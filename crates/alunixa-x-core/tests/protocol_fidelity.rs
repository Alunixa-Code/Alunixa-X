use alunixa_x_core::protocol_proxy::*;
use serde_json::{Value, json};

fn frame(value: Value) -> String {
    format!("data: {value}\n\n")
}

fn events(bytes: &[u8]) -> Vec<Value> {
    std::str::from_utf8(bytes)
        .unwrap()
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|data| serde_json::from_str(data).ok())
        .collect()
}

fn terminal(events: &[Value]) -> &Value {
    &events
        .iter()
        .rev()
        .find(|event| {
            matches!(
                event["type"].as_str(),
                Some("response.completed" | "response.failed" | "response.incomplete")
            )
        })
        .expect("terminal event")["response"]
}

#[test]
fn stream_retains_usage_after_finish_reason_and_terminal_is_exactly_once() {
    let mut converter = ChatSseToResponsesConverter::with_request(&json!({"stream":true}));
    let mut bytes = converter.push_bytes(
        frame(json!({"id":"c","choices":[{"delta":{"content":"答案"},"finish_reason":"stop"}]}))
            .as_bytes(),
    );
    assert!(!converter.is_completed(), "usage trailer has not arrived");
    bytes.extend(converter.push_bytes(
        frame(json!({"id":"c","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7,"total_tokens":19}})).as_bytes()
    ));
    bytes.extend(converter.push_bytes(b"data: [DONE]\n\n"));
    bytes.extend(converter.finish());
    bytes.extend(converter.fail("late failure".into(), None));
    bytes.extend(
        converter
            .push_bytes(frame(json!({"choices":[{"delta":{"content":"duplicate"}}]})).as_bytes()),
    );
    let events = events(&bytes);
    assert_eq!(terminal(&events)["usage"]["input_tokens"], 12);
    assert_eq!(terminal(&events)["usage"]["output_tokens"], 7);
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "response.completed")
            .count(),
        1
    );
    assert!(!events.iter().any(|e| e["type"] == "response.failed"));
    for (index, event) in events.iter().enumerate() {
        assert_eq!(event["sequence_number"], index as u64);
    }
}

#[test]
fn stream_eof_flushes_last_frame_but_never_completes_truncated_generation() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(
        "data: {\"choices\":[{\"delta\":{\"content\":\"完整🐱\"},\"finish_reason\":\"stop\"}]}"
            .as_bytes(),
    );
    bytes.extend(converter.finish());
    let result = events(&bytes);
    assert_eq!(
        terminal(&result)["output"][0]["content"][0]["text"],
        "完整🐱"
    );
    assert_eq!(terminal(&result)["status"], "completed");

    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter
        .push_bytes(frame(json!({"choices":[{"delta":{"content":"partial"}}]})).as_bytes());
    bytes.extend(converter.finish());
    assert_eq!(terminal(&events(&bytes))["status"], "failed");
}

#[test]
fn malformed_json_and_invalid_utf8_are_failures_not_silent_loss() {
    for data in [
        b"data: {broken}\n\n".as_slice(),
        b"data: {\"choices\":[]}\xff\n\n".as_slice(),
    ] {
        let mut converter = ChatSseToResponsesConverter::default();
        let mut bytes = converter.push_bytes(data);
        bytes.extend(converter.finish());
        assert_eq!(terminal(&events(&bytes))["status"], "failed");
        assert!(!String::from_utf8(bytes).unwrap().contains('\u{fffd}'));
    }
}

#[test]
fn stream_supports_cr_lines_and_every_utf8_boundary() {
    let data = "data: {\"choices\":[{\"delta\":{\"content\":\"你好🐱\"},\"finish_reason\":\"stop\"}]}\r\rdata: [DONE]\r\r";
    for split in 0..=data.len() {
        let mut converter = ChatSseToResponsesConverter::default();
        let mut bytes = converter.push_bytes(&data.as_bytes()[..split]);
        bytes.extend(converter.push_bytes(&data.as_bytes()[split..]));
        bytes.extend(converter.finish());
        assert_eq!(
            terminal(&events(&bytes))["output"][0]["content"][0]["text"],
            "你好🐱",
            "split {split}"
        );
    }
}

