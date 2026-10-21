//! Responses ↔ Anthropic, adapted from farion1231/cc-switch at
//! 99277921d9363c78e656ada0ca3bf39e30938b23 (MIT, see THIRD_PARTY_NOTICES.md).
//! Keep native content blocks independent; do not round-trip through Chat Completions.

use super::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

pub(super) const ANTHROPIC_THINKING_ENCRYPTED_PREFIX: &str = "ccswitch-anthropic-thinking-v1:";
const MAX_THINKING_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_TOKENS: u64 = 4096;

pub(super) fn responses_request_to_anthropic(mut body: Value) -> anyhow::Result<Value> {
    responses_request_to_anthropic_with_options(
        body,
        &crate::anthropic_bridge::AnthropicRequestOptions {
            max_tokens: DEFAULT_MAX_TOKENS,
            prompt_cache: false,
            ..Default::default()
        },
    )
}

pub(super) fn responses_request_to_anthropic_with_options(
    mut body: Value,
    options: &crate::anthropic_bridge::AnthropicRequestOptions,
) -> anyhow::Result<Value> {
    validate_protocol_attachments(&body, true)?;
    body = normalize_plaintext_agent_messages(body)?;
    remove_unsupported_native_search(&mut body)?;
    expand_local_compaction_history(&mut body);
    if input_has_native_compaction(&body) {
        return Err(NativeCompactionUnsupported::history().into());
    }
    // These describe the Codex transport, not Anthropic model options or caching.
    for field in [
        "prompt_cache_key",
        "prompt_cache_retention",
        "service_tier",
        "safety_identifier",
    ] {
        body.as_object_mut().map(|object| object.remove(field));
    }
    let body = fidelity::prepare_history(body, "anthropic")?;
    fidelity::validate_request(&body, "anthropic")?;
    validate_text_options(&body)?;
    let (tool_context, chat_tools) = tool_context_from_request(&body);
    let model = body["model"].as_str().unwrap_or("");
    let mut result = json!({"stream":body.get("stream").cloned().unwrap_or(json!(false))});
    if let Some(model) = body.get("model") {
        result["model"] = model.clone();
    }

    let mut system_parts = Vec::new();
    if let Some(instructions) = body.get("instructions") {
        let text = instruction_text(instructions);
        if is_meaningful_text(&text) {
            system_parts.push(text);
        }
    }
    let items: Vec<Value> = match body.get("input") {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::String(text)) => vec![json!({"role":"user","content":text})],
        _ => Vec::new(),
    };
    for item in &items {
        if matches!(item["role"].as_str(), Some("system" | "developer")) {
            system_parts.extend(responses_system_text(item));
        }
    }
    if !system_parts.is_empty() {
        result["system"] = json!(system_parts.join("\n\n"));
    }

    let mut messages = convert_input_to_messages(&items, &tool_context)?;
    drop_incomplete_tool_turns(&mut messages);
    drop_empty_messages(&mut messages);
    ensure_leading_user_message(&mut messages);
    trim_trailing_assistant_text(&mut messages);
    drop_empty_messages(&mut messages);
    if messages.is_empty() {
        return fidelity::reject("cannot convert Codex request: empty messages");
    }
    let history_supports_thinking = trailing_turn_supports_thinking(&messages);
    result["messages"] = json!(messages);
    let requested_max_tokens = body
        .get("max_output_tokens")
        .or_else(|| body.get("max_tokens"))
        .or_else(|| body.get("max_completion_tokens"))
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(options.max_tokens);
    let max_tokens = if options.force_max_tokens {
        options.max_tokens
    } else {
        requested_max_tokens
    };
    result["max_tokens"] = json!(max_tokens);

    let reasoning = body.get("reasoning").filter(|value| !value.is_null());
    if reasoning.is_some_and(|value| {
        value
            .as_object()
            .is_none_or(|object| object.keys().any(|key| key != "effort" && key != "summary"))
    }) {
        return fidelity::reject("unsupported native reasoning option");
    }
    let effort = body
        .pointer("/reasoning/effort")
        .or_else(|| body.get("reasoning_effort"))
        .and_then(Value::as_str)
        .map(|effort| effort.trim().to_ascii_lowercase());
    let effort = effort.as_deref();
    let explicit_thinking = body.get("thinking").filter(|value| !value.is_null());
    let adaptive_model = match options.thinking_mode {
        crate::anthropic_bridge::AnthropicThinkingMode::Adaptive => true,
        crate::anthropic_bridge::AnthropicThinkingMode::Budget => false,
        _ => {
            uses_adaptive_thinking(model)
        // Preserve AX's explicit adaptive/xhigh/ultra selection for Claude aliases.
        || (is_claude_model(model) && matches!(effort, Some("adaptive" | "xhigh" | "ultra")))
        }
    };
    let cannot_disable = thinking_cannot_be_disabled(model);
    let explicitly_disabled = reasoning_explicitly_disabled(effort);
    let should_adapt = adaptive_model
        && (adaptive_thinking_is_default(model)
            || effort.and_then(codex_effort_to_anthropic).is_some()
            || effort == Some("adaptive"));
    if let Some(thinking) = explicit_thinking {
        if !matches!(
            thinking["type"].as_str(),
            Some("enabled" | "disabled" | "adaptive")
        ) {
            return fidelity::reject("unsupported Anthropic thinking type");
        }
        result["thinking"] = thinking.clone();
    }
    if !history_supports_thinking {
        if cannot_disable {
            return fidelity::reject("Anthropic model requires signed thinking in tool history");
        }
        if should_adapt || explicit_thinking.is_some() {
            result["thinking"] = json!({"type":"disabled"});
        }
    } else if should_adapt && (!explicitly_disabled || cannot_disable) {
        result["thinking"] = json!({"type":"adaptive"});
        // AX's xhigh/ultra/adaptive mean model-controlled adaptive thinking.
        if options.thinking_mode == crate::anthropic_bridge::AnthropicThinkingMode::Adaptive
            || !matches!(effort, Some("adaptive" | "xhigh" | "ultra"))
        {
            if let Some(mapped) = effort.and_then(codex_effort_to_anthropic) {
                result["output_config"] = json!({"effort":mapped});
            } else if explicitly_disabled && cannot_disable {
                result["output_config"] = json!({"effort":"low"});
            }
        }
    } else if explicitly_disabled {
        if cannot_disable {
            result["thinking"] = json!({"type":"adaptive"});
            result["output_config"] = json!({"effort":"low"});
        } else {
            result["thinking"] = json!({"type":"disabled"});
        }
    } else if history_supports_thinking && effort.and_then(effort_to_thinking_budget).is_some() {
        let budget = effort
            .and_then(effort_to_thinking_budget)
            .unwrap()
            .min(max_tokens / 2);
        if budget >= 1024 {
            result["thinking"] = json!({"type":"enabled","budget_tokens":budget});
        }
    } else if effort.is_some()
        && effort != Some("adaptive")
        && !explicitly_disabled
        && explicit_thinking.is_none()
    {
        return fidelity::reject("unsupported Anthropic reasoning effort");
    }
    if result["thinking"]["type"] == "enabled" {
        let budget = result["thinking"]["budget_tokens"]
            .as_u64()
            .ok_or_else(|| fidelity::ConversionError("invalid Anthropic thinking budget".into()))?;
        let budget = budget.min(max_tokens / 2);
        if budget >= 1024 {
            result["thinking"]["budget_tokens"] = json!(budget);
        } else {
            result.as_object_mut().unwrap().remove("thinking");
        }
    }

    let tools: Vec<Value> = chat_tools
        .iter()
        .filter_map(chat_tool_to_anthropic_tool)
        .collect();
    if !tools.is_empty() {
        result["tools"] = json!(tools);
        if let Some(choice) = body.get("tool_choice") {
            result["tool_choice"] = map_tool_choice_to_anthropic(choice, &tool_context);
            if thinking_enabled(&result)
                && matches!(result["tool_choice"]["type"].as_str(), Some("any" | "tool"))
            {
                if cannot_disable {
                    return fidelity::reject(
                        "Anthropic model cannot disable thinking for forced tools",
                    );
                }
                result["thinking"] = json!({"type":"disabled"});
                result.as_object_mut().unwrap().remove("output_config");
            }
        }
        if body["parallel_tool_calls"] == false {
            if result.get("tool_choice").is_none() {
                result["tool_choice"] = json!({"type":"auto"});
            }
            result["tool_choice"]["disable_parallel_tool_use"] = json!(true);
        }
    }
    if options.thinking_mode == crate::anthropic_bridge::AnthropicThinkingMode::Off {
        result.as_object_mut().unwrap().remove("thinking");
        result.as_object_mut().unwrap().remove("output_config");
    }
    if !thinking_enabled(&result) {
        for field in ["temperature", "top_p"] {
            if let Some(value) = body.get(field) {
                result[field] = value.clone();
            }
        }
    }
    if let Some(stop) = body.get("stop") {
        result["stop_sequences"] = if stop.is_array() {
            stop.clone()
        } else {
            json!([stop])
        };
    }
    if let Some(model) = result.get("model").and_then(Value::as_str) {
        result["model"] = json!(crate::anthropic_bridge::strip_context_marker(model));
    }
    if options.prompt_cache {
        crate::anthropic_bridge::inject_prompt_cache(&mut result);
    }
    if options.impersonate_claude_code {
        crate::anthropic_bridge::prepend_claude_code_identity(&mut result);
    }
    Ok(result)
}

