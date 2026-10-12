use alunixa_x_core::protocol_proxy::{
    NativeSseToResponsesConverter, UpstreamWireApi, anthropic_message_to_response_with_request,
    responses_to_anthropic_messages,
};
use serde_json::{Value, json};

fn frame(value: Value) -> String {
    format!(
        "event: {}\ndata: {value}\n\n",
        value["type"].as_str().unwrap()
    )
}

fn events(bytes: &[u8]) -> Vec<Value> {
    std::str::from_utf8(bytes)
        .unwrap()
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|data| serde_json::from_str(data).ok())
        .collect()
}

fn stream(values: Vec<Value>, request: Value) -> Vec<Value> {
    let mut converter =
        NativeSseToResponsesConverter::with_request(UpstreamWireApi::AnthropicMessages, &request);
    let mut output = Vec::new();
    for value in values {
        for byte in frame(value).as_bytes() {
            output.extend(converter.push_bytes(&[*byte]));
        }
    }
    output.extend(converter.finish());
    events(&output)
}

fn start() -> Value {
    json!({"type":"message_start","message":{"id":"msg_fixture","model":"claude-opus-4-6","usage":{"input_tokens":12,"cache_read_input_tokens":3,"cache_creation_input_tokens":4}}})
}

fn end(reason: &str) -> Vec<Value> {
    vec![
        json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":5}}),
        json!({"type":"message_stop"}),
    ]
}

fn terminal(values: &[Value]) -> &Value {
    values
        .iter()
        .rev()
        .find(|event| {
            matches!(
                event["type"].as_str(),
                Some("response.completed" | "response.incomplete" | "response.failed")
            )
        })
        .expect("one terminal response")
}

#[test]
fn resumed_history_has_a_leading_user_and_no_empty_text_blocks() {
    let request = responses_to_anthropic_messages(json!({
        "input":[
            {"role":"assistant","content":[{"type":"output_text","text":" "},{"type":"output_text","text":"old answer"}]},
            {"role":"user","content":"continue"}
        ]
    }))
    .unwrap();
    assert_eq!(request["messages"][0]["role"], "user");
    assert_eq!(
        request["messages"][0]["content"][0]["text"],
        "(continuing the conversation)"
    );
    assert_eq!(
        request["messages"][1]["content"].as_array().unwrap().len(),
        1
    );
}

#[test]
fn parallel_results_are_grouped_before_user_text() {
    let request = responses_to_anthropic_messages(json!({"input":[
        {"role":"user","content":"inspect"},
        {"type":"function_call","call_id":"a","name":"first","arguments":"{}"},
        {"type":"function_call","call_id":"b","name":"second","arguments":"{}"},
        {"type":"function_call_output","call_id":"a","output":"one"},
        {"role":"user","content":"and continue"},
        {"type":"function_call_output","call_id":"b","output":"two"}
    ]}))
    .unwrap();
    assert_eq!(request["messages"].as_array().unwrap().len(), 3);
    let blocks = request["messages"][2]["content"].as_array().unwrap();
    assert_eq!(blocks[0]["tool_use_id"], "a");
    assert_eq!(blocks[1]["tool_use_id"], "b");
    assert_eq!(blocks[2]["text"], "and continue");
}

#[test]
fn unsigned_tool_continuation_does_not_enable_thinking() {
    let request = responses_to_anthropic_messages(json!({
        "model":"claude-opus-4-6",
        "reasoning":{"effort":"high"},
        "input":[
            {"role":"user","content":"inspect"},
            {"type":"function_call","call_id":"x","name":"exec","arguments":"{}"},
            {"type":"function_call_output","call_id":"x","output":"ok"}
        ]
    }))
    .unwrap();
    assert_eq!(request["thinking"]["type"], "disabled");
    assert!(request.get("output_config").is_none());
}

#[test]
fn forced_tool_choice_disables_thinking_without_weakening_the_constraint() {
    let request = responses_to_anthropic_messages(json!({
        "model":"claude-opus-4-6","input":"inspect","reasoning":{"effort":"high"},
        "tools":[{"type":"function","name":"exec","parameters":{"type":"object"}}],
        "tool_choice":"required","parallel_tool_calls":false,"temperature":0.3
    }))
    .unwrap();
    assert_eq!(request["thinking"]["type"], "disabled");
    assert!(request.get("output_config").is_none());
    assert_eq!(request["tool_choice"]["type"], "any");
    assert_eq!(request["tool_choice"]["disable_parallel_tool_use"], true);
    assert_eq!(request["temperature"], 0.3);
}

