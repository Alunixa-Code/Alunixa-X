//! Fail closed at lossy boundaries; keep native replay data in opaque Responses items.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

const REPLAY_PREFIX: &str = "alunixa-x-replay-v1:";
const MAX_REPLAY_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
#[error(
    "protocol_conversion_error: {0}; use a native Responses provider for unsupported capabilities"
)]
pub(super) struct ConversionError(pub String);

pub(super) fn reject<T>(path: &str) -> anyhow::Result<T> {
    Err(ConversionError(path.to_string()).into())
}

pub(super) fn validate_request(body: &Value, wire: &str) -> anyhow::Result<()> {
    let Some(object) = body.as_object() else {
        return reject("request must be an object");
    };
    for (key, value) in object {
        if value.is_null() {
            continue;
        }
        match key.as_str() {
            "model"
            | "input"
            | "instructions"
            | "tools"
            | "tool_choice"
            | "parallel_tool_calls"
            | "max_output_tokens"
            | "max_tokens"
            | "max_completion_tokens"
            | "temperature"
            | "top_p"
            | "stream"
            | "reasoning"
            | "text" => {}
            "store" | "background" if value == false => {}
            "truncation" if value == "disabled" => {}
            "include"
                if value.as_array().is_some_and(|items| {
                    items
                        .iter()
                        .all(|item| item == "reasoning.encrypted_content")
                }) => {}
            "n" if value == 1 => {}
            key if EXTRA_CHAT_PASSTHROUGH_FIELDS.contains(&key) && key != "n" => {}
            // Provider-specific thinking controls are explicitly forwarded below.
            "thinking" | "enable_thinking" | "reasoning_effort" | "reasoning_split" => {}
            _ => return reject(&format!("unsupported request field {key}")),
        }
    }
    if body
        .get("stream_options")
        .is_some_and(|v| !v.is_null() && !v.is_object())
    {
        return reject("stream_options must be an object");
    }
    let tools = body.get("tools").and_then(Value::as_array);
    if body
        .get("tools")
        .is_some_and(|v| !v.is_null() && !v.is_array())
    {
        return reject("tools must be an array");
    }
    if let Some(tools) = tools {
        validate_tools(tools)?;
        if wire == "completions" && !tools.is_empty() {
            return reject("legacy Completions cannot represent tools");
        }
    }
    if wire != "chat" {
        for key in [
            "frequency_penalty",
            "presence_penalty",
            "logit_bias",
            "logprobs",
            "top_logprobs",
            "response_format",
            "seed",
            "service_tier",
        ] {
            if body.get(key).is_some_and(|v| !v.is_null()) {
                return reject(&format!("{wire} cannot represent {key}"));
            }
        }
    }
    let input = body.get("input").unwrap_or(&Value::Null);
    let items: Vec<&Value> = match input {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![input],
        Value::Null | Value::String(_) => Vec::new(),
        _ => return reject("input must be text or structured items"),
    };
    let mut calls = BTreeSet::new();
    let mut outputs = BTreeSet::new();
    for item in items {
        let kind = item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("message");
        match kind {
            "alunixa_native_message" => {
                for id in item["call_ids"].as_array().into_iter().flatten() {
                    if let Some(id) = id.as_str() {
                        if !calls.insert(id.to_string()) {
                            return reject("duplicate native tool call id");
                        }
                    }
                }
            }
            "message" => {
                let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
                if !matches!(
                    role,
                    "user" | "assistant" | "developer" | "system" | "latest_reminder"
                ) {
                    return reject("unsupported input message role");
                }
                validate_content(item.get("content").unwrap_or(&Value::Null), wire)?;
            }
            "function_call" | "custom_tool_call" | "tool_call" => {
                if wire == "completions" {
                    return reject("legacy Completions cannot represent tool history");
                }
                let call = item.get("tool_use").unwrap_or(item);
                let id = call
                    .get("call_id")
                    .or_else(|| call.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let name = call.get("name").and_then(Value::as_str).unwrap_or("");
                if id.is_empty() || name.is_empty() || !calls.insert(id.to_string()) {
                    return reject("missing or duplicate tool call identity");
                }
                if kind != "custom_tool_call" {
                    validate_arguments(
                        call.get("arguments")
                            .or_else(|| call.get("input"))
                            .unwrap_or(&json!({})),
                    )?;
                }
            }
            "function_call_output" | "custom_tool_call_output" | "tool_result" => {
                let id = item
                    .get("call_id")
                    .or_else(|| item.get("tool_call_id"))
                    .or_else(|| item.pointer("/content/tool_use_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !calls.contains(id) || !outputs.insert(id.to_string()) {
                    return reject(
                        "orphan or duplicate tool output; matching call history is required",
                    );
                }
                let content = item
                    .get("output")
                    .or_else(|| item.pointer("/content/content"))
                    .or_else(|| item.get("content"))
                    .unwrap_or(&Value::Null);
                if content.is_array() {
                    validate_content(content, wire)?;
                    if wire == "chat"
                        && content.as_array().unwrap().iter().any(|part| {
                            !matches!(
                                part["type"].as_str(),
                                Some("text" | "input_text" | "output_text")
                            )
                        })
                    {
                        return reject("Chat tool results cannot represent non-text content");
                    }
                }
            }
            "reasoning" => {
                if item.get("encrypted_content").is_some_and(|v| !v.is_null()) {
                    return reject(
                        "opaque reasoning belongs to a different or unavailable native protocol",
                    );
                }
                if wire != "chat" && responses_reasoning_text(item).is_some_and(|s| !s.is_empty()) {
                    return reject("native reasoning requires its original signed replay item");
                }
            }
            _ => return reject(&format!("unsupported input item type {kind}")),
        }
    }
    Ok(())
}

fn validate_content(content: &Value, wire: &str) -> anyhow::Result<()> {
    if content.is_null() || content.is_string() {
        return Ok(());
    }
    let Some(parts) = content.as_array() else {
        return reject("content must be text or an array");
    };
    for part in parts {
        match part["type"].as_str() {
            Some("text" | "input_text" | "output_text" | "refusal") => {}
            Some("input_image") if wire != "completions" => {
                if part.get("image_url").is_none() {
                    return reject("image file_id has no cross-provider representation");
                }
                if wire != "chat"
                    && part
                        .get("detail")
                        .is_some_and(|v| !v.is_null() && v != "auto")
                {
                    return reject("native image detail has no equivalent mapping");
                }
            }
            Some("input_audio" | "input_file") if wire == "chat" => {}
            _ => return reject("unsupported content part"),
        }
    }
    Ok(())
}

fn validate_tools(tools: &[Value]) -> anyhow::Result<()> {
    for tool in tools {
        if tool.is_string() {
            continue;
        }
        match response_tool_type(tool) {
            "namespace" => {
                let Some(children) = tool["tools"].as_array() else {
                    return reject("namespace tools must be an array");
                };
                validate_tools(children)?;
            }
            "function" | "custom" => {
                if response_tool_name(tool).is_none() {
                    return reject("tool name is required");
                }
            }
            // Named local extension tools remain custom-call proxies, never built-in server tools.
            "image_generation"
            | "web_search"
            | "web_search_preview"
            | "file_search"
            | "code_interpreter"
            | "computer"
            | "computer_use_preview"
            | "mcp" => {
                return reject("server-side tool has no cross-protocol executor");
            }
            _ if response_tool_name(tool).is_some() => {}
            _ => return reject("unsupported unnamed tool"),
        }
    }
    let context = build_codex_tool_context(Some(&json!(tools)));
    let mut names = BTreeSet::new();
    for tool in responses_tools_to_chat_tools(tools, &context) {
        let name = tool
            .pointer("/function/name")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !names.insert(name.to_string()) {
            return reject("tool names collide after namespace conversion");
        }
    }
    Ok(())
}

pub(super) fn validate_arguments(value: &Value) -> anyhow::Result<()> {
    let parsed;
    let value = if let Some(text) = value.as_str() {
        parsed = serde_json::from_str::<Value>(text)
            .map_err(|_| ConversionError("invalid tool argument JSON".into()))?;
        &parsed
    } else {
        value
    };
    if !value.is_object() {
        return reject("tool arguments must be a JSON object");
    }
    Ok(())
}

pub(super) fn replay_item(wire: &str, native: Value, items: Vec<Value>) -> Value {
    let payload = json!({"wire":wire,"native":native,"items":items});
    json!({
        "id":format!("rs_replay_{}",uuid::Uuid::new_v4().simple()),
        "type":"reasoning",
        "summary":[],
        "encrypted_content":format!("{REPLAY_PREFIX}{}", STANDARD.encode(payload.to_string()))
    })
}

pub(super) fn attach_replay(response: &mut Value, wire: &str, native: Value) {
    let Some(items) = response["output"].as_array_mut() else {
        return;
    };
    let replay = replay_item(wire, native, items.clone());
    items.push(replay);
}

pub(super) fn prepare_history(mut body: Value, wire: &str) -> anyhow::Result<Value> {
    let Some(items) = body.get_mut("input").and_then(Value::as_array_mut) else {
        return Ok(body);
    };
    let mut rebuilt: Vec<Value> = Vec::new();
    for item in std::mem::take(items) {
        if item["type"] == "alunixa_native_message" {
            return reject("reserved native replay item");
        }
        let Some(encoded) = item["encrypted_content"]
            .as_str()
            .and_then(|s| s.strip_prefix(REPLAY_PREFIX))
        else {
            rebuilt.push(item);
            continue;
        };
        if encoded.len() > MAX_REPLAY_BYTES {
            return reject("native replay item exceeds size limit");
        }
        let payload = STANDARD
            .decode(encoded)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .ok_or_else(|| ConversionError("invalid native replay item".into()))?;
        if payload["wire"] != wire {
            return reject("native replay item cannot cross provider protocols");
        }
        let covered = payload["items"]
            .as_array()
            .ok_or_else(|| ConversionError("native replay items missing".into()))?;
        if rebuilt.len() < covered.len()
            || !rebuilt[rebuilt.len() - covered.len()..]
                .iter()
                .zip(covered)
                .all(|(actual, expected)| {
                    [
                        "type",
                        "call_id",
                        "name",
                        "namespace",
                        "arguments",
                        "input",
                        "content",
                        "summary",
                    ]
                    .iter()
                    .all(|key| actual.get(key) == expected.get(key))
                })
        {
            return reject("native replay history is missing or has been edited");
        }
        rebuilt.truncate(rebuilt.len() - covered.len());
        let call_ids: Vec<Value> = covered
            .iter()
            .filter_map(|i| i.get("call_id").cloned())
            .collect();
        let calls: Vec<Value> = covered
            .iter()
            .filter(|i| {
                matches!(
                    i["type"].as_str(),
                    Some("function_call" | "custom_tool_call")
                )
            })
            .cloned()
            .collect();
        rebuilt.push(json!({
            "type":"alunixa_native_message","role":"assistant","content":"",
            "native":payload["native"],"call_ids":call_ids,"calls":calls
        }));
    }
    *items = rebuilt;
    Ok(body)
}

pub(super) fn map_text_format(result: &mut Value, body: &Value) -> anyhow::Result<()> {
    if let Some(text) = body.get("text").filter(|v| !v.is_null()) {
        let Some(object) = text.as_object() else {
            return reject("text must be an object");
        };
        if object
            .keys()
            .any(|key| key != "format" && key != "verbosity")
        {
            return reject("unsupported text option");
        }
        if let Some(verbosity) = text.get("verbosity") {
            result["verbosity"] = verbosity.clone();
        }
        if let Some(format) = text.get("format") {
            result["response_format"] = match format["type"].as_str() {
                Some("text") => json!({"type":"text"}),
                Some("json_object") => json!({"type":"json_object"}),
                Some("json_schema") => {
                    let mut schema = format.clone();
                    schema.as_object_mut().unwrap().remove("type");
                    json!({"type":"json_schema","json_schema":schema})
                }
                _ => return reject("unsupported structured output format"),
            };
        }
    }
    Ok(())
}