fn validate_text_options(body: &Value) -> anyhow::Result<()> {
    let Some(text) = body.get("text").filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let Some(options) = text.as_object() else {
        return fidelity::reject("text must be an object");
    };
    if options
        .keys()
        .any(|key| key != "format" && key != "verbosity")
    {
        return fidelity::reject("unsupported Anthropic text option");
    }
    if let Some(verbosity) = text.get("verbosity").filter(|value| !value.is_null()) {
        if !matches!(verbosity.as_str(), Some("low" | "medium" | "high")) {
            return fidelity::reject("unsupported text.verbosity");
        }
        // This is a style preference, not a structured-output constraint. Match
        // cc-switch: Messages has no verbosity field, and changing the system
        // prompt here would also change the user's instructions/cache prefix.
    }
    if let Some(format) = text.get("format").filter(|value| !value.is_null()) {
        let Some(format) = format.as_object() else {
            return fidelity::reject("text.format must be an object");
        };
        match format.get("type").and_then(Value::as_str) {
            Some("text") if format.keys().all(|key| key == "type") => {}
            Some("json_object" | "json_schema") => {
                return fidelity::reject(
                    "Anthropic structured text format requires a native provider configuration",
                );
            }
            _ => return fidelity::reject("unsupported Anthropic text format"),
        }
    }
    Ok(())
}

