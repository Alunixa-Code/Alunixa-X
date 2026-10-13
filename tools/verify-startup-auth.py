"""Verify native Codex authentication across fresh, isolated launch preparations."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    codex = args.codex.resolve(strict=True)
    fixture = args.fixture.resolve(strict=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    version = subprocess.run([str(codex), "--version"], capture_output=True, text=True,
                             check=True, creationflags=flags).stdout.strip()
    with tempfile.TemporaryDirectory(prefix="startup-auth-", dir=ROOT / ".tmp") as directory:
        home = Path(directory).resolve()
        (home / "fixture-owned").write_text("isolated fixture\n", encoding="utf-8")
        (home / "profile.json").write_text(json.dumps({
            "id": "startup-auth", "name": "Isolated startup auth fixture",
            "relayMode": "customModels", "defaultCustomModelId": "fixture",
            "customModels": [{
                "id": "fixture", "model": "fixture-claude",
                "baseUrl": "http://127.0.0.1:1/v1", "apiKey": "fixture-only",
                "protocol": "anthropicMessages", "contextWindow": "200000",
            }],
        }), encoding="utf-8")
        env = {key: value for key, value in os.environ.items()
               if key.upper() not in {"OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_PROFILE",
                                      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"}}
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env.update({"CODEX_HOME": str(home), "ALUNIXA_X_AUTH_FIXTURE": "1",
                    "ALUNIXA_X_PROTOCOL_PROXY_PORT": str(port)})
        results = []
        for launch in range(1, 4):
            prepared = subprocess.run([str(fixture)], cwd=home, env=env,
                                      capture_output=True, text=True, encoding="utf-8",
                                      timeout=30, creationflags=flags)
            assert prepared.returncode == 0, "Isolated launch preparation failed"
            summary = json.loads(prepared.stdout.strip())
            status = subprocess.run([str(codex), "login", "status"], cwd=home, env=env,
                                    capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", timeout=20, creationflags=flags)
            # Do not print credentials or native login-status text.
            message = (status.stdout + status.stderr).lower()
            assert status.returncode == 0 and "logged in" in message and "api key" in message, {
                "launch": launch, "nativeExit": status.returncode, "prepared": summary,
            }
            assert summary == {"authMode": "apikey", "apiKeyPresent": True}, summary
            results.append({"launch": launch, "freshPreparation": True,
                            "freshNativeAuthRead": True, "nativeApiLogin": "PASS"})
            print(f"STARTUP_AUTH_PASS launch={launch}", flush=True)
        args.output.write_text(json.dumps({"codex": version, "results": results},
                                          indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
