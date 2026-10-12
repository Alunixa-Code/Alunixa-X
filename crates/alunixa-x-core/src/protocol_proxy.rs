//! Codex Responses API 与 OpenAI Chat Completions 的本地协议转换。
//!
//! Codex Chat 与 Responses 协议之间的转换实现。

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use anyhow::Context;
use serde_json::{Map, Value, json};

use crate::relay_rotation::{RotationContext, RotationEvent};
use crate::settings::{RelayProtocol, SettingsStore};

mod fidelity;

pub fn is_protocol_conversion_error(error: &anyhow::Error) -> bool {
    error.downcast_ref::<fidelity::ConversionError>().is_some()
}

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
    "prompt_cache_key",
    "prompt_cache_retention",
    "safety_identifier",
];
const ERROR_BODY_PREVIEW_LIMIT: usize = 1024;

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
    fn is_tool_search_proxy(&self, name: &str) -> bool {
        self.custom_tools
            .get(name)
            .is_some_and(|spec| spec.openai_name == "tool_search")
    }
    fn is_builtin_web_search_proxy(&self, name: &str) -> bool {
        self.custom_tools.get(name).is_some_and(|spec| {
            spec.kind == CodexCustomToolKind::BuiltIn && spec.openai_name == "web_search"
        })
    }
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
    responses_to_chat_completions_with_options(body, false)
}

fn responses_to_chat_completions_for_wire(
    mut body: Value,
    wire: &str,
    standard: bool,
) -> anyhow::Result<Value> {
    let additional: Vec<Value> = body["input"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| i["type"] == "additional_tools")
        .flat_map(|i| i["tools"].as_array().into_iter().flatten().cloned())
        .collect();
    if !additional.is_empty() {
        if !body["tools"].is_array() {
            body["tools"] = json!([]);
        }
        body["tools"].as_array_mut().unwrap().extend(additional);
    }
    fidelity::validate_request(&body, wire)?;
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
        append_responses_input(input, &mut messages)?;
    }
    normalize_chat_messages(&mut messages);
    relocate_interleaved_non_tool_messages(&mut messages);
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

    fidelity::map_text_format(&mut result, &body)?;
    for key in [
        "thinking",
        "enable_thinking",
        "reasoning_effort",
        "reasoning_split",
    ] {
        if let Some(value) = body.get(key) {
            result[key] = value.clone();
        }
    }

    apply_chat_reasoning_options(&mut result, &body, model, standard);

    let mut tool_context = build_codex_tool_context(body.get("tools"));
    let namespaces = collect_tool_search_output_namespaces(&body);
    for namespace in &namespaces {
        add_namespace_tools_to_context(&mut tool_context, namespace);
    }
    let mut has_chat_tools = false;
    let mut converted = body
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| responses_tools_to_chat_tools(tools, &tool_context))
        .unwrap_or_default();
    for namespace in &namespaces {
        converted.extend(namespace_tool_to_chat_tools(namespace, &tool_context));
    }
    dedup_chat_tools_by_name(&mut converted);
    if !converted.is_empty() {
        has_chat_tools = true;
        result["tools"] = json!(converted);
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
    if [
        "reasoning",
        "thinking",
        "reasoning_effort",
        "enable_thinking",
        "reasoning_split",
    ]
    .iter()
    .any(|key| body.get(*key).is_some_and(|v| !v.is_null()))
    {
        return fidelity::reject("legacy Completions cannot represent reasoning controls");
    }
    let chat = responses_to_chat_completions_for_wire(body, "completions", false)?;
    if chat.get("response_format").is_some() || chat.get("verbosity").is_some() {
        return fidelity::reject("legacy Completions cannot represent structured text options");
    }
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
    let native_options = fidelity::native_reasoning_options(&body, "anthropic")?;
    let body = fidelity::prepare_history(body, "anthropic")?;
    let chat = responses_to_chat_completions_for_wire(body, "anthropic", false)?;
    if chat
        .get("response_format")
        .is_some_and(|v| v["type"] != "text")
        || chat.get("verbosity").is_some()
    {
        return fidelity::reject("Anthropic text options require a native provider configuration");
    }
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
                    "content": message.get("content").filter(|v| v.is_array())
                        .map(anthropic_content_parts).map(Value::Array)
                        .unwrap_or_else(|| json!(chat_content_text(message.get("content").unwrap_or(&Value::Null))))
                }]
            }));
            continue;
        }

        if let Some(native) = message.get("_native") {
            messages.push(json!({"role":"assistant","content":native}));
            continue;
        }
        let mut content = anthropic_content_parts(message.get("content").unwrap_or(&Value::Null));
        if role == "assistant" {
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
    result
        .as_object_mut()
        .unwrap()
        .extend(native_options.as_object().unwrap().clone());
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
    if chat.get("parallel_tool_calls") == Some(&json!(false)) {
        if result.get("tool_choice").is_none() {
            result["tool_choice"] = json!({"type":"auto"});
        }
        result["tool_choice"]["disable_parallel_tool_use"] = json!(true);
    }
    Ok(result)
}

pub fn responses_to_gemini_generate_content(body: Value) -> anyhow::Result<Value> {
    let thinking_config = fidelity::native_reasoning_options(&body, "gemini")?;
    let body = fidelity::prepare_history(body, "gemini")?;
    let chat = responses_to_chat_completions_for_wire(body, "gemini", false)?;
    let mut system_parts = Vec::new();
    let mut contents = Vec::new();
    let mut tool_names = BTreeMap::<String, String>::new();
    let mut tool_wire_ids = BTreeMap::<String, Value>::new();

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
            let mut tool_result = json!({
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "name": name,
                        "response": { "result": chat_content_text(message.get("content").unwrap_or(&Value::Null)) }
                    }
                }]
            });
            if let Some(id) = tool_wire_ids.get(call_id) {
                tool_result["parts"][0]["functionResponse"]["id"] = id.clone();
            }
            contents.push(tool_result);
            continue;
        }

        if let Some(native) = message.get("_native") {
            for (id, name) in message["_native_tool_names"]
                .as_object()
                .into_iter()
                .flatten()
            {
                tool_names.insert(id.clone(), name.as_str().unwrap_or("").to_string());
            }
            for (id, wire_id) in message["_native_tool_wire_ids"]
                .as_object()
                .into_iter()
                .flatten()
            {
                tool_wire_ids.insert(id.clone(), wire_id.clone());
            }
            contents.push(json!({"role":"model","parts":native}));
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
                    let part = json!({
                        "functionCall": {
                            "name": name,
                            "args": parse_json_or_string(
                                function.get("arguments").and_then(Value::as_str).unwrap_or("")
                            )
                        }
                    });
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
    if thinking_config.as_object().is_some_and(|o| !o.is_empty()) {
        generation_config["thinkingConfig"] = thinking_config;
    }
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
    if chat.get("verbosity").is_some() {
        return fidelity::reject("Gemini cannot represent text.verbosity");
    }
    if let Some(format) = chat.get("response_format") {
        match format["type"].as_str() {
            Some("json_object") => {
                generation_config["responseMimeType"] = json!("application/json")
            }
            Some("json_schema") => {
                generation_config["responseMimeType"] = json!("application/json");
                generation_config["responseJsonSchema"] = format["json_schema"]["schema"].clone();
            }
            Some("text") => {}
            _ => return fidelity::reject("unsupported Gemini structured output format"),
        }
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
    if let Some(choice) = chat.get("tool_choice") {
        let config = match choice.as_str() {
            Some("none") => json!({"mode":"NONE"}),
            Some("required") => json!({"mode":"ANY"}),
            Some("auto") => json!({"mode":"AUTO"}),
            _ => {
                let Some(name) = choice.pointer("/function/name").and_then(Value::as_str) else {
                    return fidelity::reject("unsupported Gemini tool_choice");
                };
                json!({"mode":"ANY","allowedFunctionNames":[name]})
            }
        };
        result["toolConfig"] = json!({"functionCallingConfig":config});
    }
    if chat.get("parallel_tool_calls") == Some(&json!(false)) {
        return fidelity::reject("Gemini cannot guarantee parallel_tool_calls=false");
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
    let native = body.get("content").cloned().unwrap_or_else(|| json!([]));
    validate_anthropic_blocks(&native)?;
    let mut response = chat_completion_to_response_with_request(
        anthropic_message_to_chat_completion(body),
        original_request,
    )?;
    fidelity::attach_replay(&mut response, "anthropic", native);
    Ok(response)
}

pub fn gemini_generate_content_to_response_with_request(
    body: Value,
    original_request: &Value,
) -> anyhow::Result<Value> {
    let native = body
        .pointer("/candidates/0/content/parts")
        .cloned()
        .unwrap_or_else(|| json!([]));
    validate_gemini_response(&body)?;
    let mut response = chat_completion_to_response_with_request(
        gemini_generate_content_to_chat_completion(body, original_request),
        original_request,
    )?;
    fidelity::attach_replay(&mut response, "gemini", native);
    Ok(response)
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
    if choices.len() != 1 {
        return fidelity::reject("Responses requires exactly one upstream choice");
    }
    let choice = choices
        .first()
        .ok_or_else(|| anyhow::anyhow!("chat response choices is empty"))?;
    let message = choice
        .get("message")
        .ok_or_else(|| anyhow::anyhow!("chat response choice missing message"))?;
    validate_chat_message(message)?;
    if response_status(choice.get("finish_reason").and_then(Value::as_str)) == "completed" {
        for tool in message["tool_calls"].as_array().into_iter().flatten() {
            fidelity::validate_arguments(&tool["function"]["arguments"])?;
        }
        if let Some(tool) = message.get("function_call") {
            fidelity::validate_arguments(&tool["arguments"])?;
        }
    }

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

    let invalid_search = output.iter().any(invalid_web_search_output_item);
    let mut response = json!({
        "id": response_id,
        "object": "response",
        "created_at": body.get("created").and_then(Value::as_u64).unwrap_or(0),
        "status": response_status(choice.get("finish_reason").and_then(Value::as_str)),
        "model": body.get("model").and_then(Value::as_str).unwrap_or(""),
        "output": output,
        "usage": chat_usage_to_responses_usage(body.get("usage"))
    });

    if response["status"] == "incomplete" {
        response["incomplete_details"] = json!({ "reason": incomplete_reason(choice.get("finish_reason").and_then(Value::as_str)) });
        for item in response["output"].as_array_mut().into_iter().flatten() {
            if item.get("status").is_some() {
                item["status"] = json!("incomplete");
            }
        }
    }
    if invalid_search {
        response["status"] = json!("failed");
        response["error"] = json!({"type":"invalid_upstream_tool_call","message":"Native server-side search was not executed by the Chat upstream; use a client search tool or native Responses provider"});
    }
    copy_response_request_fields(&mut response, original_request);
    if message.get("reasoning_details").is_some()
        || message["tool_calls"].as_array().is_some_and(|calls| {
            calls
                .iter()
                .any(|call| tool_call_extra_content(call).is_some())
        })
    {
        fidelity::attach_replay(&mut response, "chat", message.clone());
    }

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
    let finish_reason = anthropic_finish_reason(
        body.get("stop_reason")
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
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
            let call_id = format!("call_gemini_{}_{}", uuid::Uuid::new_v4().simple(), index);
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
    let finish_reason = gemini_finish_reason(
        candidate
            .get("finishReason")
            .and_then(Value::as_str)
            .unwrap_or(""),
        !tool_calls.is_empty(),
    );
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
    /// 仅标记需要代理重组的合成摘要兼容路径。
    pub compaction: bool,
    /// 原生上游已返回恰好一个 compaction 项或完整失败流时为真，
    /// 调用方必须原样透传。
    pub native_compaction_passthrough: bool,
    /// 响应体已经读完。为 Some 时不要再读 response。
    pub buffered_body: Option<Vec<u8>>,
    pub response: Option<reqwest::Response>,
    pub(crate) _channel_permit: Option<crate::channel_protection::ChannelPermit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum UpstreamWireApi {
    Responses,
    ChatCompletions,
    Completions,
    AnthropicMessages,
    GeminiGenerateContent,
    AudioTranscriptions,
    ImageGenerations,
    ImageEdits,
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

    pub async fn read_body(&mut self) -> anyhow::Result<Vec<u8>> {
        if let Some(body) = &self.buffered_body {
            return Ok(body.clone());
        }
        let response = self.response.take().context("缺少上游响应")?;
        Ok(response.bytes().await?.to_vec())
    }

    pub fn take_response(&mut self) -> anyhow::Result<reqwest::Response> {
        self.response.take().context("缺少上游响应")
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
    crate::http_client::proxied_client("AlunixaX/ProtocolProxy")
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
    sequence_number: u64,
}

impl Default for ChatSseToResponsesConverter {
    fn default() -> Self {
        Self {
            buffer: String::new(),
            utf8_remainder: Vec::new(),
            state: ChatSseState::default(),
            failed: false,
            sequence_number: 0,
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
        if self.is_completed() {
            return Vec::new();
        }
        if append_utf8_safe(&mut self.buffer, &mut self.utf8_remainder, bytes).is_err() {
            return self.fail(
                "Invalid UTF-8 in upstream stream".into(),
                Some("invalid_stream_encoding".into()),
            );
        }
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
        sequence_sse(output, &mut self.sequence_number)
    }

    pub fn finish(&mut self) -> Vec<u8> {
        if self.is_completed() {
            return Vec::new();
        }
        if !self.utf8_remainder.is_empty() {
            return self.fail(
                "Truncated UTF-8 in upstream stream".into(),
                Some("invalid_stream_encoding".into()),
            );
        }

        let mut output = String::new();
        if !self.buffer.trim().is_empty() {
            let block = std::mem::take(&mut self.buffer);
            self.handle_block(&block, &mut output);
        }
        if !self.is_completed() {
            if self.state.finish_reason.is_some() {
                self.state.finalize_into(&mut output);
            } else {
                self.state.failed_into(
                    &mut output,
                    "Upstream stream ended before a terminal event".into(),
                    Some("incomplete_upstream_stream".into()),
                );
            }
        }
        sequence_sse(output, &mut self.sequence_number)
    }

    pub fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        let mut output = String::new();
        self.state.failed_into(&mut output, message, error_type);
        self.failed = true;
        sequence_sse(output, &mut self.sequence_number)
    }

    pub fn is_completed(&self) -> bool {
        self.failed || self.state.completed
    }

    fn handle_block(&mut self, block: &str, output: &mut String) {
        let (event_name, data) = sse_event_and_data(block);
        let Some(data) = data else { return };
        if data.trim() == "[DONE]" {
            self.state.finalize_into(output);
            return;
        }

        let Ok(chunk) = serde_json::from_str::<Value>(&data) else {
            self.state.failed_into(
                output,
                "Invalid JSON in upstream SSE data".into(),
                Some("invalid_stream_event".into()),
            );
            self.failed = true;
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
    sequence_number: u64,
    native_blocks: BTreeMap<usize, Value>,
    native_arguments: BTreeMap<usize, String>,
    native_parts: Vec<Value>,
    native_usage: Value,
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
            sequence_number: 0,
            native_blocks: BTreeMap::new(),
            native_arguments: BTreeMap::new(),
            native_parts: Vec::new(),
            native_usage: json!({}),
        }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<u8> {
        if self.is_completed() {
            return Vec::new();
        }
        if append_utf8_safe(&mut self.buffer, &mut self.utf8_remainder, bytes).is_err() {
            return self.fail(
                "Invalid UTF-8 in upstream stream".into(),
                Some("invalid_stream_encoding".into()),
            );
        }
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
        sequence_sse(output, &mut self.sequence_number)
    }

    pub fn finish(&mut self) -> Vec<u8> {
        if self.is_completed() {
            return Vec::new();
        }
        if !self.utf8_remainder.is_empty() {
            return self.fail(
                "Truncated UTF-8 in upstream stream".into(),
                Some("invalid_stream_encoding".into()),
            );
        }
        let mut output = String::new();
        if !self.failed && !self.state.completed {
            if !self.buffer.trim().is_empty() {
                let block = std::mem::take(&mut self.buffer);
                self.handle_block(&block, &mut output);
            }
            if !self.state.completed {
                if self.wire_api == UpstreamWireApi::Completions
                    && self.state.finish_reason.is_some()
                {
                    self.state.finalize_into(&mut output);
                } else {
                    self.state.failed_into(
                        &mut output,
                        "Upstream stream ended before its terminal event".into(),
                        Some("incomplete_upstream_stream".into()),
                    );
                }
            }
        }
        sequence_sse(output, &mut self.sequence_number)
    }

    pub fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        let mut output = String::new();
        self.state.failed_into(&mut output, message, error_type);
        self.failed = true;
        sequence_sse(output, &mut self.sequence_number)
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
            self.state.failed_into(
                output,
                "Invalid JSON in upstream SSE data".into(),
                Some("invalid_stream_event".into()),
            );
            self.failed = true;
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
                self.native_usage = message.get("usage").cloned().unwrap_or_else(|| json!({}));
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
                if validate_anthropic_blocks(&json!([block])).is_err()
                    || self.native_blocks.insert(index, block.clone()).is_some()
                {
                    self.state.failed_into(
                        output,
                        "Unsupported or duplicate Anthropic block".into(),
                        Some("invalid_stream_event".into()),
                    );
                    return;
                }
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
                let Some(block) = self.native_blocks.get_mut(&index) else {
                    self.state.failed_into(
                        output,
                        "Anthropic delta has no matching block".into(),
                        Some("invalid_stream_event".into()),
                    );
                    return;
                };
                let (field, delta_field) = match delta["type"].as_str() {
                    Some("text_delta") => ("text", "text"),
                    Some("thinking_delta") => ("thinking", "thinking"),
                    Some("signature_delta") => ("signature", "signature"),
                    Some("input_json_delta") => ("", "partial_json"),
                    _ => {
                        self.state.failed_into(
                            output,
                            "Unsupported Anthropic delta type".into(),
                            Some("unsupported_stream_event".into()),
                        );
                        return;
                    }
                };
                let fragment = delta[delta_field].as_str().unwrap_or("");
                let expected = match field {
                    "text" => "text",
                    "thinking" | "signature" => "thinking",
                    _ => "tool_use",
                };
                if block["type"] != expected {
                    self.state.failed_into(
                        output,
                        "Anthropic delta type does not match its block".into(),
                        Some("invalid_stream_event".into()),
                    );
                    return;
                }
                if field.is_empty() {
                    self.native_arguments
                        .entry(index)
                        .or_default()
                        .push_str(fragment);
                } else {
                    block[field] = json!(format!(
                        "{}{}",
                        block[field].as_str().unwrap_or(""),
                        fragment
                    ));
                }
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
                    if let (Some(target), Some(incoming)) =
                        (self.native_usage.as_object_mut(), usage.as_object())
                    {
                        target.extend(incoming.clone());
                    }
                    chunk["usage"] = anthropic_usage_to_chat_usage(Some(&self.native_usage));
                }
                self.state.handle_chat_chunk_into(&chunk, output);
            }
            "message_stop" => {
                for (index, arguments) in &self.native_arguments {
                    let Ok(input) = serde_json::from_str::<Value>(arguments) else {
                        self.state.failed_into(
                            output,
                            "Invalid Anthropic tool input JSON".into(),
                            Some("invalid_tool_arguments".into()),
                        );
                        return;
                    };
                    if let Some(block) = self.native_blocks.get_mut(index) {
                        block["input"] = input;
                    }
                }
                self.state.native_replay = Some((
                    "anthropic",
                    json!(self.native_blocks.values().collect::<Vec<_>>()),
                ));
                self.state.finalize_into(output);
            }
            "content_block_stop" => {
                let index = value["index"].as_u64().unwrap_or(0) as usize;
                if self
                    .native_blocks
                    .get(&index)
                    .is_some_and(|b| b["type"] == "tool_use")
                {
                    if self.tools_arguments_empty(index) {
                        self.push_chat_tool_delta(index, None, None, "{}", output);
                    }
                }
            }
            "ping" => {}
            "error" => {
                let (message, error_type) = extract_chat_sse_error(value);
                self.state.failed_into(output, message, error_type);
                self.failed = true;
            }
            _ => self.state.failed_into(
                output,
                "Unsupported Anthropic event".into(),
                Some("unsupported_stream_event".into()),
            ),
        }
    }

    fn tools_arguments_empty(&self, index: usize) -> bool {
        self.state
            .tools
            .get(&index)
            .is_some_and(|t| t.arguments.is_empty())
    }

    fn handle_gemini_chunk(&mut self, value: &Value, output: &mut String) {
        if validate_gemini_response(value).is_err() {
            self.state.failed_into(
                output,
                "Unsupported Gemini response content".into(),
                Some("unsupported_stream_event".into()),
            );
            return;
        }
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
                self.native_parts.push(part.clone());
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
                    let call_id =
                        format!("call_gemini_{}_{}", uuid::Uuid::new_v4().simple(), index);
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
            self.state.native_replay = Some(("gemini", json!(self.native_parts)));
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
            | UpstreamWireApi::ImageGenerations
            | UpstreamWireApi::ImageEdits
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

    pub fn is_waiting_for_terminal_event(&self) -> bool {
        match self {
            Self::Chat(converter) => {
                !converter.is_completed() && converter.state.finish_reason.is_some()
            }
            Self::Native(converter) => {
                !converter.is_completed() && converter.state.finish_reason.is_some()
            }
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
        _ => with_relay_auth(request, &relay),
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
        native_compaction_passthrough: false,
        buffered_body: None,
        _channel_permit: None,
        compaction: false,
        status_code,
        content_type,
        is_stream,
        wire_api: UpstreamWireApi::Transparent,
        response: Some(upstream),
    })
}

pub type TransparentUpstreamWebSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

pub async fn open_transparent_websocket_request(
    request_path: &str,
    request_headers: &[(String, String)],
    original_user_agent: Option<&str>,
) -> anyhow::Result<(
    TransparentUpstreamWebSocket,
    tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
)> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    open_transparent_websocket_request_with_settings(
        request_path,
        request_headers,
        original_user_agent,
        settings,
    )
    .await
}

pub async fn open_transparent_websocket_request_with_settings(
    request_path: &str,
    request_headers: &[(String, String)],
    original_user_agent: Option<&str>,
    settings: crate::settings::BackendSettings,
) -> anyhow::Result<(
    TransparentUpstreamWebSocket,
    tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
)> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;

    if !is_transparent_api_proxy_path(request_path) {
        anyhow::bail!("不允许透明代理非 OpenAI API WebSocket 路径：{request_path}");
    }
    let relay = transparent_proxy_relay(&settings)?;
    validate_upstream(&relay)?;
    let endpoint = transparent_api_url(&relay.base_url, request_path);
    let mut endpoint = reqwest::Url::parse(&endpoint).context("透明 WebSocket 上游 URL 无效")?;
    let websocket_scheme = match endpoint.scheme() {
        "http" => "ws",
        "https" => "wss",
        "ws" => "ws",
        "wss" => "wss",
        scheme => anyhow::bail!("透明 WebSocket 不支持 URL scheme：{scheme}"),
    };
    endpoint
        .set_scheme(websocket_scheme)
        .map_err(|_| anyhow::anyhow!("无法转换透明 WebSocket URL scheme"))?;
    let mut request = endpoint.as_str().into_client_request()?;
    for (name, value) in request_headers {
        if !transparent_websocket_request_header_allowed(name) {
            continue;
        }
        let Ok(name) =
            tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.as_bytes())
        else {
            continue;
        };
        let Ok(value) = tokio_tungstenite::tungstenite::http::HeaderValue::from_str(value) else {
            continue;
        };
        request.headers_mut().insert(name, value);
    }
    let user_agent = effective_user_agent(&relay.user_agent, original_user_agent);
    request.headers_mut().insert(
        tokio_tungstenite::tungstenite::http::header::USER_AGENT,
        tokio_tungstenite::tungstenite::http::HeaderValue::from_str(&user_agent)?,
    );
    match relay.protocol {
        RelayProtocol::AnthropicMessages => {
            request.headers_mut().insert(
                "x-api-key",
                tokio_tungstenite::tungstenite::http::HeaderValue::from_str(relay.api_key.trim())?,
            );
            request.headers_mut().insert(
                "anthropic-version",
                tokio_tungstenite::tungstenite::http::HeaderValue::from_static("2023-06-01"),
            );
        }
        RelayProtocol::GeminiGenerateContent => {
            request.headers_mut().insert(
                "x-goog-api-key",
                tokio_tungstenite::tungstenite::http::HeaderValue::from_str(relay.api_key.trim())?,
            );
        }
        _ => {
            request.headers_mut().insert(
                tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
                tokio_tungstenite::tungstenite::http::HeaderValue::from_str(&format!(
                    "Bearer {}",
                    relay.api_key.trim()
                ))?,
            );
        }
    }
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.transparent_websocket_request",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "path": request_path.split_once('?').map_or(request_path, |(path, _)| path),
            "endpoint": sanitized_endpoint(endpoint.as_str())
        }),
    );
    let connected = tokio::time::timeout(
        TRANSPARENT_PROXY_HEADER_TIMEOUT,
        tokio_tungstenite::connect_async(request),
    )
    .await
    .context("透明 WebSocket 上游连接超时")?
    .context("透明 WebSocket 上游连接失败")?;
    Ok(connected)
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

