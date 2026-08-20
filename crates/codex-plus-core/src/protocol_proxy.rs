//! Codex Responses API 与 OpenAI Chat Completions 的本地协议转换。
//!
//! Codex Chat 与 Responses 协议之间的转换实现。

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use anyhow::Context;
use serde_json::{Value, json};

use crate::relay_rotation::{RotationContext, RotationEvent};
use crate::settings::{RelayProtocol, SettingsStore};

pub const DEFAULT_PROTOCOL_PROXY_PORT: u16 = 57321;
const UPSTREAM_HEADER_TIMEOUT: Duration = Duration::from_secs(30);
const UPSTREAM_STREAM_HEADER_TIMEOUT: Duration = Duration::from_secs(120);
const UPSTREAM_STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const UPSTREAM_CONNECT_RETRY_DELAY: Duration = Duration::from_millis(150);
const TRANSPARENT_PROXY_HEADER_TIMEOUT: Duration = Duration::from_secs(600);
const THINK_OPEN_TAG: &str = "<think>";
const THINK_CLOSE_TAG: &str = "</think>";
const EXTRA_CHAT_PASSTHROUGH_FIELDS: &[&str] = &[
    "frequency_penalty",
    "logit_bias",
    "logprobs",
    "metadata",
    "n",
    "presence_penalty",
    "response_format",
    "seed",
    "service_tier",
    "stop",
    "stream_options",
    "top_logprobs",
    "user",
];
const ERROR_BODY_PREVIEW_LIMIT: usize = 1024;
const GEMINI_SIGNATURE_CACHE_LIMIT: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChatReasoningStyle {
    Default,
    DeepSeek,
    LowHigh,
    OpenRouter,
    Thinking,
    EnableThinking,
    ReasoningSplit,
}

#[derive(Debug, Clone, Default)]
struct CodexToolContext {
    custom_tools: BTreeMap<String, CodexCustomToolSpec>,
    function_tools: BTreeMap<String, CodexFunctionToolSpec>,
    has_custom_tools: bool,
    has_namespace_tools: bool,
}

#[derive(Debug, Clone)]
struct CodexCustomToolSpec {
    openai_name: String,
    namespace: String,
    kind: CodexCustomToolKind,
    proxy_action: Option<CodexPatchProxyAction>,
}

#[derive(Debug, Clone, Default)]
struct CodexFunctionToolSpec {
    namespace: String,
    name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexCustomToolKind {
    Raw,
    ApplyPatch,
    BuiltIn,
}

impl Default for CodexCustomToolKind {
    fn default() -> Self {
        Self::Raw
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexPatchProxyAction {
    AddFile,
    DeleteFile,
    UpdateFile,
    ReplaceFile,
    Batch,
}

impl CodexPatchProxyAction {
    fn suffix(self) -> &'static str {
        match self {
            Self::AddFile => "add_file",
            Self::DeleteFile => "delete_file",
            Self::UpdateFile => "update_file",
            Self::ReplaceFile => "replace_file",
            Self::Batch => "batch",
        }
    }
}

impl CodexToolContext {
    fn is_custom_tool_proxy(&self, upstream_name: &str) -> bool {
        self.custom_tools.contains_key(upstream_name)
    }

    fn openai_name_for_custom_tool(&self, upstream_name: &str) -> (String, String) {
        self.custom_tools
            .get(upstream_name)
            .map(|spec| (spec.openai_name.clone(), spec.namespace.clone()))
            .unwrap_or_else(|| (upstream_name.to_string(), String::new()))
    }

    fn openai_name_for_function_tool(&self, upstream_name: &str) -> (String, String) {
        let Some(spec) = self.function_tools.get(upstream_name) else {
            return (upstream_name.to_string(), String::new());
        };
        let name = if spec.name.is_empty() {
            upstream_name.to_string()
        } else {
            spec.name.clone()
        };
        (name, spec.namespace.clone())
    }
}

pub fn local_responses_proxy_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1")
}

pub fn responses_to_chat_completions(body: Value) -> anyhow::Result<Value> {
    let mut result = json!({});

    if let Some(model) = body.get("model") {
        result["model"] = model.clone();
    }

    let mut messages = Vec::new();
    if let Some(instructions) = body.get("instructions") {
        let text = instruction_text(instructions);
        if !text.is_empty() {
            messages.push(json!({ "role": "system", "content": text }));
        }
    }

    if let Some(input) = body.get("input") {
        append_responses_input(input, &mut messages);
    }
    normalize_chat_messages(&mut messages);
    let messages = collapse_system_messages_to_head(messages);
    result["messages"] = json!(messages);

    let model = body.get("model").and_then(Value::as_str).unwrap_or("");
    if let Some(value) = body.get("max_output_tokens") {
        if is_openai_o_series(model) {
            result["max_completion_tokens"] = value.clone();
        } else {
            result["max_tokens"] = value.clone();
        }
    }
    if let Some(value) = body.get("max_tokens") {
        result["max_tokens"] = value.clone();
    }
    if let Some(value) = body.get("max_completion_tokens") {
        result["max_completion_tokens"] = value.clone();
    }

    for key in ["temperature", "top_p", "stream"] {
        if let Some(value) = body.get(key) {
            result[key] = value.clone();
        }
    }
    if body.get("stream").and_then(Value::as_bool).unwrap_or(false) {
        let mut stream_options = body
            .get("stream_options")
            .cloned()
            .unwrap_or_else(|| json!({}));
        stream_options["include_usage"] = json!(true);
        result["stream_options"] = stream_options;
    }

    apply_chat_reasoning_options(&mut result, &body, model);

    let tool_context = build_codex_tool_context(body.get("tools"));
    let mut has_chat_tools = false;
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        let converted = responses_tools_to_chat_tools(tools, &tool_context);
        if !converted.is_empty() {
            has_chat_tools = true;
            result["tools"] = json!(converted);
        }
    }

    if has_chat_tools {
        if let Some(tool_choice) = body
            .get("tool_choice")
            .and_then(|value| responses_tool_choice_to_chat(value, &tool_context))
        {
            result["tool_choice"] = tool_choice;
        }
        if let Some(value) = body.get("parallel_tool_calls") {
            result["parallel_tool_calls"] = value.clone();
        }
    }

    for key in EXTRA_CHAT_PASSTHROUGH_FIELDS {
        if *key == "stream_options" && result.get("stream_options").is_some() {
            continue;
        }
        if let Some(value) = body.get(*key) {
            result[*key] = value.clone();
        }
    }

    Ok(result)
}

pub fn responses_to_completions(body: Value) -> anyhow::Result<Value> {
    let chat = responses_to_chat_completions(body)?;
    let mut prompt = String::new();
    for message in chat
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let content = chat_content_text(message.get("content").unwrap_or(&Value::Null));
        if !content.is_empty() {
            prompt.push_str(role);
            prompt.push_str(": ");
            prompt.push_str(&content);
            prompt.push('\n');
        }
    }
    prompt.push_str("assistant:");

    let mut result = json!({
        "model": chat.get("model").cloned().unwrap_or(Value::Null),
        "prompt": prompt
    });
    for key in [
        "max_tokens",
        "temperature",
        "top_p",
        "stream",
        "frequency_penalty",
        "presence_penalty",
        "stop",
        "seed",
        "user",
    ] {
        if let Some(value) = chat.get(key) {
            result[key] = value.clone();
        }
    }
    Ok(result)
}

pub fn responses_to_anthropic_messages(body: Value) -> anyhow::Result<Value> {
    let chat = responses_to_chat_completions(body)?;
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in chat
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        if role == "system" {
            let text = chat_content_text(message.get("content").unwrap_or(&Value::Null));
            if !text.is_empty() {
                system.push(text);
            }
            continue;
        }
        if role == "tool" {
            messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": message.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                    "content": chat_content_text(message.get("content").unwrap_or(&Value::Null))
                }]
            }));
            continue;
        }

        let mut content = anthropic_content_parts(message.get("content").unwrap_or(&Value::Null));
        if role == "assistant" {
            if let Some(reasoning) = extract_reasoning_field_text(message) {
                if !reasoning.is_empty() {
                    content.insert(0, json!({ "type": "text", "text": reasoning }));
                }
            }
            if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
                for tool_call in tool_calls {
                    let function = tool_call.get("function").unwrap_or(&Value::Null);
                    content.push(json!({
                        "type": "tool_use",
                        "id": tool_call.get("id").and_then(Value::as_str).unwrap_or(""),
                        "name": function.get("name").and_then(Value::as_str).unwrap_or(""),
                        "input": parse_json_or_string(
                            function.get("arguments").and_then(Value::as_str).unwrap_or("")
                        )
                    }));
                }
            }
        }
        if content.is_empty() {
            content.push(json!({ "type": "text", "text": "" }));
        }
        messages.push(json!({
            "role": if role == "assistant" { "assistant" } else { "user" },
            "content": content
        }));
    }

    let mut result = json!({
        "model": chat.get("model").cloned().unwrap_or(Value::Null),
        "max_tokens": chat
            .get("max_tokens")
            .or_else(|| chat.get("max_completion_tokens"))
            .cloned()
            .unwrap_or_else(|| json!(4096)),
        "messages": messages,
        "stream": chat.get("stream").cloned().unwrap_or_else(|| json!(false))
    });
    if !system.is_empty() {
        result["system"] = json!(system.join("\n\n"));
    }
    if let Some(value) = chat.get("temperature") {
        result["temperature"] = value.clone();
    }
    if let Some(value) = chat.get("top_p") {
        result["top_p"] = value.clone();
    }
    if let Some(stop) = chat.get("stop") {
        result["stop_sequences"] = if stop.is_array() {
            stop.clone()
        } else {
            json!([stop])
        };
    }
    if let Some(tools) = chat.get("tools").and_then(Value::as_array) {
        let converted = tools
            .iter()
            .filter_map(|tool| {
                let function = tool.get("function")?;
                Some(json!({
                    "name": function.get("name").cloned().unwrap_or(Value::Null),
                    "description": function.get("description").cloned().unwrap_or(Value::Null),
                    "input_schema": function.get("parameters").cloned().unwrap_or_else(|| json!({
                        "type": "object",
                        "properties": {}
                    }))
                }))
            })
            .collect::<Vec<_>>();
        if !converted.is_empty() {
            result["tools"] = json!(converted);
        }
    }
    if let Some(tool_choice) = chat.get("tool_choice") {
        result["tool_choice"] = match tool_choice {
            Value::String(value) if value == "required" => json!({ "type": "any" }),
            Value::String(value) if value == "none" => json!({ "type": "none" }),
            Value::Object(_) => tool_choice
                .pointer("/function/name")
                .and_then(Value::as_str)
                .map(|name| json!({ "type": "tool", "name": name }))
                .unwrap_or_else(|| json!({ "type": "auto" })),
            _ => json!({ "type": "auto" }),
        };
    }
    Ok(result)
}

pub fn responses_to_gemini_generate_content(body: Value) -> anyhow::Result<Value> {
    let chat = responses_to_chat_completions(body)?;
    let mut system_parts = Vec::new();
    let mut contents = Vec::new();
    let mut tool_names = BTreeMap::<String, String>::new();

    for message in chat
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        if role == "system" {
            let text = chat_content_text(message.get("content").unwrap_or(&Value::Null));
            if !text.is_empty() {
                system_parts.push(json!({ "text": text }));
            }
            continue;
        }
        if role == "tool" {
            let call_id = message
                .get("tool_call_id")
                .and_then(Value::as_str)
                .unwrap_or("");
            let name = tool_names
                .get(call_id)
                .cloned()
                .unwrap_or_else(|| "tool".to_string());
            contents.push(json!({
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "name": name,
                        "response": { "result": chat_content_text(message.get("content").unwrap_or(&Value::Null)) }
                    }
                }]
            }));
            continue;
        }

        let mut parts = gemini_content_parts(message.get("content").unwrap_or(&Value::Null));
        if role == "assistant" {
            if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
                for tool_call in tool_calls {
                    let function = tool_call.get("function").unwrap_or(&Value::Null);
                    let name = function
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool");
                    let call_id = tool_call.get("id").and_then(Value::as_str).unwrap_or(name);
                    tool_names.insert(call_id.to_string(), name.to_string());
                    let mut part = json!({
                        "functionCall": {
                            "name": name,
                            "args": parse_json_or_string(
                                function.get("arguments").and_then(Value::as_str).unwrap_or("")
                            )
                        }
                    });
                    if let Some(signature) = gemini_thought_signature(call_id) {
                        part["thoughtSignature"] = json!(signature);
                    }
                    parts.push(part);
                }
            }
        }
        if parts.is_empty() {
            parts.push(json!({ "text": "" }));
        }
        contents.push(json!({
            "role": if role == "assistant" { "model" } else { "user" },
            "parts": parts
        }));
    }

    let mut result = json!({ "contents": contents });
    if !system_parts.is_empty() {
        result["systemInstruction"] = json!({ "parts": system_parts });
    }
    let mut generation_config = json!({});
    if let Some(value) = chat
        .get("max_tokens")
        .or_else(|| chat.get("max_completion_tokens"))
    {
        generation_config["maxOutputTokens"] = value.clone();
    }
    if let Some(value) = chat.get("temperature") {
        generation_config["temperature"] = value.clone();
    }
    if let Some(value) = chat.get("top_p") {
        generation_config["topP"] = value.clone();
    }
    if let Some(stop) = chat.get("stop") {
        generation_config["stopSequences"] = if stop.is_array() {
            stop.clone()
        } else {
            json!([stop])
        };
    }
    if generation_config
        .as_object()
        .is_some_and(|object| !object.is_empty())
    {
        result["generationConfig"] = generation_config;
    }
    if let Some(tools) = chat.get("tools").and_then(Value::as_array) {
        let declarations = tools
            .iter()
            .filter_map(|tool| {
                let function = tool.get("function")?;
                Some(json!({
                    "name": function.get("name").cloned().unwrap_or(Value::Null),
                    "description": function.get("description").cloned().unwrap_or(Value::Null),
                    "parameters": function.get("parameters").cloned().unwrap_or_else(|| json!({
                        "type": "object",
                        "properties": {}
                    }))
                }))
            })
            .collect::<Vec<_>>();
        if !declarations.is_empty() {
            result["tools"] = json!([{ "functionDeclarations": declarations }]);
        }
    }
    Ok(result)
}

pub fn chat_completion_to_response(body: Value) -> anyhow::Result<Value> {
    chat_completion_to_response_with_context(body, &CodexToolContext::default(), None)
}

pub fn chat_completion_to_response_with_request(
    body: Value,
    original_request: &Value,
) -> anyhow::Result<Value> {
    let context = build_codex_tool_context(original_request.get("tools"));
    chat_completion_to_response_with_context(body, &context, Some(original_request))
}

pub fn completion_to_response_with_request(
    body: Value,
    original_request: &Value,
) -> anyhow::Result<Value> {
    chat_completion_to_response_with_request(completion_to_chat_completion(body), original_request)
}

pub fn anthropic_message_to_response_with_request(
    body: Value,
    original_request: &Value,
) -> anyhow::Result<Value> {
    chat_completion_to_response_with_request(
        anthropic_message_to_chat_completion(body),
        original_request,
    )
}

pub fn gemini_generate_content_to_response_with_request(
    body: Value,
    original_request: &Value,
) -> anyhow::Result<Value> {
    chat_completion_to_response_with_request(
        gemini_generate_content_to_chat_completion(body, original_request),
        original_request,
    )
}

fn chat_completion_to_response_with_context(
    body: Value,
    tool_context: &CodexToolContext,
    original_request: Option<&Value>,
) -> anyhow::Result<Value> {
    let choices = body
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("chat response missing choices"))?;
    let choice = choices
        .first()
        .ok_or_else(|| anyhow::anyhow!("chat response choices is empty"))?;
    let message = choice
        .get("message")
        .ok_or_else(|| anyhow::anyhow!("chat response choice missing message"))?;

    let response_id = response_id_from_chat_id(body.get("id").and_then(Value::as_str));
    let mut output = Vec::new();
    if let Some(reasoning) = chat_reasoning_to_response_output_item(message, &response_id) {
        output.push(reasoning);
    }
    if let Some(message) = chat_message_to_response_output_item(message, &response_id) {
        output.push(message);
    }
    output.extend(chat_tool_calls_to_response_output_items(
        message,
        tool_context,
    ));

    let mut response = json!({
        "id": response_id,
        "object": "response",
        "created_at": body.get("created").and_then(Value::as_u64).unwrap_or(0),
        "status": response_status(choice.get("finish_reason").and_then(Value::as_str)),
        "model": body.get("model").and_then(Value::as_str).unwrap_or(""),
        "output": output,
        "usage": chat_usage_to_responses_usage(body.get("usage"))
    });

    if choice.get("finish_reason").and_then(Value::as_str) == Some("length") {
        response["incomplete_details"] = json!({ "reason": "max_output_tokens" });
    }
    copy_response_request_fields(&mut response, original_request);

    Ok(response)
}

fn completion_to_chat_completion(body: Value) -> Value {
    let choices = body
        .get("choices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|choice| {
            json!({
                "index": choice.get("index").cloned().unwrap_or_else(|| json!(0)),
                "message": {
                    "role": "assistant",
                    "content": choice.get("text").cloned().unwrap_or_else(|| json!(""))
                },
                "finish_reason": choice.get("finish_reason").cloned().unwrap_or(Value::Null)
            })
        })
        .collect::<Vec<_>>();
    json!({
        "id": body.get("id").cloned().unwrap_or_else(|| json!("cmpl_compat")),
        "created": body.get("created").cloned().unwrap_or_else(|| json!(0)),
        "model": body.get("model").cloned().unwrap_or_else(|| json!("")),
        "choices": choices,
        "usage": body.get("usage").cloned().unwrap_or(Value::Null)
    })
}

fn anthropic_message_to_chat_completion(body: Value) -> Value {
    let mut text = String::new();
    let mut reasoning = String::new();
    let mut tool_calls = Vec::new();
    for (index, block) in body
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        match block.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => {
                if let Some(value) = block.get("text").and_then(Value::as_str) {
                    text.push_str(value);
                }
            }
            "thinking" | "redacted_thinking" => {
                if let Some(value) = block
                    .get("thinking")
                    .or_else(|| block.get("text"))
                    .and_then(Value::as_str)
                {
                    reasoning.push_str(value);
                }
            }
            "tool_use" => {
                tool_calls.push(json!({
                    "id": block
                        .get("id")
                        .cloned()
                        .unwrap_or_else(|| json!(format!("call_{index}"))),
                    "type": "function",
                    "function": {
                        "name": block.get("name").cloned().unwrap_or_else(|| json!("tool")),
                        "arguments": serde_json::to_string(
                            block.get("input").unwrap_or(&json!({}))
                        ).unwrap_or_else(|_| "{}".to_string())
                    }
                }));
            }
            _ => {}
        }
    }
    let mut message = json!({
        "role": "assistant",
        "content": text
    });
    if !reasoning.is_empty() {
        message["reasoning_content"] = json!(reasoning);
    }
    if !tool_calls.is_empty() {
        message["tool_calls"] = json!(tool_calls);
    }
    let finish_reason = match body.get("stop_reason").and_then(Value::as_str) {
        Some("max_tokens") => "length",
        Some("tool_use") => "tool_calls",
        _ => "stop",
    };
    json!({
        "id": body.get("id").cloned().unwrap_or_else(|| json!("msg_compat")),
        "created": 0,
        "model": body.get("model").cloned().unwrap_or_else(|| json!("")),
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason
        }],
        "usage": anthropic_usage_to_chat_usage(body.get("usage"))
    })
}

fn gemini_generate_content_to_chat_completion(body: Value, original_request: &Value) -> Value {
    let candidate = body
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut text = String::new();
    let mut reasoning = String::new();
    let mut tool_calls = Vec::new();
    for (index, part) in candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(value) = part.get("text").and_then(Value::as_str) {
            if part
                .get("thought")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                reasoning.push_str(value);
            } else {
                text.push_str(value);
            }
        }
        if let Some(call) = part.get("functionCall") {
            let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
            let call_id = format!("call_gemini_{index}");
            if let Some(signature) = part.get("thoughtSignature").and_then(Value::as_str) {
                remember_gemini_thought_signature(&call_id, signature);
            }
            tool_calls.push(json!({
                "id": call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": serde_json::to_string(
                        call.get("args").unwrap_or(&json!({}))
                    ).unwrap_or_else(|_| "{}".to_string())
                }
            }));
        }
    }
    let mut message = json!({
        "role": "assistant",
        "content": text
    });
    if !reasoning.is_empty() {
        message["reasoning_content"] = json!(reasoning);
    }
    if !tool_calls.is_empty() {
        message["tool_calls"] = json!(tool_calls);
    }
    let finish_reason = match candidate.get("finishReason").and_then(Value::as_str) {
        Some("MAX_TOKENS") => "length",
        Some("STOP") | None if !tool_calls.is_empty() => "tool_calls",
        _ => "stop",
    };
    json!({
        "id": body
            .get("responseId")
            .cloned()
            .unwrap_or_else(|| json!("gemini_compat")),
        "created": 0,
        "model": original_request
            .get("model")
            .cloned()
            .unwrap_or_else(|| json!("")),
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason
        }],
        "usage": gemini_usage_to_chat_usage(body.get("usageMetadata"))
    })
}