fn thinking_enabled(body: &Value) -> bool {
    matches!(
        body["thinking"]["type"].as_str(),
        Some("enabled" | "adaptive")
    )
}

pub(super) fn tool_context_from_request(body: &Value) -> (CodexToolContext, Vec<Value>) {
    let mut tools = body["tools"].as_array().cloned().unwrap_or_default();
    for item in body["input"].as_array().into_iter().flatten() {
        if item["type"] == "additional_tools" {
            tools.extend(item["tools"].as_array().into_iter().flatten().cloned());
        }
    }
    let mut context = build_codex_tool_context(Some(&json!(tools)));
    let namespaces = collect_tool_search_output_namespaces(body);
    for namespace in &namespaces {
        add_namespace_tools_to_context(&mut context, namespace);
    }
    let mut converted = responses_tools_to_chat_tools(&tools, &context);
    for namespace in &namespaces {
        converted.extend(namespace_tool_to_chat_tools(namespace, &context));
    }
    dedup_chat_tools_by_name(&mut converted);
    // cc-switch's bounded namespace names remain stable across declarations/history/replies.
    for tool in &mut converted {
        let name = tool["function"]["name"].as_str().unwrap_or("").to_string();
        if name.len() <= 64 {
            continue;
        }
        use sha2::{Digest, Sha256};
        let hash: String = Sha256::digest(name.as_bytes())
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let mut end = 46.min(name.len());
        while !name.is_char_boundary(end) {
            end -= 1;
        }
        let alias = format!("{}__{hash}", &name[..end]);
        context
            .native_tool_aliases
            .insert(name.clone(), alias.clone());
        if let Some(spec) = context.function_tools.remove(&name) {
            context.function_tools.insert(alias.clone(), spec);
        }
        if let Some(spec) = context.custom_tools.remove(&name) {
            context.custom_tools.insert(alias.clone(), spec);
        }
        tool["function"]["name"] = json!(alias);
    }
    (context, converted)
}

fn chat_tool_to_anthropic_tool(tool: &Value) -> Option<Value> {
    let function = tool.get("function")?;
    let name = function["name"].as_str()?.trim();
    let mut schema = function.get("parameters").cloned().unwrap_or(json!({}));
    if !schema.is_object() {
        schema = json!({});
    }
    schema["type"] = json!("object");
    if schema.get("properties").is_none() {
        schema["properties"] = json!({});
    }
    let mut result = json!({"name":name,"input_schema":schema});
    if let Some(description) = function["description"]
        .as_str()
        .filter(|text| !text.is_empty())
    {
        result["description"] = json!(description);
    }
    if let Some(strict) = function["strict"].as_bool() {
        result["strict"] = json!(strict);
    }
    Some(result)
}

fn map_tool_choice_to_anthropic(choice: &Value, context: &CodexToolContext) -> Value {
    match responses_tool_choice_to_chat(choice, context) {
        Some(Value::String(choice)) if choice == "required" => json!({"type":"any"}),
        Some(Value::String(choice)) if choice == "none" => json!({"type":"none"}),
        Some(choice) if choice.pointer("/function/name").is_some() => {
            let name = choice["function"]["name"].as_str().unwrap_or("");
            json!({"type":"tool","name":context.native_tool_aliases.get(name).map_or(name, String::as_str)})
        }
        _ if choice["type"] == "tool_search" => json!({"type":"tool","name":"tool_search"}),
        _ => json!({"type":"auto"}),
    }
}

fn function_name(item: &Value, context: &CodexToolContext) -> String {
    let name = responses_history_function_name(item);
    context
        .native_tool_aliases
        .get(&name)
        .cloned()
        .unwrap_or(name)
}

