//! Adapted from cc-switch 99277921 (MIT, see THIRD_PARTY_NOTICES.md).
//! Shared builders for the OpenAI Responses SSE envelope.
//!
//! Native Anthropic blocks emit the Responses envelope without an intermediate
//! Chat Completions state machine.
//!
//! Each function is pure — it takes primitives or a caller-built `item` `Value` and
//! returns the exact bytes the converters previously constructed inline. Item shapes that
//! vary per converter (including function, namespace, custom, and tool-search calls)
//! are supplied by the caller via the generic
//! `output_item_added` / `output_item_done` helpers.

use serde_json::{Value, json};

/// Serialize one Responses SSE event with the standard `event:`/`data:` framing.
pub(super) fn sse_event(event: &str, data: Value) -> String {
    format!("event: {event}\ndata: {data}\n\n")
}

// ---------------------------------------------------------------------------
// Response lifecycle (created / in_progress / completed / failed)
// ---------------------------------------------------------------------------

/// `response.created`, wrapping a caller-built `response` object (usage/created_at differ
/// per converter, so the caller supplies the whole object).
pub(super) fn response_created(response: &Value) -> String {
    sse_event(
        "response.created",
        json!({ "type": "response.created", "response": response }),
    )
}

/// `response.in_progress`.
pub(super) fn response_in_progress(response: &Value) -> String {
    sse_event(
        "response.in_progress",
        json!({ "type": "response.in_progress", "response": response }),
    )
}

/// `response.completed`.
pub(super) fn response_completed(response: &Value) -> String {
    sse_event(
        "response.completed",
        json!({ "type": "response.completed", "response": response }),
    )
}

/// `response.failed`.
pub(super) fn response_failed(response: &Value) -> String {
    sse_event(
        "response.failed",
        json!({ "type": "response.failed", "response": response }),
    )
}

// ---------------------------------------------------------------------------
// Generic output-item add/done (item value supplied by the caller)
// ---------------------------------------------------------------------------

/// `response.output_item.added` with a caller-built item (message / reasoning /
/// function_call / custom_tool_call).
pub(super) fn output_item_added(output_index: u32, item: &Value) -> String {
    sse_event(
        "response.output_item.added",
        json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": item
        }),
    )
}

/// `response.output_item.done` with a caller-built item.
pub(super) fn output_item_done(output_index: u32, item: &Value) -> String {
    sse_event(
        "response.output_item.done",
        json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": item
        }),
    )
}

// ---------------------------------------------------------------------------
// Assistant message (text) lifecycle
// ---------------------------------------------------------------------------

/// `response.output_item.added` for an in-progress assistant message.
pub(super) fn message_item_added(output_index: u32, item_id: &str) -> String {
    output_item_added(
        output_index,
        &json!({
            "id": item_id,
            "type": "message",
            "status": "in_progress",
            "role": "assistant",
            "content": []
        }),
    )
}

/// `response.content_part.added` for the (empty) output_text part of a message.
pub(super) fn message_content_part_added(output_index: u32, item_id: &str) -> String {
    sse_event(
        "response.content_part.added",
        json!({
            "type": "response.content_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": "", "annotations": [] }
        }),
    )
}

/// `response.output_text.delta`.
pub(super) fn output_text_delta(output_index: u32, item_id: &str, delta: &str) -> String {
    sse_event(
        "response.output_text.delta",
        json!({
            "type": "response.output_text.delta",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "delta": delta
        }),
    )
}

/// The completed assistant-message item value.
pub(super) fn message_item(item_id: &str, text: &str) -> Value {
    json!({
        "id": item_id,
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{ "type": "output_text", "text": text, "annotations": [] }]
    })
}

/// Close an assistant message: emits `output_text.done` → `content_part.done` →
/// `output_item.done`, and returns the completed item so the caller can record it.
pub(super) fn message_close(output_index: u32, item_id: &str, text: &str) -> (Vec<String>, Value) {
    let item = message_item(item_id, text);
    let events = vec![
        sse_event(
            "response.output_text.done",
            json!({
                "type": "response.output_text.done",
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "text": text
            }),
        ),
        sse_event(
            "response.content_part.done",
            json!({
                "type": "response.content_part.done",
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": { "type": "output_text", "text": text, "annotations": [] }
            }),
        ),
        output_item_done(output_index, &item),
    ];
    (events, item)
}

