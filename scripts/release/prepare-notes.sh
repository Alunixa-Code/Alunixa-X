#!/usr/bin/env bash
set -euo pipefail

test "$GITHUB_REPOSITORY" = "Alunixa-Code/Alunixa-X"
node scripts/installer/release-assets.mjs notes "$RELEASE_TAG"