fn convert_input_to_messages(
    items: &[Value],
    context: &CodexToolContext,
) -> anyhow::Result<Vec<Value>> {
    let mut messages = Vec::new();
    for item in items {
        let kind = item["type"].as_str().unwrap_or("message");
        if matches!(
            kind,
            "function_call" | "custom_tool_call" | "tool_search_call"
        ) && item["status"] == "incomplete"
        {
            continue;
        }
        match kind {
            "alunixa_native_message" => {
                validate_anthropic_blocks(&item["native"])?;
                for block in item["native"].as_array().into_iter().flatten() {
                    push_block(&mut messages, "assistant", block.clone());
                }
            }
            "function_call" | "custom_tool_call" | "tool_search_call" | "tool_call" => {
                let call = item.get("tool_use").unwrap_or(item);
                let call_id = call
                    .get("call_id")
                    .or_else(|| call.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let (name, input) = if kind == "custom_tool_call" {
                    let (name, args) = build_custom_tool_call_history(
                        &responses_history_function_name(item),
                        item.get("input").unwrap_or(&Value::Null),
                    );
                    let name = context
                        .native_tool_aliases
                        .get(&name)
                        .cloned()
                        .unwrap_or(name);
                    (name, serde_json::from_str(&args)?)
                } else {
                    let name = if kind == "tool_search_call" {
                        "tool_search".into()
                    } else {
                        function_name(call, context)
                    };
                    let args = call
                        .get("arguments")
                        .or_else(|| call.get("input"))
                        .cloned()
                        .unwrap_or(json!({}));
                    let input = if let Some(text) = args.as_str() {
                        if text.trim().is_empty() {
                            json!({})
                        } else {
                            serde_json::from_str(text)?
                        }
                    } else {
                        args
                    };
                    fidelity::validate_arguments(&input)?;
                    let input = sanitize_tool_input(&name, input);
                    (name, input)
                };
                push_block(
                    &mut messages,
                    "assistant",
                    json!({"type":"tool_use","id":call_id,"name":name,"input":input}),
                );
            }
            "function_call_output"
            | "custom_tool_call_output"
            | "tool_search_output"
            | "tool_result" => {
                let call_id = item
                    .get("call_id")
                    .or_else(|| item.get("tool_call_id"))
                    .or_else(|| item.pointer("/content/tool_use_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let output = if kind == "tool_search_output" {
                    json!(canonical_json_string(&json!({"tools":item["tools"]})))
                } else {
                    tool_result_content(
                        item.get("output")
                            .or_else(|| item.pointer("/content/content"))
                            .or_else(|| item.get("content"))
                            .unwrap_or(&Value::Null),
                    )?
                };
                let mut block =
                    json!({"type":"tool_result","tool_use_id":call_id,"content":output});
                if item["is_error"] == true || item["isError"] == true {
                    block["is_error"] = json!(true);
                }
                push_tool_result_block(&mut messages, block);
            }
            "reasoning" => {
                if let Some(block) = item["encrypted_content"]
                    .as_str()
                    .and_then(decode_anthropic_thinking_block)
                {
                    push_assistant_thinking_block(&mut messages, block);
                }
            }
            "additional_tools" => {
                if let Some(content) = item.get("content") {
                    append_content(&mut messages, "user", content)?;
                }
            }
            "input_text" => {
                if let Some(text) = item["text"]
                    .as_str()
                    .filter(|text| is_meaningful_text(text))
                {
                    push_block(&mut messages, "user", json!({"type":"text","text":text}));
                }
            }
            "input_image" => {
                let block = image_block_from_input_image(item).ok_or_else(|| {
                    fidelity::ConversionError("invalid Anthropic input image".into())
                })?;
                push_block(&mut messages, "user", block);
            }
            _ => {
                let role = item["role"].as_str().unwrap_or("user");
                if matches!(role, "system" | "developer") {
                    continue;
                }
                append_content(
                    &mut messages,
                    if role == "assistant" {
                        "assistant"
                    } else {
                        "user"
                    },
                    &item["content"],
                )?;
            }
        }
    }
    Ok(messages)
}

fn append_content(messages: &mut Vec<Value>, role: &str, content: &Value) -> anyhow::Result<()> {
    match content {
        Value::String(text) if is_meaningful_text(text) => {
            push_block(messages, role, json!({"type":"text","text":text}));
        }
        Value::Array(parts) => {
            for part in parts {
                let mut block = match part["type"].as_str() {
                    Some("text" | "input_text" | "output_text" | "refusal") => {
                        let text = part
                            .get("text")
                            .or_else(|| part.get("refusal"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        if !is_meaningful_text(text) {
                            continue;
                        }
                        json!({"type":"text","text":text})
                    }
                    Some("input_image" | "image_url") => image_block_from_input_image(part)
                        .ok_or_else(|| {
                            fidelity::ConversionError("invalid Anthropic input image".into())
                        })?,
                    Some("input_file") => {
                        document_block_from_input_file(part).ok_or_else(|| {
                            fidelity::ConversionError("invalid Anthropic input document".into())
                        })?
                    }
                    _ => return fidelity::reject("unsupported Anthropic input content"),
                };
                if let Some(cache_control) = part.get("cache_control") {
                    block["cache_control"] = cache_control.clone();
                }
                push_block(messages, role, block);
            }
        }
        _ => {}
    }
    Ok(())
}

fn tool_result_content(value: &Value) -> anyhow::Result<Value> {
    if value.is_array() {
        let mut messages = Vec::new();
        append_content(&mut messages, "user", value)?;
        Ok(messages
            .first()
            .map(|message| message["content"].clone())
            .unwrap_or(json!([])))
    } else if let Some(text) = value.as_str() {
        Ok(json!(text))
    } else {
        Ok(json!(canonical_json_string(value)))
    }
}

pub(super) fn sanitize_tool_input(name: &str, mut input: Value) -> Value {
    if name == "Read"
        && input["pages"]
            .as_str()
            .is_some_and(|text| text.trim().is_empty())
    {
        input.as_object_mut().map(|object| object.remove("pages"));
    }
    input
}

pub(super) fn anthropic_response_to_responses(
    body: Value,
    request: &Value,
) -> anyhow::Result<Value> {
    if body["type"] == "error" || body.get("error").is_some_and(|error| !error.is_null()) {
        let (message, _) = extract_chat_sse_error(&body);
        anyhow::bail!("Anthropic upstream: {message}");
    }
    let blocks = body
        .get("content")
        .ok_or_else(|| anyhow::anyhow!("Anthropic response missing content"))?;
    validate_anthropic_blocks(blocks)?;
    if body.get("role").is_some_and(|role| role != "assistant") {
        return fidelity::reject("upstream message role is not assistant");
    }
    let response_id = response_id_from_chat_id(body["id"].as_str());
    let (context, _) = tool_context_from_request(request);
    let (status, incomplete_reason) =
        map_anthropic_stop_reason_to_status(body["stop_reason"].as_str());
    let mut output = Vec::new();
    let mut text_parts = Vec::new();
    let flush_text = |output: &mut Vec<Value>, parts: &mut Vec<Value>| {
        if !parts.is_empty() {
            output.push(json!({
                "id":format!("{response_id}_msg_{}",output.len()),
                "type":"message","role":"assistant","status":"completed",
                "content":std::mem::take(parts)
            }));
        }
    };
    let mut call_ids = BTreeSet::new();
    for block in blocks.as_array().unwrap() {
        match block["type"].as_str().unwrap_or("") {
            "text" => text_parts.push(json!({"type":"output_text","text":block["text"].as_str().unwrap_or(""),"annotations":[]})),
            "thinking" | "redacted_thinking" => {
                flush_text(&mut output, &mut text_parts);
                if let Some(item) = responses_reasoning_item_from_anthropic_block(&format!("rs_{response_id}_{}",output.len()), block) {
                    output.push(item);
                } else if block["type"] == "thinking" {
                    // Unsigned gateways can display reasoning, but cannot replay it as signed thinking.
                    output.push(json!({"id":format!("rs_{response_id}_{}",output.len()),"type":"reasoning","summary":[{"type":"summary_text","text":block["thinking"].as_str().unwrap_or("")}]}));
                }
            }
            "tool_use" => {
                flush_text(&mut output, &mut text_parts);
                let call_id = block["id"].as_str().unwrap_or("");
                let name = block["name"].as_str().unwrap_or("");
                if call_id.is_empty() || name.is_empty() || !call_ids.insert(call_id) {
                    return fidelity::reject("missing or duplicate Anthropic tool identity");
                }
                let input = sanitize_tool_input(name, block.get("input").cloned().unwrap_or(json!({})));
                if status == "completed" {
                    fidelity::validate_arguments(&input)?;
                }
                let mut item = response_tool_call_item(call_id, name, &canonical_json_string(&input), &context);
                item["status"] = json!(status);
                output.push(item);
            }
            _ => unreachable!(),
        }
    }
    flush_text(&mut output, &mut text_parts);
    let mut response = json!({
        "id":response_id,"object":"response","created_at":0,"status":status,
        "model":body.get("model").or_else(|| request.get("model")).cloned().unwrap_or(json!("")),
        "output":output,"usage":build_responses_usage_from_anthropic(body.get("usage"))
    });
    if let Some(reason) = incomplete_reason {
        response["incomplete_details"] = json!({"reason":reason});
    }
    copy_response_request_fields(&mut response, Some(request));
    Ok(response)
}

pub(super) fn effort_to_thinking_budget(effort: &str) -> Option<u64> {
    // ultra 是 Codex 扩展档位，钳到 max 同档——落进 None 会让"选最深思考"
    // 反而关掉 extended thinking。
    match effort.trim().to_ascii_lowercase().as_str() {
        "minimal" | "low" => Some(2048),
        "medium" => Some(8192),
        "high" => Some(16384),
        "xhigh" | "max" | "ultra" => Some(24576),
        _ => None,
    }
}

fn codex_effort_to_anthropic(effort: &str) -> Option<&'static str> {
    match effort.trim().to_ascii_lowercase().as_str() {
        "minimal" | "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" | "max" | "ultra" => Some("max"),
        _ => None,
    }
}

fn reasoning_explicitly_disabled(effort: Option<&str>) -> bool {
    matches!(
        effort
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("none" | "off" | "disabled")
    )
}

pub(super) fn encode_anthropic_thinking_block(block: &Value) -> Option<String> {
    match block.get("type").and_then(|value| value.as_str()) {
        Some("thinking")
            if block
                .get("signature")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty()) => {}
        Some("redacted_thinking")
            if block
                .get("data")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty()) => {}
        _ => return None,
    }
    let bytes = serde_json::to_vec(block).ok()?;
    Some(format!(
        "{ANTHROPIC_THINKING_ENCRYPTED_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(bytes)
    ))
}

pub(super) fn decode_anthropic_thinking_block(encrypted_content: &str) -> Option<Value> {
    let encoded = encrypted_content.strip_prefix(ANTHROPIC_THINKING_ENCRYPTED_PREFIX)?;
    if encoded.len() > MAX_THINKING_BYTES {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let block: Value = serde_json::from_slice(&bytes).ok()?;
    // Reuse the encoder's validation so legacy/malformed bridge envelopes cannot
    // replay an unsigned thinking block into an Anthropic tool turn.
    encode_anthropic_thinking_block(&block).map(|_| block)
}

pub(super) fn responses_reasoning_item_from_anthropic_block(
    item_id: &str,
    block: &Value,
) -> Option<Value> {
    let encrypted_content = encode_anthropic_thinking_block(block)?;
    let summary = block
        .get("thinking")
        .and_then(|value| value.as_str())
        .filter(|text| !text.is_empty())
        .map(|text| vec![json!({ "type": "summary_text", "text": text })])
        .unwrap_or_default();
    Some(json!({
        "id": item_id,
        "type": "reasoning",
        "summary": summary,
        "encrypted_content": encrypted_content
    }))
}

pub(super) fn map_anthropic_stop_reason_to_status(
    stop_reason: Option<&str>,
) -> (&'static str, Option<&'static str>) {
    match stop_reason {
        Some("max_tokens") => ("incomplete", Some("max_output_tokens")),
        // Safety refusal: report as incomplete to avoid Codex treating it as a normally-completed empty reply.
        Some("refusal") => ("incomplete", Some("content_filter")),
        Some("model_context_window_exceeded") => ("incomplete", Some("max_output_tokens")),
        // pause_turn is unreachable on this path (Codex requests do not declare Anthropic server-side tools);
        // if it does occur, log a warning and treat it as completed.
        Some("pause_turn") => ("completed", None),
        _ => ("completed", None),
    }
}

pub(super) fn build_responses_usage_from_anthropic(usage: Option<&Value>) -> Value {
    let u = match usage {
        Some(v) if v.is_object() => v,
        _ => {
            return json!({
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "output_tokens_details": { "reasoning_tokens": 0 }
            });
        }
    };

    let fresh_input = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let output = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let reasoning = u
        .pointer("/output_tokens_details/thinking_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_read = u
        .get("cache_read_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_creation = u
        .get("cache_creation_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let input_tokens = fresh_input
        .saturating_add(cache_read)
        .saturating_add(cache_creation);
    let total_tokens = input_tokens.saturating_add(output);

    let mut result = json!({
        "input_tokens": input_tokens,
        "output_tokens": output,
        "total_tokens": total_tokens,
        "output_tokens_details": { "reasoning_tokens": reasoning }
    });
    if cache_read > 0 || cache_creation > 0 {
        result["input_tokens_details"] = json!({
            "cached_tokens": cache_read,
            "cache_write_tokens": cache_creation
        });
    }
    // Keep the legacy top-level alias for one compatibility window. New code reads
    // the official nested cache_write_tokens field first.
    if cache_creation > 0 {
        result["cache_creation_input_tokens"] = json!(cache_creation);
    }
    // Retain native cache creation lifetimes and provider usage extensions.
    for (key, value) in u.as_object().into_iter().flatten() {
        if !result.as_object().unwrap().contains_key(key) {
            result[key] = value.clone();
        }
    }
    result
}

fn responses_system_text(item: &Value) -> Vec<String> {
    match item.get("content") {
        Some(Value::String(text)) if is_meaningful_text(text) => {
            vec![text.trim().to_string()]
        }
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                matches!(
                    part.get("type").and_then(Value::as_str),
                    Some("input_text" | "output_text" | "text")
                )
                .then(|| part.get("text").and_then(Value::as_str))
                .flatten()
                .filter(|text| is_meaningful_text(text))
                .map(|text| text.trim().to_string())
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn ensure_leading_user_message(messages: &mut Vec<Value>) {
    let leads_with_user = messages
        .first()
        .and_then(|m| m.get("role"))
        .and_then(|r| r.as_str())
        == Some("user");
    if !messages.is_empty() && !leads_with_user {
        messages.insert(
            0,
            json!({
                "role": "user",
                "content": [{ "type": "text", "text": "(continuing the conversation)" }]
            }),
        );
    }
}

fn drop_incomplete_tool_turns(messages: &mut Vec<Value>) {
    let original = std::mem::take(messages);
    let mut sanitized = Vec::with_capacity(original.len());
    let mut index = 0;

    while index < original.len() {
        let message = &original[index];
        let is_assistant = message.get("role").and_then(Value::as_str) == Some("assistant");
        let tool_use_ids = if is_assistant {
            message_block_ids(message, "tool_use", "id")
        } else {
            Vec::new()
        };

        if !tool_use_ids.is_empty() {
            let paired_user = original
                .get(index + 1)
                .filter(|next| next.get("role").and_then(Value::as_str) == Some("user"));
            let tool_result_ids = paired_user
                .map(|user| message_block_ids(user, "tool_result", "tool_use_id"))
                .unwrap_or_default();
            let unique_tool_uses: BTreeSet<&str> = tool_use_ids.iter().copied().collect();
            let unique_tool_results: BTreeSet<&str> = tool_result_ids.iter().copied().collect();
            let complete = tool_use_ids.iter().all(|id| !id.is_empty())
                && tool_result_ids.iter().all(|id| !id.is_empty())
                && unique_tool_uses.len() == tool_use_ids.len()
                && unique_tool_results.len() == tool_result_ids.len()
                && unique_tool_uses == unique_tool_results;

            if complete {
                sanitized.push(message.clone());
                sanitized.push(paired_user.unwrap().clone());
            } else if let Some(user) = paired_user {
                let mut user = user.clone();
                drop_tool_result_blocks(&mut user);
                if message_has_content(&user) {
                    sanitized.push(user);
                }
            }

            index += if paired_user.is_some() { 2 } else { 1 };
            continue;
        }

        let mut message = message.clone();
        if message.get("role").and_then(Value::as_str) == Some("user") {
            // A user message not consumed as the adjacent half of a complete tool
            // pair cannot legally retain any tool_result blocks.
            drop_tool_result_blocks(&mut message);
        }
        if message_has_content(&message) {
            sanitized.push(message);
        }
        index += 1;
    }

    *messages = sanitized;
}

fn message_block_ids<'a>(message: &'a Value, block_type: &str, id_field: &str) -> Vec<&'a str> {
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some(block_type))
        .map(|block| block.get(id_field).and_then(Value::as_str).unwrap_or(""))
        .collect()
}

fn drop_tool_result_blocks(message: &mut Value) {
    if let Some(content) = message.get_mut("content").and_then(Value::as_array_mut) {
        content.retain(|block| block.get("type").and_then(Value::as_str) != Some("tool_result"));
    }
}

fn message_has_content(message: &Value) -> bool {
    message
        .get("content")
        .and_then(Value::as_array)
        .map(|content| !content.is_empty())
        .unwrap_or(true)
}

fn trailing_turn_supports_thinking(messages: &[Value]) -> bool {
    let Some(last) = messages.last() else {
        return false;
    };
    if last.get("role").and_then(Value::as_str) != Some("user") {
        return false;
    }
    let mut tool_result_ids = Vec::new();
    if let Some(blocks) = last.get("content").and_then(Value::as_array) {
        for block in blocks {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let Some(id) = block
                .get("tool_use_id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            else {
                return false;
            };
            tool_result_ids.push(id);
        }
    }
    if tool_result_ids.is_empty() {
        return true;
    }

    // A tool-result turn answers the immediately preceding assistant tool-use turn.
    // Looking any farther back can pick up an unrelated signed thinking block and
    // incorrectly re-enable thinking for an unsigned tool call.
    let Some(paired_assistant) = messages.get(messages.len().saturating_sub(2)) else {
        return false;
    };
    if paired_assistant.get("role").and_then(Value::as_str) != Some("assistant") {
        return false;
    }
    let Some(blocks) = paired_assistant.get("content").and_then(Value::as_array) else {
        return false;
    };
    let has_signed_thinking = blocks.iter().any(|block| {
        matches!(
            block.get("type").and_then(Value::as_str),
            Some("thinking" | "redacted_thinking")
        )
    });
    if !has_signed_thinking {
        return false;
    }

    let paired_tool_use_ids: BTreeSet<&str> = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
        .filter_map(|block| block.get("id").and_then(Value::as_str))
        .collect();
    tool_result_ids
        .iter()
        .all(|id| paired_tool_use_ids.contains(id))
}

fn trim_trailing_assistant_text(messages: &mut [Value]) {
    let Some(last) = messages.last_mut() else {
        return;
    };
    if last.get("role").and_then(Value::as_str) != Some("assistant") {
        return;
    }
    let Some(blocks) = last.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    let Some(block) = blocks.last_mut() else {
        return;
    };
    if block.get("type").and_then(Value::as_str) != Some("text") {
        return;
    }
    let Some(text) = block.get("text").and_then(Value::as_str) else {
        return;
    };
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        blocks.pop();
    } else if trimmed.len() != text.len() {
        block["text"] = json!(trimmed);
    }
}

fn is_meaningful_text(text: &str) -> bool {
    !text.trim().is_empty()
}

fn drop_empty_messages(messages: &mut Vec<Value>) {
    messages.retain(|msg| {
        msg.get("content")
            .and_then(|c| c.as_array())
            .map(|arr| !arr.is_empty())
            .unwrap_or(true)
    });
}

fn push_block(messages: &mut Vec<Value>, role: &str, block: Value) {
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(|r| r.as_str()) == Some(role) {
            if let Some(arr) = last.get_mut("content").and_then(|c| c.as_array_mut()) {
                arr.push(block);
                return;
            }
        }
    }
    messages.push(json!({
        "role": role,
        "content": [block]
    }));
}

fn push_tool_result_block(messages: &mut Vec<Value>, block: Value) {
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some("user") {
            if let Some(content) = last.get_mut("content").and_then(Value::as_array_mut) {
                let insert_at = content
                    .iter()
                    .position(|item| {
                        item.get("type").and_then(Value::as_str) != Some("tool_result")
                    })
                    .unwrap_or(content.len());
                content.insert(insert_at, block);
                return;
            }
        }
    }
    messages.push(json!({
        "role": "user",
        "content": [block]
    }));
}

fn push_assistant_thinking_block(messages: &mut Vec<Value>, block: Value) {
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(Value::as_str) == Some("assistant") {
            if let Some(content) = last.get_mut("content").and_then(Value::as_array_mut) {
                let index = content
                    .iter()
                    .take_while(|item| {
                        matches!(
                            item.get("type").and_then(Value::as_str),
                            Some("thinking" | "redacted_thinking")
                        )
                    })
                    .count();
                content.insert(index, block);
                return;
            }
        }
    }
    push_block(messages, "assistant", block);
}