pub struct ProxyHttpResponse {
    pub status: String,
    pub content_type: String,
    pub body: Vec<u8>,
}

pub struct UpstreamProxyResponse {
    pub status_code: u16,
    pub content_type: String,
    pub is_stream: bool,
    pub wire_api: UpstreamWireApi,
    pub response: reqwest::Response,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum UpstreamWireApi {
    Responses,
    ChatCompletions,
    Completions,
    AnthropicMessages,
    GeminiGenerateContent,
    AudioTranscriptions,
    Transparent,
}

#[derive(Debug, Clone)]
struct ModelRouteSelection {
    relay: crate::settings::RelayProfile,
    source_relay_id: String,
    source_model: String,
    upstream_model: String,
}

impl UpstreamProxyResponse {
    pub fn status(&self) -> String {
        http_status_line(self.status_code)
    }

    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status_code)
    }
}

pub fn upstream_header_timeout() -> Duration {
    UPSTREAM_HEADER_TIMEOUT
}

pub fn upstream_stream_header_timeout() -> Duration {
    UPSTREAM_STREAM_HEADER_TIMEOUT
}

pub fn upstream_stream_idle_timeout() -> Duration {
    UPSTREAM_STREAM_IDLE_TIMEOUT
}

pub fn upstream_http_client() -> anyhow::Result<reqwest::Client> {
    crate::http_client::proxied_client("CodexPlusPlus/ProtocolProxy")
        .context("failed to build upstream HTTP client")
}

pub async fn send_upstream_request(
    request: reqwest::RequestBuilder,
) -> anyhow::Result<reqwest::Response> {
    send_upstream_request_with_header_timeout(request, UPSTREAM_HEADER_TIMEOUT).await
}

pub async fn send_upstream_request_for_responses(
    request: reqwest::RequestBuilder,
    is_stream: bool,
) -> anyhow::Result<reqwest::Response> {
    let timeout = response_header_timeout(is_stream);
    send_upstream_request_with_header_timeout(request, timeout).await
}

pub async fn send_upstream_request_with_header_timeout(
    request: reqwest::RequestBuilder,
    timeout: Duration,
) -> anyhow::Result<reqwest::Response> {
    tokio::time::timeout(timeout, request.send())
        .await
        .with_context(|| format!("上游请求超过 {} 秒未返回响应头", timeout.as_secs()))?
        .context("上游请求失败")
}

pub struct ChatSseToResponsesConverter {
    buffer: String,
    utf8_remainder: Vec<u8>,
    state: ChatSseState,
    failed: bool,
}

impl Default for ChatSseToResponsesConverter {
    fn default() -> Self {
        Self {
            buffer: String::new(),
            utf8_remainder: Vec::new(),
            state: ChatSseState::default(),
            failed: false,
        }
    }
}

impl ChatSseToResponsesConverter {
    pub fn with_request(original_request: &Value) -> Self {
        Self {
            state: ChatSseState::with_request(original_request),
            ..Self::default()
        }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<u8> {
        append_utf8_safe(&mut self.buffer, &mut self.utf8_remainder, bytes);
        let mut output = String::new();
        while let Some(block) = take_sse_block(&mut self.buffer) {
            if block.trim().is_empty() {
                continue;
            }
            self.handle_block(&block, &mut output);
            if self.failed {
                break;
            }
        }
        output.into_bytes()
    }

    pub fn finish(&mut self) -> Vec<u8> {
        if !self.utf8_remainder.is_empty() {
            self.buffer
                .push_str(&String::from_utf8_lossy(&self.utf8_remainder));
            self.utf8_remainder.clear();
        }

        let mut output = String::new();
        if !self.failed {
            self.state.finalize_into(&mut output);
        }
        output.into_bytes()
    }

    pub fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        let mut output = String::new();
        self.state.failed_into(&mut output, message, error_type);
        self.failed = true;
        output.into_bytes()
    }

    pub fn is_completed(&self) -> bool {
        self.failed || self.state.completed
    }

    fn handle_block(&mut self, block: &str, output: &mut String) {
        let mut event_name: Option<String> = None;
        let mut data_parts = Vec::new();
        for line in block.lines() {
            if let Some(event) = strip_sse_field(line, "event") {
                event_name = Some(event.trim().to_string());
            }
            if let Some(data) = strip_sse_field(line, "data") {
                data_parts.push(data.to_string());
            }
        }

        if data_parts.is_empty() {
            return;
        }
        let data = data_parts.join("\n");
        if data.trim() == "[DONE]" {
            self.state.finalize_into(output);
            return;
        }

        let Ok(chunk) = serde_json::from_str::<Value>(&data) else {
            return;
        };
        if event_name.as_deref() == Some("error") || chunk.get("error").is_some() {
            let (message, error_type) = extract_chat_sse_error(&chunk);
            self.state.failed_into(output, message, error_type);
            self.failed = true;
            return;
        }
        self.state.handle_chat_chunk_into(&chunk, output);
    }
}

pub struct NativeSseToResponsesConverter {
    wire_api: UpstreamWireApi,
    buffer: String,
    utf8_remainder: Vec<u8>,
    state: ChatSseState,
    failed: bool,
    next_tool_index: usize,
}

impl NativeSseToResponsesConverter {
    pub fn with_request(wire_api: UpstreamWireApi, original_request: &Value) -> Self {
        Self {
            wire_api,
            buffer: String::new(),
            utf8_remainder: Vec::new(),
            state: ChatSseState::with_request(original_request),
            failed: false,
            next_tool_index: 0,
        }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<u8> {
        append_utf8_safe(&mut self.buffer, &mut self.utf8_remainder, bytes);
        let mut output = String::new();
        while let Some(block) = take_sse_block(&mut self.buffer) {
            if block.trim().is_empty() {
                continue;
            }
            self.handle_block(&block, &mut output);
            if self.is_completed() {
                break;
            }
        }
        output.into_bytes()
    }

    pub fn finish(&mut self) -> Vec<u8> {
        if !self.utf8_remainder.is_empty() {
            self.buffer
                .push_str(&String::from_utf8_lossy(&self.utf8_remainder));
            self.utf8_remainder.clear();
        }
        let mut output = String::new();
        if !self.failed && !self.state.completed {
            if !self.buffer.trim().is_empty() {
                let block = std::mem::take(&mut self.buffer);
                self.handle_block(&block, &mut output);
            }
            if !self.state.completed {
                self.state.finalize_into(&mut output);
            }
        }
        output.into_bytes()
    }

    pub fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        let mut output = String::new();
        self.state.failed_into(&mut output, message, error_type);
        self.failed = true;
        output.into_bytes()
    }

    pub fn is_completed(&self) -> bool {
        self.failed || self.state.completed
    }

    fn handle_block(&mut self, block: &str, output: &mut String) {
        let (event_name, data) = sse_event_and_data(block);
        let Some(data) = data else {
            return;
        };
        if data.trim() == "[DONE]" {
            self.state.finalize_into(output);
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            return;
        };
        if event_name.as_deref() == Some("error") || value.get("error").is_some() {
            let (message, error_type) = extract_chat_sse_error(&value);
            self.state.failed_into(output, message, error_type);
            self.failed = true;
            return;
        }
        match self.wire_api {
            UpstreamWireApi::Completions => self.handle_completion_chunk(&value, output),
            UpstreamWireApi::AnthropicMessages => {
                self.handle_anthropic_event(event_name.as_deref(), &value, output)
            }
            UpstreamWireApi::GeminiGenerateContent => self.handle_gemini_chunk(&value, output),
            _ => {}
        }
    }

    fn handle_completion_chunk(&mut self, value: &Value, output: &mut String) {
        let choices = value
            .get("choices")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|choice| {
                json!({
                    "index": choice.get("index").cloned().unwrap_or_else(|| json!(0)),
                    "delta": {
                        "content": choice.get("text").cloned().unwrap_or_else(|| json!(""))
                    },
                    "finish_reason": choice.get("finish_reason").cloned().unwrap_or(Value::Null)
                })
            })
            .collect::<Vec<_>>();
        let chunk = json!({
            "id": value.get("id").cloned().unwrap_or_else(|| json!("cmpl_compat")),
            "created": value.get("created").cloned().unwrap_or_else(|| json!(0)),
            "model": value.get("model").cloned().unwrap_or_else(|| json!("")),
            "choices": choices,
            "usage": value.get("usage").cloned().unwrap_or(Value::Null)
        });
        self.state.handle_chat_chunk_into(&chunk, output);
        if value
            .pointer("/choices/0/finish_reason")
            .is_some_and(|reason| !reason.is_null())
        {
            self.state.finalize_into(output);
        }
    }

    fn handle_anthropic_event(
        &mut self,
        event_name: Option<&str>,
        value: &Value,
        output: &mut String,
    ) {
        let event_type = event_name
            .or_else(|| value.get("type").and_then(Value::as_str))
            .unwrap_or("");
        match event_type {
            "message_start" => {
                let message = value.get("message").unwrap_or(value);
                self.state.handle_chat_chunk_into(
                    &json!({
                        "id": message.get("id").cloned().unwrap_or_else(|| json!("msg_compat")),
                        "model": message.get("model").cloned().unwrap_or_else(|| json!("")),
                        "choices": [],
                        "usage": anthropic_usage_to_chat_usage(message.get("usage"))
                    }),
                    output,
                );
            }
            "content_block_start" => {
                let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let block = value.get("content_block").unwrap_or(&Value::Null);
                match block.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text" => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            self.push_chat_text_delta(text, output);
                        }
                    }
                    "thinking" => {
                        if let Some(text) = block.get("thinking").and_then(Value::as_str) {
                            self.push_chat_reasoning_delta(text, output);
                        }
                    }
                    "tool_use" => {
                        let arguments = block
                            .get("input")
                            .filter(|input| {
                                !input.is_null()
                                    && input.as_object().is_none_or(|object| !object.is_empty())
                            })
                            .map(|input| serde_json::to_string(input).unwrap_or_default())
                            .unwrap_or_default();
                        self.push_chat_tool_delta(
                            index,
                            block.get("id").and_then(Value::as_str),
                            block.get("name").and_then(Value::as_str),
                            &arguments,
                            output,
                        );
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let delta = value.get("delta").unwrap_or(&Value::Null);
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" => self.push_chat_text_delta(
                        delta.get("text").and_then(Value::as_str).unwrap_or(""),
                        output,
                    ),
                    "thinking_delta" => self.push_chat_reasoning_delta(
                        delta.get("thinking").and_then(Value::as_str).unwrap_or(""),
                        output,
                    ),
                    "input_json_delta" => self.push_chat_tool_delta(
                        index,
                        None,
                        None,
                        delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or(""),
                        output,
                    ),
                    _ => {}
                }
            }
            "message_delta" => {
                let stop_reason = value
                    .pointer("/delta/stop_reason")
                    .and_then(Value::as_str)
                    .map(anthropic_finish_reason);
                let mut chunk = json!({
                    "choices": [{
                        "delta": {},
                        "finish_reason": stop_reason
                    }]
                });
                if let Some(usage) = value.get("usage") {
                    chunk["usage"] = anthropic_usage_to_chat_usage(Some(usage));
                }
                self.state.handle_chat_chunk_into(&chunk, output);
            }
            "message_stop" => self.state.finalize_into(output),
            "error" => {
                let (message, error_type) = extract_chat_sse_error(value);
                self.state.failed_into(output, message, error_type);
                self.failed = true;
            }
            _ => {}
        }
    }

    fn handle_gemini_chunk(&mut self, value: &Value, output: &mut String) {
        if let Some(error) = value.get("error") {
            let (message, error_type) = extract_chat_sse_error(error);
            self.state.failed_into(output, message, error_type);
            self.failed = true;
            return;
        }
        let candidate = value
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|items| items.first());
        let mut delta = json!({});
        let mut content = String::new();
        let mut reasoning = String::new();
        let mut tool_calls = Vec::new();
        if let Some(parts) = candidate
            .and_then(|candidate| candidate.pointer("/content/parts"))
            .and_then(Value::as_array)
        {
            for part in parts {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if part
                        .get("thought")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        reasoning.push_str(text);
                    } else {
                        content.push_str(text);
                    }
                }
                if let Some(call) = part.get("functionCall") {
                    let index = self.next_tool_index;
                    self.next_tool_index += 1;
                    let call_id = format!("call_gemini_{index}");
                    if let Some(signature) = part.get("thoughtSignature").and_then(Value::as_str) {
                        remember_gemini_thought_signature(&call_id, signature);
                    }
                    tool_calls.push(json!({
                        "index": index,
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": call.get("name").cloned().unwrap_or_else(|| json!("tool")),
                            "arguments": serde_json::to_string(
                                call.get("args").unwrap_or(&json!({}))
                            ).unwrap_or_else(|_| "{}".to_string())
                        }
                    }));
                }
            }
        }
        if !content.is_empty() {
            delta["content"] = json!(content);
        }
        if !reasoning.is_empty() {
            delta["reasoning_content"] = json!(reasoning);
        }
        if !tool_calls.is_empty() {
            delta["tool_calls"] = json!(tool_calls);
        }
        let finish_reason = candidate
            .and_then(|candidate| candidate.get("finishReason"))
            .and_then(Value::as_str)
            .map(|reason| gemini_finish_reason(reason, !delta["tool_calls"].is_null()));
        let mut chunk = json!({
            "id": value.get("responseId").cloned().unwrap_or_else(|| json!("gemini_compat")),
            "model": self
                .state
                .original_request
                .as_ref()
                .and_then(|request| request.get("model"))
                .cloned()
                .unwrap_or_else(|| json!("")),
            "choices": [{
                "delta": delta,
                "finish_reason": finish_reason
            }]
        });
        if let Some(usage) = value.get("usageMetadata") {
            chunk["usage"] = gemini_usage_to_chat_usage(Some(usage));
        }
        self.state.handle_chat_chunk_into(&chunk, output);
        if finish_reason.is_some() {
            self.state.finalize_into(output);
        }
    }

    fn push_chat_text_delta(&mut self, text: &str, output: &mut String) {
        if text.is_empty() {
            return;
        }
        self.state.handle_chat_chunk_into(
            &json!({ "choices": [{ "delta": { "content": text } }] }),
            output,
        );
    }

    fn push_chat_reasoning_delta(&mut self, text: &str, output: &mut String) {
        if text.is_empty() {
            return;
        }
        self.state.handle_chat_chunk_into(
            &json!({ "choices": [{ "delta": { "reasoning_content": text } }] }),
            output,
        );
    }

    fn push_chat_tool_delta(
        &mut self,
        index: usize,
        id: Option<&str>,
        name: Option<&str>,
        arguments: &str,
        output: &mut String,
    ) {
        let mut tool_call = json!({
            "index": index,
            "type": "function",
            "function": { "arguments": arguments }
        });
        if let Some(id) = id {
            tool_call["id"] = json!(id);
        }
        if let Some(name) = name {
            tool_call["function"]["name"] = json!(name);
        }
        self.state.handle_chat_chunk_into(
            &json!({ "choices": [{ "delta": { "tool_calls": [tool_call] } }] }),
            output,
        );
    }
}

pub enum UpstreamSseToResponsesConverter {
    Chat(ChatSseToResponsesConverter),
    Native(NativeSseToResponsesConverter),
}

impl UpstreamSseToResponsesConverter {
    pub fn with_request(wire_api: UpstreamWireApi, original_request: &Value) -> Option<Self> {
        match wire_api {
            UpstreamWireApi::Responses
            | UpstreamWireApi::AudioTranscriptions
            | UpstreamWireApi::Transparent => None,
            UpstreamWireApi::ChatCompletions => Some(Self::Chat(
                ChatSseToResponsesConverter::with_request(original_request),
            )),
            UpstreamWireApi::Completions
            | UpstreamWireApi::AnthropicMessages
            | UpstreamWireApi::GeminiGenerateContent => Some(Self::Native(
                NativeSseToResponsesConverter::with_request(wire_api, original_request),
            )),
        }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<u8> {
        match self {
            Self::Chat(converter) => converter.push_bytes(bytes),
            Self::Native(converter) => converter.push_bytes(bytes),
        }
    }

    pub fn finish(&mut self) -> Vec<u8> {
        match self {
            Self::Chat(converter) => converter.finish(),
            Self::Native(converter) => converter.finish(),
        }
    }

    pub fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        match self {
            Self::Chat(converter) => converter.fail(message, error_type),
            Self::Native(converter) => converter.fail(message, error_type),
        }
    }

    pub fn is_completed(&self) -> bool {
        match self {
            Self::Chat(converter) => converter.is_completed(),
            Self::Native(converter) => converter.is_completed(),
        }
    }
}

pub fn is_responses_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/responses"
            | "/v1/responses"
            | "/v1/v1/responses"
            | "/codex/v1/responses"
            | "/responses/compact"
            | "/v1/responses/compact"
            | "/v1/v1/responses/compact"
            | "/codex/v1/responses/compact"
    )
}

pub fn is_responses_compact_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/responses/compact"
            | "/v1/responses/compact"
            | "/v1/v1/responses/compact"
            | "/codex/v1/responses/compact"
    )
}

pub fn is_chat_completions_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/chat/completions"
            | "/v1/chat/completions"
            | "/v1/v1/chat/completions"
            | "/codex/v1/chat/completions"
    )
}

pub fn is_models_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/models" | "/v1/models" | "/v1/v1/models" | "/codex/v1/models"
    )
}

pub fn is_audio_transcriptions_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/audio/transcriptions"
            | "/v1/audio/transcriptions"
            | "/v1/v1/audio/transcriptions"
            | "/codex/v1/audio/transcriptions"
    )
}

pub fn is_transparent_api_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    if path == "/v1"
        || path.starts_with("/v1/")
        || path == "/codex/v1"
        || path.starts_with("/codex/v1/")
    {
        return true;
    }

    let first_segment = path
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or_default();
    matches!(
        first_segment,
        "assistants"
            | "audio"
            | "batches"
            | "chat"
            | "completions"
            | "containers"
            | "embeddings"
            | "evals"
            | "files"
            | "fine_tuning"
            | "images"
            | "models"
            | "moderations"
            | "realtime"
            | "responses"
            | "threads"
            | "uploads"
            | "vector_stores"
            | "videos"
    )
}

pub async fn open_transparent_proxy_request(
    method: &str,
    request_path: &str,
    request_headers: &[(String, String)],
    body: reqwest::Body,
    body_len: Option<u64>,
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    open_transparent_proxy_request_with_settings(
        method,
        request_path,
        request_headers,
        body,
        body_len,
        original_user_agent,
        settings,
    )
    .await
}

pub async fn open_transparent_proxy_request_with_settings(
    method: &str,
    request_path: &str,
    request_headers: &[(String, String)],
    body: reqwest::Body,
    body_len: Option<u64>,
    original_user_agent: Option<&str>,
    settings: crate::settings::BackendSettings,
) -> anyhow::Result<UpstreamProxyResponse> {
    if !is_transparent_api_proxy_path(request_path) {
        anyhow::bail!("不允许透明代理非 OpenAI API 路径：{request_path}");
    }
    let relay = transparent_proxy_relay(&settings)?;
    validate_upstream(&relay)?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).context("HTTP 方法无效")?;
    let endpoint = transparent_api_url(&relay.base_url, request_path);
    let client = crate::http_client::proxied_client(&effective_user_agent(
        &relay.user_agent,
        original_user_agent,
    ))?;
    let mut request = client.request(method.clone(), &endpoint);
    for (name, value) in request_headers {
        if !transparent_request_header_allowed(name) {
            continue;
        }
        let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
            continue;
        };
        let Ok(value) = reqwest::header::HeaderValue::from_str(value) else {
            continue;
        };
        request = request.header(name, value);
    }
    request = match relay.protocol {
        RelayProtocol::AnthropicMessages => request
            .header("x-api-key", relay.api_key.trim())
            .header("anthropic-version", "2023-06-01"),
        RelayProtocol::GeminiGenerateContent => {
            request.header("x-goog-api-key", relay.api_key.trim())
        }
        _ => request.bearer_auth(relay.api_key.trim()),
    };
    if let Some(body_len) = body_len {
        request = request.header(reqwest::header::CONTENT_LENGTH, body_len);
    }
    if method != reqwest::Method::GET && method != reqwest::Method::HEAD {
        request = request.body(body);
    }

    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.transparent_request",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "method": method.as_str(),
            "path": request_path.split_once('?').map_or(request_path, |(path, _)| path),
            "endpoint": sanitized_endpoint(&endpoint),
            "bodyBytes": body_len,
            "headerTimeoutSeconds": TRANSPARENT_PROXY_HEADER_TIMEOUT.as_secs()
        }),
    );
    let upstream =
        match send_upstream_request_with_header_timeout(request, TRANSPARENT_PROXY_HEADER_TIMEOUT)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "protocol_proxy.transparent_request_failed",
                    json!({
                        "relayId": relay.id,
                        "relayName": relay.name,
                        "method": method.as_str(),
                        "path": request_path.split_once('?').map_or(request_path, |(path, _)| path),
                        "endpoint": sanitized_endpoint(&endpoint),
                        "bodyBytes": body_len,
                        "error": sanitized_upstream_error(&error)
                    }),
                );
                return Err(error).context("透明 API 上游请求失败");
            }
        };
    let status_code = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_stream = content_type.contains("text/event-stream");
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.transparent_response",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "method": method.as_str(),
            "path": request_path.split_once('?').map_or(request_path, |(path, _)| path),
            "statusCode": status_code,
            "stream": is_stream
        }),
    );
    Ok(UpstreamProxyResponse {
        status_code,
        content_type,
        is_stream,
        wire_api: UpstreamWireApi::Transparent,
        response: upstream,
    })
}

