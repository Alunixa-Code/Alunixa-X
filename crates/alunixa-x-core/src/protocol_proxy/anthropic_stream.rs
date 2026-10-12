//! Native content-block state machine adapted from cc-switch
//! streaming_codex_anthropic.rs, commit 99277921 (MIT, see THIRD_PARTY_NOTICES.md).
//! Retains AX's strict decoding and non-executable truncated-tool boundary.

use super::anthropic::{
    self, build_responses_usage_from_anthropic, map_anthropic_stop_reason_to_status,
    responses_reasoning_item_from_anthropic_block, sanitize_tool_input,
};
use super::anthropic_sse as sse;
use super::*;

struct BlockState {
    output_index: u32,
    item_id: String,
    native: Value,
    accum: String,
    start_input: String,
    stopped: bool,
    done: bool,
}

pub(super) struct AnthropicSseConverter {
    buffer: String,
    utf8_remainder: Vec<u8>,
    sequence_number: u64,
    response_started: bool,
    completed: bool,
    failed: bool,
    response_id: String,
    model: String,
    request: Value,
    tool_context: CodexToolContext,
    blocks: BTreeMap<usize, BlockState>,
    output_items: BTreeMap<u32, Value>,
    usage: Map<String, Value>,
    stop_reason: Option<String>,
}

impl AnthropicSseConverter {
    pub(super) fn with_request(request: &Value) -> Self {
        Self {
            buffer: String::new(),
            utf8_remainder: Vec::new(),
            sequence_number: 0,
            response_started: false,
            completed: false,
            failed: false,
            response_id: response_id_from_chat_id(None),
            model: request["model"].as_str().unwrap_or("").to_string(),
            request: request.clone(),
            tool_context: anthropic::tool_context_from_request(request).0,
            blocks: BTreeMap::new(),
            output_items: BTreeMap::new(),
            usage: Map::new(),
            stop_reason: None,
        }
    }

    pub(super) fn is_completed(&self) -> bool {
        self.completed
    }

    pub(super) fn has_failed(&self) -> bool {
        self.failed
    }

    pub(super) fn is_waiting_for_terminal_event(&self) -> bool {
        !self.completed && self.stop_reason.is_some()
    }

    pub(super) fn push_bytes(&mut self, bytes: &[u8]) -> Vec<u8> {
        if self.completed {
            return Vec::new();
        }
        if append_utf8_safe(&mut self.buffer, &mut self.utf8_remainder, bytes).is_err() {
            return self.fail(
                "Invalid UTF-8 in upstream stream".into(),
                Some("invalid_stream_encoding".into()),
            );
        }
        // Some gateways advertise SSE but return one complete Messages JSON document.
        if self.buffer.trim_start().starts_with('{') {
            if let Ok(body) = serde_json::from_str::<Value>(&self.buffer) {
                return self.json_response(body);
            }
            return Vec::new();
        }
        let mut output = Vec::new();
        while let Some(block) = take_sse_block(&mut self.buffer) {
            output.extend(self.handle_block(&block));
            if self.completed {
                self.buffer.clear();
                break;
            }
        }
        self.emit(output)
    }

    pub(super) fn finish(&mut self) -> Vec<u8> {
        if self.completed {
            return Vec::new();
        }
        if !self.utf8_remainder.is_empty() {
            return self.fail(
                "Truncated UTF-8 in upstream stream".into(),
                Some("invalid_stream_encoding".into()),
            );
        }
        if self.buffer.trim_start().starts_with('{') {
            return match serde_json::from_str::<Value>(&self.buffer) {
                Ok(body) => self.json_response(body),
                Err(_) => self.fail(
                    "Invalid Anthropic response JSON".into(),
                    Some("invalid_stream_event".into()),
                ),
            };
        }
        let mut output = Vec::new();
        if !self.buffer.trim().is_empty() {
            let remaining = std::mem::take(&mut self.buffer);
            output.extend(self.handle_block(&remaining));
        }
        if !self.completed {
            output.extend(self.failed_events(
                "Upstream stream ended before message_stop".into(),
                Some("incomplete_upstream_stream".into()),
            ));
        }
        self.emit(output)
    }

    pub(super) fn fail(&mut self, message: String, error_type: Option<String>) -> Vec<u8> {
        let output = self.failed_events(message, error_type);
        self.emit(output)
    }

    fn emit(&mut self, events: Vec<String>) -> Vec<u8> {
        sequence_sse(events.concat(), &mut self.sequence_number)
    }

