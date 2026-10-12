"""Run an installed Codex CLI against the real Helper and an isolated local gateway."""
import argparse
import json
import os
from pathlib import Path
import queue
import socket
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run_scenario(codex, helper, mode):
    requests = []
    errors = []

    class Gateway(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            try:
                assert self.path == "/v1/messages"
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append(body)
                assert body["thinking"]["type"] == "adaptive", body.get("thinking")
                assert "prompt_cache_key" not in body
                assert body["messages"][0]["role"] == "user"
                if mode == "tools" and len(requests) == 1:
                    tool = next(
                        tool for tool in body["tools"]
                        if tool["name"].endswith("exec_command")
                        or tool["name"].endswith("shell_command")
                    )
                    command_field = "cmd" if tool["name"].endswith("exec_command") else "command"
                    content = [
                        {"type": "thinking", "thinking": "Inspect the fixture.", "signature": "fixture-signature"},
                        {"type": "tool_use", "id": "call_fixture", "name": tool["name"],
                         "input": {command_field: "Write-Output 'fixture-safe'"}},
                    ]
                    reason = "tool_use"
                else:
                    if mode == "tools":
                        assert len(requests) == 2, "unexpected extra model request"
                        results = [
                            block for message in body["messages"] for block in message["content"]
                            if block["type"] == "tool_result"
                        ]
                        assert any(block["tool_use_id"] == "call_fixture" for block in results)
                        thinking = [
                            block for message in body["messages"] for block in message["content"]
                            if block["type"] == "thinking"
                        ]
                        assert any(block["signature"] == "fixture-signature" for block in thinking)
                    content = [{"type": "text", "text": "fixture-ok"}]
                    reason = "max_tokens" if mode == "json-limit" else "end_turn"
                usage = {"input_tokens": 12, "cache_read_input_tokens": 3,
                         "cache_creation_input_tokens": 4, "output_tokens": 5}
                if mode == "json-limit":
                    payload = json.dumps({
                        "id": "msg_fixture", "type": "message", "role": "assistant",
                        "model": body["model"], "content": content, "stop_reason": reason,
                        "usage": usage,
                    }).encode()
                    mime = "application/json"
                else:
                    events = [
                        {"type": "message_start", "message": {
                            "id": f"msg_fixture_{len(requests)}", "type": "message",
                            "role": "assistant", "model": body["model"],
                            "usage": {**usage, "output_tokens": 0},
                        }}
                    ]
                    for index, block in enumerate(content):
                        events.extend([
                            {"type": "content_block_start", "index": index, "content_block": block},
                            {"type": "content_block_stop", "index": index},
                        ])
                    events.extend([
                        {"type": "message_delta", "delta": {"stop_reason": reason},
                         "usage": {"output_tokens": 5}},
                        {"type": "message_stop"},
                    ])
                    payload = "".join(
                        f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                        for event in events
                    ).encode()
                    mime = "text/event-stream"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as error:
                errors.append(str(error))
                self.send_error(500, "fixture validation failed")

    gateway = ThreadingHTTPServer(("127.0.0.1", 0), Gateway)
    gateway_thread = threading.Thread(target=gateway.serve_forever, daemon=True)
    gateway_thread.start()
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with tempfile.TemporaryDirectory(prefix="alunixa-anthropic-fixture-") as directory:
        root = Path(directory)
        home, state, workspace = [root / name for name in ("codex", "state", "workspace")]
        for path in (home, state, workspace):
            path.mkdir()
        port = unused_port()
        (home / "config.toml").write_text(f'''
model_provider = "fixture"
model = "claude-opus-4-6"
model_reasoning_effort = "high"
approval_policy = "never"
sandbox_mode = "read-only"
[model_providers.fixture]
name = "Local Anthropic fixture"
base_url = "http://127.0.0.1:{port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 15000
''', encoding="utf-8")
        (state / "settings.json").write_text(json.dumps({
            "enhancementsEnabled": True, "relayProfilesEnabled": True,
            "activeRelayId": "fixture",
            "relayProfiles": [{
                "id": "fixture", "name": "Local Anthropic fixture",
                "relayMode": "mixedApi", "model": "claude-opus-4-6",
                "protocol": "anthropicMessages",
                "baseUrl": f"http://127.0.0.1:{gateway.server_port}/v1",
                "apiKey": "fixture-only",
            }],
        }), encoding="utf-8")
        env = {**os.environ, "CODEX_HOME": str(home),
               "ALUNIXA_X_MULTI_INSTANCE": "1", "ALUNIXA_X_STATE_HOME": str(state),
               "ALUNIXA_X_HELPER_BIND": "127.0.0.1", "NO_PROXY": "127.0.0.1,localhost"}
        process = subprocess.Popen(
            [str(helper), str(port)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env,
            creationflags=flags,
        )
        try:
            ready = queue.Queue()
            threading.Thread(target=lambda: ready.put(process.stdout.readline()), daemon=True).start()
            line = ready.get(timeout=15)
            assert line.startswith("READY "), f"Helper not ready: {line}"
            completed = subprocess.run(
                [str(codex), "exec", "--json", "--skip-git-repo-check", "-C", str(workspace),
                 "Only complete the local fixture conversation."],
                env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", timeout=90, creationflags=flags,
            )
            events = [json.loads(line) for line in completed.stdout.splitlines() if line.startswith("{")]
            assert completed.returncode == 0, completed.stderr[-2000:] + completed.stdout[-2000:]
            assert not errors, errors
            assert any(event["type"] == "turn.completed" for event in events), events
            assert not any(event["type"] in ("error", "turn.failed") for event in events), events
            assert any(event.get("item", {}).get("text") == "fixture-ok" for event in events), events
            assert len(requests) == (2 if mode == "tools" else 1), len(requests)
            return {
                "scenario": mode, "result": "PASS", "requests": len(requests),
                "upstream": f"127.0.0.1:{gateway.server_port}",
                "downstream": f"127.0.0.1:{port}",
                "request_fields": sorted(requests[0]),
                "usage": next(event.get("usage") for event in events if event["type"] == "turn.completed"),
            }
        finally:
            if process.poll() is None:
                process.stdin.write("stop\n")
                process.stdin.flush()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=10)
            process.communicate()
            gateway.shutdown()
            gateway.server_close()
            gateway_thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--helper", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    codex, helper = args.codex.resolve(strict=True), args.helper.resolve(strict=True)
    version = subprocess.run([str(codex), "--version"], capture_output=True, text=True, check=True).stdout.strip()
    results = []
    for scenario in ("sse", "json-limit", "tools"):
        results.append(run_scenario(codex, helper, scenario))
        print(f"CODEX_ANTHROPIC_PASS {scenario}", flush=True)
    args.output.write_text(json.dumps({"codex": version, "results": results}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