#[test]
fn thinking_requests_do_not_forward_incompatible_sampling_options() {
    let request = responses_to_anthropic_messages(json!({
        "model":"claude-opus-4-6","input":"hello","reasoning":{"effort":"high"},
        "temperature":0.3,"top_p":0.8
    }))
    .unwrap();
    assert_eq!(request["thinking"]["type"], "adaptive");
    assert!(request.get("temperature").is_none());
    assert!(request.get("top_p").is_none());
}

#[test]
fn old_claude_uses_a_budget_that_leaves_answer_headroom() {
    let request = responses_to_anthropic_messages(json!({
        "model":"claude-sonnet-4-5","input":"hello","reasoning":{"effort":"high"},
        "max_output_tokens":4096
    }))
    .unwrap();
    assert_eq!(request["max_tokens"], 4096);
    assert_eq!(
        request["thinking"],
        json!({"type":"enabled","budget_tokens":2048})
    );
    assert!(request.get("output_config").is_none());
}

#[test]
fn codex_transport_cache_fields_do_not_block_anthropic_requests() {
    let request = responses_to_anthropic_messages(json!({
        "model":"claude-opus-4-6","input":"hello","store":false,
        "prompt_cache_key":"fixture","prompt_cache_retention":"24h","service_tier":"auto",
        "client_metadata":{"session_id":"fixture"}
    }))
    .unwrap();
    for field in [
        "prompt_cache_key",
        "prompt_cache_retention",
        "client_metadata",
        "service_tier",
    ] {
        assert!(
            request.get(field).is_none(),
            "{field} is not an Anthropic wire field"
        );
    }
}

#[test]
fn tool_definitions_omit_null_description_and_preserve_strict() {
    let request = responses_to_anthropic_messages(json!({
        "input":"hello",
        "tools":[{"type":"function","name":"exec","strict":true,"parameters":{"type":"object","properties":{}}}]
    }))
    .unwrap();
    assert!(request["tools"][0].get("description").is_none());
    assert_eq!(request["tools"][0]["strict"], true);
}

#[test]
fn max_tokens_finishes_with_the_codex_completed_envelope() {
    let mut values = vec![
        start(),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"partial answer"}}),
        json!({"type":"content_block_stop","index":0}),
    ];
    values.extend(end("max_tokens"));
    let result = stream(values, json!({}));
    let last = terminal(&result);
    assert_eq!(last["type"], "response.completed");
    assert_eq!(last["response"]["status"], "incomplete");
    assert_eq!(
        last["response"]["incomplete_details"]["reason"],
        "max_output_tokens"
    );
    assert_eq!(last["response"]["usage"]["input_tokens"], 19);
    assert_eq!(last["response"]["usage"]["output_tokens"], 5);
    assert_eq!(
        last["response"]["usage"]["input_tokens_details"]["cached_tokens"],
        3
    );
    assert_eq!(
        last["response"]["usage"]["input_tokens_details"]["cache_write_tokens"],
        4
    );
}

#[test]
fn content_blocks_close_independently_and_keep_wire_order() {
    let mut converter =
        NativeSseToResponsesConverter::with_request(UpstreamWireApi::AnthropicMessages, &json!({}));
    let mut output = converter.push_bytes(frame(start()).as_bytes());
    output.extend(converter.push_bytes(frame(json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"before"}})).as_bytes()));
    let closed =
        converter.push_bytes(frame(json!({"type":"content_block_stop","index":0})).as_bytes());
    assert!(
        events(&closed)
            .iter()
            .any(|e| e["type"] == "response.output_item.done")
    );
    output.extend(closed);
    for value in [
        json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"x","name":"exec","input":{}}}),
        json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}),
        json!({"type":"content_block_stop","index":1}),
        json!({"type":"content_block_start","index":2,"content_block":{"type":"text","text":"after"}}),
        json!({"type":"content_block_stop","index":2}),
    ]
    .into_iter()
    .chain(end("tool_use"))
    {
        output.extend(converter.push_bytes(frame(value).as_bytes()));
    }
    let result = events(&output);
    let items = terminal(&result)["response"]["output"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0]["content"][0]["text"], "before");
    assert_eq!(items[1]["type"], "function_call");
    assert_eq!(items[2]["content"][0]["text"], "after");
    for (i, event) in result.iter().enumerate() {
        assert_eq!(event["sequence_number"], i as u64);
    }
}

#[test]
fn streamed_arguments_override_the_gateway_start_input() {
    let mut values = vec![
        start(),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"x","name":"exec","input":{"cmd":"placeholder"}}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"cmd\":\"actual\"}"}}),
        json!({"type":"content_block_stop","index":0}),
    ];
    values.extend(end("tool_use"));
    let result = stream(values, json!({}));
    assert_eq!(terminal(&result)["type"], "response.completed");
    assert_eq!(
        serde_json::from_str::<Value>(
            terminal(&result)["response"]["output"][0]["arguments"]
                .as_str()
                .unwrap()
        )
        .unwrap(),
        json!({"cmd":"actual"})
    );
}