    fn json_response(&mut self, body: Value) -> Vec<u8> {
        if self.response_started {
            return self.fail(
                "JSON document after Anthropic SSE output".into(),
                Some("invalid_stream_event".into()),
            );
        }
        match anthropic::anthropic_response_to_responses(body, &self.request).and_then(|response| {
            response_to_sse_for_wire(&response, UpstreamWireApi::AnthropicMessages)
        }) {
            Ok(bytes) => {
                self.completed = true;
                self.buffer.clear();
                bytes
            }
            Err(_) => self.fail(
                "Invalid Anthropic response".into(),
                Some("invalid_stream_event".into()),
            ),
        }
    }

    fn base_response(&self, status: &str) -> Value {
        let mut response = json!({
            "id":self.response_id,"object":"response","created_at":0,
            "status":status,"model":self.model,
            "output":self.output_items.values().collect::<Vec<_>>(),
            "usage":build_responses_usage_from_anthropic(Some(&Value::Object(self.usage.clone())))
        });
        copy_response_request_fields(&mut response, Some(&self.request));
        response
    }

    fn ensure_started(&mut self) -> Vec<String> {
        if self.response_started {
            return Vec::new();
        }
        self.response_started = true;
        let response = self.base_response("in_progress");
        vec![
            sse::response_created(&response),
            sse::response_in_progress(&response),
        ]
    }

    fn merge_usage(&mut self, usage: &Value) {
        for (key, value) in usage.as_object().into_iter().flatten() {
            if !value.is_null() {
                self.usage.insert(key.clone(), value.clone());
            }
        }
    }