fn transparent_websocket_request_header_allowed(name: &str) -> bool {
    transparent_request_header_allowed(name)
        && !matches!(
            name.trim().to_ascii_lowercase().as_str(),
            "sec-websocket-accept"
                | "sec-websocket-extensions"
                | "sec-websocket-key"
                | "sec-websocket-version"
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
    open_responses_proxy_request_for_path_with_beta(body, original_user_agent, request_path, None)
        .await
}

pub async fn open_responses_proxy_request_with_settings(
    body: &str,
    settings: crate::settings::BackendSettings,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_with_settings_and_user_agent(
        body,
        settings,
        None,
        "/responses",
        None,
        ProxySessionHeaders::default(),
    )
    .await
}

pub async fn open_responses_proxy_request_with_settings_for_path(
    body: &str,
    settings: crate::settings::BackendSettings,
    request_path: &str,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_with_settings_and_user_agent(
        body,
        settings,
        None,
        request_path,
        None,
        ProxySessionHeaders::default(),
    )
    .await
}

async fn open_responses_proxy_request_with_settings_and_user_agent(
    body: &str,
    settings: crate::settings::BackendSettings,
    original_user_agent: Option<&str>,
    request_path: &str,
    beta_features: Option<&str>,
    session_headers: ProxySessionHeaders<'_>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let mut request_json: Value = serde_json::from_str(body)?;
    expand_local_compaction_history(&mut request_json);
    normalize_legacy_custom_item_ids(&mut request_json);
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
    let model = (!source_model.trim().is_empty()).then(|| source_model.clone());
    let context = RotationContext {
        conversation_id: conversation_id_from_responses_request(&request_json),
        model,
    };
    let (relay, relays) = if let Some(route) = &model_route {
        (route.relay.clone(), vec![route.relay.clone()])
    } else {
        let relay = crate::relay_rotation::select_relay_for_request(&settings, context)?;
        let mut relays = vec![relay.clone()];
        relays.extend(crate::relay_rotation::fallback_relays_after(
            &settings, &relay.id,
        )?);
        (relay, relays)
    };
    debug_assert_eq!(
        relays.first().map(|item| item.id.as_str()),
        Some(relay.id.as_str())
    );
    let request_model = request_json
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if relay.relay_mode == crate::settings::RelayMode::CustomModels {
        return open_custom_models_proxy_request(
            &relay,
            &request_json,
            is_stream,
            original_user_agent,
            request_path,
        )
        .await;
    }
    let relays = relays
        .into_iter()
        .map(|relay| relay_with_model_protocol(relay, request_model))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let relay_count = relays.len();
    let mut cooldown_retries = 0_usize;
    'request: loop {
        for (attempt, relay) in relays.iter().cloned().enumerate() {
            let has_more_candidates = attempt + 1 < relay_count;
            validate_upstream(&relay)?;
            let channel_key = crate::channel_protection::key_for_relay(&relay);
            let mut channel_permit = crate::channel_protection::acquire(&channel_key, &relay).await;
            let model_override = aggregate_upstream_model_override(&settings, &relay);
            let preserve_native_request = relay.protocol == RelayProtocol::Responses
                && (request_has_compaction_trigger(&request_json)
                    || is_responses_compact_proxy_path(request_path));
            let probe_native_compaction = request_has_compaction_trigger(&request_json)
                && relay.protocol == RelayProtocol::Responses
                && !is_responses_compact_proxy_path(request_path);
            let (mut endpoint, mut upstream_body, mut wire_api, compaction) =
                match upstream_request_parts(
                    &relay,
                    request_json.clone(),
                    request_path,
                    model_override.as_deref(),
                    preserve_native_request,
                )
                .await
                {
                    Ok(parts) => parts,
                    Err(error) => {
                        drop(channel_permit);
                        if has_more_candidates && error.is::<NativeCompactionUnsupported>() {
                            crate::relay_rotation::record_relay_request_failure(&settings);
                            continue;
                        }
                        return native_compaction_unsupported_result(error);
                    }
                };
            let is_compaction_request = compaction || probe_native_compaction;
            let header_timeout = response_header_timeout(is_stream);
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.upstream_request",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "endpoint": endpoint,
                    "wireApi": wire_api,
                    "stream": is_stream,
                    "attempt": attempt + 1,
                    "candidateCount": relay_count,
                    "headerTimeoutSeconds": header_timeout.as_secs(),
                    "modelRoute": model_route.as_ref().map(|route| json!({
                        "sourceRelayId": route.source_relay_id,
                        "sourceModel": route.source_model,
                        "targetRelayId": route.relay.id,
                        "upstreamModel": route.upstream_model
                    }))
                }),
            );
            let mut upstream = match send_responses_upstream_request(
                &relay,
                &endpoint,
                &upstream_body,
                wire_api,
                is_stream,
                original_user_agent,
                beta_features,
                session_headers,
            )
            .await
            {
                Ok(upstream) => upstream,
                Err(error) => {
                    drop(channel_permit);
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "protocol_proxy.upstream_request_failed",
                        json!({
                            "relayId": relay.id,
                            "relayName": relay.name,
                            "endpoint": endpoint,
                            "wireApi": wire_api,
                            "stream": is_stream,
                            "attempt": attempt + 1,
                            "candidateCount": relay_count,
                            "headerTimeoutSeconds": header_timeout.as_secs(),
                            "willFailover": has_more_candidates,
                            "error": error.to_string()
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
            let mut status_code = upstream.status().as_u16();
            let mut content_type = upstream
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string();

            if probe_native_compaction {
                let success = (200..300).contains(&status_code);
                let retry_after =
                    crate::channel_protection::retry_after_duration(upstream.headers());
                if !success {
                    // 探测不重试摘要，但同通道的后续请求仍须遵守错误冷却。
                    // 在读取响应体/释放 permit 前记录，避免排队请求抢先通过。
                    crate::channel_protection::mark_failure(
                        &channel_key,
                        &relay,
                        status_code,
                        retry_after,
                    )
                    .await;
                }
                let probed = match read_limited_upstream_body(
                    &mut upstream,
                    MAX_NATIVE_COMPACTION_PROBE_BODY_BYTES,
                )
                .await
                {
                    Ok(body) => body.to_vec(),
                    Err(error) => {
                        drop(channel_permit);
                        return Err(error.into());
                    }
                };
                let stream_response = response_body_is_stream(&content_type, &probed);
                drop(channel_permit);

                if success && upstream_has_terminal_failure(&probed, &content_type) {
                    crate::relay_rotation::record_relay_request_failure(&settings);
                    return Ok(UpstreamProxyResponse {
                        status_code,
                        is_stream: stream_response,
                        content_type,
                        wire_api,
                        compaction: false,
                        native_compaction_passthrough: stream_response,
                        buffered_body: Some(probed),
                        response: None,
                        _channel_permit: None,
                    });
                }
                if success && stream_response {
                    match upstream_compaction_item_count(&probed, &content_type) {
                        Some(1) => {
                            crate::relay_rotation::record_relay_request_event(
                                &settings,
                                RotationEvent::Success,
                            );
                            return Ok(UpstreamProxyResponse {
                                status_code,
                                is_stream: true,
                                content_type,
                                wire_api,
                                compaction: false,
                                native_compaction_passthrough: true,
                                buffered_body: Some(probed),
                                response: None,
                                _channel_permit: None,
                            });
                        }
                        None => {
                            crate::relay_rotation::record_relay_request_failure(&settings);
                            return Ok(UpstreamProxyResponse {
                                status_code,
                                is_stream: true,
                                content_type: "text/event-stream".to_string(),
                                wire_api,
                                compaction: false,
                                native_compaction_passthrough: true,
                                buffered_body: Some(incomplete_compaction_stream(&probed)),
                                response: None,
                                _channel_permit: None,
                            });
                        }
                        Some(_) => {}
                    }
                } else if success
                    && upstream_compaction_item_count(&probed, &content_type) == Some(1)
                {
                    crate::relay_rotation::record_relay_request_event(
                        &settings,
                        RotationEvent::Success,
                    );
                    if !is_stream {
                        return Ok(UpstreamProxyResponse {
                            status_code,
                            is_stream: false,
                            content_type,
                            wire_api,
                            compaction: false,
                            native_compaction_passthrough: true,
                            buffered_body: Some(probed),
                            response: None,
                            _channel_permit: None,
                        });
                    }
                    if let Some(sse) = render_native_compaction_as_sse(&probed) {
                        return Ok(UpstreamProxyResponse {
                            status_code,
                            is_stream: true,
                            content_type: "text/event-stream".to_string(),
                            wire_api,
                            compaction: false,
                            native_compaction_passthrough: true,
                            buffered_body: Some(sse),
                            response: None,
                            _channel_permit: None,
                        });
                    }
                }
                if !success && !compaction_input_rejected(status_code, &probed) {
                    crate::relay_rotation::record_relay_request_failure(&settings);
                    if has_more_candidates {
                        continue;
                    }
                    return Ok(UpstreamProxyResponse {
                        status_code,
                        is_stream: false,
                        content_type,
                        wire_api,
                        compaction: false,
                        native_compaction_passthrough: false,
                        buffered_body: Some(probed),
                        response: None,
                        _channel_permit: None,
                    });
                }
                if input_has_native_compaction(&request_json) {
                    return native_compaction_unsupported_result(
                        NativeCompactionUnsupported::history().into(),
                    );
                }

                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "protocol_proxy.compaction_fallback",
                    json!({
                        "relayId": relay.id,
                        "statusCode": status_code,
                    }),
                );
                let fallback = upstream_request_parts(
                    &relay,
                    request_json.clone(),
                    request_path,
                    model_override.as_deref(),
                    false,
                )
                .await;
                let (fallback_endpoint, fallback_body, fallback_wire, _) = match fallback {
                    Ok(parts) => parts,
                    Err(error) => {
                        if has_more_candidates && error.is::<NativeCompactionUnsupported>() {
                            crate::relay_rotation::record_relay_request_failure(&settings);
                            continue;
                        }
                        return native_compaction_unsupported_result(error);
                    }
                };
                endpoint = fallback_endpoint;
                upstream_body = fallback_body;
                wire_api = fallback_wire;
                channel_permit = crate::channel_protection::acquire(&channel_key, &relay).await;
                upstream = match send_responses_upstream_request(
                    &relay,
                    &endpoint,
                    &upstream_body,
                    wire_api,
                    is_stream,
                    original_user_agent,
                    beta_features,
                    session_headers,
                )
                .await
                {
                    Ok(upstream) => upstream,
                    Err(error) => {
                        drop(channel_permit);
                        let _ = crate::diagnostic_log::append_diagnostic_log(
                            "protocol_proxy.upstream_request_failed",
                            json!({
                                "relayId": relay.id,
                                "endpoint": endpoint,
                                "compactionFallback": true,
                                "error": error.to_string()
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
                status_code = upstream.status().as_u16();
                content_type = upstream
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("")
                    .to_string();
            }

            let retry_after = crate::channel_protection::retry_after_duration(upstream.headers());
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.upstream_response",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "endpoint": endpoint,
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
            if (200..300).contains(&status_code) || !has_more_candidates {
                if !(200..300).contains(&status_code) {
                    let cooldown_started = crate::channel_protection::mark_failure(
                        &channel_key,
                        &relay,
                        status_code,
                        retry_after,
                    )
                    .await;
                    if cooldown_started && should_retry_after_cooldown(cooldown_retries) {
                        cooldown_retries = cooldown_retries.saturating_add(1);
                        drop(channel_permit);
                        let _ = crate::diagnostic_log::append_diagnostic_log(
                            "protocol_proxy.channel_cooldown_retry",
                            json!({
                                "relayId": relay.id,
                                "relayName": relay.name,
                                "statusCode": status_code,
                                "retryAfterSeconds": retry_after.map(|value| value.as_secs()),
                                "retry": cooldown_retries
                            }),
                        );
                        continue 'request;
                    }
                }
                // 请求了 SSE 的兼容上游也可能返回 JSON 摘要；让调用方选择 JSON 包装器。
                let json_compaction = is_compaction_request
                    && content_type
                        .split(';')
                        .next()
                        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"));
                return Ok(UpstreamProxyResponse {
                    status_code,
                    is_stream: (is_stream && !json_compaction)
                        || content_type.contains("text/event-stream"),
                    content_type,
                    wire_api,
                    compaction: is_compaction_request,
                    native_compaction_passthrough: false,
                    buffered_body: None,
                    response: Some(upstream),
                    _channel_permit: Some(channel_permit),
                });
            }
            crate::channel_protection::mark_failure(&channel_key, &relay, status_code, retry_after)
                .await;
            drop(channel_permit);
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "protocol_proxy.upstream_failover",
                json!({
                    "relayId": relay.id,
                    "relayName": relay.name,
                    "endpoint": endpoint,
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
}

fn relay_with_model_protocol(
    mut relay: crate::settings::RelayProfile,
    model: &str,
) -> anyhow::Result<crate::settings::RelayProfile> {
    let protocol = relay.protocol_for_model(model)?;
    // Resolve the real upstream before changing the default protocol; live TOML
    // intentionally points at AX whenever model overrides exist.
    relay.base_url = crate::relay_config::relay_profile_base_url(&relay);
    relay.api_key = crate::relay_config::relay_profile_api_key(&relay);
    relay.protocol = protocol;
    Ok(relay)
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
        _ => with_relay_auth(request, &relay),
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
        native_compaction_passthrough: false,
        buffered_body: None,
        _channel_permit: None,
        compaction: false,
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
        response: Some(upstream),
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
        with_relay_auth(
            crate::http_client::proxied_client(&effective_user_agent(
                &relay.user_agent,
                original_user_agent,
            ))?
            .post(&endpoint),
            &relay,
        )
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
        native_compaction_passthrough: false,
        buffered_body: None,
        _channel_permit: None,
        compaction: false,
        status_code,
        is_stream: false,
        content_type,
        wire_api: UpstreamWireApi::AudioTranscriptions,
        response: Some(upstream),
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
    if relay.api_key.trim().is_empty() && !relay.uses_no_auth() {
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
        &relay,
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
        native_compaction_passthrough: false,
        buffered_body: None,
        _channel_permit: None,
        compaction: false,
        status_code,
        is_stream: is_stream || content_type.contains("text/event-stream"),
        content_type,
        wire_api: UpstreamWireApi::ChatCompletions,
        response: Some(upstream),
    })
}

async fn upstream_request_parts(
    relay: &crate::settings::RelayProfile,
    mut request_json: Value,
    request_path: &str,
    model_override: Option<&str>,
    preserve_native_request: bool,
) -> anyhow::Result<(String, Value, UpstreamWireApi, bool)> {
    if let Some(model) = model_override {
        request_json["model"] = json!(model);
    }
    let compact = request_has_compaction_trigger(&request_json)
        || is_responses_compact_proxy_path(request_path);
    let synthetic_compaction = compact && !preserve_native_request;
    if synthetic_compaction {
        request_json = rewrite_request_for_compaction(strip_compaction_trigger(request_json));
    }
    let model = request_json["model"].as_str().unwrap_or("").trim();
    if relay.reasoning_effort_for_model(model) == crate::settings::ReasoningEffort::Adaptive {
        if !is_claude_model(model)
            || !matches!(
                relay.protocol,
                RelayProtocol::ChatCompletions | RelayProtocol::AnthropicMessages
            )
        {
            return fidelity::reject(
                "Claude adaptive thinking requires a Claude model and Chat Completions or Anthropic Messages protocol",
            );
        }
        if !request_json.get("reasoning").is_some_and(Value::is_object) {
            request_json["reasoning"] = json!({});
        }
        request_json["reasoning"]["effort"] = json!("adaptive");
        // The explicitly selected provider mode takes precedence over stale
        // per-thread controls, but does not touch tools, history or cache hints.
        request_json
            .as_object_mut()
            .unwrap()
            .remove("reasoning_effort");
        request_json["thinking"] = json!({"type":"adaptive"});
    }
    match relay.protocol {
        RelayProtocol::Responses => {
            let mut body = request_json;
            if relay.web_search_history_compat_enabled()
                && compact
                && !is_responses_compact_proxy_path(request_path)
            {
                ensure_web_search_tool_for_history(&mut body);
            }
            apply_relay_image_handling(relay, &mut body).await;
            Ok((
                if is_responses_compact_proxy_path(request_path) {
                    responses_compact_url(&relay.base_url)
                } else {
                    responses_url(&relay.base_url)
                },
                body,
                UpstreamWireApi::Responses,
                synthetic_compaction,
            ))
        }
        RelayProtocol::ChatCompletions => {
            let mut body = responses_to_chat_completions_with_options(
                request_json,
                relay.standard_openai_protocol,
            )?;
            apply_relay_image_handling(relay, &mut body).await;
            Ok((
                chat_completions_url(&relay.base_url),
                body,
                UpstreamWireApi::ChatCompletions,
                synthetic_compaction,
            ))
        }
        RelayProtocol::Completions => {
            let mut source = request_json;
            apply_relay_image_handling(relay, &mut source).await;
            Ok((
                completions_url(&relay.base_url),
                responses_to_completions(source)?,
                UpstreamWireApi::Completions,
                synthetic_compaction,
            ))
        }
        RelayProtocol::AnthropicMessages => {
            let mut source = request_json;
            apply_relay_image_handling(relay, &mut source).await;
            Ok((
                anthropic_messages_url(&relay.base_url),
                responses_to_anthropic_messages(source)?,
                UpstreamWireApi::AnthropicMessages,
                synthetic_compaction,
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
                synthetic_compaction,
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponsesItemIdRetryRepair {
    pub body: String,
    pub changed_count: usize,
    pub source_prefix: &'static str,
    pub expected_prefix: &'static str,
}

/// Some third-party Responses implementations return HTTP 200 and only report an
/// item-id schema mismatch inside the SSE body.  Codex may legitimately emit the
/// custom-tool families (`ctc_` / `ctco_`), while those implementations ask for
/// the function-call family (`fc_`).  Repair only after the upstream explicitly
/// names the rejected id and expected family, and keep every other request field
/// byte-for-byte equivalent after JSON decoding/encoding.
pub fn repair_responses_item_ids_for_upstream_error(
    request_body: &str,
    upstream_error: &str,
) -> Option<ResponsesItemIdRetryRepair> {
    if serde_json::from_str::<Value>(upstream_error)
        .ok()
        .is_some_and(|value| {
            value
                .get("output")
                .or_else(|| value.pointer("/response/output"))
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
        })
    {
        return None;
    }
    // A late validation-looking error must never replay a request that already emitted output.
    for block in upstream_error.replace("\r\n", "\n").split("\n\n") {
        let (event, data) = sse_event_and_data(block);
        let parsed = data.and_then(|data| serde_json::from_str::<Value>(&data).ok());
        let kind = event
            .as_deref()
            .or_else(|| parsed.as_ref().and_then(|v| v["type"].as_str()));
        if kind.is_some_and(|kind| {
            kind.starts_with("response.")
                && !matches!(
                    kind,
                    "response.created" | "response.in_progress" | "response.failed"
                )
        }) {
            return None;
        }
    }
    let has_direct_id_error = upstream_error.contains("Invalid 'input[")
        && upstream_error.contains("Expected an ID that begins with '");
    if !upstream_error.contains("invalid_id_prefix") && !has_direct_id_error {
        return None;
    }
    let invalid_tail = upstream_error.split_once("Invalid 'input[")?.1;
    let invalid_id = invalid_tail.split_once("': '")?.1.split_once('\'')?.0;
    let expected_raw = upstream_error
        .split_once("Expected an ID that begins with '")?
        .1
        .split_once('\'')?
        .0;
    let expected_prefix = canonical_response_tool_item_prefix(expected_raw)?;
    let source_prefix = response_tool_item_id_prefix(invalid_id)?;
    if source_prefix == expected_prefix {
        return None;
    }

    let mut request: Value = serde_json::from_str(request_body).ok()?;
    let items = request.get_mut("input")?.as_array_mut()?;
    if !items.iter().any(|item| {
        item.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id == invalid_id)
    }) {
        return None;
    }

    let mut changed_count = 0;
    for item in items {
        let Some(item) = item.as_object_mut() else {
            continue;
        };
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        if id != invalid_id {
            continue;
        }
        let Some(suffix) = id
            .strip_prefix(source_prefix)
            .filter(|suffix| !suffix.is_empty())
        else {
            continue;
        };
        item.insert(
            "id".to_string(),
            Value::String(format!("{expected_prefix}{suffix}")),
        );
        changed_count += 1;
        break;
    }
    if changed_count == 0 {
        return None;
    }

    Some(ResponsesItemIdRetryRepair {
        body: serde_json::to_string(&request).ok()?,
        changed_count,
        source_prefix,
        expected_prefix,
    })
}

fn canonical_response_tool_item_prefix(prefix: &str) -> Option<&'static str> {
    match prefix.trim().trim_end_matches('_') {
        "fc" => Some("fc_"),
        "ctc" => Some("ctc_"),
        "ctco" => Some("ctco_"),
        _ => None,
    }
}

fn response_tool_item_id_prefix(id: &str) -> Option<&'static str> {
    ["ctco_", "ctc_", "fc_"]
        .into_iter()
        .find(|prefix| id.starts_with(prefix))
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
    relay: &crate::settings::RelayProfile,
    is_stream: bool,
    upstream_body: &Value,
    _wire_api: UpstreamWireApi,
) -> (anyhow::Result<reqwest::Response>, bool) {
    let first = send_upstream_request_for_responses(
        upstream_request_builder(client.clone(), endpoint, relay, is_stream, upstream_body),
        is_stream,
    )
    .await;
    match first {
        Err(error) if is_retryable_connection_error(&error) => {
            tokio::time::sleep(UPSTREAM_CONNECT_RETRY_DELAY).await;
            (
                send_upstream_request_for_responses(
                    upstream_request_builder(client, endpoint, relay, is_stream, upstream_body),
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
    relay: &crate::settings::RelayProfile,
    is_stream: bool,
    upstream_body: &Value,
) -> reqwest::RequestBuilder {
    let mut builder = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    builder = match relay.protocol {
        RelayProtocol::AnthropicMessages => {
            with_native_key(builder, relay, "x-api-key").header("anthropic-version", "2023-06-01")
        }
        RelayProtocol::GeminiGenerateContent => with_native_key(builder, relay, "x-goog-api-key"),
        _ => {
            return finish_upstream_builder(
                with_relay_auth(builder, relay),
                is_stream,
                upstream_body,
            );
        }
    };
    builder = crate::relay_headers::apply_headers(builder, &relay.custom_headers);
    finish_upstream_builder(builder, is_stream, upstream_body)
}

fn with_native_key(
    builder: reqwest::RequestBuilder,
    relay: &crate::settings::RelayProfile,
    header: &'static str,
) -> reqwest::RequestBuilder {
    if relay.uses_no_auth()
        || relay
            .custom_headers
            .iter()
            .any(|h| h.key.trim().eq_ignore_ascii_case(header) && !h.value.trim().is_empty())
    {
        builder
    } else {
        builder.header(header, relay.api_key.trim())
    }
}

fn finish_upstream_builder(
    mut builder: reqwest::RequestBuilder,
    is_stream: bool,
    upstream_body: &Value,
) -> reqwest::RequestBuilder {
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
    if relay.api_key.trim().is_empty() && !relay.uses_no_auth() {
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
                "owned_by": "alunixa-x-custom"
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
    request_path: &str,
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
    let mut request_json = request_json.clone();
    request_json["model"] = json!(model.model.trim());
    let (mut endpoint, upstream_body, wire_api, compaction) =
        upstream_request_parts(&synthetic, request_json.clone(), request_path, None, true).await?;
    // Native compact state must pass through untouched, not become a normal
    // generation request (CodexPlusPlus v1.5.0 compaction compatibility).
    if is_responses_compact_proxy_path(request_path) {
        if wire_api != UpstreamWireApi::Responses {
            return fidelity::reject("Responses compaction requires a native Responses provider");
        }
        endpoint = responses_compact_url(&synthetic.base_url);
    }
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
        &synthetic,
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
        native_compaction_passthrough: false,
        buffered_body: None,
        _channel_permit: None,
        compaction: false,
        status_code,
        is_stream: content_type.contains("text/event-stream")
            || (is_stream && !content_type.contains("application/json")),
        content_type,
        wire_api,
        response: Some(upstream),
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
    let mut upstream = open_responses_proxy_request(body, None).await?;
    let is_compaction = upstream.compaction;
    let status_code = upstream.status_code;
    let upstream_content_type = upstream.content_type.clone();
    let is_stream = upstream.is_stream;
    let wire_api = upstream.wire_api;
    let upstream_body = upstream.read_body().await?;

    if !(200..300).contains(&status_code) {
        let error =
            responses_error_from_upstream(status_code, &upstream_content_type, &upstream_body);
        return Ok(ProxyHttpResponse {
            status: http_status_line(status_code),
            content_type: "application/json; charset=utf-8".to_string(),
            body: serde_json::to_vec(&error)?,
        });
    }

    if upstream.native_compaction_passthrough {
        return Ok(ProxyHttpResponse {
            status: "200 OK".to_string(),
            content_type: if upstream_content_type.is_empty() {
                if is_stream {
                    "text/event-stream; charset=utf-8".to_string()
                } else {
                    "application/json; charset=utf-8".to_string()
                }
            } else {
                upstream_content_type
            },
            body: upstream_body,
        });
    }

    if is_compaction {
        // v2 压缩：无论上游协议/是否流式，都重组为单个 compaction 输出项。
        let model = request_json
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !is_stream {
            return Ok(ProxyHttpResponse {
                status: "200 OK".to_string(),
                content_type: "text/event-stream; charset=utf-8".to_string(),
                body: wrap_non_stream_response_as_compaction(&upstream_body, model)?,
            });
        }
        let mut converter = CompactionSseConverter::new(model);
        if wire_api != UpstreamWireApi::Responses {
            converter = converter.with_chat_upstream();
        }
        // 整包已收齐，直接喂给有状态 SSE 解析器（与 launcher 逐 chunk 路径同逻辑）。
        converter.push_upstream_bytes(&upstream_body);
        return Ok(ProxyHttpResponse {
            status: "200 OK".to_string(),
            content_type: "text/event-stream; charset=utf-8".to_string(),
            body: converter.finish(),
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
        let text = String::from_utf8_lossy(&upstream_body);
        return Ok(ProxyHttpResponse {
            status: "200 OK".to_string(),
            content_type: "text/event-stream; charset=utf-8".to_string(),
            body: chat_sse_to_responses_sse_with_request(&text, &request_json).into_bytes(),
        });
    }

    let chat_json: Value = serde_json::from_slice(&upstream_body)?;
    let response_json = chat_completion_to_response_with_request(chat_json, &request_json)?;
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
    let base = base_url.trim().trim_end_matches('#').trim_end_matches('/');
    if base.to_ascii_lowercase().ends_with("/responses/compact") {
        return base.to_string();
    }
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

/// A provider may answer a streaming request with JSON. Keep the downstream wire contract.
pub fn response_to_sse(response: &Value) -> anyhow::Result<Vec<u8>> {
    let mut output = String::new();
    let mut initial = response.clone();
    initial["status"] = json!("in_progress");
    initial["output"] = json!([]);
    for event in ["response.created", "response.in_progress"] {
        push_sse(&mut output, event, json!({"type":event,"response":initial}));
    }
    for (index, item) in response["output"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let kind = item["type"].as_str().unwrap_or("");
        if !matches!(
            kind,
            "message" | "reasoning" | "function_call" | "custom_tool_call"
        ) {
            return fidelity::reject("unsupported response item in JSON-to-SSE conversion");
        }
        let mut added = item.clone();
        if kind == "message" {
            added["content"] = json!([]);
        }
        if kind == "reasoning" {
            added["summary"] = json!([]);
        }
        if kind == "function_call" {
            added["arguments"] = json!("");
        }
        if kind == "custom_tool_call" {
            added["input"] = json!("");
        }
        push_sse(
            &mut output,
            "response.output_item.added",
            json!({"type":"response.output_item.added","output_index":index,"item":added}),
        );
        if kind == "message" {
            for (part_index, part) in item["content"].as_array().into_iter().flatten().enumerate() {
                let refusal = part["type"] == "refusal";
                let field = if refusal { "refusal" } else { "text" };
                let event = if refusal {
                    "response.refusal"
                } else {
                    "response.output_text"
                };
                let mut empty = part.clone();
                empty[field] = json!("");
                push_sse(
                    &mut output,
                    "response.content_part.added",
                    json!({"type":"response.content_part.added","item_id":item["id"],"output_index":index,"content_index":part_index,"part":empty}),
                );
                push_sse(
                    &mut output,
                    &format!("{event}.delta"),
                    json!({"type":format!("{event}.delta"),"item_id":item["id"],"output_index":index,"content_index":part_index,"delta":part[field]}),
                );
                let mut done = json!({"type":format!("{event}.done"),"item_id":item["id"],"output_index":index,"content_index":part_index});
                done[field] = part[field].clone();
                push_sse(&mut output, &format!("{event}.done"), done);
                push_sse(
                    &mut output,
                    "response.content_part.done",
                    json!({"type":"response.content_part.done","item_id":item["id"],"output_index":index,"content_index":part_index,"part":part}),
                );
            }
        } else if kind == "reasoning" {
            for (summary_index, part) in
                item["summary"].as_array().into_iter().flatten().enumerate()
            {
                push_sse(
                    &mut output,
                    "response.reasoning_summary_part.added",
                    json!({"type":"response.reasoning_summary_part.added","item_id":item["id"],"output_index":index,"summary_index":summary_index,"part":{"type":"summary_text","text":""}}),
                );
                push_sse(
                    &mut output,
                    "response.reasoning_summary_text.delta",
                    json!({"type":"response.reasoning_summary_text.delta","item_id":item["id"],"output_index":index,"summary_index":summary_index,"delta":part["text"]}),
                );
                push_sse(
                    &mut output,
                    "response.reasoning_summary_text.done",
                    json!({"type":"response.reasoning_summary_text.done","item_id":item["id"],"output_index":index,"summary_index":summary_index,"text":part["text"]}),
                );
                push_sse(
                    &mut output,
                    "response.reasoning_summary_part.done",
                    json!({"type":"response.reasoning_summary_part.done","item_id":item["id"],"output_index":index,"summary_index":summary_index,"part":part}),
                );
            }
        } else if item["status"] == "completed" && response["status"] == "completed" {
            let field = if kind == "function_call" {
                "arguments"
            } else {
                "input"
            };
            let event = if kind == "function_call" {
                "response.function_call_arguments"
            } else {
                "response.custom_tool_call_input"
            };
            push_sse(
                &mut output,
                &format!("{event}.delta"),
                json!({"type":format!("{event}.delta"),"item_id":item["id"],"output_index":index,"delta":item[field]}),
            );
            let mut done =
                json!({"type":format!("{event}.done"),"item_id":item["id"],"output_index":index});
            done[field] = item[field].clone();
            push_sse(&mut output, &format!("{event}.done"), done);
        } else {
            continue;
        }
        push_sse(
            &mut output,
            "response.output_item.done",
            json!({"type":"response.output_item.done","output_index":index,"item":item}),
        );
    }
    let event = match response["status"].as_str() {
        Some("completed") => "response.completed",
        Some("incomplete") => "response.incomplete",
        _ => "response.failed",
    };
    push_sse(
        &mut output,
        event,
        json!({"type":event,"response":response}),
    );
    output.push_str("data: [DONE]\n\n");
    Ok(sequence_sse(output, &mut 0))
}

pub fn response_id_from_chat_id(id: Option<&str>) -> String {
    let Some(id) = id.filter(|id| {
        !id.is_empty() && !matches!(*id, "cmpl_compat" | "msg_compat" | "gemini_compat")
    }) else {
        return format!("resp_{}", uuid::Uuid::new_v4().simple());
    };
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
    refusal: bool,
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
    native_replay: Option<(&'static str, Value)>,
}

impl Default for ChatSseState {
    fn default() -> Self {
        Self {
            response_started: false,
            completed: false,
            response_id: format!("resp_{}", uuid::Uuid::new_v4().simple()),
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
            native_replay: None,
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
        if self.completed {
            return;
        }
        if chunk
            .get("choices")
            .is_none_or(|choices| !choices.is_array())
        {
            self.failed_into(
                output,
                "Upstream chat event is missing choices".into(),
                Some("invalid_stream_event".into()),
            );
            return;
        }
        if !self.response_started {
            if let Some(id) = chunk.get("id").and_then(Value::as_str) {
                self.response_id = response_id_from_chat_id(Some(id));
            }
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
        if chunk
            .get("choices")
            .and_then(Value::as_array)
            .is_some_and(|choices| choices.len() > 1)
        {
            self.failed_into(
                output,
                "Multiple upstream choices cannot be merged into one response".into(),
                Some("unsupported_stream_event".into()),
            );
            return;
        }

        let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return;
        };

        if let Some(delta) = choice.get("delta") {
            if validate_chat_delta(delta).is_err() {
                self.failed_into(
                    output,
                    "Unsupported upstream chat delta".into(),
                    Some("unsupported_stream_event".into()),
                );
                return;
            }
            if let Some(reasoning) = chat_delta_reasoning_text(delta) {
                self.push_reasoning_delta_into(&reasoning, output);
            }

            if let Some(content) = delta.get("content").and_then(Value::as_str) {
                if !content.is_empty() {
                    self.push_content_delta_into(content, output);
                }
            }
            if let Some(refusal) = delta.get("refusal").and_then(Value::as_str) {
                self.flush_inline_think_at_boundary_into(output);
                self.finalize_reasoning_into(output);
                self.push_message_delta_into(refusal, true, output);
            }

            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                self.flush_inline_think_at_boundary_into(output);
                self.finalize_reasoning_into(output);
                self.finalize_text_into(output);
                for tool_call in tool_calls {
                    self.push_tool_call_delta_into(tool_call, output);
                }
            }
            if let Some(function_call) = delta.get("function_call") {
                let id = self
                    .tools
                    .get(&0)
                    .map(|t| t.call_id.clone())
                    .filter(|id| !id.is_empty())
                    .unwrap_or_else(|| format!("call_{}", uuid::Uuid::new_v4().simple()));
                self.flush_inline_think_at_boundary_into(output);
                self.finalize_reasoning_into(output);
                self.finalize_text_into(output);
                self.push_tool_call_delta_into(
                    &json!({"index":0,"id":id,"function":function_call}),
                    output,
                );
            }
        }

        if let Some(finish_reason) = choice.get("finish_reason").and_then(Value::as_str) {
            if !matches!(
                finish_reason,
                "stop" | "length" | "content_filter" | "tool_calls" | "function_call"
            ) {
                self.failed_into(
                    output,
                    "Unknown upstream finish reason".into(),
                    Some("unsupported_stream_event".into()),
                );
                return;
            }
            self.finish_reason = Some(finish_reason.to_string());
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
                        let buffer = self.inline_think.buffer.trim_start();
                        self.inline_think.buffer = buffer[THINK_OPEN_TAG.len()..].to_string();
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
        let Some(close) = self.inline_think.buffer.find(THINK_CLOSE_TAG) else {
            // Emit reasoning promptly, keeping only a possible split closing delimiter.
            let keep = (1..THINK_CLOSE_TAG.len())
                .rev()
                .find(|len| self.inline_think.buffer.ends_with(&THINK_CLOSE_TAG[..*len]))
                .unwrap_or(0);
            let available = self.inline_think.buffer.len() - keep;
            let reasoning = self.inline_think.buffer[..available].to_string();
            self.inline_think.buffer.drain(..available);
            if !reasoning.is_empty() {
                self.push_reasoning_delta_into(&reasoning, output);
            }
            return;
        };
        let reasoning = self.inline_think.buffer[..close].to_string();
        let answer = strip_think_answer_separator(
            &self.inline_think.buffer[close + THINK_CLOSE_TAG.len()..],
        )
        .to_string();
        self.inline_think.mode = InlineThinkMode::Text;
        self.inline_think.buffer.clear();
        if !reasoning.is_empty() {
            self.push_reasoning_delta_into(&reasoning, output);
        }
        self.finalize_reasoning_into(output);
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
                if !buffered.is_empty() {
                    self.push_reasoning_delta_into(&buffered, output);
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
        if delta.is_empty() {
            return;
        }
        self.finalize_text_into(output);
        if self.reasoning.done {
            self.reasoning = ReasoningItemState::default();
        }
        if !self.reasoning.added {
            let output_index = self.next_output_index();
            let item_id = format!("rs_{}_{}", self.response_id, output_index);
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
        self.push_message_delta_into(delta, false, output);
    }

    fn push_message_delta_into(&mut self, delta: &str, refusal: bool, output: &mut String) {
        if delta.is_empty() {
            return;
        }
        if self.text.added && self.text.refusal != refusal {
            self.finalize_text_into(output);
        }
        if self.text.done {
            self.text = TextItemState::default();
        }
        self.text.refusal = refusal;
        if !self.text.added {
            let output_index = self.next_output_index();
            let item_id = format!(
                "msg_{}_{}",
                response_id_body(&self.response_id),
                output_index
            );
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
                    "part": if refusal { json!({"type":"refusal","refusal":""}) } else { json!({ "type": "output_text", "text": "", "annotations": [] }) }
                }),
            );
        }

        self.text.text.push_str(delta);
        let output_index = self.text.output_index.unwrap_or(0);
        push_sse(
            output,
            if refusal {
                "response.refusal.delta"
            } else {
                "response.output_text.delta"
            },
            json!({
                "type": if refusal { "response.refusal.delta" } else { "response.output_text.delta" },
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

        if let Some(existing) = self.tools.get(&chat_index) {
            if existing.added
                && (id_delta
                    .as_ref()
                    .is_some_and(|id| !id.is_empty() && id != &existing.call_id)
                    || name_delta
                        .as_ref()
                        .is_some_and(|name| !name.is_empty() && name != &existing.name))
            {
                self.failed_into(
                    output,
                    "Tool identity changed after its first event".into(),
                    Some("invalid_tool_identity".into()),
                );
                return;
            }
        }
        {
            let state = self.tools.entry(chat_index).or_default();
            if let Some(id) = id_delta {
                if state.call_id != id {
                    state.call_id.push_str(&id);
                }
            }
            if let Some(name) = name_delta {
                if !name.is_empty() && state.name != name {
                    state.name.push_str(&name);
                }
            }
            if !args_delta.is_empty() {
                state.arguments.push_str(&args_delta);
            }

            if !state.added
                && !state.call_id.is_empty()
                && !state.name.is_empty()
                && !state.arguments.is_empty()
            {
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
            state.item_id = tool_call_item_id(&state.call_id, &state.name, &self.tool_context);
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

        let status = response_status(self.finish_reason.as_deref());
        if status == "completed" {
            let mut ids = BTreeSet::new();
            for tool in self.tools.values() {
                if tool.call_id.is_empty()
                    || tool.name.is_empty()
                    || !ids.insert(tool.call_id.clone())
                    || fidelity::validate_arguments(&json!(tool.arguments)).is_err()
                {
                    self.failed_into(
                        output,
                        "Incomplete, duplicate or invalid tool call; execution was not finalized"
                            .into(),
                        Some("invalid_tool_call".into()),
                    );
                    return;
                }
            }
            self.finalize_tools_into(output);
        } else {
            for tool in self.tools.values() {
                let mut item = response_tool_call_item(
                    &tool.call_id,
                    &tool.name,
                    &tool.arguments,
                    &self.tool_context,
                );
                item["status"] = json!("incomplete");
                self.output_items
                    .push((tool.output_index.unwrap_or(self.next_output_index), item));
            }
        }
        if let Some((wire, native)) = self.native_replay.take() {
            let item = fidelity::replay_item(wire, native, self.completed_output_items());
            let output_index = self.next_output_index();
            push_sse(
                output,
                "response.output_item.added",
                json!({"type":"response.output_item.added","output_index":output_index,"item":item}),
            );
            push_sse(
                output,
                "response.output_item.done",
                json!({"type":"response.output_item.done","output_index":output_index,"item":item}),
            );
            self.output_items.push((output_index, item));
        }
        let mut response = self.base_response(status, self.completed_output_items());
        if status == "incomplete" {
            response["incomplete_details"] =
                json!({ "reason": incomplete_reason(self.finish_reason.as_deref()) });
        }
        copy_response_request_fields(&mut response, self.original_request.as_ref());
        let event = if status == "incomplete" {
            "response.incomplete"
        } else {
            "response.completed"
        };
        push_sse(
            output,
            event,
            json!({
                "type": event,
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
        let part = if self.text.refusal {
            json!({"type":"refusal","refusal":self.text.text})
        } else {
            json!({"type":"output_text","text":self.text.text,"annotations":[]})
        };
        let item = json!({
            "id": self.text.item_id,
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [part]
        });
        self.output_items.push((output_index, item.clone()));
        self.text.done = true;
        let event = if self.text.refusal {
            "response.refusal.done"
        } else {
            "response.output_text.done"
        };
        let mut text_done = json!({
            "type": event,
            "item_id": self.text.item_id,
            "output_index": output_index,
            "content_index": 0,
        });
        text_done[if self.text.refusal { "refusal" } else { "text" }] = json!(self.text.text);
        push_sse(output, event, text_done);
        push_sse(
            output,
            "response.content_part.done",
            json!({
                "type": "response.content_part.done",
                "item_id": self.text.item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": part
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
                state.item_id = tool_call_item_id(&state.call_id, &state.name, &self.tool_context);
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
        if self.completed {
            return;
        }
        self.ensure_response_started_into(output);
        self.flush_inline_think_at_boundary_into(output);
        self.finalize_reasoning_into(output);
        self.finalize_text_into(output);
        self.completed = true;
        let mut error = json!({ "message": message });
        if let Some(error_type) = error_type.filter(|value| !value.is_empty()) {
            error["type"] = json!(error_type);
        }
        let mut partial_output = self.completed_output_items();
        for tool in self.tools.values().filter(|tool| !tool.done) {
            let mut item = response_tool_call_item(
                &tool.call_id,
                &tool.name,
                &tool.arguments,
                &self.tool_context,
            );
            item["status"] = json!("incomplete");
            partial_output.push(item);
        }
        let mut response = self.base_response("failed", partial_output);
        response["error"] = error;
        push_sse(
            output,
            "response.failed",
            json!({
                "type": "response.failed",
                "response": response
            }),
        );
        output.push_str("data: [DONE]\n\n");
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
    let bytes = buffer.as_bytes();
    let mut cursor = 0;
    let mut line_start = 0;
    while cursor < bytes.len() {
        if bytes[cursor] != b'\r' && bytes[cursor] != b'\n' {
            cursor += 1;
            continue;
        }
        let end = cursor;
        if bytes[cursor] == b'\r' && cursor + 1 == bytes.len() {
            // A CRLF may be split between network chunks.
            return None;
        }
        cursor += if bytes[cursor] == b'\r' && bytes.get(cursor + 1) == Some(&b'\n') {
            2
        } else {
            1
        };
        if end == line_start {
            let block = buffer[..line_start].to_string();
            buffer.drain(..cursor);
            return Some(block);
        }
        line_start = cursor;
    }
    None
}

fn append_utf8_safe(
    buffer: &mut String,
    remainder: &mut Vec<u8>,
    bytes: &[u8],
) -> anyhow::Result<()> {
    if bytes.is_empty() {
        return Ok(());
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
                anyhow::bail!("invalid UTF-8");
            }
        }
    }
    if buffer.len() > 16 * 1024 * 1024 {
        anyhow::bail!("upstream frame exceeds buffer limit");
    }
    Ok(())
}

fn sequence_sse(output: String, sequence: &mut u64) -> Vec<u8> {
    let mut result = String::with_capacity(output.len());
    for block in output.split("\n\n").filter(|block| !block.is_empty()) {
        let (event, data) = sse_event_and_data(block);
        if let Some(mut value) = data
            .as_deref()
            .and_then(|data| serde_json::from_str::<Value>(data).ok())
        {
            value["sequence_number"] = json!(*sequence);
            *sequence += 1;
            push_sse(&mut result, event.as_deref().unwrap_or("message"), value);
        } else {
            result.push_str(block);
            result.push_str("\n\n");
        }
    }
    result.into_bytes()
}

fn strip_sse_field<'a>(line: &'a str, field: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(field)?.strip_prefix(':')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

fn sse_event_and_data(block: &str) -> (Option<String>, Option<String>) {
    let mut event_name = None;
    let mut data_parts = Vec::new();
    for line in block.trim_start_matches('\u{feff}').split(['\r', '\n']) {
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
    let mut result = if usage.is_object() {
        usage.clone()
    } else {
        json!({})
    };
    result["prompt_tokens"] = json!(
        input_tokens
            .saturating_add(cache_read)
            .saturating_add(cache_creation)
    );
    result["completion_tokens"] = json!(output_tokens);
    result["total_tokens"] = json!(
        input_tokens
            .saturating_add(cache_read)
            .saturating_add(cache_creation)
            .saturating_add(output_tokens)
    );
    result
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
    let mut result = if usage.is_object() {
        usage.clone()
    } else {
        json!({})
    };
    let normalized = json!({
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
    });
    result
        .as_object_mut()
        .unwrap()
        .extend(normalized.as_object().unwrap().clone());
    result
}

fn anthropic_finish_reason(reason: &str) -> &'static str {
    match reason {
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        "end_turn" | "stop_sequence" => "stop",
        _ => "content_filter",
    }
}

fn gemini_finish_reason(reason: &str, has_tools: bool) -> &'static str {
    match reason {
        "MAX_TOKENS" => "length",
        "STOP" if has_tools => "tool_calls",
        "STOP" => "stop",
        _ => "content_filter",
    }
}

fn chat_delta_reasoning_text(delta: &Value) -> Option<String> {
    extract_reasoning_field_text(delta)
}

fn validate_chat_message(message: &Value) -> anyhow::Result<()> {
    let Some(object) = message.as_object() else {
        return fidelity::reject("upstream assistant message must be an object");
    };
    if message
        .get("role")
        .is_some_and(|role| !role.is_null() && role != "assistant")
    {
        return fidelity::reject("upstream message role is not assistant");
    }
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "role"
                | "content"
                | "refusal"
                | "tool_calls"
                | "function_call"
                | "reasoning_content"
                | "reasoning"
                | "reasoning_text"
                | "reasoning_details"
                | "reasoning_summary"
                | "summary"
        ) {
            return fidelity::reject(&format!("unsupported upstream assistant field {key}"));
        }
    }
    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        for part in parts {
            if !matches!(
                part["type"].as_str(),
                Some("text" | "output_text" | "refusal")
            ) {
                return fidelity::reject("unsupported upstream content part");
            }
        }
    }
    Ok(())
}

fn validate_chat_delta(delta: &Value) -> anyhow::Result<()> {
    validate_chat_message(delta)?;
    if delta
        .get("content")
        .is_some_and(|v| !v.is_null() && !v.is_string())
    {
        return fidelity::reject("non-text chat stream delta");
    }
    if delta.get("reasoning_details").is_some() {
        return fidelity::reject("opaque reasoning_details streaming requires native Responses");
    }
    Ok(())
}

fn validate_anthropic_blocks(blocks: &Value) -> anyhow::Result<()> {
    let Some(blocks) = blocks.as_array() else {
        return fidelity::reject("Anthropic content must be an array");
    };
    for block in blocks {
        if !matches!(
            block["type"].as_str(),
            Some("text" | "thinking" | "redacted_thinking" | "tool_use")
        ) {
            return fidelity::reject("unsupported Anthropic content block");
        }
    }
    Ok(())
}

fn validate_gemini_response(body: &Value) -> anyhow::Result<()> {
    if body
        .get("promptFeedback")
        .is_some_and(|v| v.get("blockReason").is_some())
    {
        return fidelity::reject("Gemini prompt was blocked without a response candidate");
    }
    let candidates = body.get("candidates").and_then(Value::as_array);
    if candidates.is_some_and(|c| c.len() > 1) {
        return fidelity::reject("multiple Gemini candidates cannot be merged");
    }
    for part in body
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(call) = part.get("functionCall") {
            if call.as_object().is_none_or(|o| {
                o.keys()
                    .any(|key| !matches!(key.as_str(), "name" | "args" | "id"))
            }) {
                return fidelity::reject("unsupported Gemini function call fields");
            }
        }
        if part.as_object().is_none_or(|o| {
            o.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "text" | "thought" | "thoughtSignature" | "functionCall"
                )
            })
        }) {
            return fidelity::reject("unsupported Gemini output part");
        }
    }
    Ok(())
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

fn append_responses_input(input: &Value, messages: &mut Vec<Value>) -> anyhow::Result<()> {
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
                )?;
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
            )?;
            flush_tool_calls(messages, &mut pending_tool_calls, &mut pending_reasoning);
            flush_reasoning(messages, &mut pending_reasoning);
        }
        _ => {}
    }
    Ok(())
}

fn append_responses_item(
    item: &Value,
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut Vec<Value>,
    pending_reasoning: &mut Vec<String>,
    seen_tool_call_ids: &mut BTreeSet<String>,
) -> anyhow::Result<()> {
    match item.get("type").and_then(Value::as_str) {
        Some("alunixa_native_message") => {
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            flush_reasoning(messages, pending_reasoning);
            let mut names = json!({});
            let mut wire_ids = json!({});
            let native = item.get("native").cloned().unwrap_or(Value::Null);
            let native_calls: Vec<Value> = native
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|part| part.get("functionCall").cloned())
                .collect();
            let mut message = if native.is_object() {
                native
            } else {
                json!({"role":"assistant","content":"","_native":native})
            };
            for (index, call) in item["calls"].as_array().into_iter().flatten().enumerate() {
                let id = call["call_id"].as_str().unwrap_or("");
                seen_tool_call_ids.insert(id.to_string());
                names[id] = native_calls
                    .get(index)
                    .and_then(|call| call.get("name"))
                    .cloned()
                    .unwrap_or_else(|| json!(responses_history_function_name(call)));
                if let Some(wire_id) = native_calls.get(index).and_then(|call| call.get("id")) {
                    wire_ids[id] = wire_id.clone();
                }
            }
            if message.get("_native").is_some() {
                message["_native_tool_names"] = names;
                message["_native_tool_wire_ids"] = wire_ids;
            }
            messages.push(message);
        }
        Some("function_call") => {
            let name = responses_history_function_name(item);
            if name.is_empty() {
                return fidelity::reject("invalid tool history item");
            }
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if call_id.is_empty() {
                return fidelity::reject("invalid tool history item");
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
                return fidelity::reject("invalid tool history item");
            }
            if !seen_tool_call_ids.contains(call_id) {
                return fidelity::reject("orphan tool output requires matching call history");
            }
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": tool_output_content(item.get("output").unwrap_or(&Value::Null))
            }));
        }
        Some("custom_tool_call") => {
            let name = responses_history_function_name(item);
            let input = item
                .get("input")
                .or_else(|| item.get("arguments"))
                .unwrap_or(&Value::Null);
            let (name, arguments) = build_custom_tool_call_history(&name, input);
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if call_id.is_empty() {
                return fidelity::reject("invalid tool history item");
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
        Some("tool_search_call") => {
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            seen_tool_call_ids.insert(call_id.to_string());
            pending_tool_calls.push(json!({"id":call_id,"type":"function","function":{
                "name":"tool_search","arguments":responses_arguments_to_chat(item.get("arguments").unwrap_or(&json!({})))
            }}));
        }
        Some("tool_search_output") => {
            let call_id = item["call_id"].as_str().unwrap_or("");
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            messages.push(json!({"role":"tool","tool_call_id":call_id,"content":response_output_text(&item["tools"])}));
        }
        Some("additional_tools") => {
            if let Some(content) = item.get("content") {
                messages.push(json!({"role":"system","content":responses_content_to_chat_content("system", content)}));
            }
        }
        Some("custom_tool_call_output") => {
            let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
            if call_id.is_empty() {
                return fidelity::reject("invalid tool history item");
            }
            if !seen_tool_call_ids.contains(call_id) {
                return fidelity::reject("orphan tool output requires matching call history");
            }
            flush_tool_calls(messages, pending_tool_calls, pending_reasoning);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": tool_output_content(item.get("output").unwrap_or(&Value::Null))
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
                    return fidelity::reject("invalid tool history item");
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
                return fidelity::reject("invalid tool history item");
            }
            let output = content.get("content").unwrap_or(content);
            if !seen_tool_call_ids.contains(call_id) {
                return fidelity::reject("orphan tool output requires matching call history");
            }
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": tool_output_content(output)
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
    Ok(())
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
            if !pending_reasoning.is_empty() {
                append_reasoning_to_assistant_message(
                    last,
                    &std::mem::take(pending_reasoning).join("\n"),
                );
            }
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
                        chat_parts.push(json!({ "type": "refusal", "refusal": value }));
                        has_non_text_part = true;
                    }
                }
            }
            "input_image" | "image_url" => {
                if let Some(image_url) = part.get("image_url") {
                    let mut image_url = if image_url.is_object() {
                        image_url.clone()
                    } else {
                        json!({ "url": image_url.as_str().unwrap_or_default() })
                    };
                    if let Some(detail) = part.get("detail") {
                        image_url["detail"] = detail.clone();
                    }
                    chat_parts.push(json!({ "type": "image_url", "image_url": image_url }));
                    has_non_text_part = true;
                }
            }
            "input_audio" => {
                let audio = part.get("input_audio").cloned().unwrap_or_else(|| {
                    let mut value = part.clone();
                    value.as_object_mut().unwrap().remove("type");
                    value
                });
                chat_parts.push(json!({"type":"input_audio","input_audio":audio}));
                has_non_text_part = true;
            }
            "input_file" => {
                let mut file = part.clone();
                file.as_object_mut().unwrap().remove("type");
                chat_parts.push(json!({"type":"file","file":file}));
                has_non_text_part = true;
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
                .concat(),
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
        if response_tool_type(tool) == "tool_search" {
            let name = response_tool_name(tool).unwrap_or("tool_search");
            context.custom_tools.insert(
                name.to_string(),
                CodexCustomToolSpec {
                    openai_name: "tool_search".into(),
                    namespace: String::new(),
                    kind: CodexCustomToolKind::Raw,
                    proxy_action: None,
                },
            );
            context.has_custom_tools = true;
        } else if response_tool_type(tool) == "namespace" {
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
        if response_tool_type(tool) == "tool_search" {
            converted.push(function_tool(
                response_tool_name(tool).unwrap_or("tool_search"),
                response_tool_description(tool),
                normalize_chat_tool_parameters(
                    &tool.get("parameters").cloned().unwrap_or_else(|| json!({})),
                ),
            ));
        } else if response_tool_type(tool) == "namespace" {
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
    let bare_ref = normalized
        .as_object()
        .is_some_and(|o| o.len() == 1 && o.contains_key("$ref"));
    if !bare_ref {
        if normalized.get("type").is_none_or(Value::is_null) {
            normalized["type"] = json!("object");
        }
        if normalized.get("properties").is_none() {
            normalized["properties"] = json!({});
        }
        if normalized.get("required").is_none() {
            normalized["required"] = json!([]);
        }
    }
    flatten_top_level_combinators(inline_ref_siblings(&normalized))
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
        if let Some(reasoning) = strip_leading_think_open_tag(content) {
            return Some(reasoning);
        }
    }

    None
}

fn chat_message_to_response_output_item(message: &Value, response_id: &str) -> Option<Value> {
    let mut content = Vec::new();
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        let text = split_leading_think_block(text)
            .map(|(_reasoning, answer)| answer)
            .unwrap_or_else(|| {
                if strip_leading_think_open_tag(text).is_some() {
                    String::new()
                } else {
                    text.to_string()
                }
            });
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
        "id": format!("msg_{}", response_id_body(response_id)),
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
        .unwrap_or_else(|| format!("call_{}_{}", uuid::Uuid::new_v4().simple(), index));
    let function = tool_call.get("function").unwrap_or(&Value::Null);
    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
    let arguments = responses_arguments_to_chat(function.get("arguments").unwrap_or(&json!({})));
    response_tool_call_item(&call_id, name, &arguments, tool_context)
}

fn chat_legacy_function_call_to_response_item(
    function_call: &Value,
    tool_context: &CodexToolContext,
) -> Value {
    let fallback_id = format!("call_{}", uuid::Uuid::new_v4().simple());
    let call_id = function_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_id);
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
    if tool_context.is_tool_search_proxy(&state.name) {
        return json!({"type":"response.output_item.added","output_index":output_index,
            "item":{"id":state.item_id,"type":"tool_search_call","status":"in_progress",
                "call_id":state.call_id,"execution":"client","arguments":{}}});
    }
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
    if tool_context.is_custom_tool_proxy(&state.name)
        && !tool_context.is_tool_search_proxy(&state.name)
    {
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
    if tool_context.is_custom_tool_proxy(&state.name)
        && !tool_context.is_tool_search_proxy(&state.name)
    {
        let input = reconstruct_custom_tool_call_input_with_context(
            tool_context,
            &state.name,
            &state.arguments,
        );
        push_sse(
            output,
            "response.custom_tool_call_input.delta",
            json!({
                "type": "response.custom_tool_call_input.delta",
                "item_id": format!("ctc_{}", state.call_id),
                "call_id": state.call_id,
                "output_index": output_index,
                "delta": input
            }),
        );
        push_sse(
            output,
            "response.custom_tool_call_input.done",
            json!({
                "type":"response.custom_tool_call_input.done",
                "item_id":format!("ctc_{}",state.call_id),
                "output_index":output_index,
                "input":input
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
    if tool_context.is_builtin_web_search_proxy(name) {
        return json!({
            "id": web_search_item_id(call_id),
            "type": "web_search_call",
            "status": "failed",
            "action": web_search_action_from_arguments(arguments)
        });
    }
    if tool_context.is_tool_search_proxy(name) {
        return json!({
            "id": format!("tsc_{call_id}"),
            "type": "tool_search_call",
            "status": "completed",
            "call_id": call_id,
            "execution": "client",
            "arguments": serde_json::from_str::<Value>(arguments).unwrap_or_else(|_| json!({}))
        });
    }
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
        input_tokens_include_cache = !has_claude_cache_fields;
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
        input_tokens
    } else {
        input_tokens
            .saturating_add(cached_tokens)
            .saturating_add(effective_cache_creation_tokens(
                cache_creation,
                cache_creation_5m,
                cache_creation_1h,
            ))
    };
    let should_recalculate_total = usage.get("total_tokens").is_none()
        || cached_tokens > 0
        || effective_cache_creation_tokens(cache_creation, cache_creation_5m, cache_creation_1h)
            > 0
        || usage.get("promptTokenCount").is_some();
    let total_tokens = if should_recalculate_total {
        usage_input_tokens.saturating_add(output_tokens)
    } else {
        usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(usage_input_tokens + output_tokens)
    };
    let mut result = usage.clone();
    result["input_tokens"] = json!(usage_input_tokens);
    result["output_tokens"] = json!(output_tokens);
    result["total_tokens"] = json!(total_tokens);

    if has_claude_cache_fields || has_cache_details || cached_tokens > 0 {
        if !result["input_tokens_details"].is_object() {
            result["input_tokens_details"] = usage
                .get("prompt_tokens_details")
                .cloned()
                .unwrap_or_else(|| json!({}));
        }
        result["input_tokens_details"]["cached_tokens"] = json!(cached_tokens);
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
        Some("length" | "content_filter") => "incomplete",
        _ => "completed",
    }
}

fn incomplete_reason(finish_reason: Option<&str>) -> &'static str {
    if finish_reason == Some("content_filter") {
        "content_filter"
    } else {
        "max_output_tokens"
    }
}

fn response_output_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => canonical_json_string(other),
    }
}

fn tool_output_content(value: &Value) -> Value {
    if value
        .as_array()
        .is_some_and(|parts| parts.iter().any(is_image_part))
    {
        responses_content_to_chat_content("tool", value)
    } else {
        json!(response_output_text(value))
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
        Value::String(text) => text.clone(),
        Value::Object(_) => canonical_json_string(value),
        Value::Null => "{}".to_string(),
        other => canonical_json_string(&json!({ "input": other })),
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

fn apply_chat_reasoning_options(result: &mut Value, body: &Value, model: &str, standard: bool) {
    let effort = body
        .pointer("/reasoning/effort")
        .or_else(|| body.get("reasoning_effort"))
        .and_then(Value::as_str);
    if is_claude_model(model) && effort.is_some_and(|v| matches!(v, "adaptive" | "xhigh" | "ultra"))
    {
        result["thinking"] = json!({"type":"adaptive"});
        if let Some(object) = result.as_object_mut() {
            object.remove("reasoning_effort");
            object.remove("reasoning");
        }
        return;
    }
    let Some(reasoning_enabled) = reasoning_requested(body) else {
        return;
    };
    let style = if standard {
        ChatReasoningStyle::Default
    } else {
        infer_chat_reasoning_style(model)
    };

    match style {
        ChatReasoningStyle::Thinking => {
            result["thinking"] = json!({
                "type": if reasoning_enabled { if is_kimi_coding_model(model) { "adaptive" } else { "enabled" } } else { "disabled" }
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
    let mapped = if is_claude_model(model) && mapped == "ultra" {
        "max"
    } else {
        mapped
    };

    match style {
        ChatReasoningStyle::OpenRouter => {
            result["reasoning"] = json!({ "effort": mapped });
        }
        ChatReasoningStyle::DeepSeek
        | ChatReasoningStyle::LowHigh
        | ChatReasoningStyle::Default
            if supports_reasoning_effort(model)
                || (standard && model.to_ascii_lowercase().contains("gemini")) =>
        {
            result["reasoning_effort"] = json!(mapped);
        }
        ChatReasoningStyle::Thinking if is_kimi_coding_model(model) => {
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
    if is_kimi_coding_model(&model)
        || model.contains("kimi")
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
        ChatReasoningStyle::Thinking => match effort.as_str() {
            "minimal" | "low" => Some("low"),
            "medium" | "high" => Some("high"),
            "ultra" | "xhigh" | "max" => Some("max"),
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
    is_claude_model(model)
        || is_openai_o_series(model)
        || model
            .to_lowercase()
            .strip_prefix("gpt-")
            .and_then(|rest| rest.chars().next())
            .is_some_and(|ch| ch.is_ascii_digit() && ch >= '5')
        || infer_chat_reasoning_style(model) == ChatReasoningStyle::DeepSeek
        || infer_chat_reasoning_style(model) == ChatReasoningStyle::LowHigh
        || model.eq_ignore_ascii_case("gemini-3.8-flash")
}

fn is_claude_model(model: &str) -> bool {
    model
        .to_ascii_lowercase()
        .split(['/', ':', '\\'])
        .any(|part| part.starts_with("claude-"))
}

fn is_openai_o_series(model: &str) -> bool {
    model.len() > 1
        && model.starts_with('o')
        && model
            .as_bytes()
            .get(1)
            .is_some_and(|byte| byte.is_ascii_digit())
}

async fn send_responses_upstream_request(
    relay: &crate::settings::RelayProfile,
    endpoint: &str,
    upstream_body: &Value,
    wire_api: UpstreamWireApi,
    is_stream: bool,
    original_user_agent: Option<&str>,
    beta_features: Option<&str>,
    session_headers: ProxySessionHeaders<'_>,
) -> anyhow::Result<reqwest::Response> {
    let mut builder = upstream_request_builder(
        crate::http_client::proxied_client(&effective_user_agent(
            &relay.user_agent,
            original_user_agent,
        ))?,
        endpoint,
        relay,
        is_stream,
        upstream_body,
    );
    builder = with_client_session_headers(builder, relay, session_headers);
    if wire_api == UpstreamWireApi::Responses {
        if let Some(value) = beta_features.filter(|value| !value.is_empty()) {
            builder = builder.header("x-codex-beta-features", value);
        }
    }
    send_upstream_request_for_responses(builder, is_stream).await
}

fn tool_call_extra_content_cache() -> &'static Mutex<ExtraContentCache> {
    static CACHE: OnceLock<Mutex<ExtraContentCache>> = OnceLock::new();
    // 缓存上限：一次会话里同时活跃的工具调用远小于此数；超出后按插入序淘汰最旧的，
    // 避免长时间运行时无界增长。
    CACHE.get_or_init(|| Mutex::new(ExtraContentCache::new(256)))
}

fn tool_call_extra_content(tool_call: &Value) -> Option<Value> {
    if let Some(value) = tool_call.get("extra_content") {
        if value.is_object() && !value.as_object().is_some_and(Map::is_empty) {
            return Some(value.clone());
        }
    }
    for key in ["thought_signature", "thoughtSignature"] {
        if let Some(value) = tool_call.get(key) {
            if !value.is_null() {
                return Some(json!({ "google": { "thought_signature": value } }));
            }
        }
    }
    None
}

fn remember_tool_call_extra_content(call_id: &str, tool_call: &Value) {
    let Some(extra) = tool_call_extra_content(tool_call) else {
        return;
    };
    if let Ok(mut cache) = tool_call_extra_content_cache().lock() {
        cache.remember(call_id, extra);
    }
}

fn recall_tool_call_extra_content(call_id: &str) -> Option<Value> {
    tool_call_extra_content_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.recall(call_id))
}

pub fn protocol_proxy_port() -> u16 {
    std::env::var("ALUNIXA_X_PROTOCOL_PROXY_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_PROTOCOL_PROXY_PORT)
}

fn should_retry_after_cooldown(retries: usize) -> bool {
    retries < MAX_COOLDOWN_RETRIES
}

pub fn request_has_compaction_trigger(body: &Value) -> bool {
    body.get("input")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some(COMPACTION_TRIGGER_TYPE)
            })
        })
}

fn strip_compaction_trigger(mut body: Value) -> Value {
    if let Some(items) = body.get_mut("input").and_then(Value::as_array_mut) {
        items.retain(|item| {
            item.get("type").and_then(Value::as_str) != Some(COMPACTION_TRIGGER_TYPE)
        });
    }
    body
}

fn rewrite_request_for_compaction(mut body: Value) -> Value {
    if let Some(items) = body.get_mut("input").and_then(Value::as_array_mut) {
        items.push(json!({
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": COMPACTION_SUMMARY_INSTRUCTION }]
        }));
    }
    body["tools"] = json!([]);
    body["tool_choice"] = json!("none");
    body["parallel_tool_calls"] = json!(false);
    body
}

fn input_has_encrypted_agent_content(input: &Value) -> bool {
    fn item_has_encrypted_content(item: &Value) -> bool {
        item.get("type").and_then(Value::as_str) == Some("encrypted_content")
            || item.get("content").is_some_and(|content| match content {
                Value::Array(parts) => parts.iter().any(|part| {
                    part.get("type").and_then(Value::as_str) == Some("encrypted_content")
                }),
                Value::Object(_) => {
                    content.get("type").and_then(Value::as_str) == Some("encrypted_content")
                }
                _ => false,
            })
    }
    match input {
        Value::Array(items) => items.iter().any(item_has_encrypted_content),
        Value::Object(_) => item_has_encrypted_content(input),
        _ => false,
    }
}

pub fn responses_to_chat_completions_with_options(
    mut body: Value,
    standard: bool,
) -> anyhow::Result<Value> {
    remove_unsupported_native_search(&mut body)?;
    expand_local_compaction_history(&mut body);
    if input_has_native_compaction(&body) {
        return Err(NativeCompactionUnsupported::history().into());
    }
    if body
        .get("input")
        .is_some_and(input_has_encrypted_agent_content)
    {
        return Err(UnsupportedEncryptedAgentContent.into());
    }
    let body = fidelity::prepare_history(body, "chat")?;
    let mut result = responses_to_chat_completions_for_wire(body.clone(), "chat", standard)?;
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Some(messages) = result["messages"].as_array_mut() {
        relocate_tool_output_images(messages);
        normalize_image_data_urls_for_model(messages, model);
    }
    Ok(result)
}

fn chrono_now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn wrap_non_stream_response_as_compaction(
    upstream_body: &[u8],
    model: &str,
) -> anyhow::Result<Vec<u8>> {
    let upstream_json: Value = serde_json::from_slice(upstream_body)?;
    let mut converter = CompactionSseConverter::new(model);
    if let Some(error) = upstream_json.get("error").filter(|value| !value.is_null()) {
        converter.fail(
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("compaction upstream error")
                .to_string(),
            None,
        );
        return Ok(converter.finish());
    }
    let responses_text = extract_summary_text_from_responses(&upstream_json);
    let text = if responses_text.is_empty() {
        extract_summary_text_from_chat(&upstream_json)
    } else {
        responses_text
    };
    if text.is_empty() {
        converter.fail(
            "上游返回了空摘要，无法完成压缩".to_string(),
            Some("compaction_empty_summary".to_string()),
        );
        return Ok(converter.finish());
    }
    converter.push_summary_text(&text);
    Ok(converter.finish())
}

fn extract_summary_text_from_responses(response: &Value) -> String {
    let Some(items) = response.get("output").and_then(Value::as_array) else {
        return String::new();
    };
    let mut texts = Vec::new();
    for item in items {
        let text = extract_summary_text_from_response_item(item);
        if !text.is_empty() {
            texts.push(text);
        }
    }
    texts.join("\n")
}

fn extract_summary_text_from_response_item(item: &Value) -> String {
    match item.get("type").and_then(Value::as_str) {
        Some("message") => item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn extract_summary_text_from_chat(response: &Value) -> String {
    response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn response_body_is_stream(content_type: &str, body: &[u8]) -> bool {
    if content_type.contains("text/event-stream") {
        return true;
    }
    let trimmed = body
        .iter()
        .copied()
        .skip_while(|byte| byte.is_ascii_whitespace())
        .take(6)
        .collect::<Vec<_>>();
    trimmed.starts_with(b"data:") || trimmed.starts_with(b"event:")
}

fn output_compaction_count(output: Option<&Value>) -> Option<usize> {
    let items = output?.as_array()?;
    let compactions = items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some(COMPACTION_OUTPUT_TYPE));
    if compactions
        .clone()
        .any(|item| usable_compaction_content(item).is_none())
    {
        return Some(0);
    }
    Some(compactions.count())
}

async fn read_limited_upstream_body(
    response: &mut reqwest::Response,
    limit: usize,
) -> anyhow::Result<Vec<u8>> {
    if let Some(content_length) = response.content_length()
        && content_length > limit as u64
    {
        anyhow::bail!("上游响应体超过 {limit} 字节限制");
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len().saturating_add(chunk.len()) > limit {
            anyhow::bail!("上游响应体超过 {limit} 字节限制");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn usable_compaction_content(item: &Value) -> Option<&str> {
    item.get("encrypted_content")?
        .as_str()
        .filter(|content| !content.is_empty())
}

fn json_compaction_count(value: &Value) -> Option<usize> {
    if let Some(count) = output_compaction_count(value.get("output")) {
        return Some(count);
    }
    value
        .get("response")
        .and_then(|response| output_compaction_count(response.get("output")))
}

fn upstream_compaction_item_count(body: &[u8], content_type: &str) -> Option<usize> {
    if response_body_is_stream(content_type, body) {
        let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
        let mut count = 0;
        for block in text.split("\n\n") {
            let mut event_name = None;
            let mut data_parts = Vec::new();
            for line in block.lines() {
                if let Some(event) = strip_sse_field(line, "event") {
                    event_name = Some(event.trim());
                }
                if let Some(data) = strip_sse_field(line.trim_end_matches('\r'), "data") {
                    data_parts.push(data);
                }
            }
            if data_parts.is_empty() {
                continue;
            }
            let data = data_parts.join("\n");
            if data.trim() == "[DONE]" {
                continue;
            }
            let Ok(json) = serde_json::from_str::<Value>(&data) else {
                continue;
            };
            let event = event_name.or_else(|| json.get("type").and_then(Value::as_str));
            match event {
                Some("response.output_item.done")
                    if json
                        .get("item")
                        .and_then(|item| item.get("type"))
                        .and_then(Value::as_str)
                        == Some(COMPACTION_OUTPUT_TYPE) =>
                {
                    if usable_compaction_content(json.get("item")?).is_none() {
                        return Some(0);
                    }
                    count += 1;
                }
                Some("response.completed") => {
                    json.get("response")?.get("id")?.as_str()?;
                    return Some(count);
                }
                Some("response.failed" | "response.incomplete" | "error") => return None,
                _ => {}
            }
        }
        return None;
    }
    let Ok(json) = serde_json::from_slice::<Value>(body) else {
        return None;
    };
    json_compaction_count(&json)
}

fn compaction_input_rejected(status_code: u16, body: &[u8]) -> bool {
    if status_code != 400 && status_code != 422 {
        return false;
    }
    // 只读取错误本身，避免回显请求中的 trigger 让无关参数错误触发降级。
    let text = match serde_json::from_slice::<Value>(body) {
        Ok(json) => {
            let error = json.get("error").unwrap_or(&json);
            [
                error.as_str(),
                error.get("message").and_then(Value::as_str),
                error.get("code").and_then(Value::as_str),
                error.get("param").and_then(Value::as_str),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ")
        }
        Err(_) => String::from_utf8_lossy(body).into_owned(),
    }
    .to_ascii_lowercase();
    let unrecognized = text.contains("unknown")
        || text.contains("unrecognized")
        || text.contains("unsupported")
        || text.contains("unexpected")
        || text.contains("not supported")
        || text.contains("invalid type")
        || text.contains("invalid_type")
        || text.contains("additional propert");
    text.contains(COMPACTION_TRIGGER_TYPE) && unrecognized
}

fn sse_block_type(block: &str) -> Option<String> {
    let mut event_name = None;
    let mut data_parts = Vec::new();
    for line in block.lines() {
        if let Some(event) = strip_sse_field(line, "event") {
            event_name = Some(event.trim().to_string());
        }
        if let Some(data) = strip_sse_field(line.trim_end_matches('\r'), "data") {
            data_parts.push(data);
        }
    }
    if let Some(name) = event_name.filter(|name| !name.is_empty()) {
        return Some(name);
    }
    let data = data_parts.join("\n");
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    serde_json::from_str::<Value>(data).ok().and_then(|json| {
        json.get("type")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

fn upstream_has_terminal_failure(body: &[u8], content_type: &str) -> bool {
    if response_body_is_stream(content_type, body) {
        let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
        return text.split("\n\n").any(|block| {
            matches!(
                sse_block_type(block).as_deref(),
                Some("response.failed" | "response.incomplete" | "error")
            )
        });
    }
    serde_json::from_slice::<Value>(body).is_ok_and(|json| {
        json.get("error").is_some_and(|error| !error.is_null())
            || matches!(
                json.get("status").and_then(Value::as_str),
                Some("failed" | "incomplete")
            )
    })
}

fn render_native_compaction_as_sse(body: &[u8]) -> Option<Vec<u8>> {
    let json = serde_json::from_slice::<Value>(body).ok()?;
    let response = if json.get("output").is_some() {
        json
    } else {
        json.get("response")?.clone()
    };
    let output = response.get("output")?.as_array()?;
    let mut compaction_items = output.iter().filter(|item| {
        item.get("type").and_then(Value::as_str) == Some(COMPACTION_OUTPUT_TYPE)
            && usable_compaction_content(item).is_some()
    });
    let item = compaction_items.next()?.clone();
    if compaction_items.next().is_some() {
        return None;
    }
    let mut sse = String::new();
    let mut created_response = response.clone();
    created_response["status"] = json!("in_progress");
    created_response["output"] = json!([]);
    push_sse(
        &mut sse,
        "response.created",
        json!({
            "type": "response.created",
            "sequence_number": 0,
            "response": created_response
        }),
    );
    push_sse(
        &mut sse,
        "response.output_item.added",
        json!({
            "type": "response.output_item.added",
            "sequence_number": 1,
            "output_index": 0,
            "item": item
        }),
    );
    push_sse(
        &mut sse,
        "response.output_item.done",
        json!({
            "type": "response.output_item.done",
            "sequence_number": 2,
            "output_index": 0,
            "item": item
        }),
    );
    push_sse(
        &mut sse,
        "response.completed",
        json!({
            "type": "response.completed",
            "sequence_number": 3,
            "response": response
        }),
    );
    sse.push_str("data: [DONE]\n\n");
    Some(sse.into_bytes())
}

fn incomplete_compaction_stream(body: &[u8]) -> Vec<u8> {
    let mut output = String::from_utf8_lossy(body)
        .into_owned()
        .replace("\r\n", "\n");
    if !output.is_empty() && !output.ends_with("\n\n") {
        if !output.ends_with('\n') {
            output.push('\n');
        }
        output.push('\n');
    }
    push_sse(
        &mut output,
        "response.failed",
        json!({
            "type": "response.failed",
            "response": {
                "id": "resp_compact_incomplete",
                "status": "failed",
                "error": {
                    "message": "remote compaction v2 stream closed before response.completed",
                    "type": "stream_error"
                }
            }
        }),
    );
    output.into_bytes()
}

fn native_compaction_unsupported_result(
    error: anyhow::Error,
) -> anyhow::Result<UpstreamProxyResponse> {
    if error
        .downcast_ref::<NativeCompactionUnsupported>()
        .is_some()
    {
        let body = json!({
            "error": {
                "message": error.to_string(),
                "type": "compaction_incompatible",
                "code": "native_compaction_unsupported"
            }
        });
        Ok(UpstreamProxyResponse {
            status_code: 400,
            content_type: "application/json".to_string(),
            is_stream: false,
            wire_api: UpstreamWireApi::Responses,
            compaction: false,
            native_compaction_passthrough: false,
            buffered_body: Some(serde_json::to_vec(&body).unwrap_or_default()),
            response: None,
            _channel_permit: None,
        })
    } else {
        Err(error)
    }
}

fn input_has_native_compaction(body: &Value) -> bool {
    let is_native =
        |item: &Value| item.get("type").and_then(Value::as_str) == Some(COMPACTION_OUTPUT_TYPE);
    match body.get("input") {
        Some(Value::Array(items)) => items.iter().any(is_native),
        Some(Value::Object(_)) => is_native(&body["input"]),
        _ => false,
    }
}

fn expand_compaction_item(item: &Value) -> Option<Value> {
    if item.get("type").and_then(Value::as_str) != Some(COMPACTION_OUTPUT_TYPE) {
        return None;
    }
    let encoded = item
        .get("encrypted_content")?
        .as_str()?
        .strip_prefix(LOCAL_COMPACTION_PREFIX)?;
    let summary: String = serde_json::from_str(encoded).ok()?;
    if summary.trim().is_empty() {
        return None;
    }
    let mut text = COMPACTION_REPLAY_PREFIX.to_string();
    text.push_str(&summary);
    Some(json!({
        "type": "message",
        "role": "user",
        "content": [{ "type": "input_text", "text": text }]
    }))
}

fn expand_local_compaction_history(body: &mut Value) {
    match body.get_mut("input") {
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(message) = expand_compaction_item(item) {
                    *item = message;
                }
            }
        }
        Some(input @ Value::Object(_)) => {
            if let Some(message) = expand_compaction_item(input) {
                *input = json!([message]);
            }
        }
        _ => {}
    }
}

pub fn is_image_generations_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/images/generations"
            | "/v1/images/generations"
            | "/v1/v1/images/generations"
            | "/codex/v1/images/generations"
    )
}

pub fn is_image_edits_proxy_path(path: &str) -> bool {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    matches!(
        path,
        "/images/edits" | "/v1/images/edits" | "/v1/v1/images/edits" | "/codex/v1/images/edits"
    )
}

pub async fn open_responses_proxy_request_for_path_with_beta(
    body: &str,
    original_user_agent: Option<&str>,
    request_path: &str,
    beta_features: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_for_path_with_session_headers(
        body,
        original_user_agent,
        request_path,
        beta_features,
        ProxySessionHeaders::default(),
    )
    .await
}

pub async fn open_responses_proxy_request_for_path_with_session_headers(
    body: &str,
    original_user_agent: Option<&str>,
    request_path: &str,
    beta_features: Option<&str>,
    session_headers: ProxySessionHeaders<'_>,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    open_responses_proxy_request_with_settings_and_user_agent(
        body,
        settings,
        original_user_agent,
        request_path,
        beta_features,
        session_headers,
    )
    .await
}

pub async fn open_responses_proxy_request_with_settings_for_path_and_beta(
    body: &str,
    settings: crate::settings::BackendSettings,
    request_path: &str,
    beta_features: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_with_settings_for_path_and_session_headers(
        body,
        settings,
        request_path,
        beta_features,
        ProxySessionHeaders::default(),
    )
    .await
}

pub async fn open_responses_proxy_request_with_settings_for_path_and_session_headers(
    body: &str,
    settings: crate::settings::BackendSettings,
    request_path: &str,
    beta_features: Option<&str>,
    session_headers: ProxySessionHeaders<'_>,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_responses_proxy_request_with_settings_and_user_agent(
        body,
        settings,
        None,
        request_path,
        beta_features,
        session_headers,
    )
    .await
}

fn aggregate_upstream_model_override(
    settings: &crate::settings::BackendSettings,
    relay: &crate::settings::RelayProfile,
) -> Option<String> {
    settings.active_aggregate_relay_profile()?;
    let model = crate::relay_config::relay_profile_model(relay);
    let model = model.trim();
    (!model.is_empty()).then(|| model.to_string())
}

pub async fn open_image_generations_proxy_request(
    body: &[u8],
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_image_proxy_request(
        body,
        "application/json",
        original_user_agent,
        ImageProxyEndpoint::Generations,
    )
    .await
}

pub async fn open_image_edits_proxy_request(
    body: &[u8],
    content_type: &str,
    original_user_agent: Option<&str>,
) -> anyhow::Result<UpstreamProxyResponse> {
    open_image_proxy_request(
        body,
        content_type,
        original_user_agent,
        ImageProxyEndpoint::Edits,
    )
    .await
}

async fn open_image_proxy_request(
    body: &[u8],
    content_type: &str,
    original_user_agent: Option<&str>,
    endpoint_kind: ImageProxyEndpoint,
) -> anyhow::Result<UpstreamProxyResponse> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let relay = crate::relay_rotation::select_relay_for_probe(&settings)?;
    let base_url = if relay.upstream_base_url.trim().is_empty() {
        crate::relay_config::relay_profile_base_url(&relay)
    } else {
        relay.upstream_base_url.trim().to_string()
    };
    if is_local_protocol_proxy_base_url(&base_url) {
        anyhow::bail!("图片上游 Base URL 不能指向本地协议代理");
    }
    if base_url.trim().is_empty() {
        anyhow::bail!("图片上游 Base URL 不能为空");
    }
    if relay.api_key.trim().is_empty() && !relay.uses_no_auth() {
        anyhow::bail!("图片上游 Key 不能为空");
    }
    let content_type = content_type.trim();
    let content_type = if content_type.is_empty() {
        match endpoint_kind {
            ImageProxyEndpoint::Generations => "application/json",
            ImageProxyEndpoint::Edits => {
                anyhow::bail!("图片 edits 请求缺少 Content-Type");
            }
        }
    } else {
        content_type
    };
    let endpoint = endpoint_kind.url(&base_url);
    let wire_api = endpoint_kind.wire_api();
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "protocol_proxy.image_request",
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "endpoint": endpoint,
            "wireApi": wire_api,
            "bodyBytes": body.len(),
            "endpointKind": endpoint_kind.name()
        }),
    );
    let request = crate::http_client::proxied_client(&effective_user_agent(
        &relay.user_agent,
        original_user_agent,
    ))?
    .post(endpoint)
    .header(reqwest::header::CONTENT_TYPE, content_type)
    .body(body.to_vec());
    let upstream = send_upstream_request_with_header_timeout(
        with_relay_auth(request, &relay),
        UPSTREAM_IMAGE_HEADER_TIMEOUT,
    )
    .await?;
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
        wire_api,
        compaction: false,
        native_compaction_passthrough: false,
        buffered_body: None,
        response: Some(upstream),
        _channel_permit: None,
    })
}

fn with_relay_auth(
    request: reqwest::RequestBuilder,
    relay: &crate::settings::RelayProfile,
) -> reqwest::RequestBuilder {
    // 认证（API Key / 无认证）+ 供应商自定义请求头，统一在 relay_headers 里决定优先级。
    crate::relay_headers::apply(request, relay)
}

fn with_client_session_headers(
    mut builder: reqwest::RequestBuilder,
    relay: &crate::settings::RelayProfile,
    headers: ProxySessionHeaders<'_>,
) -> reqwest::RequestBuilder {
    for (name, value) in [
        ("session-id", headers.session_id),
        ("thread-id", headers.thread_id),
        ("x-opencode-session", headers.opencode_session),
    ] {
        // 显式供应商配置优先，避免 reqwest 追加出两个同名头。
        if relay
            .custom_headers
            .iter()
            .any(|header| header.key.trim().eq_ignore_ascii_case(name))
        {
            continue;
        }
        let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            continue;
        };
        if let Ok(value) = reqwest::header::HeaderValue::from_str(value) {
            builder = builder.header(name, value);
        }
    }
    builder
}

pub fn image_generations_url(base_url: &str) -> String {
    image_endpoint_url(base_url, "generations")
}

pub fn image_edits_url(base_url: &str) -> String {
    image_endpoint_url(base_url, "edits")
}

fn image_endpoint_url(base_url: &str, endpoint: &str) -> String {
    let skip_version_prefix = base_url.trim().ends_with('#');
    let base = base_url.trim().trim_end_matches('#').trim_end_matches('/');
    if base
        .to_ascii_lowercase()
        .ends_with(&format!("/images/{endpoint}"))
    {
        return base.to_string();
    }
    let origin_only = base
        .split_once("://")
        .map_or(!base.contains('/'), |(_, rest)| !rest.contains('/'));
    let mut url = if skip_version_prefix || has_version_suffix(base) || !origin_only {
        format!("{base}/images/{endpoint}")
    } else {
        format!("{base}/v1/images/{endpoint}")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

fn is_local_protocol_proxy_base_url(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url.trim()) else {
        return false;
    };
    if !url.scheme().eq_ignore_ascii_case("http") || url.port() != Some(protocol_proxy_port()) {
        return false;
    }
    matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "::1" | "[::1]")
    )
}

fn response_id_body(response_id: &str) -> &str {
    response_id
        .strip_prefix("resp_")
        .filter(|value| !value.is_empty())
        .unwrap_or(response_id)
}

pub fn normalize_responses_item_ids_for_test(body: &mut Value) {
    normalize_responses_item_ids(body);
}

fn normalize_legacy_custom_item_ids(body: &mut Value) {
    if let Some(items) = body.get_mut("input").and_then(Value::as_array_mut) {
        for item in items {
            let prefix = match item["type"].as_str() {
                Some("custom_tool_call") => "ctc_",
                Some("custom_tool_call_output") => "ctco_",
                _ => continue,
            };
            if let Some(id) = item["id"].as_str().and_then(|id| id.strip_prefix("fc_")) {
                item["id"] = json!(format!("{prefix}{id}"));
            }
        }
    }
}

fn normalize_responses_item_ids(body: &mut Value) {
    let Some(input) = body.get_mut("input") else {
        return;
    };
    match input {
        Value::Array(items) => {
            for item in items {
                normalize_responses_item_id(item);
            }
        }
        Value::Object(_) => normalize_responses_item_id(input),
        _ => {}
    }
}

fn normalize_responses_item_id(item: &mut Value) {
    let Some(item_type) = item.get("type").and_then(Value::as_str) else {
        return;
    };
    let Some((_, prefix)) = RESPONSES_ITEM_ID_PREFIXES
        .iter()
        .find(|(kind, _)| *kind == item_type)
    else {
        return;
    };
    let Some(id) = item.get("id").and_then(Value::as_str) else {
        return;
    };
    // 只有「前缀 + 非空后缀」才算已经合规。id 恰好等于前缀本身（`fc_`）是空壳，
    // 放它过去会直接触发上游的 invalid_id_prefix，所以落到下面按 call_id 重建。
    if id.len() > prefix.len() && id.starts_with(prefix) {
        return;
    }
    // 剥掉 id 上现有的前缀再换新的。取**最长**匹配：`fc_` 是 `fco_` 的前缀，
    // 先撞上短的会把 `fco_call_a` 剥成 `call_a` 再换成 `fc_call_a`，
    // 把 function_call_output 错改成 function_call。
    // `item_` 是历史版本 Alunixa X 自己造的前缀；`cp_` 来自压缩项错误使用
    // `cp_{response_id}` 的版本；`resp_` 来自历史版本把 message item 命名成
    // `{response_id}_msg`（#1431 / #1781），都要一并剥掉。
    let suffix = ["item_", "cp_", "resp_"]
        .into_iter()
        .chain(RESPONSES_ITEM_ID_PREFIXES.iter().map(|(_, known)| *known))
        .filter_map(|known| id.strip_prefix(known).map(|rest| (known.len(), rest)))
        .max_by_key(|(len, _)| *len)
        .map(|(_, rest)| rest)
        .unwrap_or(id);
    // 剥完是空串说明 id 恰好只由某个前缀组成，退回 call_id，再退回原 id。
    let suffix = if suffix.is_empty() {
        item.get("call_id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or(id)
    } else {
        suffix
    };
    item["id"] = json!(format!("{prefix}{suffix}"));
}

fn orphan_tool_output_message(call_id: &str, output: &Value) -> Value {
    // 这条已经是 user 消息，multi-part 图片可以直接内联，不必走 relocate。
    if let Value::Array(parts) = tool_output_content(output) {
        let mut content = vec![json!({
            "type": "text",
            "text": format!("Function call output ({call_id}):")
        })];
        content.extend(parts);
        return json!({ "role": "user", "content": content });
    }
    json!({
        "role": "user",
        "content": format!(
            "Function call output ({call_id}): {}",
            response_output_text(output)
        )
    })
}

fn relocate_interleaved_non_tool_messages(messages: &mut Vec<Value>) {
    let mut index = 0;
    while index < messages.len() {
        let Some(tool_calls) = messages[index].get("tool_calls").and_then(Value::as_array) else {
            index += 1;
            continue;
        };
        let mut unanswered: BTreeSet<String> = tool_calls
            .iter()
            .filter_map(|tool_call| tool_call.get("id").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        if unanswered.is_empty() {
            index += 1;
            continue;
        }

        // 从本条 assistant 往后扫，收集本轮的所有 tool 结果与夹在其中的非 tool 消息，
        // 直到 tool_call 集合配齐、撞上下一条 assistant（新轮次，不能越界）、或到底。
        let mut tool_messages: Vec<Value> = Vec::new();
        let mut interleaved: Vec<Value> = Vec::new();
        let mut scan = index + 1;
        while scan < messages.len() {
            let role = messages[scan].get("role").and_then(Value::as_str);
            if role == Some("assistant") {
                break;
            }
            if role == Some("tool") {
                if let Some(id) = messages[scan].get("tool_call_id").and_then(Value::as_str) {
                    unanswered.remove(id);
                }
                tool_messages.push(messages[scan].clone());
            } else if !tool_messages.is_empty() {
                // 只有已经收到过 tool 结果之后的夹心才值得搬：
                // 本条 assistant 尚未收到任何结果时，中间的消息是正常历史，不是夹心。
                interleaved.push(messages[scan].clone());
            }
            scan += 1;
            if unanswered.is_empty() {
                break;
            }
        }

        if interleaved.is_empty() {
            index += 1;
            continue;
        }

        // 重建这段区间：tool 结果。配齐时）在前、夹心消息在后。
        let rebuilt: Vec<Value> = tool_messages.into_iter().chain(interleaved).collect();
        let rebuilt_len = rebuilt.len();
        messages.splice(index + 1..scan, rebuilt);
        // 跳过刚重建的区间，避免在搬动过的消息上重复扫描导致死循环。
        index += 1 + rebuilt_len;
    }
}

fn degrade_unpaired_tool_messages(messages: &mut [Value]) {
    let mut known: BTreeSet<String> = BTreeSet::new();
    for message in messages.iter() {
        if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
            for tool_call in tool_calls {
                if let Some(id) = tool_call.get("id").and_then(Value::as_str) {
                    known.insert(id.to_string());
                }
            }
        }
    }

    for message in messages.iter_mut() {
        if message.get("role").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        let paired = message
            .get("tool_call_id")
            .and_then(Value::as_str)
            .is_some_and(|id| known.contains(id));
        if paired {
            continue;
        }
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        *message = json!({
            "role": "user",
            "content": content
        });
    }
}

fn enforce_tool_call_pairing(messages: &mut [Value]) {
    let mut index = 0;
    while index < messages.len() {
        if messages[index].get("role").and_then(Value::as_str) != Some("assistant") {
            index += 1;
            continue;
        }
        let Some(tool_calls) = messages[index].get("tool_calls").and_then(Value::as_array) else {
            index += 1;
            continue;
        };
        if tool_calls.is_empty() {
            index += 1;
            continue;
        }

        // 收集紧跟其后的 tool 消息所应答的 id
        let mut answered = BTreeSet::new();
        let mut followers = 0;
        for message in messages[index + 1..]
            .iter()
            .take_while(|message| message.get("role").and_then(Value::as_str) == Some("tool"))
        {
            followers += 1;
            if let Some(id) = message.get("tool_call_id").and_then(Value::as_str) {
                answered.insert(id.to_string());
            }
        }

        // 位于历史尾部的 tool_call 是「刚发起、output 还没回来」的正常形态，
        // 上游本就期待它；只有序列越过了它却没应答才是非法的。
        if index + 1 + followers >= messages.len() {
            index += 1;
            continue;
        }

        let (kept, orphaned): (Vec<Value>, Vec<Value>) =
            tool_calls.iter().cloned().partition(|tool_call| {
                tool_call
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| answered.contains(id))
            });
        if orphaned.is_empty() {
            index += 1;
            continue;
        }

        let notes = orphaned
            .iter()
            .map(|tool_call| {
                let name = tool_call
                    .get("function")
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let id = tool_call.get("id").and_then(Value::as_str).unwrap_or("");
                format!("Abandoned function call ({id}): {name}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        if kept.is_empty() {
            if let Some(message) = messages[index].as_object_mut() {
                message.remove("tool_calls");
            }
        } else {
            messages[index]["tool_calls"] = json!(kept);
        }
        append_text_to_assistant_message(&mut messages[index], &notes);
        index += 1;
    }
}

fn relocate_tool_output_images(messages: &mut Vec<Value>) {
    let mut index = 0;
    while index < messages.len() {
        if messages[index].get("role").and_then(Value::as_str) != Some("tool") {
            index += 1;
            continue;
        }
        let mut images = Vec::new();
        let mut end = index;
        while end < messages.len()
            && messages[end].get("role").and_then(Value::as_str) == Some("tool")
        {
            take_images_from_tool_message(&mut messages[end], &mut images);
            end += 1;
        }
        if !images.is_empty() {
            let mut content = vec![json!({
                "type": "text",
                "text": "Images returned by the tool call(s) above:"
            })];
            content.append(&mut images);
            messages.insert(end, json!({ "role": "user", "content": content }));
            end += 1;
        }
        index = end;
    }
}

fn take_images_from_tool_message(message: &mut Value, images: &mut Vec<Value>) {
    let Some(parts) = message.get("content").and_then(Value::as_array) else {
        return;
    };

    let mut texts = Vec::new();
    let mut found = Vec::new();
    for part in parts {
        if is_image_part(part) {
            if let Some(image) = image_part_to_chat(part) {
                found.push(image);
            }
            continue;
        }
        if let Some(text) = part.get("text").and_then(Value::as_str)
            && !text.is_empty()
        {
            texts.push(text.to_string());
        }
    }
    if found.is_empty() {
        return;
    }

    let placeholder = if found.len() == 1 {
        "[image]".to_string()
    } else {
        format!("[{} images]", found.len())
    };
    message["content"] = json!(if texts.is_empty() {
        placeholder
    } else {
        format!("{}\n{placeholder}", texts.join("\n"))
    });
    images.append(&mut found);
}

fn append_text_to_assistant_message(message: &mut Value, text: &str) {
    if text.is_empty() {
        return;
    }
    let existing = match message.get("content") {
        Some(Value::String(content)) => content.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    };
    message["content"] = if existing.trim().is_empty() {
        json!(text)
    } else {
        json!(format!("{existing}\n{text}"))
    };
}

fn ensure_tool_call_reasoning_content(messages: &mut [Value]) {
    for message in messages {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let has_tool_calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some_and(|tool_calls| !tool_calls.is_empty());
        if !has_tool_calls {
            continue;
        }
        let has_content = message
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|content| !content.trim().is_empty());
        let has_reasoning = message
            .get("reasoning_content")
            .and_then(Value::as_str)
            .is_some_and(|reasoning| !reasoning.trim().is_empty());
        if has_content || has_reasoning {
            continue;
        }
        message["reasoning_content"] = json!("Calling the requested tool.");
    }
}

fn system_message_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

fn is_image_part(part: &Value) -> bool {
    matches!(
        part.get("type").and_then(Value::as_str),
        Some("input_image") | Some("image_url")
    )
}

fn image_part_to_chat(part: &Value) -> Option<Value> {
    if !is_image_part(part) {
        return None;
    }
    let raw = part.get("image_url")?;
    let image_url = if raw.is_object() {
        raw.clone()
    } else {
        json!({ "url": raw.as_str().unwrap_or_default() })
    };
    if image_url
        .get("url")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return None;
    }
    Some(json!({ "type": "image_url", "image_url": image_url }))
}

fn flatten_top_level_combinators(schema: Value) -> Value {
    let Some(object) = schema.as_object() else {
        return schema;
    };
    let Some((key, branches)) = SCHEMA_COMBINATOR_KEYS.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_array)
            .map(|a| (*key, a))
    }) else {
        return schema;
    };
    if branches.is_empty() {
        return schema;
    }

    // 分支常是裸 `$ref`（`{ "$ref": "#/$defs/__schema0" }`），它自己不带 `$defs`，
    // 所以必须拿**父级**的 $defs 来解析——只对分支单独调 inline_ref_siblings
    // 永远解析不出来（实测：分支落进降级路径，properties 为空）。
    let defs = object.get("$defs").and_then(Value::as_object);

    let mut properties = Map::new();
    let mut required: Option<BTreeSet<String>> = None;
    let mut flattenable = true;

    for branch in branches {
        let normalized = match resolve_local_definition(
            branch
                .get("$ref")
                .and_then(Value::as_str)
                .and_then(local_definition_name)
                .unwrap_or(""),
            defs,
            &mut Vec::new(),
        ) {
            // 分支是裸 $ref：用父级 $defs 解析出真实 schema。
            Ok(Some(resolved)) if branch.as_object().is_some_and(|o| o.len() == 1) => {
                normalize_schema_value(&resolved, defs, &mut Vec::new()).unwrap_or(resolved)
            }
            _ => inline_ref_siblings(branch),
        };
        let Some(branch_object) = normalized.as_object() else {
            flattenable = false;
            break;
        };
        let branch_properties = branch_object.get("properties").and_then(Value::as_object);
        let branch_required: BTreeSet<String> = branch_object
            .get("required")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        // 分支没有 properties 时（例如 type:"string"）无法并入对象 schema。
        if branch_properties.is_none() && !branch_required.is_empty() {
            flattenable = false;
            break;
        }
        for (name, value) in branch_properties.into_iter().flatten() {
            merge_schema_property(&mut properties, name, value);
        }
        required = Some(match required {
            None => branch_required,
            Some(current) => current.intersection(&branch_required).cloned().collect(),
        });
    }

    if !flattenable || properties.is_empty() {
        // 降级：把分支原样塞进一个带说明的字段，schema 依然合法。
        let mut fallback = object.clone();
        fallback.insert("type".to_string(), json!("object"));
        fallback.insert("properties".to_string(), json!({}));
        let mut description: Vec<String> = Vec::new();
        for branch in branches {
            if let Some(text) = branch.get("description").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    description.push(text.trim().to_string());
                }
            }
        }
        fallback.insert(
            "x-merged-combinator".to_string(),
            json!({
                "kind": key,
                "branches": branches,
                "description": description.join("\n")
            }),
        );
        for combinator in SCHEMA_COMBINATOR_KEYS {
            fallback.remove(combinator);
        }
        return Value::Object(fallback);
    }

    let mut flattened = object.clone();
    for combinator in SCHEMA_COMBINATOR_KEYS {
        flattened.remove(combinator);
    }
    flattened.insert("type".to_string(), json!("object"));
    flattened.insert("properties".to_string(), Value::Object(properties));
    flattened.insert(
        "required".to_string(),
        json!(required.unwrap_or_default().into_iter().collect::<Vec<_>>()),
    );
    Value::Object(flattened)
}

fn merge_schema_property(properties: &mut Map<String, Value>, name: &str, value: &Value) {
    let Some(existing) = properties.get_mut(name) else {
        properties.insert(name.to_string(), value.clone());
        return;
    };
    let (Some(left), Some(right)) = (existing.as_object(), value.as_object()) else {
        return;
    };
    if left.get("properties").is_none() || right.get("properties").is_none() {
        return;
    }
    let mut merged = left.clone();
    let mut merged_properties = left
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (child_name, child_value) in right
        .get("properties")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        merge_schema_property(&mut merged_properties, child_name, child_value);
    }
    merged.insert("properties".to_string(), Value::Object(merged_properties));

    let left_required: BTreeSet<String> = left
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let right_required: BTreeSet<String> = right
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    merged.insert(
        "required".to_string(),
        json!(
            left_required
                .intersection(&right_required)
                .cloned()
                .collect::<Vec<_>>()
        ),
    );
    *existing = Value::Object(merged);
}

fn inline_ref_siblings(root: &Value) -> Value {
    let defs = root.get("$defs").and_then(Value::as_object);
    let mut resolving = Vec::new();
    normalize_schema_value(root, defs, &mut resolving).unwrap_or_else(|_| root.clone())
}

fn normalize_schema_value(
    node: &Value,
    defs: Option<&Map<String, Value>>,
    resolving: &mut Vec<String>,
) -> Result<Value, LocalRefNormalizationError> {
    match node {
        Value::Array(items) => Ok(Value::Array(
            items
                .iter()
                .map(|item| normalize_schema_value(item, defs, resolving))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        Value::Object(object) => normalize_schema_object(object, defs, resolving),
        _ => Ok(node.clone()),
    }
}

fn normalize_schema_object(
    object: &Map<String, Value>,
    defs: Option<&Map<String, Value>>,
    resolving: &mut Vec<String>,
) -> Result<Value, LocalRefNormalizationError> {
    if object.len() > 1
        && let Some(reference) = object.get("$ref").and_then(Value::as_str)
        && let Some(name) = local_definition_name(reference)
    {
        match resolve_local_definition(name, defs, resolving)? {
            Some(Value::Object(mut merged)) if merged.get("$ref").is_none() => {
                for (key, value) in object {
                    if key != "$ref" {
                        merged.insert(key.clone(), normalize_schema_value(value, defs, resolving)?);
                    }
                }
                return Ok(Value::Object(merged));
            }
            Some(_) | None => {}
        }
    }

    let mut normalized = Map::new();
    for (key, value) in object {
        // JSON Schema 的 type 必须是字符串，null 恒非法，剥掉等价于未声明。
        if key == "type" && value.is_null() {
            continue;
        }
        normalized.insert(key.clone(), normalize_schema_value(value, defs, resolving)?);
    }
    Ok(Value::Object(normalized))
}

fn resolve_local_definition(
    name: &str,
    defs: Option<&Map<String, Value>>,
    resolving: &mut Vec<String>,
) -> Result<Option<Value>, LocalRefNormalizationError> {
    let Some(defs) = defs else {
        return Ok(None);
    };
    let Some(target) = defs.get(name) else {
        return Ok(None);
    };
    if resolving.iter().any(|current| current == name) {
        return Err(LocalRefNormalizationError::Cycle);
    }

    resolving.push(name.to_string());
    let resolved = if let Some(alias) = bare_local_ref_name(target) {
        resolve_local_definition(alias, Some(defs), resolving)
    } else {
        normalize_schema_value(target, Some(defs), resolving).map(Some)
    };
    resolving.pop();
    resolved
}

fn bare_local_ref_name(node: &Value) -> Option<&str> {
    let object = node.as_object()?;
    if object.len() != 1 {
        return None;
    }
    local_definition_name(object.get("$ref")?.as_str()?)
}

fn local_definition_name(reference: &str) -> Option<&str> {
    let name = reference.strip_prefix("#/$defs/")?;
    if name.is_empty() || name.contains('/') {
        return None;
    }
    Some(name)
}

fn collect_tool_search_output_namespaces(body: &Value) -> Vec<Value> {
    let mut collected: Vec<Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let Some(items) = body.get("input").and_then(Value::as_array) else {
        return collected;
    };

    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("tool_search_output") {
            continue;
        }
        let Some(tools) = item.get("tools").and_then(Value::as_array) else {
            continue;
        };
        for tool in tools {
            let Some(name) = tool
                .get("name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            if seen.insert(name.to_string()) {
                collected.push(tool.clone());
            }
        }
    }

    collected
}

fn dedup_chat_tools_by_name(tools: &mut Vec<Value>) {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    tools.retain(|tool| {
        match tool
            .get("function")
            .and_then(|function| function.get("name"))
            .and_then(Value::as_str)
        {
            Some(name) => seen.insert(name.to_string()),
            None => true,
        }
    });
}

fn web_search_item_id(call_id: &str) -> String {
    format!("ws_{call_id}")
}

fn web_search_action_from_arguments(arguments: &str) -> Value {
    let parsed = responses_arguments_to_chat_parse(arguments);
    let query = parsed
        .get("query")
        .and_then(Value::as_str)
        .or_else(|| parsed.get("input").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty());
    let url = parsed
        .get("url")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    if let Some(url) = url {
        return json!({ "type": "open_page", "url": url });
    }
    let queries = parsed
        .get("queries")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| json!(value))
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty());
    match (query, queries) {
        (Some(query), Some(queries)) => {
            json!({ "type": "search", "query": query, "queries": queries })
        }
        (Some(query), None) => json!({ "type": "search", "query": query }),
        (None, Some(queries)) => {
            let first = queries
                .first()
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            json!({ "type": "search", "query": first, "queries": queries })
        }
        (None, None) => json!({ "type": "search" }),
    }
}

fn web_search_action_has_target(action: &Value) -> bool {
    action
        .get("query")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
        || action
            .get("queries")
            .and_then(Value::as_array)
            .is_some_and(|queries| {
                queries
                    .iter()
                    .any(|query| query.as_str().is_some_and(|value| !value.trim().is_empty()))
            })
        || action
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
}

fn invalid_web_search_output_item(item: &Value) -> bool {
    item.get("type").and_then(Value::as_str) == Some("web_search_call")
}

fn tool_call_item_id(call_id: &str, name: &str, tool_context: &CodexToolContext) -> String {
    if tool_context.is_builtin_web_search_proxy(name) {
        return web_search_item_id(call_id);
    }
    let prefix = if tool_context.is_custom_tool_proxy(name) {
        if tool_context.is_tool_search_proxy(name) {
            // 官方客户端给 tool_search_call 分配的 item id 前缀（见 codex id_prefix）。
            return format!("tsc_{call_id}");
        }
        "ctc_"
    } else {
        "fc_"
    };
    format!("{prefix}{call_id}")
}

fn upstream_needs_bare_base64(model: &str) -> bool {
    let model = model.to_ascii_lowercase();
    model.starts_with("glm-") || model.starts_with("zhipu") || model.contains("/glm-")
}

fn normalize_image_data_urls_for_model(messages: &mut [Value], model: &str) {
    if !upstream_needs_bare_base64(model) {
        return;
    }
    for message in messages.iter_mut() {
        let Some(parts) = message.get_mut("content").and_then(Value::as_array_mut) else {
            continue;
        };
        for part in parts.iter_mut() {
            if !is_image_part(part) {
                continue;
            }
            let Some(url) = part
                .get_mut("image_url")
                .and_then(|value| {
                    if value.is_object() {
                        value.get_mut("url")
                    } else {
                        Some(value)
                    }
                })
                .and_then(|value| value.as_str().map(str::to_string))
            else {
                continue;
            };
            let Some(bare) = strip_data_url_prefix(&url) else {
                continue;
            };
            let target = part.get_mut("image_url").expect("checked above");
            if target.is_object() {
                target["url"] = json!(bare);
            } else {
                *target = json!(bare);
            }
        }
    }
}

fn strip_data_url_prefix(url: &str) -> Option<String> {
    let rest = url.strip_prefix(IMAGE_DATA_URL_PREFIX)?;
    let (_, payload) = rest.split_once(";base64,")?;
    Some(payload.to_string())
}

fn redact_image_data_urls(text: &str) -> Option<String> {
    if !text.contains(IMAGE_DATA_URL_PREFIX) {
        return None;
    }
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find(IMAGE_DATA_URL_PREFIX) {
        out.push_str(&rest[..start]);
        out.push_str("[image omitted]");
        let tail = &rest[start..];
        // data URL 由 base64 字母表加少量分隔符组成，遇到其它字符即结束。
        let end = tail
            .find(|c: char| {
                !(c.is_ascii_alphanumeric()
                    || matches!(c, '+' | '/' | '=' | ':' | ';' | ',' | '.' | '-' | '_'))
            })
            .unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    Some(out)
}

fn guard_inline_image_data_urls(value: &mut Value) -> bool {
    match value {
        Value::Object(map) => {
            let mut hit = false;
            for (key, child) in map.iter_mut() {
                // image_url 子树是图片的合法归宿，跳过。
                if key == "image_url" {
                    continue;
                }
                hit |= guard_inline_image_data_urls(child);
            }
            hit
        }
        Value::Array(items) => {
            let mut hit = false;
            for item in items {
                hit |= guard_inline_image_data_urls(item);
            }
            hit
        }
        Value::String(text) => match redact_image_data_urls(text) {
            Some(cleaned) => {
                *text = cleaned;
                true
            }
            None => false,
        },
        _ => false,
    }
}

fn responses_arguments_to_chat_parse(arguments: &str) -> Value {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return json!({});
    }
    serde_json::from_str(trimmed).unwrap_or_else(|_| json!({}))
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

fn is_kimi_coding_model(model: &str) -> bool {
    let model = model.to_ascii_lowercase();
    model.starts_with("k3") || model.contains("kimi-k3") || model.contains("for-coding")
}

fn kimi_thinking_enabled_type(model: &str) -> &'static str {
    if is_kimi_coding_model(model) {
        "adaptive"
    } else {
        "enabled"
    }
}

pub struct CompactionSseConverter {
    response_id: String,
    compaction_id: String,
    model: String,
    summary: String,
    final_summary: Option<String>,
    failed: Option<(String, Option<String>)>,
    /// 跨网络 chunk 攒 SSE 事件的缓冲（见 push_upstream_bytes）。
    sse_buffer: String,
    sse_utf8_remainder: Vec<u8>,
    responses_wire: bool,
}

impl CompactionSseConverter {
    pub fn new(model: &str) -> Self {
        Self {
            response_id: format!("resp_compact_{}", chrono_now_millis()),
            compaction_id: format!("cmp_{}", uuid::Uuid::new_v4().simple()),
            model: model.to_string(),
            summary: String::new(),
            final_summary: None,
            failed: None,
            sse_buffer: String::new(),
            sse_utf8_remainder: Vec::new(),
            responses_wire: true,
        }
    }

    /// 标记上游是 Chat Completions（SSE chunk 的增量在 `choices[].delta.content`）。
    /// Responses 上游默认，增量在 `response.output_text.delta` 事件里。
    pub fn with_chat_upstream(mut self) -> Self {
        self.responses_wire = false;
        self
    }

    /// 追加上游输出的一块文本内容（非流式路径直接喂完整摘要）。
    pub fn push_summary_text(&mut self, text: &str) {
        self.summary.push_str(text);
    }

    /// 当前已收集的原始摘要文本（剥 think 之前），供空摘要判定。
    pub fn summary_text(&self) -> &str {
        &self.summary
    }

    /// 喂入上游流式响应的一个网络 chunk。SSE 事件可能被 TCP 拆开，
    /// 内部按 `\n\n` 边界缓冲；残缺块留在缓冲区等下一个 chunk。
    pub fn push_upstream_bytes(&mut self, bytes: &[u8]) {
        if let Err(error) =
            append_utf8_safe(&mut self.sse_buffer, &mut self.sse_utf8_remainder, bytes)
        {
            self.fail(error.to_string(), Some("invalid_utf8".into()));
            return;
        }
        while let Some(block) = take_sse_block(&mut self.sse_buffer) {
            if block.trim().is_empty() {
                continue;
            }
            self.handle_upstream_sse_block(&block);
        }
    }

    fn handle_upstream_sse_block(&mut self, block: &str) {
        let mut event_name = "";
        let mut data_parts: Vec<&str> = Vec::new();
        for line in block.lines() {
            if let Some(event) = strip_sse_field(line, "event") {
                event_name = event.trim();
            }
            if let Some(data) = strip_sse_field(line, "data") {
                data_parts.push(data);
            }
        }
        if data_parts.is_empty() {
            return;
        }
        let data = data_parts.join("\n");
        if data.trim() == "[DONE]" {
            return;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(&data) else {
            return;
        };
        let event_type = chunk
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or(event_name);
        if matches!(
            event_type,
            "response.failed" | "response.incomplete" | "error"
        ) || chunk.get("error").is_some_and(|error| !error.is_null())
        {
            let error = chunk
                .pointer("/response/error")
                .or_else(|| chunk.get("error"));
            self.fail(
                error
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Compaction upstream stream failed or was incomplete")
                    .to_string(),
                error
                    .and_then(|error| error.get("code"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
            );
            return;
        }
        if self.responses_wire {
            match event_type {
                // Responses 流优先读取正文增量，排除携带同名 delta 字段的推理事件。
                "response.output_text.delta" => {
                    if let Some(delta) = chunk.get("delta").and_then(Value::as_str) {
                        self.summary.push_str(delta);
                    }
                }
                // 部分兼容实现不发送 delta，只在完成事件里携带完整正文。
                "response.output_text.done" => {
                    self.capture_final_summary(chunk.get("text"));
                }
                "response.content_part.done" => {
                    self.capture_final_summary(chunk.pointer("/part/text"));
                }
                "response.output_item.done" => {
                    let text = chunk
                        .get("item")
                        .map(extract_summary_text_from_response_item)
                        .unwrap_or_default();
                    self.capture_final_summary(Some(&json!(text)));
                }
                "response.completed" => {
                    let text = chunk
                        .get("response")
                        .map(extract_summary_text_from_responses)
                        .unwrap_or_default();
                    self.capture_final_summary(Some(&json!(text)));
                }
                _ => {}
            }
        } else if let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        {
            if let Some(content) = choice
                .get("delta")
                .and_then(|delta| delta.get("content"))
                .and_then(Value::as_str)
            {
                self.summary.push_str(content);
            }
            self.capture_final_summary(
                choice
                    .get("message")
                    .and_then(|message| message.get("content")),
            );
        }
    }

    fn capture_final_summary(&mut self, text: Option<&Value>) {
        let Some(text) = text
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        else {
            return;
        };
        self.final_summary = Some(text.to_string());
    }

    pub fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        self.failed = Some((message, error_type));
        Vec::new()
    }

    /// 收尾：产出完整的 compaction 响应 SSE。
    /// 链式推理上游（DeepSeek thinking 等）会把推理过程以 `<think>` 块
    /// 混进正文，这里统一剥掉首部完整 think 块，只保留真正的摘要答案；
    /// think 块未闭合（上游截断）时整个丢弃——剩下的只有推理残片。
    pub fn finish(mut self) -> Vec<u8> {
        if let Some(final_summary) = self.final_summary.take() {
            self.summary = final_summary;
        }
        if let Some((_reasoning, answer)) = split_leading_think_block(&self.summary) {
            self.summary = answer;
        } else if self.summary.trim_start().starts_with(THINK_OPEN_TAG) {
            self.summary = String::new();
        }
        self.summary = self.summary.trim().to_string();
        // 剥掉 think 块后为空（上游空输出、纯推理文本、截断导致块未闭合），
        // 一律按失败返回，避免向 codex 交付 `completed + 空 encrypted_content`
        // 的空 checkpoint 静默清空会话。
        if self.failed.is_none() && self.summary.is_empty() {
            self.failed = Some((
                "上游返回了空摘要，无法完成压缩".to_string(),
                Some("compaction_empty_summary".to_string()),
            ));
        }
        let mut output = String::new();
        let mut response = json!({
            "id": self.response_id,
            "object": "response",
            "created_at": chrono_now_millis() / 1000,
            "status": "in_progress",
            "model": self.model,
            "output": [],
            "usage": default_responses_usage()
        });
        push_sse(
            &mut output,
            "response.created",
            json!({"type": "response.created", "sequence_number": 0, "response": response}),
        );
        if let Some((message, error_type)) = self.failed {
            response["status"] = json!("failed");
            response["error"] = json!({
                "code": error_type.unwrap_or_else(|| "compaction_failed".to_string()),
                "message": message
            });
            push_sse(
                &mut output,
                "response.failed",
                json!({"type": "response.failed", "sequence_number": 1, "response": response}),
            );
            output.push_str("data: [DONE]\n\n");
            return output.into_bytes();
        }
        let compaction_item = json!({
            "id": self.compaction_id,
            "type": COMPACTION_OUTPUT_TYPE,
            "encrypted_content": format!("{LOCAL_COMPACTION_PREFIX}{}", json!(self.summary))
        });
        for (sequence_number, event_type) in [
            (1, "response.output_item.added"),
            (2, "response.output_item.done"),
        ] {
            push_sse(
                &mut output,
                event_type,
                json!({
                    "type": event_type,
                    "sequence_number": sequence_number,
                    "output_index": 0,
                    "item": compaction_item
                }),
            );
        }
        response["status"] = json!("completed");
        response["output"] = json!([compaction_item]);
        push_sse(
            &mut output,
            "response.completed",
            json!({
                "type": "response.completed",
                "sequence_number": 3,
                "response": response
            }),
        );
        output.push_str("data: [DONE]\n\n");
        output.into_bytes()
    }
}

#[derive(Clone, Copy, Default)]

pub struct ProxySessionHeaders<'a> {
    pub session_id: Option<&'a str>,
    pub thread_id: Option<&'a str>,
    pub opencode_session: Option<&'a str>,
}

#[derive(Debug)]

struct ExtraContentCache {
    entries: BTreeMap<String, Value>,
    order: VecDeque<String>,
    capacity: usize,
}

impl ExtraContentCache {
    fn new(capacity: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }

    fn remember(&mut self, call_id: &str, extra_content: Value) {
        if call_id.is_empty() {
            return;
        }
        if self
            .entries
            .insert(call_id.to_string(), extra_content)
            .is_none()
        {
            self.order.push_back(call_id.to_string());
        }
        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                // 只有仍是最旧那一条时才删，避免把刚更新过的键误删。
                if !self.order.contains(&oldest) {
                    self.entries.remove(&oldest);
                }
            }
        }
    }

    fn recall(&self, call_id: &str) -> Option<Value> {
        self.entries.get(call_id).cloned()
    }
}

#[derive(Default)]

pub(crate) struct NativeResponsesSseObserver {
    event_prefix: Vec<u8>,
    event_tail: [u8; 4],
    event_too_large: bool,
    unclassified_large_event: bool,
    completed: bool,
    failure: Option<&'static str>,
}

impl NativeResponsesSseObserver {
    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if self.event_prefix.len() < NATIVE_SSE_DIAGNOSTIC_PREFIX_LIMIT {
                self.event_prefix.push(*byte);
            } else {
                self.event_too_large = true;
            }
            self.event_tail.rotate_left(1);
            self.event_tail[3] = *byte;
            if self.event_tail.ends_with(b"\n\n") || self.event_tail == *b"\r\n\r\n" {
                self.observe_event();
                self.event_prefix.clear();
                self.event_tail = [0; 4];
                self.event_too_large = false;
            }
        }
    }

    fn observe_event(&mut self) {
        let prefix = String::from_utf8_lossy(&self.event_prefix);
        let event_name = prefix
            .lines()
            .find_map(|line| strip_sse_field(line, "event"));
        let data = prefix
            .lines()
            .filter_map(|line| strip_sse_field(line, "data"))
            .collect::<Vec<_>>()
            .join("\n");
        // 只观察已完整解析的顶层 type；后续大 payload 超过前缀上限时，
        // 忽略其解析错误，保留此前读到的类型。它不是原生响应的有效性校验器。
        struct EventType<'a>(&'a mut Option<String>);
        impl<'de> serde::de::Visitor<'de> for EventType<'_> {
            type Value = ();
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an SSE event object")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut map: M,
            ) -> Result<Self::Value, M::Error> {
                while let Some(key) = map.next_key::<String>()? {
                    if key == "type" {
                        *self.0 = Some(map.next_value::<String>()?);
                    } else {
                        map.next_value::<serde::de::IgnoredAny>()?;
                    }
                }
                Ok(())
            }
        }
        let mut deserializer = serde_json::Deserializer::from_str(&data);
        let mut event_type = None;
        let _ = serde::Deserializer::deserialize_map(&mut deserializer, EventType(&mut event_type));
        match event_type.as_deref().or(event_name.map(str::trim)) {
            Some("response.completed") => self.completed = true,
            Some("response.failed") => {
                self.failure = Some("原生 Responses 上游返回 response.failed")
            }
            Some("response.incomplete") => {
                self.failure = Some("原生 Responses 上游返回 response.incomplete")
            }
            Some("error") => self.failure = Some("原生 Responses 上游返回 error 事件"),
            None if self.event_too_large => self.unclassified_large_event = true,
            _ => {}
        }
    }

    pub(crate) fn finish(self) -> Option<String> {
        // failed/incomplete 优先于 completed；[DONE] 或 HTTP EOF 都不能证明成功。
        self.failure
            .or_else(|| {
                if self.completed {
                    None
                } else if self.unclassified_large_event {
                    Some("原生 Responses 流终止状态未知（诊断事件超限），未观察到完成事件")
                } else {
                    Some("原生 Responses 上游在完成事件前结束了响应流")
                }
            })
            .map(str::to_string)
    }
}

#[derive(Debug)]

pub(crate) struct UnsupportedEncryptedAgentContent;

impl std::fmt::Display for UnsupportedEncryptedAgentContent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "unsupported_encrypted_agent_content: Chat Completions 上游无法处理加密的 agent 消息内容，请使用支持该协议的 Responses 上游"
        )
    }
}

