#!/usr/bin/env bash
set -euo pipefail

test "$GITHUB_REPOSITORY" = "Alunixa-Code/Alunixa-X"
test -s "docs/releases/${RELEASE_TAG}.md"
NOTES="$RUNNER_TEMP/alunixa-x-release-notes.md"
cp "docs/releases/${RELEASE_TAG}.md" "$NOTES"
{
  printf '\n## 构建来源与文件校验\n\n'
  printf -- '- 代码提交：`%s` 喵~\n' "$(git rev-parse HEAD)"
  printf -- '- 正式 Actions：https://github.com/%s/actions/runs/%s 喵~\n' "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID"
  if [ -n "${REUSE_RUN_ID:-}" ]; then
    printf -- '- 同提交已验证的构建：https://github.com/%s/actions/runs/%s 喵~\n' "$GITHUB_REPOSITORY" "$REUSE_RUN_ID"
  fi
  printf '\n六项安装文件的 SHA-256，由本次工作流直接计算喵~\n\n```text\n'
  (cd dist/release && sha256sum *)
  printf '```\n'
} >> "$NOTES"
