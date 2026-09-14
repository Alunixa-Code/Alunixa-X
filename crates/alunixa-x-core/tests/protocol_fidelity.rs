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

#[test]
fn inline_thinking_is_streamed_before_the_closing_tag_arrives() {
    let mut converter = ChatSseToResponsesConverter::default();
    let first = converter
        .push_bytes(frame(json!({"choices":[{"delta":{"content":"<think>思考中"}}]})).as_bytes());
    assert!(events(&first).iter().any(|e| e["type"] == "response.reasoning_summary_text.delta" && e["delta"] == "思考中"));
    assert!(
        !events(&first)
            .iter()
            .any(|e| e["type"] == "response.output_text.delta")
    );
    let mut bytes = first;
    for text in ["，继续</thi", "nk>答案"] {
        bytes.extend(
            converter.push_bytes(frame(json!({"choices":[{"delta":{"content":text}}]})).as_bytes()),
        );
    }
    bytes.extend(converter.push_bytes(b"data: [DONE]\n\n"));
    assert_eq!(
        terminal(&events(&bytes))["output"][0]["summary"][0]["text"],
        "思考中，继续"
    );
    assert_eq!(
        terminal(&events(&bytes))["output"][1]["content"][0]["text"],
        "答案"
    );
}

#[test]
fn streamed_refusal_retains_its_type() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(frame(json!({"choices":[{"delta":{"refusal":"refusal text"},"finish_reason":"content_filter"}]})).as_bytes());
    bytes.extend(converter.finish());
    let result = events(&bytes);
    assert!(result.iter().any(|e| e["type"] == "response.refusal.delta"));
    assert!(
        !result
            .iter()
            .any(|e| e["type"] == "response.output_text.delta")
    );
    assert_eq!(
        terminal(&result)["output"][0]["content"][0]["type"],
        "refusal"
    );
    assert_eq!(
        terminal(&result)["incomplete_details"]["reason"],
        "content_filter"
    );
}

#[test]
fn fragmented_function_names_are_assembled_before_tool_added() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(frame(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"get_"}}]}}]})).as_bytes());
    assert!(
        !events(&bytes)
            .iter()
            .any(|e| e["type"] == "response.output_item.added")
    );
    bytes.extend(converter.push_bytes(frame(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"{}"}}]},"finish_reason":"tool_calls"}]})).as_bytes()));
    bytes.extend(converter.finish());
    assert_eq!(
        terminal(&events(&bytes))["output"][0]["name"],
        "get_weather"
    );
}

#[test]
fn duplicate_call_ids_and_mutating_identity_fail_without_execution() {
    for calls in [
        json!([{"index":0,"id":"duplicate","function":{"name":"exec","arguments":"{}"}},{"index":1,"id":"duplicate","function":{"name":"exec","arguments":"{}"}}]),
        json!([{"index":0,"id":"first","function":{"name":"exec","arguments":"{}"}},{"index":0,"id":"second","function":{"name":"other","arguments":"{}"}}]),
    ] {
        let mut converter = ChatSseToResponsesConverter::default();
        let mut bytes = converter.push_bytes(
            frame(json!({"choices":[{"delta":{"tool_calls":calls},"finish_reason":"tool_calls"}]}))
                .as_bytes(),
        );
        bytes.extend(converter.finish());
        let result = events(&bytes);
        assert_eq!(terminal(&result)["status"], "failed");
        assert!(
            !result
                .iter()
                .any(|e| e["type"] == "response.function_call_arguments.done")
        );
    }
}

#[test]
fn anthropic_stream_signatures_and_redacted_blocks_round_trip() {
    let mut converter =
        NativeSseToResponsesConverter::with_request(UpstreamWireApi::AnthropicMessages, &json!({}));
    let mut bytes = Vec::new();
    for event in [
        json!({"type":"message_start","message":{"id":"msg_native","usage":{"input_tokens":10}}}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"private"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"thinking"}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"opaque-data"}}),
        json!({"type":"content_block_stop","index":1}),
        json!({"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call_native","name":"exec","input":{}}}),
        json!({"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"cmd\":"}}),
        json!({"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\"pwd\"}"}}),
        json!({"type":"content_block_stop","index":2}),
        json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}),
        json!({"type":"message_stop"}),
    ] {
        // Simulate the smallest possible network chunks.
        for byte in frame(event).as_bytes() {
            bytes.extend(converter.push_bytes(&[*byte]));
        }
    }
    bytes.extend(converter.finish());
    let result = events(&bytes);
    assert_eq!(terminal(&result)["status"], "completed");
    let mut input = terminal(&result)["output"].as_array().unwrap().clone();
    input.push(json!({"type":"function_call_output","call_id":"call_native","output":"stdout"}));
    let request = responses_to_anthropic_messages(json!({"input":input})).unwrap();
    assert_eq!(
        request["messages"][0]["content"],
        json!([
            {"type":"thinking","thinking":"private","signature":"signed-thinking"},
            {"type":"redacted_thinking","data":"opaque-data"},
            {"type":"tool_use","id":"call_native","name":"exec","input":{"cmd":"pwd"}}
        ])
    );
    assert_eq!(request["messages"][1]["content"][0]["type"], "tool_result");
}