impl UnsupportedEncryptedAgentContent {
    pub(crate) fn response_body(&self) -> Value {
        json!({"error":{
            "type":"invalid_request_error",
            "code":"unsupported_encrypted_agent_content",
            "param":"input",
            "message":self.to_string()
        }})
    }
}

impl std::error::Error for UnsupportedEncryptedAgentContent {}

#[derive(Debug)]

struct NativeCompactionUnsupported {
    message: &'static str,
}

impl NativeCompactionUnsupported {
    fn history() -> Self {
        Self {
            message: "This compaction checkpoint cannot be converted to a text summary. Use a compatible Responses upstream or start a new conversation.",
        }
    }
}

impl std::fmt::Display for NativeCompactionUnsupported {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for NativeCompactionUnsupported {}

#[derive(Debug, Clone, Copy)]

enum ImageProxyEndpoint {
    Generations,
    Edits,
}

impl ImageProxyEndpoint {
    fn url(self, base_url: &str) -> String {
        match self {
            Self::Generations => image_generations_url(base_url),
            Self::Edits => image_edits_url(base_url),
        }
    }

    fn wire_api(self) -> UpstreamWireApi {
        match self {
            Self::Generations => UpstreamWireApi::ImageGenerations,
            Self::Edits => UpstreamWireApi::ImageEdits,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Generations => "image_generations",
            Self::Edits => "image_edits",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]

enum LocalRefNormalizationError {
    Cycle,
}

pub const NO_AUTH_PROXY_BEARER_TOKEN: &str = "alunixa-x-no-auth";

const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

const UPSTREAM_IMAGE_HEADER_TIMEOUT: Duration = Duration::from_secs(600);

const MAX_COOLDOWN_RETRIES: usize = 3;

const MAX_NATIVE_COMPACTION_PROBE_BODY_BYTES: usize = 32 * 1024 * 1024;

const COMPACTION_TRIGGER_TYPE: &str = "compaction_trigger";

const COMPACTION_OUTPUT_TYPE: &str = "compaction";

const LOCAL_COMPACTION_PREFIX: &str = "codexplusplus:summary:v1:";

const COMPACTION_SUMMARY_INSTRUCTION: &str = "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.\n\nInclude:\n- Current progress and key decisions made\n- Important context, constraints, or user preferences\n- What remains to be done (clear next steps)\n- Any critical data, examples, or references needed to continue\n\nBe concise, structured, and focused on helping the next LLM seamlessly continue the work.";

const COMPACTION_REPLAY_PREFIX: &str = "Another language model started to solve this problem and produced a summary of its thinking process. Here is the summary produced by the other language model:\n";

const NATIVE_SSE_DIAGNOSTIC_PREFIX_LIMIT: usize = 64 * 1024;

const RESPONSES_ITEM_ID_PREFIXES: &[(&str, &str)] = &[
    ("message", "msg_"),
    ("reasoning", "rs_"),
    ("compaction", "cmp_"),
    ("function_call", "fc_"),
    ("function_call_output", "fco_"),
    ("custom_tool_call", "ctc_"),
    ("custom_tool_call_output", "ctco_"),
];

const SCHEMA_COMBINATOR_KEYS: [&str; 3] = ["oneOf", "anyOf", "allOf"];

const IMAGE_DATA_URL_PREFIX: &str = "data:image/";

impl ChatSseToResponsesConverter {
    pub fn has_failed(&self) -> bool {
        self.failed
    }
    pub fn has_terminal_event(&self) -> bool {
        self.failed || self.state.completed
    }
}

fn upstream_request_builder_for_wire(
    client: reqwest::Client,
    endpoint: &str,
    key: &str,
    stream: bool,
    body: &Value,
    wire: UpstreamWireApi,
) -> reqwest::RequestBuilder {
    let protocol = match wire {
        UpstreamWireApi::AnthropicMessages => RelayProtocol::AnthropicMessages,
        UpstreamWireApi::GeminiGenerateContent => RelayProtocol::GeminiGenerateContent,
        _ => RelayProtocol::ChatCompletions,
    };
    let relay = crate::settings::RelayProfile {
        api_key: key.into(),
        protocol,
        ..Default::default()
    };
    upstream_request_builder(client, endpoint, &relay, stream, body)
}

pub fn ensure_web_search_tool_for_history(request_json: &mut Value) -> bool {
    let Some(input) = request_json.get("input").and_then(Value::as_array) else {
        return false;
    };
    if !input
        .iter()
        .any(|item| item.get("type").and_then(Value::as_str) == Some("web_search_call"))
    {
        return false;
    }
    let is_web_search = |tool: &Value| {
        matches!(
            tool.get("type").and_then(Value::as_str),
            Some("web_search" | "web_search_preview" | "web_search_preview_2025_03_11")
        )
    };
    let mut has_other_tools = false;
    for tool in input
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("additional_tools"))
        .filter_map(|item| item.get("tools").and_then(Value::as_array))
        .flatten()
    {
        if is_web_search(tool) {
            return false;
        }
        has_other_tools = true;
    }
    match request_json.get("tools") {
        None | Some(Value::Null) => {}
        Some(Value::Array(tools)) => {
            if tools.iter().any(is_web_search) {
                return false;
            }
            has_other_tools |= !tools.is_empty();
        }
        _ => return false,
    }
    let tool = json!({"type": "web_search", "external_web_access": false});
    if let Some(tools) = request_json.get_mut("tools").and_then(Value::as_array_mut) {
        tools.push(tool);
    } else {
        request_json["tools"] = json!([tool]);
    }
    if !has_other_tools
        && (matches!(request_json.get("tool_choice"), None | Some(Value::Null))
            || matches!(
                request_json.get("tool_choice").and_then(Value::as_str),
                Some("auto" | "none")
            ))
    {
        request_json["tool_choice"] = json!("none");
    }
    true
}

#[derive(Debug)]
pub(crate) struct UnsupportedNativeWebSearch;

impl std::fmt::Display for UnsupportedNativeWebSearch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "unsupported_native_web_search: Chat 路由不执行服务端原生搜索，请使用客户端搜索工具或支持原生搜索的 Responses 上游"
        )
    }
}

