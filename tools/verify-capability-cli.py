"""Read-only installed-CLI contract tests, with disposable CODEX_HOME fixtures."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", type=Path, required=True)
    args = parser.parse_args()
    executable = args.codex.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="capability-cli-", dir=ROOT / ".tmp") as temporary:
        home = Path(temporary).resolve()
        assert home.is_relative_to((ROOT / ".tmp").resolve())
        env = os.environ.copy()
        for key in list(env):
            if key.upper() in {"OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_PROFILE",
                               "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"}:
                env.pop(key)
        env["CODEX_HOME"] = str(home)

        def run(*command):
            return subprocess.run([str(executable), *command], cwd=home, env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  encoding="utf-8", errors="replace", timeout=20,
                                  creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

        def features(*prefix):
            response = run(*prefix, "features", "list")
            assert response.returncode == 0, "Installed CLI rejected isolated configuration"
            result = {}
            for line in response.stdout.splitlines():
                columns = line.split()
                if len(columns) >= 3 and columns[-1] in {"true", "false"}:
                    result[columns[0]] = columns[-1] == "true"
            return result

        version = run("--version")
        assert version.returncode == 0
        config = home / "config.toml"
        defaults = features()
        for enabled in [True, False]:
            config.write_text("[features]\nfast_mode=" + str(enabled).lower()
                              + "\ngoals=" + str(enabled).lower() + "\n", encoding="utf-8")
            actual = features()
            assert actual["fast_mode"] == enabled and actual["goals"] == enabled
            # Fresh process is used for every invocation, not a cached/in-memory switch.
            assert features() == actual
        config.write_text('[features]\nfast_mode=false\n', encoding="utf-8")
        (home / "fixture.config.toml").write_text('[features]\nfast_mode=true\n', encoding="utf-8")
        assert features("--profile", "fixture")["fast_mode"] is True, "Profile file override contract changed"
        config.write_text('profile="fixture"\n[profiles.fixture]\n', encoding="utf-8")
        legacy = run("features", "list")
        assert legacy.returncode != 0 and "legacy" in legacy.stderr
        config.write_text('[features]\nguardianv2="invalid-fixture"\n', encoding="utf-8")
        rejected = run("features", "list")
        assert rejected.returncode != 0 and "FeatureToml" in rejected.stderr
        config.write_text("[features]\nfast_mode=false\ngoals=false\n", encoding="utf-8")
        assert features()["fast_mode"] is False
        print(json.dumps({"version": version.stdout.strip(), "defaultFast": defaults.get("fast_mode"),
                          "defaultGoals": defaults.get("goals"), "explicitOnOffFreshProcess": True,
                          "profileFileOverride": True, "legacyProfileRejected": True, "guardianInvalidRejected": True,
                          "mode": "isolated CLI parsing; no desktop or model requests"}))
        print("CAPABILITY_CLI_PASS")


if __name__ == "__main__":
    main()