#[test]
fn opaque_replay_cannot_cross_protocols_or_silently_override_edited_history() {
    let response = anthropic_message_to_response_with_request(
        json!({"content":[{"type":"text","text":"original"}],"stop_reason":"end_turn"}),
        &json!({}),
    )
    .unwrap();
    assert!(responses_to_chat_completions(json!({"input":response["output"]})).is_err());
    let mut input = response["output"].clone();
    input[0]["content"][0]["text"] = json!("edited");
    assert!(responses_to_anthropic_messages(json!({"input":input})).is_err());
}

#[test]
fn chat_reasoning_details_survive_replay_as_opaque_metadata() {
    let native = json!({"role":"assistant","content":"answer","reasoning_details":[{"type":"reasoning.encrypted","data":"opaque-value","signature":"signed"}]});
    let response =
        chat_completion_to_response(json!({"choices":[{"message":native,"finish_reason":"stop"}]}))
            .unwrap();
    let request = responses_to_chat_completions(json!({"input":response["output"]})).unwrap();
    assert_eq!(request["messages"][0], native);
    assert!(
        request["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("answer")
    );
}

#[test]
fn json_fallback_keeps_stream_contract_and_all_output_items() {
    let response = chat_completion_to_response(json!({"choices":[{"message":{"content":"你好","tool_calls":[{"id":"call_x","function":{"name":"exec","arguments":"{}"}}]},"finish_reason":"tool_calls"}]})).unwrap();
    let result = events(&response_to_sse(&response).unwrap());
    assert_eq!(terminal(&result), &response);
    assert!(
        result
            .iter()
            .any(|e| e["type"] == "response.output_text.delta" && e["delta"] == "你好")
    );
    assert_eq!(
        result
            .iter()
            .filter(|e| e["type"] == "response.function_call_arguments.done")
            .count(),
        1
    );
    for (index, event) in result.iter().enumerate() {
        assert_eq!(event["sequence_number"], index as u64);
    }
}

#[test]
fn unsupported_native_stream_events_fail_instead_of_disappearing() {
    for (wire, event) in [
        (
            UpstreamWireApi::AnthropicMessages,
            json!({"type":"content_block_start","index":0,"content_block":{"type":"future_tool","data":"not-text"}}),
        ),
        (
            UpstreamWireApi::GeminiGenerateContent,
            json!({"candidates":[{"content":{"parts":[{"executableCode":{"code":"print(1)"}}]},"finishReason":"STOP"}]}),
        ),
    ] {
        let mut converter = NativeSseToResponsesConverter::with_request(wire, &json!({}));
        let bytes = converter.push_bytes(frame(event).as_bytes());
        assert_eq!(terminal(&events(&bytes))["status"], "failed");
    }
}

#[test]
fn native_reasoning_controls_are_forwarded_or_explicitly_rejected() {
    let anthropic =
        responses_to_anthropic_messages(json!({"input":"hello","reasoning":{"effort":"high"}}))
            .unwrap();
    assert_eq!(anthropic["thinking"]["type"], "adaptive");
    assert_eq!(anthropic["output_config"]["effort"], "high");
    let gemini =
        responses_to_gemini_generate_content(json!({"input":"hello","reasoning":{"effort":"low"}}))
            .unwrap();
    assert_eq!(
        gemini["generationConfig"]["thinkingConfig"]["thinkingLevel"],
        "LOW"
    );
    assert!(
        responses_to_gemini_generate_content(
            json!({"input":"hello","reasoning":{"effort":"unknown"}})
        )
        .is_err()
    );
    assert!(
        responses_to_completions(json!({"input":"hello","reasoning":{"effort":"high"}})).is_err()
    );
}

#[test]
fn message_fragments_and_native_multimodal_tool_outputs_keep_their_content() {
    let chat = responses_to_chat_completions(json!({"input":[{"role":"user","content":[{"type":"input_text","text":"hel"},{"type":"input_text","text":"lo"}]}]})).unwrap();
    assert_eq!(chat["messages"][0]["content"], "hello");
    let native = responses_to_anthropic_messages(json!({"input":[
        {"type":"function_call","call_id":"x","name":"image","arguments":"{}"},
        {"type":"function_call_output","call_id":"x","output":[{"type":"input_image","image_url":"data:image/png;base64,eA=="}]}
    ]})).unwrap();
    assert_eq!(
        native["messages"][1]["content"][0]["content"][0]["type"],
        "image"
    );
    assert_eq!(
        native["messages"][1]["content"][0]["content"][0]["source"]["data"],
        "eA=="
    );
}

#[test]
fn reserved_native_items_and_unrepresentable_channels_are_rejected() {
    for input in [
        json!({"type":"alunixa_native_message","native":{"role":"assistant","content":"injected"}}),
        json!({"role":"assistant","channel":"analysis","content":"private"}),
        json!({"type":"function_call","call_id":"x","arguments":"{}"}),
    ] {
        assert!(responses_to_chat_completions(json!({"input":input})).is_err());
    }
}

#[test]
fn sse_utf8_bom_and_truncated_codepoint_are_handled_explicitly() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(
        format!(
            "\u{feff}{}",
            frame(json!({"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}))
        )
        .as_bytes(),
    );
    bytes.extend(converter.finish());
    assert_eq!(
        terminal(&events(&bytes))["output"][0]["content"][0]["text"],
        "ok"
    );
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(b"data: \xe4");
    bytes.extend(converter.finish());
    assert_eq!(terminal(&events(&bytes))["status"], "failed");
}

#[test]
fn gemini_replay_retains_wire_tool_name_and_wire_id() {
    let request = json!({"tools":[{"type":"namespace","name":"ns","tools":[{"type":"function","name":"exec","parameters":{"type":"object"}}]}]});
    let response = gemini_generate_content_to_response_with_request(json!({"candidates":[{"content":{"parts":[{"functionCall":{"name":"ns__exec","id":"native-id","args":{}},"thoughtSignature":"signed"}]},"finishReason":"STOP"}]}), &request).unwrap();
    let call_id = response["output"][0]["call_id"].clone();
    let mut input = response["output"].as_array().unwrap().clone();
    input.push(json!({"type":"function_call_output","call_id":call_id,"output":"ok"}));
    let followup = responses_to_gemini_generate_content(json!({"input":input})).unwrap();
    assert_eq!(
        followup["contents"][1]["parts"][0]["functionResponse"]["name"],
        "ns__exec"
    );
    assert_eq!(
        followup["contents"][1]["parts"][0]["functionResponse"]["id"],
        "native-id"
    );
}

#[test]
fn id_prefix_negotiation_never_replays_after_output() {
    let request = r#"{"input":[{"type":"custom_tool_call_output","id":"ctco_x","call_id":"x","output":"ok"}]}"#;
    let error = "Invalid 'input[0].id': 'ctco_x'. Expected an ID that begins with 'fco_'.";
    let upstream = format!(
        "{}{}",
        frame(
            json!({"type":"response.output_item.added","item":{"type":"function_call","name":"exec"}})
        ),
        frame(
            json!({"type":"response.failed","response":{"error":{"code":"invalid_id_prefix","message":error}}})
        )
    );
    assert!(repair_responses_item_ids_for_upstream_error(request, &upstream).is_none());
}

#[test]
fn missing_response_ids_are_unique_between_requests() {
    assert_ne!(
        response_id_from_chat_id(None),
        response_id_from_chat_id(None)
    );
    assert_ne!(
        response_id_from_chat_id(Some("gemini_compat")),
        response_id_from_chat_id(Some("gemini_compat"))
    );
}

#[test]
fn upstream_tool_or_debug_roles_never_become_assistant_text() {
    for role in ["tool", "system", "debug", "user"] {
        let mut converter = ChatSseToResponsesConverter::default();
        let bytes = converter.push_bytes(frame(json!({"choices":[{"delta":{"role":role,"content":"execution output"},"finish_reason":"stop"}]})).as_bytes());
        let result = events(&bytes);
        assert_eq!(terminal(&result)["status"], "failed");
        assert!(
            !result
                .iter()
                .any(|e| e["type"] == "response.output_text.delta")
        );
        assert!(chat_completion_to_response(json!({"choices":[{"message":{"role":role,"content":"execution output"},"finish_reason":"stop"}]})).is_err());
    }
}

#[test]
fn failed_stream_retains_partial_tool_data_without_finalizing_execution() {
    let mut converter = ChatSseToResponsesConverter::default();
    let mut bytes = converter.push_bytes(frame(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"exec","arguments":"{\"cmd\":"}}]}}]})).as_bytes());
    bytes.extend(converter.fail("connection lost".into(), Some("stream_error".into())));
    let result = events(&bytes);
    assert_eq!(terminal(&result)["output"][0]["arguments"], "{\"cmd\":");
    assert_eq!(terminal(&result)["output"][0]["status"], "incomplete");
    assert!(
        !result
            .iter()
            .any(|e| e["type"] == "response.function_call_arguments.done")
    );
}