#[test]
fn tool_identity_waits_for_name_and_arguments_are_never_rewritten() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(
        frame(
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{}}]}}]}),
        )
        .as_bytes(),
    );
    assert!(
        !events(&bytes)
            .iter()
            .any(|e| e["type"] == "response.output_item.added")
    );
    bytes.extend(converter.push_bytes(frame(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"exec","arguments":" { \"cmd\": \"你好\" } "}}]},"finish_reason":"tool_calls"}]})).as_bytes()));
    bytes.extend(converter.finish());
    let result = events(&bytes);
    let added = result
        .iter()
        .find(|e| e["type"] == "response.output_item.added")
        .unwrap();
    assert_eq!(added["item"]["name"], "exec");
    assert_eq!(
        terminal(&result)["output"][0]["arguments"],
        " { \"cmd\": \"你好\" } "
    );
}

#[test]
fn incomplete_tool_arguments_do_not_become_executable_done_events() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(frame(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"exec","arguments":"{\"cmd\":"}}]},"finish_reason":"length"}]})).as_bytes());
    bytes.extend(converter.finish());
    let result = events(&bytes);
    assert_eq!(terminal(&result)["status"], "incomplete");
    assert!(!result.iter().any(|e| e["type"] == "response.completed"));
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
fn interleaved_reasoning_and_legacy_function_call_stay_typed() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = Vec::new();
    for delta in [
        json!({"reasoning_content":"first"}),
        json!({"content":"answer"}),
        json!({"reasoning_content":"second"}),
        json!({"function_call":{"name":"exec","arguments":"{}"}}),
    ] {
        bytes.extend(converter.push_bytes(frame(json!({"choices":[{"delta":delta}]})).as_bytes()));
    }
    bytes.extend(converter.push_bytes(
        frame(json!({"choices":[{"delta":{},"finish_reason":"function_call"}]})).as_bytes(),
    ));
    bytes.extend(converter.finish());
    let result = events(&bytes);
    let output = terminal(&result)["output"].as_array().unwrap();
    assert_eq!(
        output.iter().filter(|i| i["type"] == "reasoning").count(),
        2
    );
    assert!(
        output
            .iter()
            .any(|i| i["type"] == "function_call" && i["name"] == "exec")
    );
    assert_eq!(
        output.iter().find(|i| i["type"] == "message").unwrap()["content"][0]["text"],
        "answer"
    );
}

#[test]
fn lossy_request_shapes_are_rejected_instead_of_downgraded() {
    for input in [
        json!([{"type":"function_call_output","call_id":"orphan","output":"execution stdout"}]),
        json!([{"type":"function_call","call_id":"x","name":"exec","arguments":"{invalid}"}]),
        json!([{"type":"item_reference","id":"unresolved"}]),
        json!([{"role":"user","content":[{"type":"future_binary","data":"abc"}]}]),
    ] {
        assert!(responses_to_chat_completions(json!({"input":input})).is_err());
    }
    for extra in [
        json!({"tools":[{"type":"image_generation"}]}),
        json!({"previous_response_id":"resp_server_state"}),
        json!({"n":2}),
        json!({"unknown_generation_control":true}),
    ] {
        let mut body = json!({"input":"test"});
        body.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(responses_to_chat_completions(body).is_err());
    }
    assert!(responses_to_completions(json!({"input":"test","tools":[{"type":"function","name":"exec","parameters":{"type":"object"}}]})).is_err());
}