    fn handle_block(&mut self, block: &str) -> Vec<String> {
        let (event_name, data) = sse_event_and_data(block);
        let Some(data) = data else { return Vec::new() };
        if data.trim() == "[DONE]" {
            return if self.stop_reason.is_some() {
                self.finalize()
            } else {
                self.failed_events(
                    "Anthropic stream has no stop reason".into(),
                    Some("incomplete_upstream_stream".into()),
                )
            };
        }
        let Ok(value) = serde_json::from_str::<Value>(&data) else {
            return self.failed_events(
                "Invalid JSON in upstream SSE data".into(),
                Some("invalid_stream_event".into()),
            );
        };
        let event_type = value["type"]
            .as_str()
            .or(event_name.as_deref())
            .unwrap_or("");
        if event_type == "error" || value.get("error").is_some_and(|error| !error.is_null()) {
            let (message, error_type) = extract_chat_sse_error(&value);
            return self.failed_events(message, error_type);
        }
        let result = match event_type {
            "message_start" => {
                if self.response_started {
                    Err(anyhow::anyhow!("duplicate or late message_start"))
                } else {
                    let message = value.get("message").unwrap_or(&value);
                    if message.get("role").is_some_and(|role| role != "assistant") {
                        return self.failed_events(
                            "Anthropic message role is not assistant".into(),
                            Some("invalid_stream_event".into()),
                        );
                    }
                    if let Some(id) = message["id"].as_str() {
                        self.response_id = response_id_from_chat_id(Some(id));
                    }
                    if let Some(model) = message["model"].as_str().filter(|model| !model.is_empty())
                    {
                        self.model = model.to_string();
                    }
                    self.merge_usage(&message["usage"]);
                    Ok(self.ensure_started())
                }
            }
            "content_block_start" => self.start_block(&value),
            "content_block_delta" => self.delta_block(&value),
            "content_block_stop" => self.stop_block(&value),
            "message_delta" => {
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    self.stop_reason = Some(reason.to_string());
                }
                self.merge_usage(&value["usage"]);
                Ok(Vec::new())
            }
            "message_stop" => {
                if !self.response_started {
                    Err(anyhow::anyhow!("message_stop before message_start"))
                } else {
                    Ok(self.finalize())
                }
            }
            "ping" => Ok(Vec::new()),
            _ => Err(anyhow::anyhow!("unsupported Anthropic event")),
        };
        result.unwrap_or_else(|error| {
            self.failed_events(error.to_string(), Some("invalid_stream_event".into()))
        })
    }

    fn block_index(value: &Value) -> anyhow::Result<usize> {
        value["index"]
            .as_u64()
            .and_then(|index| usize::try_from(index).ok())
            .ok_or_else(|| anyhow::anyhow!("missing Anthropic block index"))
    }

    fn start_block(&mut self, value: &Value) -> anyhow::Result<Vec<String>> {
        let index = Self::block_index(value)?;
        if self.blocks.contains_key(&index) {
            anyhow::bail!("duplicate Anthropic block index");
        }
        let native = value.get("content_block").cloned().unwrap_or(Value::Null);
        validate_anthropic_blocks(&json!([native]))?;
        let mut events = self.ensure_started();
        let output_index = u32::try_from(self.blocks.len())?;
        let mut item_id = format!("{}_msg_{output_index}", self.response_id);
        let mut accum = String::new();
        let mut start_input = String::new();
        match native["type"].as_str().unwrap_or("") {
            "text" => {
                events.push(sse::message_item_added(output_index, &item_id));
                events.push(sse::message_content_part_added(output_index, &item_id));
                accum = native["text"].as_str().unwrap_or("").to_string();
                if !accum.is_empty() {
                    events.push(sse::output_text_delta(output_index, &item_id, &accum));
                }
            }
            "thinking" | "redacted_thinking" => {
                item_id = format!("rs_{}_{output_index}", self.response_id);
                events.push(sse::reasoning_item_added(output_index, &item_id));
                if native["type"] == "thinking" {
                    events.push(sse::reasoning_summary_part_added(output_index, &item_id));
                    accum = native["thinking"].as_str().unwrap_or("").to_string();
                    if !accum.is_empty() {
                        events.push(sse::reasoning_summary_text_delta(
                            output_index,
                            &item_id,
                            &accum,
                        ));
                    }
                }
            }
            "tool_use" => {
                let call_id = native["id"].as_str().unwrap_or("");
                let name = native["name"].as_str().unwrap_or("");
                if call_id.is_empty()
                    || name.is_empty()
                    || self.blocks.values().any(|block| {
                        block.native["type"] == "tool_use" && block.native["id"] == call_id
                    })
                {
                    anyhow::bail!("missing or duplicate Anthropic tool identity");
                }
                if let Some(input) = native.get("input") {
                    if !input.is_object() {
                        anyhow::bail!("Anthropic tool input must be an object");
                    }
                    start_input = canonical_json_string(input);
                }
                let mut item = response_tool_call_item(call_id, name, "", &self.tool_context);
                item["status"] = json!("in_progress");
                item_id = item["id"].as_str().unwrap_or("").to_string();
                events.push(sse::output_item_added(output_index, &item));
            }
            _ => unreachable!(),
        }
        self.blocks.insert(
            index,
            BlockState {
                output_index,
                item_id,
                native,
                accum,
                start_input,
                stopped: false,
                done: false,
            },
        );
        Ok(events)
    }

    fn delta_block(&mut self, value: &Value) -> anyhow::Result<Vec<String>> {
        let index = Self::block_index(value)?;
        let block = self
            .blocks
            .get_mut(&index)
            .ok_or_else(|| anyhow::anyhow!("Anthropic delta without block"))?;
        if block.stopped || block.done {
            anyhow::bail!("Anthropic delta after content_block_stop");
        }
        let delta = &value["delta"];
        let kind = delta["type"].as_str().unwrap_or("");
        let field = match (block.native["type"].as_str().unwrap_or(""), kind) {
            ("text", "text_delta") => "text",
            ("thinking", "thinking_delta") => "thinking",
            ("thinking", "signature_delta") => "signature",
            ("tool_use", "input_json_delta") => "partial_json",
            _ => anyhow::bail!("Anthropic delta type does not match its block"),
        };
        let fragment = delta[field]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Anthropic delta must contain text"))?;
        if kind == "signature_delta" {
            block.native["signature"] = json!(format!(
                "{}{}",
                block.native["signature"].as_str().unwrap_or(""),
                fragment
            ));
            return Ok(Vec::new());
        }
        block.accum.push_str(fragment);
        match kind {
            "text_delta" => Ok(vec![sse::output_text_delta(
                block.output_index,
                &block.item_id,
                fragment,
            )]),
            "thinking_delta" => {
                block.native["thinking"] = json!(block.accum);
                Ok(vec![sse::reasoning_summary_text_delta(
                    block.output_index,
                    &block.item_id,
                    fragment,
                )])
            }
            "input_json_delta" => {
                let name = block.native["name"].as_str().unwrap_or("");
                if name == "Read" || self.tool_context.is_custom_tool_proxy(name) {
                    Ok(Vec::new())
                } else {
                    Ok(vec![sse::function_call_arguments_delta(
                        block.output_index,
                        &block.item_id,
                        fragment,
                    )])
                }
            }
            _ => unreachable!(),
        }
    }

    fn stop_block(&mut self, value: &Value) -> anyhow::Result<Vec<String>> {
        let index = Self::block_index(value)?;
        let block = self
            .blocks
            .get_mut(&index)
            .ok_or_else(|| anyhow::anyhow!("Anthropic stop without block"))?;
        if block.stopped {
            anyhow::bail!("duplicate Anthropic content_block_stop");
        }
        block.stopped = true;
        // Await the message's stop reason before publishing executable tool output.
        if block.native["type"] == "tool_use" {
            return Ok(Vec::new());
        }
        self.close_block(index, false)
    }

    fn close_block(&mut self, index: usize, incomplete: bool) -> anyhow::Result<Vec<String>> {
        let block = self.blocks.get_mut(&index).unwrap();
        if block.done {
            return Ok(Vec::new());
        }
        let (events, item) = match block.native["type"].as_str().unwrap_or("") {
            "text" => sse::message_close(block.output_index, &block.item_id, &block.accum),
            "thinking" | "redacted_thinking" => {
                if block.native["type"] == "thinking" {
                    block.native["thinking"] = json!(block.accum);
                }
                let item =
                    responses_reasoning_item_from_anthropic_block(&block.item_id, &block.native)
                        .unwrap_or_else(|| sse::reasoning_item(&block.item_id, &block.accum));
                let events = sse::reasoning_close_with_item(
                    block.output_index,
                    &block.item_id,
                    &block.accum,
                    &item,
                    block.native["type"] == "thinking",
                );
                (events, item)
            }
            "tool_use" => {
                let raw = if block.accum.trim().is_empty() {
                    if block.start_input.is_empty() {
                        "{}"
                    } else {
                        &block.start_input
                    }
                } else {
                    &block.accum
                };
                let name = block.native["name"].as_str().unwrap_or("");
                let parsed = serde_json::from_str::<Value>(raw).ok();
                if !incomplete && parsed.as_ref().is_none_or(|input| !input.is_object()) {
                    anyhow::bail!("invalid Anthropic tool input JSON");
                }
                let arguments = parsed
                    .map(|input| canonical_json_string(&sanitize_tool_input(name, input)))
                    .unwrap_or_else(|| raw.to_string());
                let mut item = response_tool_call_item(
                    block.native["id"].as_str().unwrap_or(""),
                    name,
                    &arguments,
                    &self.tool_context,
                );
                let mut events = Vec::new();
                if incomplete {
                    item["status"] = json!("incomplete");
                } else {
                    if item["type"] == "custom_tool_call" {
                        let input = item["input"].as_str().unwrap_or("");
                        events.push(sse::custom_tool_call_input_delta(
                            block.output_index,
                            &block.item_id,
                            input,
                        ));
                        events.push(sse::custom_tool_call_input_done(
                            block.output_index,
                            &block.item_id,
                            input,
                        ));
                    } else {
                        events.push(sse::function_call_arguments_done(
                            block.output_index,
                            &block.item_id,
                            &arguments,
                        ));
                    }
                    events.push(sse::output_item_done(block.output_index, &item));
                }
                (events, item)
            }
            _ => unreachable!(),
        };
        block.done = true;
        self.output_items.insert(block.output_index, item);
        Ok(events)
    }

    fn finalize(&mut self) -> Vec<String> {
        if self.completed {
            return Vec::new();
        }
        let mut events = self.ensure_started();
        let (status, reason) = map_anthropic_stop_reason_to_status(self.stop_reason.as_deref());
        let keys: Vec<_> = self.blocks.keys().copied().collect();
        // Validate all complete tools before publishing any executable done event.
        if status == "completed" {
            for block in self
                .blocks
                .values()
                .filter(|block| block.native["type"] == "tool_use")
            {
                let raw = if block.accum.trim().is_empty() {
                    if block.start_input.is_empty() {
                        "{}"
                    } else {
                        &block.start_input
                    }
                } else {
                    &block.accum
                };
                if serde_json::from_str::<Value>(raw)
                    .ok()
                    .is_none_or(|input| !input.is_object())
                {
                    events.extend(self.failed_events(
                        "Invalid Anthropic tool input JSON".into(),
                        Some("invalid_tool_arguments".into()),
                    ));
                    return events;
                }
            }
        }
        for index in keys {
            match self.close_block(index, status == "incomplete") {
                Ok(closed) => events.extend(closed),
                Err(_) => {
                    events.extend(self.failed_events(
                        "Invalid Anthropic content block".into(),
                        Some("invalid_stream_event".into()),
                    ));
                    return events;
                }
            }
        }
        let mut response = self.base_response(status);
        if let Some(reason) = reason {
            response["incomplete_details"] = json!({"reason":reason});
        }
        // Ordinary Codex turns require completed framing even for limited generation.
        events.push(sse::response_completed(&response));
        self.completed = true;
        events
    }

    fn failed_events(&mut self, message: String, error_type: Option<String>) -> Vec<String> {
        if self.completed {
            return Vec::new();
        }
        let mut events = self.ensure_started();
        let keys: Vec<_> = self.blocks.keys().copied().collect();
        for index in keys {
            // Preserve buffered partial output but never authorize a tool on failure.
            let _ = self.close_block(index, true);
        }
        let mut response = self.base_response("failed");
        response["error"] = json!({"message":message,"code":error_type.clone().unwrap_or_else(|| "upstream_stream_error".into())});
        if let Some(error_type) = error_type {
            response["error"]["type"] = json!(error_type);
        }
        events.push(sse::response_failed(&response));
        self.failed = true;
        self.completed = true;
        self.buffer.clear();
        self.utf8_remainder.clear();
        events
    }
}