fn image_block_from_input_image(part: &Value) -> Option<Value> {
    let url = part.get("image_url").and_then(|v| {
        v.as_str()
            .map(str::to_string)
            .or_else(|| v.get("url").and_then(|u| u.as_str()).map(str::to_string))
    })?;

    if url
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:"))
    {
        // data:<media_type>;base64,<data>
        let rest = &url[5..];
        let (meta, data) = rest.split_once(',')?;
        let media_type = meta.split(';').next().unwrap_or("image/png");
        Some(json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": data
            }
        }))
    } else if url
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        || url
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
    {
        Some(json!({
            "type": "image",
            "source": { "type": "url", "url": url }
        }))
    } else {
        None
    }
}

pub(super) fn document_block_from_input_file(part: &Value) -> Option<Value> {
    let filename = part
        .get("filename")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());

    let mut block = if let Some(file_url) = part
        .get("file_url")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
    {
        json!({
            "type":"document",
            "source":{"type":"url","url":file_url}
        })
    } else {
        let file_data = part.get("file_data").and_then(Value::as_str)?;
        let rest = file_data.strip_prefix("data:")?;
        let (meta, data) = rest.split_once(',')?;
        if data.is_empty() {
            return None;
        }
        let media_type = meta.split(';').next().unwrap_or("application/pdf");
        json!({
            "type":"document",
            "source":{
                "type":"base64",
                "media_type":media_type,
                "data":data
            }
        })
    };

    if let Some(filename) = filename {
        block["title"] = json!(filename);
    }
    Some(block)
}

pub(super) fn uses_adaptive_thinking(model: &str) -> bool {
    let normalized = normalize_model_name(model);
    [
        "fable-5",
        "mythos-5",
        "mythos-preview",
        "sonnet-5",
        "opus-5",
        "opus-4-8",
        "opus-4-7",
        "opus-4-6",
        "sonnet-4-6",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

pub(super) fn adaptive_thinking_is_default(model: &str) -> bool {
    let normalized = normalize_model_name(model);
    [
        "fable-5",
        "mythos-5",
        "mythos-preview",
        "opus-5",
        "sonnet-5",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

pub(super) fn thinking_cannot_be_disabled(model: &str) -> bool {
    let normalized = normalize_model_name(model);
    ["fable-5", "mythos-5"]
        .iter()
        .any(|needle| normalized.contains(needle))
}

fn normalize_model_name(model: &str) -> String {
    model.trim().to_ascii_lowercase().replace(['.', '_'], "-")
}