#[test]
fn request_preserves_image_detail_and_structured_output_constraints() {
    let body = responses_to_chat_completions(json!({
        "input":[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,eA==","detail":"high"}]}],
        "text":{"format":{"type":"json_schema","name":"answer","strict":true,"schema":{"type":"object","properties":{"ok":{"type":"boolean"}}}}}
    })).unwrap();
    assert_eq!(
        body["messages"][0]["content"][0]["image_url"]["detail"],
        "high"
    );
    assert_eq!(body["response_format"]["json_schema"]["name"], "answer");
    assert_eq!(body["response_format"]["json_schema"]["strict"], true);
}

#[test]
fn nonstream_unclosed_think_never_leaks_into_dialogue() {
    let response = chat_completion_to_response(json!({"choices":[{"message":{"content":"<think>private thought"},"finish_reason":"length"}]})).unwrap();
    assert_eq!(response["status"], "incomplete");
    assert!(
        response["output"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["type"] != "message")
    );
    assert_eq!(
        response["output"][0]["summary"][0]["text"],
        "private thought"
    );
}

#[test]
fn anthropic_stream_retains_initial_usage_and_waits_for_message_stop() {
    let mut converter =
        NativeSseToResponsesConverter::with_request(UpstreamWireApi::AnthropicMessages, &json!({}));
    let mut bytes = converter.push_bytes(frame(json!({"type":"message_start","message":{"id":"msg_x","usage":{"input_tokens":12,"cache_read_input_tokens":3,"output_tokens":0}}})).as_bytes());
    bytes.extend(converter.push_bytes(frame(json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}})).as_bytes()));
    bytes.extend(
        converter.push_bytes(frame(json!({"type":"content_block_stop","index":0})).as_bytes()),
    );
    bytes.extend(converter.push_bytes(frame(json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}})).as_bytes()));
    assert!(!converter.is_completed());
    bytes.extend(converter.push_bytes(frame(json!({"type":"message_stop"})).as_bytes()));
    let result = events(&bytes);
    assert_eq!(terminal(&result)["usage"]["input_tokens"], 15);
    assert_eq!(terminal(&result)["usage"]["output_tokens"], 5);
}

#[test]
fn gemini_call_ids_are_unique_and_native_signed_parts_round_trip() {
    let native = json!([{"text":"private","thought":true,"thoughtSignature":"text-signature"},{"functionCall":{"name":"exec","args":{"cmd":"pwd"}},"thoughtSignature":"call-signature"}]);
    let make = || {
        gemini_generate_content_to_response_with_request(
            json!({"candidates":[{"content":{"parts":native},"finishReason":"STOP"}]}),
            &json!({"model":"gemini-test"}),
        )
        .unwrap()
    };
    let first = make();
    let second = make();
    let call = |response: &Value| {
        response["output"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["type"] == "function_call")
            .unwrap()["call_id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert_ne!(call(&first), call(&second));
    let mut input = first["output"].as_array().unwrap().clone();
    input.push(json!({"type":"function_call_output","call_id":call(&first),"output":"stdout"}));
    let replay =
        responses_to_gemini_generate_content(json!({"model":"gemini-test","input":input})).unwrap();
    assert_eq!(replay["contents"][0]["parts"], native);
    assert_eq!(
        replay["contents"][1]["parts"][0]["functionResponse"]["name"],
        "exec"
    );
}

#[test]
fn anthropic_signed_and_redacted_thinking_round_trip_without_becoming_text() {
    let content = json!([
        {"type":"thinking","thinking":"private","signature":"signature-test"},
        {"type":"redacted_thinking","data":"opaque"},
        {"type":"text","text":"answer"},
        {"type":"tool_use","id":"call_x","name":"exec","input":{"cmd":"pwd"}}
    ]);
    let response = anthropic_message_to_response_with_request(
        json!({"id":"msg_x","content":content,"stop_reason":"tool_use"}),
        &json!({"model":"claude-test"}),
    )
    .unwrap();
    let mut input = response["output"].as_array().unwrap().clone();
    input.push(json!({"type":"function_call_output","call_id":"call_x","output":"stdout"}));
    let replay =
        responses_to_anthropic_messages(json!({"model":"claude-test","input":input})).unwrap();
    assert_eq!(replay["messages"][0]["content"], content);
}