// ---------------------------------------------------------------------------
// Reasoning (summary) lifecycle
// ---------------------------------------------------------------------------

/// `response.output_item.added` for an in-progress reasoning item.
pub(super) fn reasoning_item_added(output_index: u32, item_id: &str) -> String {
    output_item_added(
        output_index,
        &json!({
            "id": item_id,
            "type": "reasoning",
            "status": "in_progress",
            "summary": []
        }),
    )
}

/// `response.reasoning_summary_part.added` for the (empty) summary part.
pub(super) fn reasoning_summary_part_added(output_index: u32, item_id: &str) -> String {
    sse_event(
        "response.reasoning_summary_part.added",
        json!({
            "type": "response.reasoning_summary_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": "" }
        }),
    )
}

/// `response.reasoning_summary_text.delta`.
pub(super) fn reasoning_summary_text_delta(
    output_index: u32,
    item_id: &str,
    delta: &str,
) -> String {
    sse_event(
        "response.reasoning_summary_text.delta",
        json!({
            "type": "response.reasoning_summary_text.delta",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "delta": delta
        }),
    )
}

/// The completed reasoning item value (note: no `status` field, matching both converters).
pub(super) fn reasoning_item(item_id: &str, text: &str) -> Value {
    json!({
        "id": item_id,
        "type": "reasoning",
        "summary": [{ "type": "summary_text", "text": text }]
    })
}

/// Close a reasoning item whose completed shape is supplied by the converter.
/// Anthropic uses this to attach opaque signed/redacted thinking in
/// `encrypted_content` while keeping the standard Responses event lifecycle.
pub(super) fn reasoning_close_with_item(
    output_index: u32,
    item_id: &str,
    text: &str,
    item: &Value,
    has_visible_summary: bool,
) -> Vec<String> {
    let mut events = Vec::new();
    if has_visible_summary {
        events.extend([
            sse_event(
                "response.reasoning_summary_text.done",
                json!({
                    "type": "response.reasoning_summary_text.done",
                    "item_id": item_id,
                    "output_index": output_index,
                    "summary_index": 0,
                    "text": text
                }),
            ),
            sse_event(
                "response.reasoning_summary_part.done",
                json!({
                    "type": "response.reasoning_summary_part.done",
                    "item_id": item_id,
                    "output_index": output_index,
                    "summary_index": 0,
                    "part": { "type": "summary_text", "text": text }
                }),
            ),
        ]);
    }
    events.push(output_item_done(output_index, item));
    events
}

// ---------------------------------------------------------------------------
// Tool-call argument streaming (item value supplied by the caller)
// ---------------------------------------------------------------------------

/// `response.function_call_arguments.delta`.
pub(super) fn function_call_arguments_delta(
    output_index: u32,
    item_id: &str,
    delta: &str,
) -> String {
    sse_event(
        "response.function_call_arguments.delta",
        json!({
            "type": "response.function_call_arguments.delta",
            "item_id": item_id,
            "output_index": output_index,
            "delta": delta
        }),
    )
}

/// `response.function_call_arguments.done`.
pub(super) fn function_call_arguments_done(
    output_index: u32,
    item_id: &str,
    arguments: &str,
) -> String {
    sse_event(
        "response.function_call_arguments.done",
        json!({
            "type": "response.function_call_arguments.done",
            "item_id": item_id,
            "output_index": output_index,
            "arguments": arguments
        }),
    )
}

/// `response.custom_tool_call_input.delta` (Chat freeform tools only).
pub(super) fn custom_tool_call_input_delta(
    output_index: u32,
    item_id: &str,
    delta: &str,
) -> String {
    sse_event(
        "response.custom_tool_call_input.delta",
        json!({
            "type": "response.custom_tool_call_input.delta",
            "item_id": item_id,
            "output_index": output_index,
            "delta": delta
        }),
    )
}

/// `response.custom_tool_call_input.done` (Chat freeform tools only).
pub(super) fn custom_tool_call_input_done(output_index: u32, item_id: &str, input: &str) -> String {
    sse_event(
        "response.custom_tool_call_input.done",
        json!({
            "type": "response.custom_tool_call_input.done",
            "item_id": item_id,
            "output_index": output_index,
            "input": input
        }),
    )
}