#[test]
fn truncated_tool_arguments_are_preserved_but_never_executable() {
    let mut values = vec![
        start(),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"x","name":"exec","input":{}}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"cmd\":"}}),
        json!({"type":"content_block_stop","index":0}),
    ];
    values.extend(end("max_tokens"));
    let result = stream(values, json!({}));
    assert_eq!(terminal(&result)["type"], "response.completed");
    assert_eq!(terminal(&result)["response"]["status"], "incomplete");
    assert_eq!(
        terminal(&result)["response"]["output"][0]["arguments"],
        "{\"cmd\":"
    );
    assert_eq!(
        terminal(&result)["response"]["output"][0]["status"],
        "incomplete"
    );
    assert!(
        !result
            .iter()
            .any(|e| e["type"] == "response.function_call_arguments.done")
    );
    assert!(
        !result
            .iter()
            .any(|e| e["type"] == "response.output_item.done"
                && e["item"]["type"] == "function_call")
    );
}

#[test]
fn signed_reasoning_is_closed_and_replayed_in_the_same_tool_turn() {
    let mut values = vec![
        start(),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"思考🐱"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"thinking"}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"x","name":"exec","input":{"cmd":"pwd"}}}),
        json!({"type":"content_block_stop","index":1}),
    ];
    values.extend(end("tool_use"));
    let result = stream(values, json!({"model":"claude-opus-4-6"}));
    let items = terminal(&result)["response"]["output"].as_array().unwrap();
    assert_eq!(
        items.len(),
        2,
        "one reasoning item per native block, no synthetic whole-response replay"
    );
    assert!(
        items[0]["encrypted_content"]
            .as_str()
            .unwrap()
            .starts_with("ccswitch-anthropic-thinking-v1:")
    );
    let mut input = vec![json!({"role":"user","content":"inspect"})];
    input.extend(items.clone());
    input.push(json!({"type":"function_call_output","call_id":"x","output":"ok"}));
    let replay = responses_to_anthropic_messages(json!({
        "model":"claude-opus-4-6","reasoning":{"effort":"high"},"input":input
    }))
    .unwrap();
    assert_eq!(replay["thinking"]["type"], "adaptive");
    assert_eq!(
        replay["messages"][1]["content"][0],
        json!({"type":"thinking","thinking":"思考🐱","signature":"signed-thinking"})
    );
    assert_eq!(replay["messages"][1]["content"][1]["id"], "x");
}

#[test]
fn json_conversion_does_not_flatten_separate_native_content_blocks() {
    let response = anthropic_message_to_response_with_request(
        json!({
            "id":"msg_fixture","content":[
                {"type":"text","text":"before"},
                {"type":"thinking","thinking":"thought","signature":"signed"},
                {"type":"text","text":"after"}
            ],"stop_reason":"end_turn"
        }),
        &json!({}),
    )
    .unwrap();
    let output = response["output"].as_array().unwrap();
    assert_eq!(output.len(), 3);
    assert_eq!(output[0]["content"][0]["text"], "before");
    assert_eq!(output[1]["summary"][0]["text"], "thought");
    assert_eq!(output[2]["content"][0]["text"], "after");
}

#[test]
fn stream_failures_and_duplicate_terminal_events_never_become_success() {
    for data in [
        b"data: {broken}\n\n".as_slice(),
        b"data: \xff\n\n".as_slice(),
    ] {
        let mut converter = NativeSseToResponsesConverter::with_request(
            UpstreamWireApi::AnthropicMessages,
            &json!({}),
        );
        let mut output = converter.push_bytes(data);
        output.extend(converter.finish());
        assert_eq!(terminal(&events(&output))["type"], "response.failed");
    }
    let mut converter =
        NativeSseToResponsesConverter::with_request(UpstreamWireApi::AnthropicMessages, &json!({}));
    let mut output = converter.push_bytes(frame(start()).as_bytes());
    output.extend(converter.push_bytes(
        frame(json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}})).as_bytes(),
    ));
    assert!(!converter.is_completed());
    output.extend(converter.push_bytes(frame(json!({"type":"message_stop"})).as_bytes()));
    assert!(converter.is_completed());
    assert!(
        converter
            .push_bytes(frame(json!({"type":"message_stop"})).as_bytes())
            .is_empty()
    );
    assert!(converter.fail("late failure".into(), None).is_empty());
    assert!(converter.finish().is_empty());
    assert_eq!(
        events(&output)
            .iter()
            .filter(|e| e["type"] == "response.completed")
            .count(),
        1
    );
}