fn transparent_proxy_relay(
    settings: &crate::settings::BackendSettings,
) -> anyhow::Result<crate::settings::RelayProfile> {
    let relay = crate::relay_rotation::select_relay_for_probe(settings)?;
    if relay.relay_mode != crate::settings::RelayMode::CustomModels {
        return Ok(relay);
    }
    let model = relay
        .default_custom_model()
        .context("自定义供应商未配置默认模型，无法选择透明 API 上游")?;
    let mut synthetic = relay.clone();
    synthetic.base_url = model.base_url.clone();
    synthetic.upstream_base_url = model.base_url.clone();
    synthetic.api_key = model.api_key.clone();
    synthetic.protocol = model.protocol;
    synthetic.model = model.model.clone();
    Ok(synthetic)
}

fn transparent_request_header_allowed(name: &str) -> bool {
    !matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "authorization"
            | "connection"
            | "content-length"
            | "cookie"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "user-agent"
    )
}

pub async fn open_responses_proxy_request(
    body: &str,
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_for_path(body, original_user_agent, "/responses").await
}

pub async fn open_responses_proxy_request_for_path(
    body: &str,
    original_user_agent: Option<&str>,
    request_path: &str,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    open_responses_proxy_request_with_settings_and_user_agent(
        body,
        settings,
        original_user_agent,
        request_path,
    )
    .await
}

pub async fn open_responses_proxy_request_with_settings(
    body: &str,
    settings: crate::settings::BackendSettings,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_with_settings_for_path(body, settings, "/responses").await
}

pub async fn open_responses_proxy_request_with_settings_for_path(
    body: &str,
    settings: crate::settings::BackendSettings,
    request_path: &str,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_with_settings_and_user_agent(body, settings, None, request_path)
        .await
}

async fn open_responses_proxy_request_with_settings_and_user_agent(
    body: &str,
    settings: crate::settings::BackendSettings,
    original_user_agent: Option<&str>,
    request_path: &str,
) -> anyhow::Result<UpstreamProxyResponse> {
    let mut request_json: Value = serde_json::from_str(body)?;
    let is_stream = request_json
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let source_model = request_json
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let model_route = select_model_route(&settings, &source_model)?;
    if let Some(route) = &model_route
        && route.upstream_model != source_model
    {
        request_json["model"] = Value::String(route.upstream_model.clone());
    }
    let context = RotationContext {
        conversation_id: conversation_id_from_responses_request(&request_json),
    };
    let selected_relay = if let Some(route) = &model_route {
        route.relay.clone()
    } else {
        crate::relay_rotation::select_relay_for_request(&settings, context)?
    };
    if selected_relay.relay_mode == crate::settings::RelayMode::CustomModels {
        return open_custom_models_proxy_request(
            &selected_relay,
            &request_json,
            is_stream,
            original_user_agent,
        )
        .await;
    }
    let relays = if model_route.is_some() {
        vec![selected_relay]
    } else {
        let mut relays = vec![selected_relay.clone()];
        relays.extend(crate::relay_rotation::fallback_relays_after(
            &settings,
            &selected_relay.id,
        )?);
        relays
    };
    let relay_count = relays.len();
    for (attempt, relay) in relays.into_iter().enumerate() {
        validate_upstream(&relay)?;
        let (mut endpoint, upstream_body, wire_api) =
            upstream_request_parts(&relay, request_json.clone()).await?;
        if wire_api == UpstreamWireApi::Responses && is_responses_compact_proxy_path(request_path) {
            endpoint = responses_compact_url(&relay.base_url);
        }
        let has_more_candidates = attempt + 1 < relay_count;
        let header_timeout = response_header_timeout(is_stream);
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "protocol_proxy.upstream_request",
            json!({
                "relayId": relay.id,
                "relayName": relay.name,
                "endpoint": sanitized_endpoint(&endpoint),
                "wireApi": wire_api,
                "stream": is_stream,
                "attempt": attempt + 1,
                "candidateCount": relay_count,
                "headerTimeoutSeconds": header_timeout.as_secs(),
                "requestToolSummary": response_tools_diagnostic_summary(request_json.get("tools")),
                "upstreamToolSummary": response_tools_diagnostic_summary(upstream_body.get("tools")),
                "modelRoute": model_route.as_ref().map(|route| json!({
                    "sourceRelayId": route.source_relay_id,
                    "sourceModel": route.source_model,
                    "targetRelayId": route.relay.id,
                    "upstreamModel": route.upstream_model
                }))
            }),
        );
        let client = crate::http_client::proxied_client(&effective_user_agent(
            &relay.user_agent,
            original_user_agent,
        ))?;
        let (upstream, connection_retried) = send_json_upstream_with_connect_retry(
            client,
            &endpoint,
            relay.api_key.trim(),
            is_stream,
            &upstream_body,
            wire_api,
        )
        .await;
        let upstream = match upstream {
            Ok(upstream) => upstream,
            Err(error) => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "protocol_proxy.upstream_request_failed",
                    json!({
                        "relayId": relay.id,
                        "relayName": relay.name,
                        "endpoint": sanitized_endpoint(&endpoint),
                        "wireApi": wire_api,
                        "stream": is_stream,
                        "attempt": attempt + 1,
                        "candidateCount": relay_count,
                        "headerTimeoutSeconds": header_timeout.as_secs(),
                        "willFailover": has_more_candidates,
                        "connectionRetried": connection_retried,
                        "error": sanitized_upstream_error(&error)
                    }),
                );
                crate::relay_rotation::record_relay_request_failure(&settings);
                if has_more_candidates {
                    continue;
                }
                return Err(error).with_context(|| {
                    format!(
                        "供应商「{}」请求上游失败，endpoint: {}",
                        relay.name, endpoint
                    )
                });
            }
        };
        let status_code = upstream.status().as_u16();
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "protocol_proxy.upstream_response",
            json!({
                "relayId": relay.id,
                "relayName": relay.name,
                "endpoint": sanitized_endpoint(&endpoint),
                "wireApi": wire_api,
                "stream": is_stream,
                "statusCode": status_code,
                "attempt": attempt + 1,
                "candidateCount": relay_count,
                "headerTimeoutSeconds": header_timeout.as_secs(),
                "willFailover": has_more_candidates && !(200..300).contains(&status_code)
            }),
        );
        crate::relay_rotation::record_relay_request_event(
            &settings,
            if (200..300).contains(&status_code) {
                RotationEvent::Success
            } else {
                RotationEvent::Failure
            },
        );
        let content_type = upstream
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        if (200..300).contains(&status_code) || !has_more_candidates {
            return Ok(UpstreamProxyResponse {
                status_code,
                is_stream: is_stream || content_type.contains("text/event-stream"),
                content_type,
                wire_api,
                response: upstream,
            });
        }
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "protocol_proxy.upstream_failover",
            json!({
                "relayId": relay.id,
                "relayName": relay.name,
                "endpoint": sanitized_endpoint(&endpoint),
                "wireApi": wire_api,
                "stream": is_stream,
                "statusCode": status_code,
                "attempt": attempt + 1,
                "candidateCount": relay_count,
                "headerTimeoutSeconds": header_timeout.as_secs()
            }),
        );
    }
    anyhow::bail!("未找到可用的聚合供应商成员")
}

fn select_model_route(
    settings: &crate::settings::BackendSettings,
    model: &str,
) -> anyhow::Result<Option<ModelRouteSelection>> {
    if model.is_empty() || settings.active_aggregate_relay_profile().is_some() {
        return Ok(None);
    }
    let source = settings.active_relay_profile();
    let Some(route) = source
        .model_routes
        .iter()
        .find(|route| route.model.trim() == model)
    else {
        return Ok(None);
    };
    let target_relay_id = route.target_relay_id.trim();
    if target_relay_id == source.id {
        anyhow::bail!("模型路由不能指向当前供应商自身：{model}");
    }
    let target = settings
        .relay_profiles
        .iter()
        .find(|profile| profile.id == target_relay_id)
        .cloned()
        .with_context(|| format!("模型路由目标供应商不存在：{target_relay_id}"))?;
    if target.relay_mode == crate::settings::RelayMode::Aggregate {
        anyhow::bail!("模型路由目标不能是聚合供应商：{}", target.name);
    }
    if target.relay_mode == crate::settings::RelayMode::CustomModels {
        anyhow::bail!("模型路由目标不能是自定义模型代理供应商：{}", target.name);
    }
    if target.protocol != RelayProtocol::Responses {
        anyhow::bail!("模型路由目标必须使用 Responses API：{}", target.name);
    }
    let upstream_model = if route.target_model.trim().is_empty() {
        model.to_string()
    } else {
        route.target_model.trim().to_string()
    };
    Ok(Some(ModelRouteSelection {
        relay: target,
        source_relay_id: source.id,
        source_model: model.to_string(),
        upstream_model,
    }))
}

pub async fn open_models_proxy_request(
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let relay = crate::relay_rotation::select_relay_for_probe(&settings)?;
    validate_upstream(&relay)?;

    let endpoint = models_url(&relay.base_url);
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.models_request",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "endpoint": sanitized_endpoint(&endpoint),
            "wireApi": UpstreamWireApi::Responses
        }),
    );
    let request = crate::http_client::proxied_client(&effective_user_agent(
        &relay.user_agent,
        original_user_agent,
    ))?
    .get(&endpoint);
    let request = match relay.protocol {
        RelayProtocol::AnthropicMessages => request
            .header("x-api-key", relay.api_key.trim())
            .header("anthropic-version", "2023-06-01"),
        RelayProtocol::GeminiGenerateContent => {
            request.header("x-goog-api-key", relay.api_key.trim())
        }
        _ => request.bearer_auth(relay.api_key.trim()),
    };
    let upstream = match send_upstream_request(request).await {
        Ok(upstream) => upstream,
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.models_request_failed",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "wireApi": UpstreamWireApi::Responses,
                    "endpoint": sanitized_endpoint(&endpoint),
                    "error": sanitized_upstream_error(&error)
                }),
            );
            return Err(error).context("Models 上游请求失败");
        }
    };
    let status_code = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json; charset=utf-8")
        .to_string();

    Ok(UpstreamProxyResponse {
        status_code,
        is_stream: false,
        content_type,
        wire_api: match relay.protocol {
            RelayProtocol::Responses => UpstreamWireApi::Responses,
            RelayProtocol::ChatCompletions => UpstreamWireApi::ChatCompletions,
            RelayProtocol::Completions => UpstreamWireApi::Completions,
            RelayProtocol::AnthropicMessages => UpstreamWireApi::AnthropicMessages,
            RelayProtocol::GeminiGenerateContent => UpstreamWireApi::GeminiGenerateContent,
        },
        response: upstream,
    })
}

pub async fn open_audio_transcriptions_proxy_request(
    body: &[u8],
    content_type: &str,
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let relay = crate::relay_rotation::select_relay_for_probe(&settings)?;
    validate_upstream(&relay)?;
    let content_type = content_type.trim();
    if content_type.is_empty() {
        anyhow::bail!("Audio transcriptions 请求缺少 Content-Type");
    }

    let endpoint = audio_transcriptions_url(&relay.base_url);
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.audio_transcriptions_request",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "endpoint": sanitized_endpoint(&endpoint),
            "wireApi": UpstreamWireApi::AudioTranscriptions,
            "bodyBytes": body.len()
        }),
    );
    let upstream = match send_upstream_request(
        crate::http_client::proxied_client(&effective_user_agent(
            &relay.user_agent,
            original_user_agent,
        ))?
        .post(&endpoint)
        .bearer_auth(relay.api_key.trim())
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body.to_vec()),
    )
    .await
    {
        Ok(upstream) => upstream,
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.audio_transcriptions_request_failed",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "wireApi": UpstreamWireApi::AudioTranscriptions,
                    "endpoint": sanitized_endpoint(&endpoint),
                    "bodyBytes": body.len(),
                    "error": sanitized_upstream_error(&error)
                }),
            );
            return Err(error).context("Audio transcriptions 上游请求失败");
        }
    };
    let status_code = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json; charset=utf-8")
        .to_string();

    Ok(UpstreamProxyResponse {
        status_code,
        is_stream: false,
        content_type,
        wire_api: UpstreamWireApi::AudioTranscriptions,
        response: upstream,
    })
}

fn response_header_timeout(is_stream: bool) -> Duration {
    if is_stream {
        UPSTREAM_STREAM_HEADER_TIMEOUT
    } else {
        UPSTREAM_HEADER_TIMEOUT
    }
}

pub async fn open_chat_completions_proxy_request(
    body: &str,
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let relay = settings.active_relay_profile();
    if relay.protocol != RelayProtocol::ChatCompletions {
        anyhow::bail!("当前中转未启用 Chat Completions 协议代理");
    }
    if relay.base_url.trim().is_empty() {
        anyhow::bail!("Chat Completions 上游 Base URL 不能为空");
    }
    if relay.api_key.trim().is_empty() {
        anyhow::bail!("Chat Completions 上游 Key 不能为空");
    }

    let request_json: Value = serde_json::from_str(body)?;
    let is_stream = request_json
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let endpoint = chat_completions_url(&relay.base_url);
    let client = crate::http_client::proxied_client(&effective_user_agent(
        &relay.user_agent,
        original_user_agent,
    ))?;
    let (upstream, connection_retried) = send_json_upstream_with_connect_retry(
        client,
        &endpoint,
        relay.api_key.trim(),
        is_stream,
        &request_json,
        UpstreamWireApi::ChatCompletions,
    )
    .await;
    let upstream = match upstream {
        Ok(upstream) => upstream,
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.chat_completions_request_failed",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "model": request_json.get("model").and_then(Value::as_str),
                    "wireApi": UpstreamWireApi::ChatCompletions,
                    "endpoint": sanitized_endpoint(&endpoint),
                    "stream": is_stream,
                    "connectionRetried": connection_retried,
                    "error": sanitized_upstream_error(&error)
                }),
            );
            return Err(error).context("Chat Completions 上游请求失败");
        }
    };
    let status_code = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    Ok(UpstreamProxyResponse {
        status_code,
        is_stream: is_stream || content_type.contains("text/event-stream"),
        content_type,
        wire_api: UpstreamWireApi::ChatCompletions,
        response: upstream,
    })
}

async fn upstream_request_parts(
    relay: &crate::settings::RelayProfile,
    request_json: Value,
) -> anyhow::Result<(String, Value, UpstreamWireApi)> {
    match relay.protocol {
        RelayProtocol::Responses => {
            let mut body = request_json;
            apply_relay_image_handling(relay, &mut body).await;
            Ok((
                responses_url(&relay.base_url),
                body,
                UpstreamWireApi::Responses,
            ))
        }
        RelayProtocol::ChatCompletions => {
            let mut body = responses_to_chat_completions(request_json)?;
            apply_relay_image_handling(relay, &mut body).await;
            Ok((
                chat_completions_url(&relay.base_url),
                body,
                UpstreamWireApi::ChatCompletions,
            ))
        }
        RelayProtocol::Completions => {
            let mut source = request_json;
            apply_relay_image_handling(relay, &mut source).await;
            Ok((
                completions_url(&relay.base_url),
                responses_to_completions(source)?,
                UpstreamWireApi::Completions,
            ))
        }
        RelayProtocol::AnthropicMessages => {
            let mut source = request_json;
            apply_relay_image_handling(relay, &mut source).await;
            Ok((
                anthropic_messages_url(&relay.base_url),
                responses_to_anthropic_messages(source)?,
                UpstreamWireApi::AnthropicMessages,
            ))
        }
        RelayProtocol::GeminiGenerateContent => {
            let model = request_json
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or(&relay.model)
                .to_string();
            let is_stream = request_json
                .get("stream")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut source = request_json;
            apply_relay_image_handling(relay, &mut source).await;
            Ok((
                gemini_generate_content_url(&relay.base_url, &model, is_stream),
                responses_to_gemini_generate_content(source)?,
                UpstreamWireApi::GeminiGenerateContent,
            ))
        }
    }
}

#[doc(hidden)]
pub fn sanitized_endpoint_for_tests(endpoint: &str) -> String {
    sanitized_endpoint(endpoint)
}

fn is_retryable_connection_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .is_some_and(reqwest::Error::is_connect)
    })
}

fn sanitized_endpoint(endpoint: &str) -> String {
    url::Url::parse(endpoint)
        .ok()
        .and_then(|url| {
            let host = url.host_str()?;
            let port = url
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
            Some(format!("{}://{host}{port}", url.scheme()))
        })
        .unwrap_or_else(|| "invalid-endpoint".to_string())
}

fn sanitized_upstream_error(error: &anyhow::Error) -> Value {
    if let Some(error) = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<reqwest::Error>())
    {
        let category = if error.is_connect() {
            "connect"
        } else if error.is_timeout() {
            "timeout"
        } else if error.is_decode() {
            "decode"
        } else if error.is_body() {
            "body"
        } else {
            "request"
        };
        return json!({
            "category": category,
            "connect": error.is_connect(),
            "timeout": error.is_timeout(),
            "status": error.status().map(|status| status.as_u16()),
            "source": std::error::Error::source(error).map(ToString::to_string)
        });
    }
    json!({
        "category": "other",
        "source": error.root_cause().to_string()
    })
}

async fn send_json_upstream_with_connect_retry(
    client: reqwest::Client,
    endpoint: &str,
    api_key: &str,
    is_stream: bool,
    upstream_body: &Value,
    wire_api: UpstreamWireApi,
) -> (anyhow::Result<reqwest::Response>, bool) {
    let first = send_upstream_request_for_responses(
        upstream_request_builder(
            client.clone(),
            endpoint,
            api_key,
            is_stream,
            upstream_body,
            wire_api,
        ),
        is_stream,
    )
    .await;
    match first {
        Err(error) if is_retryable_connection_error(&error) => {
            tokio::time::sleep(UPSTREAM_CONNECT_RETRY_DELAY).await;
            (
                send_upstream_request_for_responses(
                    upstream_request_builder(
                        client,
                        endpoint,
                        api_key,
                        is_stream,
                        upstream_body,
                        wire_api,
                    ),
                    is_stream,
                )
                .await,
                true,
            )
        }
        result => (result, false),
    }
}

async fn apply_relay_image_handling(relay: &crate::settings::RelayProfile, body: &mut Value) {
    // Image handling (per-model): send-as-is / strip / VLM analysis
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !model.is_empty() {
        use crate::vision::ImageHandling;
        match crate::vision::image_handling_mode(&model, &relay.model_vlm) {
            ImageHandling::SendAsIs => { /* 不做任何处理 */ }
            ImageHandling::Strip => {
                for key in &["messages", "input"] {
                    if let Some(arr) = body.get_mut(key).and_then(Value::as_array_mut) {
                        crate::vision::strip_images_only(arr);
                    }
                }
            }
            ImageHandling::Vlm => {
                if !relay.vlm_api_key.is_empty()
                    && !relay.vlm_model.is_empty()
                    && !relay.vlm_base_url.is_empty()
                {
                    let vlm_config = crate::vision::VlmConfig {
                        api_key: relay.vlm_api_key.clone(),
                        model: relay.vlm_model.clone(),
                        base_url: relay.vlm_base_url.clone(),
                    };

                    for key in &["messages", "input"] {
                        if let Some(arr) = body.get_mut(key).and_then(Value::as_array_mut) {
                            crate::vision::strip_image_blocks(
                                arr,
                                &vlm_config,
                                &relay.model_windows,
                                &relay.context_window,
                                &model,
                                relay.protocol == crate::settings::RelayProtocol::Responses,
                            )
                            .await;
                        }
                    }
                }
            }
        }
    }
}