impl std::error::Error for UnsupportedNativeWebSearch {}

impl UnsupportedNativeWebSearch {
    pub(crate) fn response_body(&self) -> Value {
        json!({"error": {
            "type": "invalid_request_error", "code": "unsupported_native_web_search",
            "param": "tool_choice", "message": self.to_string()
        }})
    }
}

fn remove_unsupported_native_search(body: &mut Value) -> anyhow::Result<()> {
    let choice = body.get("tool_choice");
    if choice
        .and_then(|choice| choice.get("type"))
        .and_then(Value::as_str)
        .is_some_and(|kind| matches!(kind, "web_search" | "web_search_preview"))
    {
        return Err(UnsupportedNativeWebSearch.into());
    }
    let required = choice.and_then(Value::as_str) == Some("required");
    if let Some(tools) = body.get_mut("tools").and_then(Value::as_array_mut) {
        let before = tools.len();
        // 同名 function/custom 和命名空间工具由客户端执行，必须保留。
        tools.retain(|tool| {
            !matches!(
                tool.get("type").and_then(Value::as_str),
                Some("web_search" | "web_search_preview")
            )
        });
        if before != tools.len() && required && tools.is_empty() {
            return Err(UnsupportedNativeWebSearch.into());
        }
    }
    Ok(())
}