fn upstream_request_builder(
    client: reqwest::Client,
    endpoint: &str,
    api_key: &str,
    is_stream: bool,
    upstream_body: &Value,
    wire_api: UpstreamWireApi,
) -> reqwest::RequestBuilder {
    let mut builder = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    builder = match wire_api {
        UpstreamWireApi::AnthropicMessages => builder
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        UpstreamWireApi::GeminiGenerateContent => builder.header("x-goog-api-key", api_key),
        _ => builder.bearer_auth(api_key),
    };
    if is_stream {
        builder = builder
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header(reqwest::header::CACHE_CONTROL, "no-cache");
    }
    builder.json(upstream_body)
}

fn validate_upstream(relay: &crate::settings::RelayProfile) -> anyhow::Result<()> {
    if relay.base_url.trim().is_empty() {
        anyhow::bail!("上游 Base URL 不能为空");
    }
    if relay.api_key.trim().is_empty() {
        anyhow::bail!("上游 Key 不能为空");
    }
    Ok(())
}

pub fn custom_models_list_payload(relay: &crate::settings::RelayProfile) -> Value {
    let data = relay
        .custom_models
        .iter()
        .map(|model| {
            json!({
                "id": model.model,
                "object": "model",
                "owned_by": "codex-plus-custom"
            })
        })
        .collect::<Vec<_>>();
    json!({ "object": "list", "data": data })
}

pub fn normalize_models_payload(payload: &Value) -> Value {
    fn collect(value: &Value, output: &mut Vec<String>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    collect(item, output);
                }
            }
            Value::Object(object) => {
                for key in ["id", "model", "name"] {
                    if let Some(model) = object.get(key).and_then(Value::as_str) {
                        let model = model.strip_prefix("models/").unwrap_or(model).trim();
                        if !model.is_empty() && !output.iter().any(|existing| existing == model) {
                            output.push(model.to_string());
                        }
                        return;
                    }
                }
                for key in ["data", "models", "items"] {
                    if let Some(nested) = object.get(key) {
                        collect(nested, output);
                    }
                }
            }
            Value::String(model) => {
                let model = model.strip_prefix("models/").unwrap_or(model).trim();
                if !model.is_empty() && !output.iter().any(|existing| existing == model) {
                    output.push(model.to_string());
                }
            }
            _ => {}
        }
    }

    let mut models = Vec::new();
    collect(payload, &mut models);
    json!({
        "object": "list",
        "data": models.into_iter().map(|model| json!({
            "id": model,
            "object": "model",
            "owned_by": "upstream"
        })).collect::<Vec<_>>()
    })
}

async fn open_custom_models_proxy_request(
    relay: &crate::settings::RelayProfile,
    request_json: &Value,
    is_stream: bool,
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let requested_model = request_json
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let model = match relay.find_custom_model_by_name(&requested_model) {
        Some(model) => model,
        None if !requested_model.is_empty() => {
            anyhow::bail!("未知自定义模型：{requested_model}");
        }
        None => {
            anyhow::bail!("自定义供应商未配置默认模型");
        }
    };
    if model.base_url.trim().is_empty() {
        anyhow::bail!("模型 {} 的 Base URL 不能为空", model.model);
    }
    if model.api_key.trim().is_empty() {
        anyhow::bail!("模型 {} 的 Key 不能为空", model.model);
    }
    let mut synthetic = relay.clone();
    synthetic.base_url = model.base_url.clone();
    synthetic.upstream_base_url = model.base_url.clone();
    synthetic.api_key = model.api_key.clone();
    synthetic.protocol = model.protocol;
    synthetic.model = model.model.clone();
    let (endpoint, upstream_body, wire_api) =
        upstream_request_parts(&synthetic, request_json.clone()).await?;
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.custom_model_request",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "model": model.model,
            "protocol": match model.protocol {
                RelayProtocol::Responses => "responses",
                RelayProtocol::ChatCompletions => "chatCompletions",
                RelayProtocol::Completions => "completions",
                RelayProtocol::AnthropicMessages => "anthropicMessages",
                RelayProtocol::GeminiGenerateContent => "geminiGenerateContent",
            },
            "endpoint": sanitized_endpoint(&endpoint),
            "stream": is_stream
        }),
    );
    let client = crate::http_client::proxied_client(&effective_user_agent(
        &relay.user_agent,
        original_user_agent,
    ))?;
    let (upstream, connection_retried) = send_json_upstream_with_connect_retry(
        client,
        &endpoint,
        model.api_key.trim(),
        is_stream,
        &upstream_body,
        wire_api,
    )
    .await;
    let upstream = match upstream {
        Ok(upstream) => upstream,
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.custom_model_request_failed",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "model": model.model,
                    "wireApi": wire_api,
                    "endpoint": sanitized_endpoint(&endpoint),
                    "stream": is_stream,
                    "connectionRetried": connection_retried,
                    "error": sanitized_upstream_error(&error)
                }),
            );
            return Err(error)
                .with_context(|| format!("自定义模型「{}」请求上游失败", model.model));
        }
    };
    let status_code = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    Ok(UpstreamProxyResponse {
        status_code,
        is_stream: is_stream || content_type.contains("text/event-stream"),
        content_type,
        wire_api,
        response: upstream,
    })
}

fn conversation_id_from_responses_request(body: &Value) -> Option<String> {
    for key in ["conversation", "conversation_id", "previous_response_id"] {
        if let Some(value) = body.get(key).and_then(Value::as_str) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn effective_user_agent(configured_user_agent: &str, original_user_agent: Option<&str>) -> String {
    let configured_user_agent = configured_user_agent.trim();
    if !configured_user_agent.is_empty() {
        return configured_user_agent.to_string();
    }
    original_user_agent
        .map(str::trim)
        .filter(|user_agent| !user_agent.is_empty())
        .unwrap_or("")
        .to_string()
}

pub async fn handle_responses_proxy_request(body: &str) -> anyhow::Result<ProxyHttpResponse> {
    let request_json: Value = serde_json::from_str(body)?;
    let upstream = open_responses_proxy_request(body, None).await?;
    let status_code = upstream.status_code;
    let upstream_content_type = upstream.content_type.clone();
    let is_stream = upstream.is_stream;
    let wire_api = upstream.wire_api;
    let upstream_body = upstream.response.bytes().await?;

    if !(200..300).contains(&status_code) {
        let error =
            responses_error_from_upstream(status_code, &upstream_content_type, &upstream_body);
        return Ok(ProxyHttpResponse {
            status: http_status_line(status_code),
            content_type: "application/json; charset=utf-8".to_string(),
            body: serde_json::to_vec(&error)?,
        });
    }

    if wire_api == UpstreamWireApi::Responses {
        return Ok(ProxyHttpResponse {
            status: "200 OK".to_string(),
            content_type: if upstream_content_type.is_empty() {
                "application/json; charset=utf-8".to_string()
            } else {
                upstream_content_type
            },
            body: upstream_body.to_vec(),
        });
    }

    if is_stream {
        let body = match wire_api {
            UpstreamWireApi::ChatCompletions => {
                let text = String::from_utf8_lossy(&upstream_body);
                chat_sse_to_responses_sse_with_request(&text, &request_json).into_bytes()
            }
            UpstreamWireApi::Completions
            | UpstreamWireApi::AnthropicMessages
            | UpstreamWireApi::GeminiGenerateContent => {
                let mut converter =
                    NativeSseToResponsesConverter::with_request(wire_api, &request_json);
                let mut converted = converter.push_bytes(&upstream_body);
                converted.extend(converter.finish());
                converted
            }
            UpstreamWireApi::Responses
            | UpstreamWireApi::AudioTranscriptions
            | UpstreamWireApi::Transparent => upstream_body.to_vec(),
        };
        return Ok(ProxyHttpResponse {
            status: "200 OK".to_string(),
            content_type: "text/event-stream; charset=utf-8".to_string(),
            body,
        });
    }

    let upstream_json: Value = serde_json::from_slice(&upstream_body)?;
    let response_json = match wire_api {
        UpstreamWireApi::ChatCompletions => {
            chat_completion_to_response_with_request(upstream_json, &request_json)?
        }
        UpstreamWireApi::Completions => {
            completion_to_response_with_request(upstream_json, &request_json)?
        }
        UpstreamWireApi::AnthropicMessages => {
            anthropic_message_to_response_with_request(upstream_json, &request_json)?
        }
        UpstreamWireApi::GeminiGenerateContent => {
            gemini_generate_content_to_response_with_request(upstream_json, &request_json)?
        }
        UpstreamWireApi::Responses
        | UpstreamWireApi::AudioTranscriptions
        | UpstreamWireApi::Transparent => upstream_json,
    };
    Ok(ProxyHttpResponse {
        status: "200 OK".to_string(),
        content_type: "application/json; charset=utf-8".to_string(),
        body: serde_json::to_vec(&response_json)?,
    })
}

pub fn chat_completions_url(base_url: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let base = base_url.trim().trim_end_matches('#').trim_end_matches('/');
    if base.to_ascii_lowercase().ends_with("/chat/completions") {
        return base.to_string();
    }
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut url = if skip_version_prefix || has_version_suffix(base) || !origin_only {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

pub fn completions_url(base_url: &str) -> String {
    endpoint_url(base_url, "/completions", "/v1/completions")
}

pub fn anthropic_messages_url(base_url: &str) -> String {
    endpoint_url(base_url, "/messages", "/v1/messages")
}

pub fn gemini_generate_content_url(base_url: &str, model: &str, stream: bool) -> String {
    let method = if stream {
        "streamGenerateContent"
    } else {
        "generateContent"
    };
    let model = model.trim().strip_prefix("models/").unwrap_or(model.trim());
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    if base.contains("{model_id}") {
        base = base.replace("{model_id}", model);
    }
    if let Some(index) = base.rfind(":generateContent") {
        base.truncate(index);
        base.push(':');
        base.push_str(method);
    } else if let Some(index) = base.rfind(":streamGenerateContent") {
        base.truncate(index);
        base.push(':');
        base.push_str(method);
    } else if base.contains("/models/") {
        base.push(':');
        base.push_str(method);
    } else if base.ends_with("/models") {
        base.push('/');
        base.push_str(model);
        base.push(':');
        base.push_str(method);
    } else {
        let origin_only = base
            .split_once("://")
            .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
        if origin_only {
            base.push_str("/v1");
        }
        base.push_str("/models/");
        base.push_str(model);
        base.push(':');
        base.push_str(method);
    }
    if stream && !base.contains('?') {
        base.push_str("?alt=sse");
    } else if stream && !base.contains("alt=sse") {
        base.push_str("&alt=sse");
    }
    while base.contains("/v1/v1") {
        base = base.replace("/v1/v1", "/v1");
    }
    base
}

fn endpoint_url(base_url: &str, endpoint_suffix: &str, origin_suffix: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let base = base_url.trim().trim_end_matches('#').trim_end_matches('/');
    if base
        .to_ascii_lowercase()
        .ends_with(&endpoint_suffix.to_ascii_lowercase())
    {
        return base.to_string();
    }
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut url = if skip_version_prefix || has_version_suffix(base) || !origin_only {
        format!("{base}{endpoint_suffix}")
    } else {
        format!("{base}{origin_suffix}")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

pub fn responses_url(base_url: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let base = base_url.trim().trim_end_matches('#').trim_end_matches('/');
    if base.to_ascii_lowercase().ends_with("/responses") {
        return base.to_string();
    }
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut url = if skip_version_prefix || has_version_suffix(base) || !origin_only {
        format!("{base}/responses")
    } else {
        format!("{base}/v1/responses")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

pub fn responses_compact_url(base_url: &str) -> String {
    let responses = responses_url(base_url);
    if responses
        .to_ascii_lowercase()
        .ends_with("/responses/compact")
    {
        responses
    } else {
        format!("{}/compact", responses.trim_end_matches('/'))
    }
}

pub fn audio_transcriptions_url(base_url: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let base = base_url.trim().trim_end_matches('#').trim_end_matches('/');
    if base.to_ascii_lowercase().ends_with("/audio/transcriptions") {
        return base.to_string();
    }
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut url = if skip_version_prefix || has_version_suffix(base) || !origin_only {
        format!("{base}/audio/transcriptions")
    } else {
        format!("{base}/v1/audio/transcriptions")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

pub fn transparent_api_url(base_url: &str, request_path: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let mut base = base_url
        .trim()
        .trim_end_matches('#')
        .trim_end_matches('/')
        .to_string();
    let lower = base.to_ascii_lowercase();
    for suffix in [
        "/audio/transcriptions",
        "/chat/completions",
        "/responses/compact",
        "/responses",
        "/completions",
        "/models",
        "/messages",
    ] {
        if lower.ends_with(suffix) {
            base.truncate(base.len() - suffix.len());
            break;
        }
    }

    let (path, query) = request_path
        .split_once('?')
        .map_or((request_path, None), |(path, query)| (path, Some(query)));
    let mut normalized = path.to_string();
    if let Some(rest) = normalized.strip_prefix("/codex/v1") {
        normalized = format!("/v1{rest}");
    }
    while normalized == "/v1/v1" || normalized.starts_with("/v1/v1/") {
        normalized = normalized.replacen("/v1/v1", "/v1", 1);
    }
    if normalized != "/v1" && !normalized.starts_with("/v1/") {
        normalized = format!("/v1/{}", normalized.trim_start_matches('/'));
    }
    let suffix = normalized.strip_prefix("/v1").unwrap_or(&normalized);
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut endpoint = if skip_version_prefix {
        format!("{base}{suffix}")
    } else if origin_only {
        format!("{base}/v1{suffix}")
    } else if has_version_suffix(&base) {
        format!("{base}{suffix}")
    } else {
        format!("{base}{suffix}")
    };
    while endpoint.contains("/v1/v1") {
        endpoint = endpoint.replace("/v1/v1", "/v1");
    }
    if let Some(query) = query.filter(|query| !query.is_empty()) {
        endpoint.push('?');
        endpoint.push_str(query);
    }
    endpoint
}

pub fn models_url(base_url: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let mut base = base_url
        .trim()
        .trim_end_matches('#')
        .trim_end_matches('/')
        .to_string();
    for suffix in [
        "/chat/completions",
        "/completions",
        "/messages",
        "/responses",
    ] {
        if base.to_ascii_lowercase().ends_with(suffix) {
            base.truncate(base.len() - suffix.len());
            break;
        }
    }
    if let Some(models_index) = base.find("/models/") {
        if base[models_index..].contains(":generateContent")
            || base[models_index..].contains(":streamGenerateContent")
        {
            base.truncate(models_index + "/models".len());
        }
    }
    if base.to_ascii_lowercase().ends_with("/models") {
        return base;
    }
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut url = if skip_version_prefix || has_version_suffix(&base) || !origin_only {
        format!("{base}/models")
    } else {
        format!("{base}/v1/models")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

pub(crate) fn has_version_suffix(base_url: &str) -> bool {
    let segment = base_url.rsplit('/').next().unwrap_or(base_url);
    let Some(rest) = segment.strip_prefix('v') else {
        return false;
    };
    rest.chars().next().is_some_and(|ch| ch.is_ascii_digit())
}

pub fn chat_sse_to_responses_sse(input: &str) -> String {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut output = converter.push_bytes(input.as_bytes());
    output.extend(converter.finish());
    String::from_utf8(output).unwrap_or_default()
}

pub fn chat_sse_to_responses_sse_with_request(input: &str, original_request: &Value) -> String {
    let mut converter = ChatSseToResponsesConverter::with_request(original_request);
    let mut output = converter.push_bytes(input.as_bytes());
    output.extend(converter.finish());
    String::from_utf8(output).unwrap_or_default()
}

pub fn response_id_from_chat_id(id: Option<&str>) -> String {
    let id = id.unwrap_or("compat");
    if id.starts_with("resp_") {
        id.to_string()
    } else {
        format!("resp_{id}")
    }
}

fn push_sse(output: &mut String, event: &str, data: Value) {
    output.push_str("event: ");
    output.push_str(event);
    output.push_str("\ndata: ");
    output.push_str(&serde_json::to_string(&data).unwrap_or_default());
    output.push_str("\n\n");
}

#[derive(Debug, Default)]
struct TextItemState {
    output_index: Option<u32>,
    item_id: String,
    text: String,
    added: bool,
    done: bool,
}

#[derive(Debug, Default)]
struct ReasoningItemState {
    output_index: Option<u32>,
    item_id: String,
    text: String,
    added: bool,
    done: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum InlineThinkMode {
    #[default]
    Detecting,
    Reasoning,
    Text,
}

#[derive(Debug, Default)]
struct InlineThinkState {
    mode: InlineThinkMode,
    buffer: String,
}

#[derive(Debug, Default)]
struct ToolCallState {
    output_index: Option<u32>,
    item_id: String,
    call_id: String,
    name: String,
    arguments: String,
    added: bool,
    done: bool,
}

#[derive(Debug)]
struct ChatSseState {
    response_started: bool,
    completed: bool,
    response_id: String,
    model: String,
    created_at: u64,
    next_output_index: u32,
    text: TextItemState,
    reasoning: ReasoningItemState,
    inline_think: InlineThinkState,
    tools: BTreeMap<usize, ToolCallState>,
    output_items: Vec<(u32, Value)>,
    latest_usage: Option<Value>,
    finish_reason: Option<String>,
    tool_context: CodexToolContext,
    original_request: Option<Value>,
}

impl Default for ChatSseState {
    fn default() -> Self {
        Self {
            response_started: false,
            completed: false,
            response_id: "resp_compat".to_string(),
            model: String::new(),
            created_at: 0,
            next_output_index: 0,
            text: TextItemState::default(),
            reasoning: ReasoningItemState::default(),
            inline_think: InlineThinkState::default(),
            tools: BTreeMap::new(),
            output_items: Vec::new(),
            latest_usage: None,
            finish_reason: None,
            tool_context: CodexToolContext::default(),
            original_request: None,
        }
    }
}

impl ChatSseState {
    fn with_request(original_request: &Value) -> Self {
        Self {
            tool_context: build_codex_tool_context(original_request.get("tools")),
            original_request: Some(original_request.clone()),
            ..Self::default()
        }
    }

    fn handle_chat_chunk_into(&mut self, chunk: &Value, output: &mut String) {
        if let Some(id) = chunk.get("id").and_then(Value::as_str) {
            self.response_id = response_id_from_chat_id(Some(id));
        }
        if let Some(model) = chunk.get("model").and_then(Value::as_str) {
            if !model.is_empty() {
                self.model = model.to_string();
            }
        }
        if let Some(created) = chunk.get("created").and_then(Value::as_u64) {
            self.created_at = created;
        }
        self.ensure_response_started_into(output);

        if let Some(usage) = chunk.get("usage").filter(|value| !value.is_null()) {
            self.latest_usage = Some(chat_usage_to_responses_usage(Some(usage)));
        }

        let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return;
        };

        if let Some(delta) = choice.get("delta") {
            if let Some(reasoning) = chat_delta_reasoning_text(delta) {
                self.push_reasoning_delta_into(&reasoning, output);
            }

            if let Some(content) = delta.get("content").and_then(Value::as_str) {
                if !content.is_empty() {
                    self.push_content_delta_into(content, output);
                }
            }

            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                self.flush_inline_think_at_boundary_into(output);
                self.finalize_reasoning_into(output);
                for tool_call in tool_calls {
                    self.push_tool_call_delta_into(tool_call, output);
                }
            }
        }

        if let Some(finish_reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(finish_reason.to_string());
            self.finalize_into(output);
        }
    }

    fn push_content_delta_into(&mut self, delta: &str, output: &mut String) {
        match self.inline_think.mode {
            InlineThinkMode::Text => {
                self.finalize_reasoning_into(output);
                self.push_text_delta_into(delta, output);
            }
            InlineThinkMode::Detecting => {
                self.inline_think.buffer.push_str(delta);
                match leading_think_prefix_decision(&self.inline_think.buffer) {
                    ThinkPrefixDecision::NeedMore => {}
                    ThinkPrefixDecision::Reasoning => {
                        self.inline_think.mode = InlineThinkMode::Reasoning;
                        self.drain_complete_inline_think_into(output);
                    }
                    ThinkPrefixDecision::Text => {
                        self.inline_think.mode = InlineThinkMode::Text;
                        let text = std::mem::take(&mut self.inline_think.buffer);
                        self.finalize_reasoning_into(output);
                        self.push_text_delta_into(&text, output);
                    }
                }
            }
            InlineThinkMode::Reasoning => {
                self.inline_think.buffer.push_str(delta);
                self.drain_complete_inline_think_into(output);
            }
        }
    }

    fn drain_complete_inline_think_into(&mut self, output: &mut String) {
        let Some((reasoning, answer)) = split_leading_think_block(&self.inline_think.buffer) else {
            return;
        };
        self.inline_think.mode = InlineThinkMode::Text;
        self.inline_think.buffer.clear();
        if !reasoning.is_empty() {
            self.push_reasoning_delta_into(&reasoning, output);
            self.finalize_reasoning_into(output);
        }
        if !answer.is_empty() {
            self.push_text_delta_into(&answer, output);
        }
    }

    fn flush_inline_think_at_boundary_into(&mut self, output: &mut String) {
        match self.inline_think.mode {
            InlineThinkMode::Text => {}
            InlineThinkMode::Detecting => {
                self.inline_think.mode = InlineThinkMode::Text;
                let text = std::mem::take(&mut self.inline_think.buffer);
                if !text.is_empty() {
                    self.finalize_reasoning_into(output);
                    self.push_text_delta_into(&text, output);
                }
            }
            InlineThinkMode::Reasoning => {
                let buffered = std::mem::take(&mut self.inline_think.buffer);
                self.inline_think.mode = InlineThinkMode::Text;
                if let Some((reasoning, answer)) = split_leading_think_block(&buffered) {
                    if !reasoning.is_empty() {
                        self.push_reasoning_delta_into(&reasoning, output);
                        self.finalize_reasoning_into(output);
                    }
                    if !answer.is_empty() {
                        self.push_text_delta_into(&answer, output);
                    }
                    return;
                }
                let reasoning = strip_leading_think_open_tag(&buffered).unwrap_or(buffered);
                if !reasoning.is_empty() {
                    self.push_reasoning_delta_into(&reasoning, output);
                    self.finalize_reasoning_into(output);
                }
            }
        }
    }

    fn ensure_response_started_into(&mut self, output: &mut String) {
        if self.response_started {
            return;
        }
        self.response_started = true;
        push_sse(
            output,
            "response.created",
            json!({
                "type": "response.created",
                "response": self.base_response("in_progress", Vec::new())
            }),
        );
        push_sse(
            output,
            "response.in_progress",
            json!({
                "type": "response.in_progress",
                "response": self.base_response("in_progress", Vec::new())
            }),
        );
    }

    fn push_reasoning_delta_into(&mut self, delta: &str, output: &mut String) {
        if !self.reasoning.added {
            let output_index = self.next_output_index();
            let item_id = format!("rs_{}", self.response_id);
            self.reasoning.output_index = Some(output_index);
            self.reasoning.item_id = item_id.clone();
            self.reasoning.added = true;

            push_sse(
                output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "id": item_id,
                        "type": "reasoning",
                        "status": "in_progress",
                        "reasoning_content": "",
                        "summary": []
                    }
                }),
            );
            push_sse(
                output,
                "response.reasoning_summary_part.added",
                json!({
                    "type": "response.reasoning_summary_part.added",
                    "item_id": self.reasoning.item_id,
                    "output_index": output_index,
                    "summary_index": 0,
                    "part": { "type": "summary_text", "text": "" }
                }),
            );
        }

        self.reasoning.text.push_str(delta);
        let output_index = self.reasoning.output_index.unwrap_or(0);
        push_sse(
            output,
            "response.reasoning_summary_text.delta",
            json!({
                "type": "response.reasoning_summary_text.delta",
                "item_id": self.reasoning.item_id,
                "output_index": output_index,
                "summary_index": 0,
                "delta": delta
            }),
        );
    }

    fn push_text_delta_into(&mut self, delta: &str, output: &mut String) {
        if !self.text.added {
            let output_index = self.next_output_index();
            let item_id = format!("{}_msg", self.response_id);
            self.text.output_index = Some(output_index);
            self.text.item_id = item_id.clone();
            self.text.added = true;
            push_sse(
                output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "id": item_id,
                        "type": "message",
                        "status": "in_progress",
                        "role": "assistant",
                        "content": []
                    }
                }),
            );
            push_sse(
                output,
                "response.content_part.added",
                json!({
                    "type": "response.content_part.added",
                    "item_id": self.text.item_id,
                    "output_index": output_index,
                    "content_index": 0,
                    "part": { "type": "output_text", "text": "", "annotations": [] }
                }),
            );
        }

        self.text.text.push_str(delta);
        let output_index = self.text.output_index.unwrap_or(0);
        push_sse(
            output,
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "item_id": self.text.item_id,
                "output_index": output_index,
                "content_index": 0,
                "delta": delta
            }),
        );
    }

    fn push_tool_call_delta_into(&mut self, tool_call: &Value, output: &mut String) {
        let chat_index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let id_delta = tool_call
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string);
        let function = tool_call.get("function").unwrap_or(&Value::Null);
        let name_delta = function
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string);
        let args_delta = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        let mut should_add = false;
        let mut output_index = None;
        let mut item_id = String::new();
        let mut pending_arguments = String::new();

        {
            let state = self.tools.entry(chat_index).or_default();
            if let Some(id) = id_delta {
                state.call_id = id;
            }
            if let Some(name) = name_delta {
                if !name.is_empty() {
                    state.name = name;
                }
            }
            if !args_delta.is_empty() {
                state.arguments.push_str(&args_delta);
            }

            if !state.added && (!state.call_id.is_empty() || !state.name.is_empty()) {
                should_add = true;
                pending_arguments = state.arguments.clone();
            } else if state.added {
                output_index = state.output_index;
                item_id = state.item_id.clone();
            }
        }

        if should_add {
            let assigned = self.next_output_index();
            let state = self.tools.get_mut(&chat_index).expect("tool state exists");
            state.added = true;
            if state.call_id.is_empty() {
                state.call_id = format!("call_{chat_index}");
            }
            if state.name.is_empty() {
                state.name = "unknown_tool".to_string();
            }
            state.output_index = Some(assigned);
            state.item_id = format!("fc_{}", state.call_id);
            let added_item = tool_call_added_item(state, assigned, &self.tool_context);
            push_sse(output, "response.output_item.added", added_item);
            if !pending_arguments.is_empty() {
                push_tool_call_delta_sse(
                    output,
                    state,
                    assigned,
                    &pending_arguments,
                    &self.tool_context,
                );
            }
        } else if !args_delta.is_empty() {
            if let Some(output_index) = output_index {
                let state = ToolCallState {
                    output_index: Some(output_index),
                    item_id,
                    name: self
                        .tools
                        .get(&chat_index)
                        .map(|state| state.name.clone())
                        .unwrap_or_default(),
                    call_id: self
                        .tools
                        .get(&chat_index)
                        .map(|state| state.call_id.clone())
                        .unwrap_or_default(),
                    ..ToolCallState::default()
                };
                push_tool_call_delta_sse(
                    output,
                    &state,
                    output_index,
                    &args_delta,
                    &self.tool_context,
                );
            }
        }
    }

    fn finalize_into(&mut self, output: &mut String) {
        if self.completed {
            return;
        }
        self.ensure_response_started_into(output);
        self.flush_inline_think_at_boundary_into(output);
        self.finalize_reasoning_into(output);
        self.finalize_text_into(output);
        self.finalize_tools_into(output);

        let status = response_status(self.finish_reason.as_deref());
        let mut response = self.base_response(status, self.completed_output_items());
        if status == "incomplete" {
            response["incomplete_details"] = json!({ "reason": "max_output_tokens" });
        }
        copy_response_request_fields(&mut response, self.original_request.as_ref());
        push_sse(
            output,
            "response.completed",
            json!({
                "type": "response.completed",
                "response": response
            }),
        );
        output.push_str("data: [DONE]\n\n");
        self.completed = true;
    }

    fn finalize_reasoning_into(&mut self, output: &mut String) {
        if !self.reasoning.added || self.reasoning.done {
            return;
        }
        let output_index = self.reasoning.output_index.unwrap_or(0);
        let item = json!({
            "id": self.reasoning.item_id,
            "type": "reasoning",
            "reasoning_content": self.reasoning.text,
            "summary": [{ "type": "summary_text", "text": self.reasoning.text }]
        });
        self.output_items.push((output_index, item.clone()));
        self.reasoning.done = true;
        push_sse(
            output,
            "response.reasoning_summary_text.done",
            json!({
                "type": "response.reasoning_summary_text.done",
                "item_id": self.reasoning.item_id,
                "output_index": output_index,
                "summary_index": 0,
                "text": self.reasoning.text
            }),
        );
        push_sse(
            output,
            "response.reasoning_summary_part.done",
            json!({
                "type": "response.reasoning_summary_part.done",
                "item_id": self.reasoning.item_id,
                "output_index": output_index,
                "summary_index": 0,
                "part": { "type": "summary_text", "text": self.reasoning.text }
            }),
        );
        push_sse(
            output,
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "output_index": output_index,
                "item": item
            }),
        );
    }

    fn finalize_text_into(&mut self, output: &mut String) {
        if !self.text.added || self.text.done {
            return;
        }
        let output_index = self.text.output_index.unwrap_or(0);
        let item = json!({
            "id": self.text.item_id,
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": self.text.text, "annotations": [] }]
        });
        self.output_items.push((output_index, item.clone()));
        self.text.done = true;
        push_sse(
            output,
            "response.output_text.done",
            json!({
                "type": "response.output_text.done",
                "item_id": self.text.item_id,
                "output_index": output_index,
                "content_index": 0,
                "text": self.text.text
            }),
        );
        push_sse(
            output,
            "response.content_part.done",
            json!({
                "type": "response.content_part.done",
                "item_id": self.text.item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": { "type": "output_text", "text": self.text.text, "annotations": [] }
            }),
        );
        push_sse(
            output,
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "output_index": output_index,
                "item": item
            }),
        );
    }

    fn finalize_tools_into(&mut self, output: &mut String) {
        let keys: Vec<usize> = self.tools.keys().copied().collect();
        for key in keys {
            if self.tools.get(&key).map(|state| state.done).unwrap_or(true) {
                continue;
            }
            if self
                .tools
                .get(&key)
                .map(|state| !state.added && !state.done)
                .unwrap_or(false)
            {
                let assigned = self.next_output_index();
                let state = self.tools.get_mut(&key).expect("tool state exists");
                state.added = true;
                if state.call_id.is_empty() {
                    state.call_id = format!("call_{key}");
                }
                if state.name.is_empty() {
                    state.name = "unknown_tool".to_string();
                }
                state.output_index = Some(assigned);
                state.item_id = format!("fc_{}", state.call_id);
                let added_item = tool_call_added_item(state, assigned, &self.tool_context);
                push_sse(output, "response.output_item.added", added_item);
            }

            let state = self.tools.get_mut(&key).expect("tool state exists");
            let output_index = state.output_index.unwrap_or(0);
            let item = tool_call_done_item(state, &self.tool_context);
            state.done = true;
            self.output_items.push((output_index, item.clone()));
            push_tool_call_done_sse(output, state, output_index, &self.tool_context);
            push_sse(
                output,
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": output_index,
                    "item": item
                }),
            );
        }
    }

    fn failed_into(&mut self, output: &mut String, message: String, error_type: Option<String>) {
        self.completed = true;
        let mut error = json!({ "message": message });
        if let Some(error_type) = error_type.filter(|value| !value.is_empty()) {
            error["type"] = json!(error_type);
        }
        let mut response = self.base_response("failed", self.completed_output_items());
        response["error"] = error;
        push_sse(
            output,
            "response.failed",
            json!({
                "type": "response.failed",
                "response": response
            }),
        );
    }

    fn completed_output_items(&self) -> Vec<Value> {
        let mut output_items = self.output_items.clone();
        output_items.sort_by_key(|(output_index, _)| *output_index);
        output_items.into_iter().map(|(_, item)| item).collect()
    }

    fn base_response(&self, status: &str, output: Vec<Value>) -> Value {
        json!({
            "id": self.response_id,
            "object": "response",
            "created_at": self.created_at,
            "status": status,
            "model": self.model,
            "output": output,
            "usage": self.latest_usage.clone().unwrap_or_else(default_responses_usage)
        })
    }

    fn next_output_index(&mut self) -> u32 {
        let index = self.next_output_index;
        self.next_output_index += 1;
        index
    }
}

fn take_sse_block(buffer: &mut String) -> Option<String> {
    let lf = buffer.find("\n\n").map(|index| (index, 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, 4));
    let (index, delimiter_len) = match (lf, crlf) {
        (Some(left), Some(right)) => {
            if left.0 <= right.0 {
                left
            } else {
                right
            }
        }
        (Some(value), None) | (None, Some(value)) => value,
        (None, None) => return None,
    };
    let block = buffer[..index].to_string();
    buffer.drain(..index + delimiter_len);
    Some(block)
}

fn append_utf8_safe(buffer: &mut String, remainder: &mut Vec<u8>, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let mut combined = Vec::new();
    if !remainder.is_empty() {
        combined.extend_from_slice(remainder);
        remainder.clear();
    }
    combined.extend_from_slice(bytes);

    match std::str::from_utf8(&combined) {
        Ok(text) => buffer.push_str(text),
        Err(error) => {
            let valid = error.valid_up_to();
            if valid > 0 {
                buffer.push_str(std::str::from_utf8(&combined[..valid]).unwrap_or_default());
            }
            if error.error_len().is_none() {
                remainder.extend_from_slice(&combined[valid..]);
            } else {
                buffer.push_str(&String::from_utf8_lossy(&combined[valid..]));
            }
        }
    }
}

fn strip_sse_field<'a>(line: &'a str, field: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(field)?.strip_prefix(':')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

fn sse_event_and_data(block: &str) -> (Option<String>, Option<String>) {
    let mut event_name = None;
    let mut data_parts = Vec::new();
    for line in block.lines() {
        if let Some(event) = strip_sse_field(line, "event") {
            event_name = Some(event.trim().to_string());
        }
        if let Some(data) = strip_sse_field(line, "data") {
            data_parts.push(data.to_string());
        }
    }
    let data = if data_parts.is_empty() {
        None
    } else {
        Some(data_parts.join("\n"))
    };
    (event_name, data)
}

fn chat_content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .or_else(|| part.get("content"))
                    .and_then(Value::as_str)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        value => value.to_string(),
    }
}

fn anthropic_content_parts(content: &Value) -> Vec<Value> {
    match content {
        Value::String(text) if !text.is_empty() => vec![json!({ "type": "text", "text": text })],
        Value::String(_) => Vec::new(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                Some("text") => Some(json!({
                    "type": "text",
                    "text": part.get("text").and_then(Value::as_str).unwrap_or("")
                })),
                Some("image_url") => {
                    let url = part
                        .pointer("/image_url/url")
                        .or_else(|| part.get("image_url"))
                        .and_then(Value::as_str)?;
                    if let Some((media_type, data)) = split_data_url(url) {
                        Some(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": data
                            }
                        }))
                    } else {
                        Some(json!({
                            "type": "image",
                            "source": { "type": "url", "url": url }
                        }))
                    }
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn gemini_content_parts(content: &Value) -> Vec<Value> {
    match content {
        Value::String(text) if !text.is_empty() => vec![json!({ "text": text })],
        Value::String(_) => Vec::new(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                Some("text") => Some(json!({
                    "text": part.get("text").and_then(Value::as_str).unwrap_or("")
                })),
                Some("image_url") => {
                    let url = part
                        .pointer("/image_url/url")
                        .or_else(|| part.get("image_url"))
                        .and_then(Value::as_str)?;
                    if let Some((mime_type, data)) = split_data_url(url) {
                        Some(json!({
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": data
                            }
                        }))
                    } else {
                        Some(json!({
                            "fileData": {
                                "mimeType": "application/octet-stream",
                                "fileUri": url
                            }
                        }))
                    }
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn split_data_url(url: &str) -> Option<(&str, &str)> {
    let rest = url.strip_prefix("data:")?;
    let (metadata, data) = rest.split_once(',')?;
    let media_type = metadata.strip_suffix(";base64")?;
    Some((media_type, data))
}

fn parse_json_or_string(value: &str) -> Value {
    if value.trim().is_empty() {
        return json!({});
    }
    match serde_json::from_str::<Value>(value) {
        Ok(Value::Object(object)) => Value::Object(object),
        Ok(value) => json!({ "input": value }),
        Err(_) => json!({ "input": value }),
    }
}

fn gemini_signature_cache() -> &'static Mutex<BTreeMap<String, String>> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn remember_gemini_thought_signature(call_id: &str, signature: &str) {
    if call_id.is_empty() || signature.is_empty() {
        return;
    }
    let Ok(mut cache) = gemini_signature_cache().lock() else {
        return;
    };
    if cache.len() >= GEMINI_SIGNATURE_CACHE_LIMIT {
        cache.clear();
    }
    cache.insert(call_id.to_string(), signature.to_string());
}

fn gemini_thought_signature(call_id: &str) -> Option<String> {
    gemini_signature_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(call_id).cloned())
}

fn anthropic_usage_to_chat_usage(usage: Option<&Value>) -> Value {
    let usage = usage.unwrap_or(&Value::Null);
    let input_tokens = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_read = usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_creation = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    json!({
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens + cache_creation,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": cache_creation
    })
}

fn gemini_usage_to_chat_usage(usage: Option<&Value>) -> Value {
    let usage = usage.unwrap_or(&Value::Null);
    let prompt_tokens = usage
        .get("promptTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cached_tokens = usage
        .get("cachedContentTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .get("candidatesTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let reasoning_tokens = usage
        .get("thoughtsTokenCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    json!({
        "promptTokenCount": prompt_tokens,
        "cachedContentTokenCount": cached_tokens,
        "candidatesTokenCount": completion_tokens,
        "thoughtsTokenCount": reasoning_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens + reasoning_tokens,
        "total_tokens": usage
            .get("totalTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(prompt_tokens + completion_tokens + reasoning_tokens)
    })
}

fn anthropic_finish_reason(reason: &str) -> &'static str {
    match reason {
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        _ => "stop",
    }
}

fn gemini_finish_reason(reason: &str, has_tools: bool) -> &'static str {
    match reason {
        "MAX_TOKENS" => "length",
        "STOP" if has_tools => "tool_calls",
        _ => "stop",
    }
}

fn chat_delta_reasoning_text(delta: &Value) -> Option<String> {
    extract_reasoning_field_text(delta)
}

enum ThinkPrefixDecision {
    NeedMore,
    Reasoning,
    Text,
}

fn leading_think_prefix_decision(buffer: &str) -> ThinkPrefixDecision {
    let trimmed = buffer.trim_start();
    if trimmed.is_empty() {
        return ThinkPrefixDecision::NeedMore;
    }
    if trimmed.starts_with(THINK_OPEN_TAG) {
        return ThinkPrefixDecision::Reasoning;
    }
    if THINK_OPEN_TAG.starts_with(trimmed) {
        return ThinkPrefixDecision::NeedMore;
    }
    ThinkPrefixDecision::Text
}

fn extract_chat_sse_error(value: &Value) -> (String, Option<String>) {
    let error = value.get("error").unwrap_or(value);
    let message = error
        .as_str()
        .map(ToString::to_string)
        .or_else(|| {
            error
                .get("message")
                .or_else(|| error.get("detail"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| error.to_string());
    let error_type = error
        .get("type")
        .or_else(|| error.get("code"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    (message, error_type)
}

fn http_status_line(status: u16) -> String {
    match status {
        200 => "200 OK".to_string(),
        400 => "400 Bad Request".to_string(),
        401 => "401 Unauthorized".to_string(),
        403 => "403 Forbidden".to_string(),
        404 => "404 Not Found".to_string(),
        429 => "429 Too Many Requests".to_string(),
        500 => "500 Internal Server Error".to_string(),
        502 => "502 Bad Gateway".to_string(),
        503 => "503 Service Unavailable".to_string(),
        _ => format!("{status} Upstream"),
    }
}

pub fn responses_error_from_upstream(status_code: u16, content_type: &str, body: &[u8]) -> Value {
    let (message, error_type, code, param) = upstream_error_parts(status_code, content_type, body);
    let mut error = json!({
        "message": message,
        "type": error_type.unwrap_or_else(|| "upstream_error".to_string()),
    });
    if let Some(code) = code {
        error["code"] = json!(code);
    }
    if let Some(param) = param {
        error["param"] = json!(param);
    }
    json!({ "error": error })
}

fn upstream_error_parts(
    status_code: u16,
    content_type: &str,
    body: &[u8],
) -> (String, Option<String>, Option<String>, Option<String>) {
    if content_type.to_ascii_lowercase().contains("json") {
        if let Ok(value) = serde_json::from_slice::<Value>(body) {
            let error = value.get("error").unwrap_or(&value);
            let message = error
                .get("message")
                .or_else(|| error.get("detail"))
                .or_else(|| error.get("error"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| truncate_error_preview(&value.to_string()));
            let error_type = error
                .get("type")
                .or_else(|| error.get("error_type"))
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let code = error.get("code").and_then(|value| {
                value
                    .as_str()
                    .map(ToString::to_string)
                    .or_else(|| value.as_i64().map(|number| number.to_string()))
            });
            let param = error
                .get("param")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            return (message, error_type, code, param);
        }
    }

    let preview = truncate_error_preview(&String::from_utf8_lossy(body));
    let message = if preview.trim().is_empty() {
        format!("Upstream returned HTTP {status_code}")
    } else {
        preview
    };
    (message, None, Some(status_code.to_string()), None)
}

fn truncate_error_preview(input: &str) -> String {
    input.chars().take(ERROR_BODY_PREVIEW_LIMIT).collect()
}

fn append_responses_input(input: &Value, messages: &mut Vec<Value>) {
    match input {
        Value::String(text) => messages.push(json!({ "role": "user", "content": text })),
        Value::Array(items) => {
            let mut pending_tool_calls = Vec::new();
            let mut pending_reasoning = Vec::new();
            let mut seen_tool_call_ids = BTreeSet::new();
            for item in items {
                append_responses_item(
                    item,
                    messages,
                    &mut pending_tool_calls,
                    &mut pending_reasoning,
                    &mut seen_tool_call_ids,
                );
            }
            flush_tool_calls(messages, &mut pending_tool_calls, &mut pending_reasoning);
            flush_reasoning(messages, &mut pending_reasoning);
        }
        Value::Object(_) => {
            let mut pending_tool_calls = Vec::new();
            let mut pending_reasoning = Vec::new();
            let mut seen_tool_call_ids = BTreeSet::new();
            append_responses_item(
                input,
                messages,
                &mut pending_tool_calls,
                &mut pending_reasoning,
                &mut seen_tool_call_ids,
            );
            flush_tool_calls(messages, &mut pending_tool_calls, &mut pending_reasoning);
            flush_reasoning(messages, &mut pending_reasoning);
        }
        _ => {}
    }
}

fn append_responses_item(
    item: &Value,
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    pending_reasoning: &mut Vec<String>,
    seen_tool_call_ids: &mut BTreeSet<String>,
) {
    match item.get("type").and_then(Value::as_str) {
        Some("function_call") => {
            let name = responses_history_function_name(item);
            if name.is_empty() {
                return;
            }
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if call_id.is_empty() {
                return;
            }
            seen_tool_call_ids.insert(call_id.to_string());
            pending_tool_calls.push(json!({
                "id": call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": responses_arguments_to_chat(item.get("arguments").unwrap_or(&json!({})))
                }
            }));
        }
        Some("function_call_output") => {
            let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
            if call_id.is_empty() {
                return;
            }
            if !seen_tool_call_ids.contains(call_id) {
                flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
                flush_reasoning(messages, pending_reasoning);
                messages.push(orphan_tool_output_message(
                    call_id,
                    item.get("output").unwrap_or(&Value::Null),
                ));
                return;
            }
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": response_output_text(item.get("output").unwrap_or(&Value::Null))
            }));
        }
        Some("custom_tool_call") => {
            let name = item.get("name").and_then(Value::as_str).unwrap_or("");
            let input = item
                .get("input")
                .or_else(|| item.get("arguments"))
                .unwrap_or(&Value::Null);
            let (name, arguments) = build_custom_tool_call_history(name, input);
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if call_id.is_empty() {
                return;
            }
            seen_tool_call_ids.insert(call_id.to_string());
            pending_tool_calls.push(json!({
                "id": call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": arguments
                }
            }));
        }
        Some("custom_tool_call_output") => {
            let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
            if call_id.is_empty() {
                return;
            }
            if !seen_tool_call_ids.contains(call_id) {
                flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
                flush_reasoning(messages, pending_reasoning);
                messages.push(orphan_tool_output_message(
                    call_id,
                    item.get("output").unwrap_or(&Value::Null),
                ));
                return;
            }
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": response_output_text(item.get("output").unwrap_or(&Value::Null))
            }));
        }
        Some("tool_call") => {
            if let Some(tool_use) = item.get("tool_use") {
                let call_id = tool_use
                    .get("id")
                    .or_else(|| item.get("call_id"))
                    .or_else(|| item.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if call_id.is_empty() {
                    return;
                }
                seen_tool_call_ids.insert(call_id.to_string());
                pending_tool_calls.push(json!({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": tool_use.get("name").and_then(Value::as_str).unwrap_or(""),
                        "arguments": responses_arguments_to_chat(tool_use.get("input").unwrap_or(&json!({})))
                    }
                }));
            }
        }
        Some("tool_result") => {
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            let content = item.get("content").unwrap_or(&Value::Null);
            let call_id = content
                .get("tool_use_id")
                .or_else(|| item.get("tool_call_id"))
                .or_else(|| item.get("call_id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if call_id.is_empty() {
                return;
            }
            let output = content.get("content").unwrap_or(content);
            if !seen_tool_call_ids.contains(call_id) {
                flush_reasoning(messages, pending_reasoning);
                messages.push(orphan_tool_output_message(call_id, output));
                return;
            }
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": response_output_text(output)
            }));
        }
        Some("reasoning") => {
            if let Some(text) = responses_reasoning_text(item) {
                if !text.is_empty() {
                    pending_reasoning.push(text);
                }
            }
        }
        _ => {
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            if item.get("role").is_some() || item.get("content").is_some() {
                let role = responses_role_to_chat_role(item.get("role").and_then(Value::as_str));
                let mut message = json!({
                    "role": role,
                    "content": responses_content_to_chat_content(
                        role,
                        item.get("content").unwrap_or(&Value::Null)
                        )
                });
                if role == "assistant" {
                    if !pending_reasoning.is_empty() && pending_tool_calls.is_empty() {
                        message["reasoning_content"] =
                            json!(std::mem::take(pending_reasoning).join("\n"));
                    }
                } else if !pending_reasoning.is_empty() {
                    flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
                    flush_reasoning(messages, pending_reasoning);
                }
                messages.push(message);
            }
        }
    }
}

fn orphan_tool_output_message(call_id: &str, output: &Value) -> Value {
    json!({
        "role": "user",
        "content": format!(
            "Function call output ({call_id}): {}",
            response_output_text(output)
        )
    })
}

fn normalize_chat_messages(messages: &mut [Value]) {
    for message in messages {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let has_content = match message.get("content") {
            Some(Value::Null) | None => false,
            Some(Value::String(_)) => true,
            Some(Value::Array(parts)) => !parts.is_empty(),
            Some(_) => true,
        };
        let has_tool_calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|tool_calls| !tool_calls.is_empty());
        if !has_content && !has_tool_calls {
            message["content"] = json!("");
        }
    }
}

fn collapse_system_messages_to_head(messages: Vec<Value>) -> Vec<Value> {
    let mut system_chunks = Vec::new();
    let mut rest = Vec::with_capacity(messages.len());

    for message in messages {
        if message.get("role").and_then(Value::as_str) == Some("system") {
            if let Some(text) = message.get("content").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    system_chunks.push(text.to_string());
                }
                continue;
            }
        }
        rest.push(message);
    }

    let mut output = Vec::with_capacity(rest.len() + usize::from(!system_chunks.is_empty()));
    if !system_chunks.is_empty() {
        output.push(json!({
            "role": "system",
            "content": system_chunks.join("\n\n")
        }));
    }
    output.extend(rest);
    output
}

fn responses_role_to_chat_role(role: Option<&str>) -> &'static str {
    match role {
        Some("developer") | Some("system") => "system",
        Some("assistant") => "assistant",
        Some("tool") => "tool",
        Some("latest_reminder") => "user",
        Some("user") | None => "user",
        Some(_) => "user",
    }
}

fn flush_tool_calls(
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    pending_reasoning: &mut Vec<String>,
) {
    if pending_tool_calls.is_empty() {
        return;
    }

    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some("assistant") {
            merge_tool_calls_into_message(last, std::mem::take(pending_tool_calls));
            return;
        }
    }

    let mut message = json!({
        "role": "assistant",
        "content": "",
        "tool_calls": std::mem::take(pending_tool_calls)
    });
    if !pending_reasoning.is_empty() {
        message["reasoning_content"] = json!(std::mem::take(pending_reasoning).join("\n"));
    }
    messages.push(message);
}

fn flush_reasoning(messages: &mut Vec<Value>, pending_reasoning: &mut Vec<String>) {
    if pending_reasoning.is_empty() {
        return;
    }
    let reasoning = std::mem::take(pending_reasoning).join("\n");
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some("assistant") {
            append_reasoning_to_assistant_message(last, &reasoning);
            return;
        }
    }
    messages.push(json!({
        "role": "assistant",
        "content": "",
        "reasoning_content": reasoning
    }));
}

fn append_reasoning_to_assistant_message(message: &mut Value, reasoning: &str) {
    if reasoning.is_empty() {
        return;
    }
    let existing = message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .unwrap_or("");
    message["reasoning_content"] = if existing.is_empty() {
        json!(reasoning)
    } else {
        json!(format!("{existing}\n{reasoning}"))
    };
    if message.get("content").is_none() || message.get("content") == Some(&Value::Null) {
        message["content"] = json!("");
    }
}

fn merge_tool_calls_into_message(message: &mut Value, incoming: Vec<Value>) {
    let Some(object) = message.as_object_mut() else {
        return;
    };
    let existing = object
        .entry("tool_calls".to_string())
        .or_insert_with(|| json!([]));
    let Some(existing_array) = existing.as_array_mut() else {
        *existing = json!(incoming);
        return;
    };
    for tool_call in incoming {
        let id = tool_call.get("id").and_then(Value::as_str).unwrap_or("");
        if !id.is_empty()
            && existing_array
                .iter()
                .any(|item| item.get("id").and_then(Value::as_str) == Some(id))
        {
            continue;
        }
        existing_array.push(tool_call);
    }
    if message.get("content").is_none() || message.get("content") == Some(&Value::Null) {
        message["content"] = json!("");
    }
}

fn responses_reasoning_text(item: &Value) -> Option<String> {
    extract_reasoning_summary_text(item).or_else(|| extract_reasoning_field_text(item))
}

fn responses_content_to_chat_content(_role: &str, content: &Value) -> Value {
    if content.is_null() || content.is_string() {
        return content.clone();
    }

    let Some(parts) = content.as_array() else {
        return content.clone();
    };
    let mut chat_parts = Vec::new();
    let mut has_non_text_part = false;

    for part in parts {
        match part.get("type").and_then(Value::as_str).unwrap_or("") {
            "input_text" | "output_text" | "text" => {
                if let Some(value) = part.get("text").and_then(Value::as_str) {
                    if !value.is_empty() {
                        chat_parts.push(json!({ "type": "text", "text": value }));
                    }
                }
            }
            "refusal" => {
                if let Some(value) = part.get("refusal").and_then(Value::as_str) {
                    if !value.is_empty() {
                        chat_parts.push(json!({ "type": "text", "text": value }));
                    }
                }
            }
            "input_image" => {
                if let Some(image_url) = part.get("image_url") {
                    let image_url = if image_url.is_object() {
                        image_url.clone()
                    } else {
                        json!({ "url": image_url.as_str().unwrap_or_default() })
                    };
                    chat_parts.push(json!({ "type": "image_url", "image_url": image_url }));
                    has_non_text_part = true;
                }
            }
            _ => {}
        }
    }

    if !has_non_text_part {
        return Value::String(
            chat_parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    Value::Array(chat_parts)
}

fn responses_history_function_name(item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
    let namespace = item.get("namespace").and_then(Value::as_str).unwrap_or("");
    if name.is_empty() {
        String::new()
    } else if namespace.is_empty() {
        name.to_string()
    } else {
        flatten_namespace_tool_name(namespace, name)
    }
}

fn build_codex_tool_context(tools: Option<&Value>) -> CodexToolContext {
    let mut context = CodexToolContext::default();
    let Some(tools) = tools.and_then(Value::as_array) else {
        return context;
    };

    for tool in tools {
        if let Some(name) = tool.as_str().filter(|name| !name.is_empty()) {
            if let Some(action) = proxy_action_from_upstream_name(name) {
                context.custom_tools.insert(
                    name.to_string(),
                    CodexCustomToolSpec {
                        openai_name: "apply_patch".to_string(),
                        namespace: String::new(),
                        kind: CodexCustomToolKind::ApplyPatch,
                        proxy_action: Some(action),
                    },
                );
                context.has_custom_tools = true;
                continue;
            }
            context.custom_tools.insert(
                name.to_string(),
                CodexCustomToolSpec {
                    openai_name: name.to_string(),
                    namespace: String::new(),
                    kind: CodexCustomToolKind::Raw,
                    proxy_action: None,
                },
            );
            context.has_custom_tools = true;
            continue;
        }
        if response_tool_type(tool) == "namespace" {
            add_namespace_tools_to_context(&mut context, tool);
        } else if response_tool_is_structured_function(tool) {
            if let Some(name) = response_tool_name(tool) {
                context.function_tools.insert(
                    name.to_string(),
                    CodexFunctionToolSpec {
                        name: name.to_string(),
                        namespace: String::new(),
                    },
                );
            }
        } else if let Some((upstream_name, openai_name)) = response_tool_proxy_names("", tool) {
            add_custom_tool_to_context(&mut context, &upstream_name, &openai_name, "", tool);
        }
    }

    context
}

fn add_namespace_tools_to_context(context: &mut CodexToolContext, namespace_tool: &Value) {
    let namespace = namespace_tool
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let Some(children) = namespace_tool.get("tools").and_then(Value::as_array) else {
        return;
    };
    for child in children {
        if response_tool_is_structured_function(child) {
            let Some(name) = response_tool_name(child) else {
                continue;
            };
            let flat = flatten_namespace_tool_name(namespace, name);
            if namespace.is_empty() {
                context.function_tools.insert(
                    flat,
                    CodexFunctionToolSpec {
                        namespace: namespace.to_string(),
                        name: name.to_string(),
                    },
                );
            } else if context
                .function_tools
                .get(&flat)
                .is_none_or(|spec| !spec.namespace.is_empty())
            {
                context.function_tools.insert(
                    flat,
                    CodexFunctionToolSpec {
                        namespace: namespace.to_string(),
                        name: name.to_string(),
                    },
                );
                context.has_namespace_tools = true;
            }
        } else if let Some((upstream_name, openai_name)) =
            response_tool_proxy_names(namespace, child)
        {
            add_custom_tool_to_context(context, &upstream_name, &openai_name, namespace, child);
            if !namespace.is_empty() {
                context.has_namespace_tools = true;
            }
        }
    }
}

fn responses_tools_to_chat_tools(tools: &[Value], context: &CodexToolContext) -> Vec<Value> {
    let mut converted = Vec::new();
    for tool in tools {
        if let Some(name) = tool.as_str().filter(|name| !name.is_empty()) {
            converted.push(generic_custom_proxy_tool(name, ""));
            continue;
        }
        if response_tool_type(tool) == "namespace" {
            converted.extend(namespace_tool_to_chat_tools(tool, context));
        } else if response_tool_is_structured_function(tool) {
            if let Some(tool) = responses_function_tool_to_chat_tool(tool) {
                converted.push(tool);
            }
        } else if let Some((upstream_name, openai_name)) = response_tool_proxy_names("", tool) {
            let description = response_tool_description(tool);
            if detect_codex_custom_tool_kind(tool, &openai_name) == CodexCustomToolKind::ApplyPatch
            {
                converted.extend(apply_patch_proxy_tools(&upstream_name, description));
            } else {
                converted.push(generic_custom_proxy_tool(&upstream_name, description));
            }
        }
    }
    converted
}

fn response_tool_type(tool: &Value) -> &str {
    tool.get("type").and_then(Value::as_str).unwrap_or("")
}

fn response_tool_name(tool: &Value) -> Option<&str> {
    tool.get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
        })
}

fn response_tool_description(tool: &Value) -> &str {
    tool.get("description")
        .and_then(Value::as_str)
        .or_else(|| {
            tool.pointer("/function/description")
                .and_then(Value::as_str)
        })
        .unwrap_or("")
}

fn response_tool_parameters(tool: &Value) -> Option<&Value> {
    ["parameters", "input_schema", "inputSchema", "schema"]
        .into_iter()
        .find_map(|key| tool.get(key))
        .or_else(|| tool.pointer("/function/parameters"))
}

fn response_tool_is_structured_function(tool: &Value) -> bool {
    match response_tool_type(tool) {
        "custom" | "web_search" | "local_shell" | "computer_use" => false,
        "function" => true,
        _ => {
            tool.get("function").is_some_and(Value::is_object)
                || (response_tool_name(tool).is_some() && response_tool_parameters(tool).is_some())
        }
    }
}

fn response_tool_proxy_names(namespace: &str, tool: &Value) -> Option<(String, String)> {
    let name = response_tool_name(tool).or_else(|| {
        let tool_type = response_tool_type(tool);
        (!tool_type.is_empty() && tool_type != "function" && tool_type != "namespace")
            .then_some(tool_type)
    })?;
    Some((
        flatten_namespace_tool_name(namespace, name),
        name.to_string(),
    ))
}

fn add_custom_tool_to_context(
    context: &mut CodexToolContext,
    upstream_name: &str,
    openai_name: &str,
    namespace: &str,
    tool: &Value,
) {
    let kind = detect_codex_custom_tool_kind(tool, openai_name);
    context.custom_tools.insert(
        upstream_name.to_string(),
        CodexCustomToolSpec {
            openai_name: openai_name.to_string(),
            namespace: namespace.to_string(),
            kind,
            proxy_action: None,
        },
    );
    if kind == CodexCustomToolKind::ApplyPatch {
        for action in [
            CodexPatchProxyAction::AddFile,
            CodexPatchProxyAction::DeleteFile,
            CodexPatchProxyAction::UpdateFile,
            CodexPatchProxyAction::ReplaceFile,
            CodexPatchProxyAction::Batch,
        ] {
            let proxy_name = format!("{upstream_name}_{}", action.suffix());
            context.custom_tools.insert(
                proxy_name,
                CodexCustomToolSpec {
                    openai_name: openai_name.to_string(),
                    namespace: namespace.to_string(),
                    kind: CodexCustomToolKind::ApplyPatch,
                    proxy_action: Some(action),
                },
            );
        }
    }
    context.has_custom_tools = true;
}

fn detect_codex_custom_tool_kind(tool: &Value, name: &str) -> CodexCustomToolKind {
    if name == "apply_patch" {
        return CodexCustomToolKind::ApplyPatch;
    }
    if let Some(definition) = tool.pointer("/format/definition").and_then(Value::as_str) {
        if definition.contains("begin_patch")
            && definition.contains("end_patch")
            && definition.contains("add_hunk")
        {
            return CodexCustomToolKind::ApplyPatch;
        }
    }
    if matches!(
        tool.get("type").and_then(Value::as_str),
        Some("web_search" | "local_shell" | "computer_use")
    ) {
        CodexCustomToolKind::BuiltIn
    } else {
        CodexCustomToolKind::Raw
    }
}

fn responses_function_tool_to_chat_tool(tool: &Value) -> Option<Value> {
    if !response_tool_is_structured_function(tool) {
        return None;
    }
    let name = response_tool_name(tool)?;
    let mut function = json!({
        "name": name,
        "description": response_tool_description(tool),
        "parameters": normalize_chat_tool_parameters(
            response_tool_parameters(tool).unwrap_or(&json!({}))
        )
    });
    if let Some(strict) = tool.get("strict") {
        function["strict"] = strict.clone();
    } else if let Some(strict) = tool.pointer("/function/strict") {
        function["strict"] = strict.clone();
    }
    Some(json!({
        "type": "function",
        "function": function
    }))
}

fn namespace_tool_to_chat_tools(namespace_tool: &Value, context: &CodexToolContext) -> Vec<Value> {
    let namespace = namespace_tool
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let namespace_description = namespace_tool
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let Some(children) = namespace_tool.get("tools").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut converted = Vec::new();
    for child in children {
        if response_tool_is_structured_function(child) {
            let Some(name) = response_tool_name(child) else {
                continue;
            };
            let flat = flatten_namespace_tool_name(namespace, name);
            if namespace != ""
                && context
                    .function_tools
                    .get(&flat)
                    .is_some_and(|spec| spec.namespace.is_empty())
            {
                continue;
            }
            let description = combine_namespace_description(
                namespace_description,
                response_tool_description(child),
            );
            let mut function = json!({
                "name": flat,
                "parameters": normalize_chat_tool_parameters(
                    response_tool_parameters(child).unwrap_or(&json!({}))
                )
            });
            if !description.is_empty() {
                function["description"] = json!(description);
            }
            if let Some(strict) = child
                .get("strict")
                .or_else(|| child.pointer("/function/strict"))
            {
                function["strict"] = strict.clone();
            }
            converted.push(json!({
                "type": "function",
                "function": function
            }));
        } else if let Some((upstream_name, openai_name)) =
            response_tool_proxy_names(namespace, child)
        {
            let description = combine_namespace_description(
                namespace_description,
                response_tool_description(child),
            );
            if detect_codex_custom_tool_kind(child, &openai_name) == CodexCustomToolKind::ApplyPatch
            {
                converted.extend(apply_patch_proxy_tools(&upstream_name, &description));
            } else {
                converted.push(generic_custom_proxy_tool(&upstream_name, &description));
            }
        }
    }
    converted
}

fn normalize_chat_tool_parameters(parameters: &Value) -> Value {
    let mut normalized = if parameters.is_object() {
        parameters.clone()
    } else {
        json!({})
    };
    if normalized.get("type").is_none() {
        normalized["type"] = json!("object");
    }
    if normalized.get("properties").is_none() {
        normalized["properties"] = json!({});
    }
    if normalized.get("required").is_none() {
        normalized["required"] = json!([]);
    }
    normalized
}

fn generic_custom_proxy_tool(name: &str, description: &str) -> Value {
    let description = if description.trim().is_empty() {
        format!("FREEFORM custom tool: {name}. Put only the tool input text here.")
    } else {
        format!(
            "{}\n\nThis is a FREEFORM tool. Do not wrap the input in JSON or markdown.",
            description.trim()
        )
    };
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "input": {
                        "type": "string",
                        "description": "Raw freeform input for this custom tool."
                    }
                },
                "required": ["input"]
            }
        }
    })
}

fn apply_patch_proxy_tools(name: &str, description: &str) -> Vec<Value> {
    vec![
        function_tool(
            &format!("{name}_add_file"),
            &patch_proxy_description(
                description,
                "add_file",
                "Create one new file by providing a target path and full file content.",
            ),
            apply_patch_add_file_schema(),
        ),
        function_tool(
            &format!("{name}_delete_file"),
            &patch_proxy_description(
                description,
                "delete_file",
                "Delete one file by providing a target path.",
            ),
            apply_patch_delete_file_schema(),
        ),
        function_tool(
            &format!("{name}_update_file"),
            &patch_proxy_description(
                description,
                "update_file",
                "Edit one existing file with structured hunks.",
            ),
            apply_patch_update_file_schema(),
        ),
        function_tool(
            &format!("{name}_replace_file"),
            &patch_proxy_description(
                description,
                "replace_file",
                "Replace one existing file by providing a target path and full new file content.",
            ),
            apply_patch_replace_file_schema(),
        ),
        function_tool(
            &format!("{name}_batch"),
            &patch_proxy_description(
                description,
                "batch",
                "Edit files by providing structured JSON patch operations.",
            ),
            apply_patch_batch_schema(),
        ),
    ]
}

fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters
        }
    })
}

fn patch_proxy_description(description: &str, action: &str, default_description: &str) -> String {
    if description.trim().is_empty() {
        default_description.to_string()
    } else {
        format!("{} (proxy action: {action})", description.trim())
    }
}

fn apply_patch_add_file_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": { "type": "string", "description": "Target file path." },
            "content": { "type": "string", "description": "Full file content without patch '+' prefixes." }
        },
        "required": ["path", "content"]
    })
}

fn apply_patch_delete_file_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": { "type": "string", "description": "Target file path." }
        },
        "required": ["path"]
    })
}

fn apply_patch_update_file_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": { "type": "string", "description": "Target file path." },
            "move_to": { "type": "string", "description": "Optional destination path for move operations." },
            "hunks": apply_patch_hunks_schema()
        },
        "required": ["path", "hunks"]
    })
}

fn apply_patch_replace_file_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": { "type": "string", "description": "Target file path." },
            "content": { "type": "string", "description": "Full replacement content." }
        },
        "required": ["path", "content"]
    })
}

fn apply_patch_batch_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "operations": {
                "type": "array",
                "description": "Ordered list of file patch operations.",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "type": { "type": "string", "enum": ["add_file", "delete_file", "update_file", "replace_file"] },
                        "path": { "type": "string" },
                        "move_to": { "type": "string", "description": "Optional destination path for move operations (update_file only)." },
                        "content": { "type": "string", "description": "Full file content for add_file / replace_file." },
                        "hunks": apply_patch_hunks_schema()
                    },
                    "required": ["type", "path"]
                }
            }
        },
        "required": ["operations"]
    })
}

fn apply_patch_hunks_schema() -> Value {
    json!({
        "type": "array",
        "description": "Structured update hunks (required when type=update_file).",
        "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "context": { "type": "string", "description": "Optional @@ context header text." },
                "lines": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "op": { "type": "string", "enum": ["context", "add", "remove"] },
                            "text": { "type": "string" }
                        },
                        "required": ["op", "text"]
                    }
                }
            },
            "required": ["lines"]
        }
    })
}

fn proxy_action_from_upstream_name(name: &str) -> Option<CodexPatchProxyAction> {
    if name.ends_with("_add_file") {
        Some(CodexPatchProxyAction::AddFile)
    } else if name.ends_with("_delete_file") {
        Some(CodexPatchProxyAction::DeleteFile)
    } else if name.ends_with("_update_file") {
        Some(CodexPatchProxyAction::UpdateFile)
    } else if name.ends_with("_replace_file") {
        Some(CodexPatchProxyAction::ReplaceFile)
    } else if name.ends_with("_batch") {
        Some(CodexPatchProxyAction::Batch)
    } else {
        None
    }
}

fn combine_namespace_description(namespace_description: &str, child_description: &str) -> String {
    let namespace_description = namespace_description.trim();
    let child_description = child_description.trim();
    match (
        namespace_description.is_empty(),
        child_description.is_empty(),
    ) {
        (true, true) => String::new(),
        (true, false) => child_description.to_string(),
        (false, true) => namespace_description.to_string(),
        (false, false) => format!("{namespace_description}\n\n{child_description}"),
    }
}

fn flatten_namespace_tool_name(namespace: &str, name: &str) -> String {
    if namespace.is_empty() {
        return name.to_string();
    }
    if name.is_empty() {
        return namespace.to_string();
    }
    if namespace.ends_with("__") || name.starts_with("__") {
        format!("{namespace}{name}")
    } else {
        format!("{namespace}__{name}")
    }
}

fn response_tools_diagnostic_summary(tools: Option<&Value>) -> Value {
    let Some(tools) = tools.and_then(Value::as_array) else {
        return json!({
            "present": tools.is_some(),
            "count": 0,
            "topLevelTypes": {},
            "namespaceChildTypes": {}
        });
    };

    let mut top_level_types = BTreeMap::<String, usize>::new();
    let mut namespace_child_types = BTreeMap::<String, usize>::new();
    let mut named_tool_count = 0usize;
    let mut structured_tool_count = 0usize;
    for tool in tools {
        let tool_type = if tool.is_string() {
            "string".to_string()
        } else {
            response_tool_type(tool).to_string()
        };
        *top_level_types.entry(tool_type).or_default() += 1;
        if response_tool_name(tool).is_some() {
            named_tool_count += 1;
        }
        if response_tool_is_structured_function(tool) {
            structured_tool_count += 1;
        }
        if let Some(children) = tool.get("tools").and_then(Value::as_array) {
            for child in children {
                *namespace_child_types
                    .entry(response_tool_type(child).to_string())
                    .or_default() += 1;
                if response_tool_name(child).is_some() {
                    named_tool_count += 1;
                }
                if response_tool_is_structured_function(child) {
                    structured_tool_count += 1;
                }
            }
        }
    }

    json!({
        "present": true,
        "count": tools.len(),
        "namedToolCount": named_tool_count,
        "structuredToolCount": structured_tool_count,
        "topLevelTypes": top_level_types,
        "namespaceChildTypes": namespace_child_types
    })
}

fn responses_tool_choice_to_chat(tool_choice: &Value, context: &CodexToolContext) -> Option<Value> {
    match tool_choice {
        Value::Object(object) if object.get("type").and_then(Value::as_str) == Some("function") => {
            if let Some(namespace) = object.get("namespace").and_then(Value::as_str) {
                let name = object.get("name").and_then(Value::as_str).unwrap_or("");
                return Some(json!({
                    "type": "function",
                    "function": {
                        "name": flatten_namespace_tool_name(namespace, name)
                    }
                }));
            }
            if let Some(function) = object.get("function").and_then(Value::as_object) {
                if let Some(namespace) = function.get("namespace").and_then(Value::as_str) {
                    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
                    return Some(json!({
                        "type": "function",
                        "function": {
                            "name": flatten_namespace_tool_name(namespace, name)
                        }
                    }));
                }
            }
            Some(json!({
                "type": "function",
                "function": {
                    "name": object.get("name").and_then(Value::as_str).unwrap_or("")
                }
            }))
        }
        Value::Object(object) => {
            let Some(name) = object.get("name").and_then(Value::as_str) else {
                return Some(tool_choice.clone());
            };
            let namespace = object
                .get("namespace")
                .and_then(Value::as_str)
                .unwrap_or("");
            let upstream_name = flatten_namespace_tool_name(namespace, name);
            let lookup_name = if context.custom_tools.contains_key(&upstream_name) {
                upstream_name
            } else {
                name.to_string()
            };
            let Some(spec) = context.custom_tools.get(&lookup_name) else {
                return Some(tool_choice.clone());
            };
            let selected_name = if spec.kind == CodexCustomToolKind::ApplyPatch {
                format!("{}_batch", lookup_name)
            } else {
                lookup_name
            };
            Some(json!({
                "type": "function",
                "function": { "name": selected_name }
            }))
        }
        other => Some(other.clone()),
    }
}

fn chat_reasoning_to_response_output_item(message: &Value, response_id: &str) -> Option<Value> {
    let reasoning = chat_reasoning_text(message)?;
    if reasoning.is_empty() {
        return None;
    }
    Some(json!({
        "id": format!("rs_{response_id}"),
        "type": "reasoning",
        "reasoning_content": reasoning,
        "summary": [{ "type": "summary_text", "text": reasoning }]
    }))
}

fn chat_reasoning_text(message: &Value) -> Option<String> {
    if let Some(reasoning) = extract_reasoning_field_text(message) {
        return Some(reasoning);
    }

    if let Some(content) = message.get("content").and_then(Value::as_str) {
        if let Some((reasoning, _answer)) = split_leading_think_block(content) {
            if !reasoning.is_empty() {
                return Some(reasoning);
            }
        }
    }

    None
}

fn chat_message_to_response_output_item(message: &Value, response_id: &str) -> Option<Value> {
    let mut content = Vec::new();
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        let text = split_leading_think_block(text)
            .map(|(_reasoning, answer)| answer)
            .unwrap_or_else(|| text.to_string());
        if !text.is_empty() {
            content.push(json!({ "type": "output_text", "text": text, "annotations": [] }));
        }
    } else if let Some(parts) = message.get("content").and_then(Value::as_array) {
        for part in parts {
            match part.get("type").and_then(Value::as_str).unwrap_or("") {
                "text" | "output_text" => {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            content.push(
                                json!({ "type": "output_text", "text": text, "annotations": [] }),
                            );
                        }
                    }
                }
                "refusal" => {
                    if let Some(refusal) = part.get("refusal").and_then(Value::as_str) {
                        if !refusal.is_empty() {
                            content.push(json!({ "type": "refusal", "refusal": refusal }));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(refusal) = message.get("refusal").and_then(Value::as_str) {
        if !refusal.is_empty() {
            content.push(json!({ "type": "refusal", "refusal": refusal }));
        }
    }

    if content.is_empty() {
        return None;
    }

    Some(json!({
        "id": format!("{response_id}_msg"),
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": content
    }))
}

fn chat_tool_calls_to_response_output_items(
    message: &Value,
    tool_context: &CodexToolContext,
) -> Vec<Value> {
    let mut output = Vec::new();
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, tool_call) in tool_calls.iter().enumerate() {
            output.push(chat_tool_call_to_response_item(
                tool_call,
                index,
                tool_context,
            ));
        }
    } else if let Some(function_call) = message.get("function_call") {
        output.push(chat_legacy_function_call_to_response_item(
            function_call,
            tool_context,
        ));
    }
    output
}

fn chat_tool_call_to_response_item(
    tool_call: &Value,
    index: usize,
    tool_context: &CodexToolContext,
) -> Value {
    let call_id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("call_{index}"));
    let function = tool_call.get("function").unwrap_or(&Value::Null);
    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
    let arguments = responses_arguments_to_chat(function.get("arguments").unwrap_or(&json!({})));
    response_tool_call_item(&call_id, name, &arguments, tool_context)
}

fn chat_legacy_function_call_to_response_item(
    function_call: &Value,
    tool_context: &CodexToolContext,
) -> Value {
    let call_id = function_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("call_0");
    let name = function_call
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let arguments =
        responses_arguments_to_chat(function_call.get("arguments").unwrap_or(&json!({})));
    response_tool_call_item(call_id, name, &arguments, tool_context)
}

fn tool_call_added_item(
    state: &ToolCallState,
    output_index: u32,
    tool_context: &CodexToolContext,
) -> Value {
    if tool_context.is_custom_tool_proxy(&state.name) {
        let (display_name, namespace) = tool_context.openai_name_for_custom_tool(&state.name);
        let mut item = json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": {
                "id": format!("ctc_{}", state.call_id),
                "type": "custom_tool_call",
                "status": "in_progress",
                "call_id": state.call_id,
                "name": display_name,
                "input": ""
            }
        });
        if !namespace.is_empty() {
            item["item"]["namespace"] = json!(namespace);
        }
        return item;
    }
    let (display_name, namespace) = tool_context.openai_name_for_function_tool(&state.name);
    let mut item = json!({
        "type": "response.output_item.added",
        "output_index": output_index,
        "item": {
            "id": state.item_id,
            "type": "function_call",
            "status": "in_progress",
            "call_id": state.call_id,
            "name": display_name,
            "arguments": ""
        }
    });
    if !namespace.is_empty() {
        item["item"]["namespace"] = json!(namespace);
    }
    item
}

fn push_tool_call_delta_sse(
    output: &mut String,
    state: &ToolCallState,
    output_index: u32,
    delta: &str,
    tool_context: &CodexToolContext,
) {
    if tool_context.is_custom_tool_proxy(&state.name) {
        let _ = delta;
    } else {
        push_sse(
            output,
            "response.function_call_arguments.delta",
            json!({
                "type": "response.function_call_arguments.delta",
                "item_id": state.item_id,
                "output_index": output_index,
                "delta": delta
            }),
        );
    }
}

fn push_tool_call_done_sse(
    output: &mut String,
    state: &ToolCallState,
    output_index: u32,
    tool_context: &CodexToolContext,
) {
    if tool_context.is_custom_tool_proxy(&state.name) {
        push_sse(
            output,
            "response.custom_tool_call_input.delta",
            json!({
                "type": "response.custom_tool_call_input.delta",
                "item_id": format!("ctc_{}", state.call_id),
                "call_id": state.call_id,
                "output_index": output_index,
                "delta": reconstruct_custom_tool_call_input_with_context(
                    tool_context,
                    &state.name,
                    &state.arguments
                )
            }),
        );
        return;
    }
    push_sse(
        output,
        "response.function_call_arguments.done",
        json!({
            "type": "response.function_call_arguments.done",
            "item_id": state.item_id,
            "output_index": output_index,
            "arguments": state.arguments
        }),
    );
}

fn tool_call_done_item(state: &ToolCallState, tool_context: &CodexToolContext) -> Value {
    response_tool_call_item(&state.call_id, &state.name, &state.arguments, tool_context)
}

fn response_tool_call_item(
    call_id: &str,
    name: &str,
    arguments: &str,
    tool_context: &CodexToolContext,
) -> Value {
    if tool_context.is_custom_tool_proxy(name) {
        let (display_name, namespace) = tool_context.openai_name_for_custom_tool(name);
        let mut item = json!({
            "id": format!("ctc_{call_id}"),
            "type": "custom_tool_call",
            "status": "completed",
            "call_id": call_id,
            "name": display_name,
            "input": reconstruct_custom_tool_call_input_with_context(tool_context, name, arguments)
        });
        if !namespace.is_empty() {
            item["namespace"] = json!(namespace);
        }
        return item;
    }
    let (display_name, namespace) = tool_context.openai_name_for_function_tool(name);
    let mut item = json!({
        "id": format!("fc_{call_id}"),
        "type": "function_call",
        "status": "completed",
        "call_id": call_id,
        "name": display_name,
        "arguments": arguments
    });
    if !namespace.is_empty() {
        item["namespace"] = json!(namespace);
    }
    item
}

fn split_leading_think_block(text: &str) -> Option<(String, String)> {
    let leading_ws_len = text.len() - text.trim_start().len();
    let after_ws = &text[leading_ws_len..];
    if !after_ws.starts_with(THINK_OPEN_TAG) {
        return None;
    }
    let body_start = leading_ws_len + THINK_OPEN_TAG.len();
    let close_relative = text[body_start..].find(THINK_CLOSE_TAG)?;
    let close_start = body_start + close_relative;
    let answer_start = close_start + THINK_CLOSE_TAG.len();
    Some((
        text[body_start..close_start].trim().to_string(),
        strip_think_answer_separator(&text[answer_start..]).to_string(),
    ))
}

fn strip_leading_think_open_tag(text: &str) -> Option<String> {
    let leading_ws_len = text.len() - text.trim_start().len();
    let after_ws = &text[leading_ws_len..];
    after_ws
        .strip_prefix(THINK_OPEN_TAG)
        .map(|value| value.trim().to_string())
}

fn strip_think_answer_separator(text: &str) -> &str {
    text.trim_start_matches(['\r', '\n', '\t', ' '])
}

fn extract_reasoning_field_text(value: &Value) -> Option<String> {
    for key in ["reasoning_content", "reasoning"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }

    if let Some(reasoning) = value.get("reasoning") {
        for key in ["content", "text", "summary"] {
            if let Some(text) = reasoning.get(key).and_then(Value::as_str) {
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }

    value
        .get("reasoning_details")
        .and_then(extract_reasoning_details_text)
}

fn extract_reasoning_details_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => (!text.is_empty()).then(|| text.to_string()),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(extract_reasoning_detail_part_text)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            (!text.is_empty()).then_some(text)
        }
        Value::Object(_) => extract_reasoning_detail_part_text(value),
        _ => None,
    }
}

fn extract_reasoning_detail_part_text(value: &Value) -> Option<String> {
    for key in ["text", "content", "summary"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }

    if let Some(parts) = value.get("parts").and_then(Value::as_array) {
        let text = parts
            .iter()
            .filter_map(extract_reasoning_detail_part_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        return (!text.is_empty()).then_some(text);
    }

    None
}

fn extract_reasoning_summary_text(value: &Value) -> Option<String> {
    for key in ["reasoning_content", "content", "text"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }

    let summary = value.get("summary")?;
    if let Some(text) = summary.as_str() {
        return (!text.is_empty()).then(|| text.to_string());
    }

    let parts = summary.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .or_else(|| part.get("content").and_then(Value::as_str))
                .or_else(|| part.as_str())
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    (!text.is_empty()).then_some(text)
}

fn default_responses_usage() -> Value {
    json!({ "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 })
}

fn chat_usage_to_responses_usage(usage: Option<&Value>) -> Value {
    let Some(usage) = usage.filter(|value| value.is_object() && !value.is_null()) else {
        return default_responses_usage();
    };
    let mut input_tokens = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("promptTokenCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let mut input_tokens_include_cache = usage.get("prompt_tokens").is_some();
    let output_tokens = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("candidatesTokenCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let mut cached_tokens = usage
        .pointer("/prompt_tokens_details/cached_tokens")
        .or_else(|| usage.pointer("/input_tokens_details/cached_tokens"))
        .or_else(|| usage.get("cachedContentTokenCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_creation = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_creation_5m = usage
        .get("cache_creation_5m_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_creation_1h = usage
        .get("cache_creation_1h_input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let has_claude_cache_fields = usage.get("cache_read_input_tokens").is_some()
        || usage.get("cache_creation_input_tokens").is_some()
        || usage.get("cache_creation_5m_input_tokens").is_some()
        || usage.get("cache_creation_1h_input_tokens").is_some();
    let has_cache_details = cached_tokens > 0
        || usage
            .pointer("/prompt_tokens_details/cached_tokens")
            .is_some()
        || usage
            .pointer("/input_tokens_details/cached_tokens")
            .is_some();

    if let Some(value) = usage.get("input_tokens").and_then(Value::as_u64) {
        input_tokens = value;
        input_tokens_include_cache = false;
    }
    if let Some(cache_read) = usage.get("cache_read_input_tokens").and_then(Value::as_u64) {
        cached_tokens = cache_read;
    }
    if let Some(prompt_tokens) = usage.get("promptTokenCount").and_then(Value::as_u64) {
        cached_tokens = usage
            .get("cachedContentTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        input_tokens = prompt_tokens.saturating_sub(cached_tokens);
        input_tokens_include_cache = false;
    }

    let usage_input_tokens = if input_tokens_include_cache {
        input_tokens.saturating_sub(
            cached_tokens
                + effective_cache_creation_tokens(
                    cache_creation,
                    cache_creation_5m,
                    cache_creation_1h,
                ),
        )
    } else {
        input_tokens
    };
    let should_recalculate_total = usage.get("total_tokens").is_none()
        || cached_tokens > 0
        || effective_cache_creation_tokens(cache_creation, cache_creation_5m, cache_creation_1h)
            > 0
        || usage.get("promptTokenCount").is_some();
    let total_tokens = if should_recalculate_total {
        usage_input_tokens
            + output_tokens
            + cached_tokens
            + effective_cache_creation_tokens(cache_creation, cache_creation_5m, cache_creation_1h)
    } else {
        usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(usage_input_tokens + output_tokens)
    };
    let mut result = json!({
        "input_tokens": usage_input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens
    });

    if !has_claude_cache_fields && has_cache_details && cached_tokens > 0 {
        result["input_tokens_details"] = json!({ "cached_tokens": cached_tokens });
    }
    if let Some(details) = usage.get("completion_tokens_details") {
        result["output_tokens_details"] = details.clone();
    }
    if let Some(cache_read) = usage.get("cache_read_input_tokens") {
        result["cache_read_input_tokens"] = cache_read.clone();
    }
    if let Some(cache_creation) = usage.get("cache_creation_input_tokens") {
        result["cache_creation_input_tokens"] = cache_creation.clone();
    }
    if let Some(cache_creation) = usage.get("cache_creation_5m_input_tokens") {
        result["cache_creation_5m_input_tokens"] = cache_creation.clone();
    }
    if let Some(cache_creation) = usage.get("cache_creation_1h_input_tokens") {
        result["cache_creation_1h_input_tokens"] = cache_creation.clone();
    }
    let cache_ttl = match (cache_creation_5m > 0, cache_creation_1h > 0) {
        (true, true) => Some("mixed"),
        (true, false) => Some("5m"),
        (false, true) => Some("1h"),
        (false, false) => None,
    };
    if let Some(cache_ttl) = cache_ttl {
        result["cache_ttl"] = json!(cache_ttl);
    }
    result
}

fn effective_cache_creation_tokens(
    cache_creation: u64,
    cache_creation_5m: u64,
    cache_creation_1h: u64,
) -> u64 {
    if cache_creation > 0 {
        cache_creation
    } else {
        cache_creation_5m + cache_creation_1h
    }
}

fn response_status(finish_reason: Option<&str>) -> &'static str {
    match finish_reason {
        Some("length") => "incomplete",
        _ => "completed",
    }
}

fn response_output_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => canonical_json_string(other),
    }
}

fn build_custom_tool_call_history(name: &str, input: &Value) -> (String, String) {
    let input = response_output_text(input);
    if name == "apply_patch" || input.starts_with("*** Begin Patch") {
        let operations = parse_apply_patch_operations(&input);
        if operations.len() == 1 {
            let action = operations[0]
                .get("type")
                .and_then(Value::as_str)
                .and_then(single_apply_patch_action)
                .unwrap_or(CodexPatchProxyAction::Batch);
            return (
                format!("{name}_{}", action.suffix()),
                build_apply_patch_operation_arguments(&operations[0], action),
            );
        }
        return (
            format!("{name}_batch"),
            json!({ "operations": operations, "raw_patch": input }).to_string(),
        );
    }
    (name.to_string(), json!({ "input": input }).to_string())
}

fn reconstruct_custom_tool_call_input_with_context(
    tool_context: &CodexToolContext,
    upstream_name: &str,
    arguments: &str,
) -> String {
    if let Some(spec) = tool_context.custom_tools.get(upstream_name) {
        if spec.kind == CodexCustomToolKind::ApplyPatch {
            return reconstruct_apply_patch_input(spec.proxy_action, arguments);
        }
    }
    reconstruct_custom_tool_call_input(arguments)
}

fn reconstruct_custom_tool_call_input(arguments: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(arguments) else {
        return arguments.to_string();
    };
    value
        .get("input")
        .map(response_output_text)
        .unwrap_or_else(|| arguments.to_string())
}

fn reconstruct_apply_patch_input(action: Option<CodexPatchProxyAction>, arguments: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(arguments) else {
        return arguments.to_string();
    };
    if let Some(raw_patch) = value
        .get("raw_patch")
        .or_else(|| value.get("patch"))
        .or_else(|| value.get("input"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return raw_patch.to_string();
    }

    let operations = match action.unwrap_or(CodexPatchProxyAction::Batch) {
        CodexPatchProxyAction::AddFile => vec![json!({
            "type": "add_file",
            "path": value.get("path").and_then(Value::as_str).unwrap_or(""),
            "content": value.get("content").and_then(Value::as_str).unwrap_or("")
        })],
        CodexPatchProxyAction::DeleteFile => vec![json!({
            "type": "delete_file",
            "path": value.get("path").and_then(Value::as_str).unwrap_or("")
        })],
        CodexPatchProxyAction::UpdateFile => vec![json!({
            "type": "update_file",
            "path": value.get("path").and_then(Value::as_str).unwrap_or(""),
            "move_to": value.get("move_to").and_then(Value::as_str).unwrap_or(""),
            "hunks": value.get("hunks").cloned().unwrap_or_else(|| json!([]))
        })],
        CodexPatchProxyAction::ReplaceFile => vec![json!({
            "type": "replace_file",
            "path": value.get("path").and_then(Value::as_str).unwrap_or(""),
            "content": value.get("content").and_then(Value::as_str).unwrap_or("")
        })],
        CodexPatchProxyAction::Batch => value
            .get("operations")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    };

    build_apply_patch_text(&operations)
}

fn build_apply_patch_text(operations: &[Value]) -> String {
    let mut text = String::from("*** Begin Patch");
    for operation in operations {
        let op_type = operation.get("type").and_then(Value::as_str).unwrap_or("");
        let path = operation.get("path").and_then(Value::as_str).unwrap_or("");
        match op_type {
            "add_file" => {
                text.push_str(&format!("\n*** Add File: {path}"));
                for line in operation
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .lines()
                {
                    text.push_str("\n+");
                    text.push_str(line);
                }
            }
            "delete_file" => {
                text.push_str(&format!("\n*** Delete File: {path}"));
            }
            "update_file" => {
                text.push_str(&format!("\n*** Update File: {path}"));
                if let Some(move_to) = operation.get("move_to").and_then(Value::as_str) {
                    if !move_to.is_empty() {
                        text.push_str(&format!("\n*** Move to: {move_to}"));
                    }
                }
                if let Some(hunks) = operation.get("hunks").and_then(Value::as_array) {
                    for hunk in hunks {
                        let context = hunk.get("context").and_then(Value::as_str).unwrap_or("");
                        if context.is_empty() {
                            text.push_str("\n@@");
                        } else {
                            text.push_str(&format!("\n@@ {context}"));
                        }
                        if let Some(lines) = hunk.get("lines").and_then(Value::as_array) {
                            for line in lines {
                                text.push('\n');
                                text.push_str(line_op_prefix(
                                    line.get("op").and_then(Value::as_str).unwrap_or("context"),
                                ));
                                text.push_str(
                                    line.get("text").and_then(Value::as_str).unwrap_or(""),
                                );
                            }
                        }
                    }
                }
            }
            "replace_file" => {
                text.push_str(&format!("\n*** Delete File: {path}"));
                text.push_str(&format!("\n*** Add File: {path}"));
                for line in operation
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .lines()
                {
                    text.push_str("\n+");
                    text.push_str(line);
                }
            }
            _ => {}
        }
    }
    text.push_str("\n*** End Patch");
    text
}

fn line_op_prefix(op: &str) -> &'static str {
    match op {
        "add" => "+",
        "remove" | "delete" => "-",
        _ => " ",
    }
}

fn parse_apply_patch_operations(input: &str) -> Vec<Value> {
    let mut operations = Vec::new();
    let mut current: Option<serde_json::Map<String, Value>> = None;
    let mut content_lines: Vec<String> = Vec::new();
    let mut hunks: Vec<Value> = Vec::new();
    let mut current_hunk: Option<serde_json::Map<String, Value>> = None;
    let mut hunk_lines: Vec<Value> = Vec::new();

    let flush_hunk = |current_hunk: &mut Option<serde_json::Map<String, Value>>,
                      hunk_lines: &mut Vec<Value>,
                      hunks: &mut Vec<Value>| {
        if let Some(mut hunk) = current_hunk.take() {
            hunk.insert("lines".to_string(), json!(std::mem::take(hunk_lines)));
            hunks.push(Value::Object(hunk));
        }
    };
    let flush_operation = |current: &mut Option<serde_json::Map<String, Value>>,
                           content_lines: &mut Vec<String>,
                           hunks: &mut Vec<Value>,
                           operations: &mut Vec<Value>| {
        if let Some(mut operation) = current.take() {
            match operation.get("type").and_then(Value::as_str).unwrap_or("") {
                "add_file" | "replace_file" => {
                    operation.insert("content".to_string(), json!(content_lines.join("\n")));
                }
                "update_file" => {
                    operation.insert("hunks".to_string(), json!(std::mem::take(hunks)));
                }
                _ => {}
            }
            content_lines.clear();
            operations.push(Value::Object(operation));
        }
    };

    for raw_line in input.lines() {
        if raw_line == "*** Begin Patch" || raw_line == "*** End Patch" {
            continue;
        }
        if let Some(path) = raw_line.strip_prefix("*** Add File: ") {
            flush_hunk(&mut current_hunk, &mut hunk_lines, &mut hunks);
            flush_operation(
                &mut current,
                &mut content_lines,
                &mut hunks,
                &mut operations,
            );
            current = Some(serde_json::Map::from_iter([
                ("type".to_string(), json!("add_file")),
                ("path".to_string(), json!(path)),
            ]));
            continue;
        }
        if let Some(path) = raw_line.strip_prefix("*** Delete File: ") {
            flush_hunk(&mut current_hunk, &mut hunk_lines, &mut hunks);
            flush_operation(
                &mut current,
                &mut content_lines,
                &mut hunks,
                &mut operations,
            );
            current = Some(serde_json::Map::from_iter([
                ("type".to_string(), json!("delete_file")),
                ("path".to_string(), json!(path)),
            ]));
            continue;
        }
        if let Some(path) = raw_line.strip_prefix("*** Update File: ") {
            flush_hunk(&mut current_hunk, &mut hunk_lines, &mut hunks);
            flush_operation(
                &mut current,
                &mut content_lines,
                &mut hunks,
                &mut operations,
            );
            current = Some(serde_json::Map::from_iter([
                ("type".to_string(), json!("update_file")),
                ("path".to_string(), json!(path)),
            ]));
            continue;
        }
        if let Some(path) = raw_line.strip_prefix("*** Move to: ") {
            if let Some(operation) = current.as_mut() {
                operation.insert("move_to".to_string(), json!(path));
            }
            continue;
        }
        if raw_line.starts_with("@@") {
            flush_hunk(&mut current_hunk, &mut hunk_lines, &mut hunks);
            let context = raw_line.strip_prefix("@@").unwrap_or("").trim().to_string();
            current_hunk = Some(serde_json::Map::from_iter([(
                "context".to_string(),
                json!(context),
            )]));
            continue;
        }
        if let Some(operation) = current.as_ref() {
            match operation.get("type").and_then(Value::as_str).unwrap_or("") {
                "add_file" | "replace_file" => {
                    if let Some(line) = raw_line.strip_prefix('+') {
                        content_lines.push(line.to_string());
                    }
                }
                "update_file" => {
                    let (op, text) = match raw_line.chars().next() {
                        Some('+') => ("add", &raw_line[1..]),
                        Some('-') => ("remove", &raw_line[1..]),
                        Some(' ') => ("context", &raw_line[1..]),
                        _ => ("context", raw_line),
                    };
                    hunk_lines.push(json!({ "op": op, "text": text }));
                }
                _ => {}
            }
        }
    }

    flush_hunk(&mut current_hunk, &mut hunk_lines, &mut hunks);
    flush_operation(
        &mut current,
        &mut content_lines,
        &mut hunks,
        &mut operations,
    );
    operations
}

fn single_apply_patch_action(op_type: &str) -> Option<CodexPatchProxyAction> {
    match op_type {
        "add_file" => Some(CodexPatchProxyAction::AddFile),
        "delete_file" => Some(CodexPatchProxyAction::DeleteFile),
        "update_file" => Some(CodexPatchProxyAction::UpdateFile),
        "replace_file" => Some(CodexPatchProxyAction::ReplaceFile),
        _ => None,
    }
}

fn build_apply_patch_operation_arguments(
    operation: &Value,
    action: CodexPatchProxyAction,
) -> String {
    match action {
        CodexPatchProxyAction::AddFile | CodexPatchProxyAction::ReplaceFile => json!({
            "content": operation.get("content").and_then(Value::as_str).unwrap_or(""),
            "path": operation.get("path").and_then(Value::as_str).unwrap_or("")
        })
        .to_string(),
        CodexPatchProxyAction::DeleteFile => json!({
            "path": operation.get("path").and_then(Value::as_str).unwrap_or("")
        })
        .to_string(),
        CodexPatchProxyAction::UpdateFile => {
            let mut args = json!({
                "hunks": operation.get("hunks").cloned().unwrap_or_else(|| json!([])),
                "path": operation.get("path").and_then(Value::as_str).unwrap_or("")
            });
            if let Some(move_to) = operation.get("move_to").and_then(Value::as_str) {
                if !move_to.is_empty() {
                    args["move_to"] = json!(move_to);
                }
            }
            args.to_string()
        }
        CodexPatchProxyAction::Batch => json!({ "operations": [operation.clone()] }).to_string(),
    }
}

fn copy_response_request_fields(response: &mut Value, original_request: Option<&Value>) {
    let Some(original_request) = original_request else {
        return;
    };
    for key in [
        "instructions",
        "max_output_tokens",
        "parallel_tool_calls",
        "previous_response_id",
        "reasoning",
        "temperature",
        "tool_choice",
        "tools",
        "top_p",
        "metadata",
    ] {
        if let Some(value) = original_request.get(key) {
            response[key] = value.clone();
        }
    }
}

fn responses_arguments_to_chat(value: &Value) -> String {
    match value {
        Value::String(text) => normalize_chat_tool_arguments_string(text),
        Value::Object(_) => canonical_json_string(value),
        Value::Null => "{}".to_string(),
        other => canonical_json_string(&json!({ "input": other })),
    }
}

fn normalize_chat_tool_arguments_string(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "{}".to_string();
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Object(_)) => trimmed.to_string(),
        Ok(value) => canonical_json_string(&json!({ "input": value })),
        Err(_) => canonical_json_string(&json!({ "input": text })),
    }
}

fn instruction_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        other => other.as_str().unwrap_or_default().to_string(),
    }
}

fn canonical_json_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_default(),
        Value::Array(values) => {
            let parts = values.iter().map(canonical_json_string).collect::<Vec<_>>();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            let parts = entries
                .into_iter()
                .map(|(key, value)| {
                    let key = serde_json::to_string(key).unwrap_or_default();
                    format!("{key}:{}", canonical_json_string(value))
                })
                .collect::<Vec<_>>();
            format!("{{{}}}", parts.join(","))
        }
    }
}

fn apply_chat_reasoning_options(result: &mut Value, body: &Value, model: &str) {
    let Some(reasoning_enabled) = reasoning_requested(body) else {
        return;
    };
    let style = infer_chat_reasoning_style(model);

    match style {
        ChatReasoningStyle::Thinking => {
            result["thinking"] = json!({
                "type": if reasoning_enabled { "enabled" } else { "disabled" }
            });
        }
        ChatReasoningStyle::EnableThinking => {
            result["enable_thinking"] = json!(reasoning_enabled);
        }
        ChatReasoningStyle::ReasoningSplit => {
            result["reasoning_split"] = json!(reasoning_enabled);
        }
        _ => {}
    }

    if !reasoning_enabled {
        if style == ChatReasoningStyle::OpenRouter {
            result["reasoning"] = json!({ "effort": "none" });
        }
        return;
    }

    let Some(effort) = body.pointer("/reasoning/effort").and_then(Value::as_str) else {
        return;
    };
    let Some(mapped) = map_chat_reasoning_effort(effort, style) else {
        return;
    };

    match style {
        ChatReasoningStyle::OpenRouter => {
            result["reasoning"] = json!({ "effort": mapped });
        }
        ChatReasoningStyle::DeepSeek
        | ChatReasoningStyle::LowHigh
        | ChatReasoningStyle::Default
            if supports_reasoning_effort(model) =>
        {
            result["reasoning_effort"] = json!(mapped);
        }
        _ => {}
    }
}

fn reasoning_requested(body: &Value) -> Option<bool> {
    if let Some(effort) = body.pointer("/reasoning/effort").and_then(Value::as_str) {
        return Some(!matches!(
            effort.trim().to_ascii_lowercase().as_str(),
            "none" | "off" | "disabled"
        ));
    }

    body.get("reasoning").map(|value| !value.is_null())
}

fn infer_chat_reasoning_style(model: &str) -> ChatReasoningStyle {
    let model = model.to_ascii_lowercase();
    if model.contains("openrouter") || model.starts_with("openrouter/") {
        return ChatReasoningStyle::OpenRouter;
    }
    if model.contains("deepseek") {
        return ChatReasoningStyle::DeepSeek;
    }
    if model.contains("qwen") || model.contains("dashscope") || model.contains("bailian") {
        return ChatReasoningStyle::EnableThinking;
    }
    if model.contains("kimi")
        || model.contains("moonshot")
        || model.contains("glm")
        || model.contains("zhipu")
        || model.contains("z.ai")
        || model.contains("mimo")
    {
        return ChatReasoningStyle::Thinking;
    }
    if model.contains("minimax") {
        return ChatReasoningStyle::ReasoningSplit;
    }
    if model.contains("siliconflow") {
        return ChatReasoningStyle::EnableThinking;
    }
    if model.contains("stepfun") || model.contains("step-3.5-flash-2603") {
        return ChatReasoningStyle::LowHigh;
    }
    ChatReasoningStyle::Default
}

fn map_chat_reasoning_effort(effort: &str, style: ChatReasoningStyle) -> Option<&'static str> {
    let effort = effort.trim().to_ascii_lowercase();
    if matches!(effort.as_str(), "none" | "off" | "disabled") {
        return None;
    }

    match style {
        ChatReasoningStyle::DeepSeek => match effort.as_str() {
            "ultra" | "max" | "xhigh" => Some("max"),
            _ => Some("high"),
        },
        ChatReasoningStyle::LowHigh => match effort.as_str() {
            "minimal" | "low" => Some("low"),
            _ => Some("high"),
        },
        ChatReasoningStyle::OpenRouter => match effort.as_str() {
            "ultra" | "max" | "xhigh" => Some("xhigh"),
            "high" => Some("high"),
            "medium" => Some("medium"),
            "low" => Some("low"),
            "minimal" => Some("minimal"),
            _ => None,
        },
        _ => match effort.as_str() {
            "minimal" => Some("minimal"),
            "low" => Some("low"),
            "medium" => Some("medium"),
            "high" => Some("high"),
            "xhigh" => Some("xhigh"),
            "max" => Some("max"),
            "ultra" => Some("ultra"),
            _ => None,
        },
    }
}

fn supports_reasoning_effort(model: &str) -> bool {
    is_openai_o_series(model)
        || model
            .to_lowercase()
            .strip_prefix("gpt-")
            .and_then(|rest| rest.chars().next())
            .is_some_and(|ch| ch.is_ascii_digit() && ch >= '5')
        || infer_chat_reasoning_style(model) == ChatReasoningStyle::DeepSeek
        || infer_chat_reasoning_style(model) == ChatReasoningStyle::LowHigh
}

fn is_openai_o_series(model: &str) -> bool {
    model.len() > 1
        && model.starts_with('o')
        && model
            .as_bytes()
            .get(1)
            .is_some_and(|byte| byte.is_ascii_digit())
}
