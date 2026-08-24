#!/usr/bin/env bash
# Cloud Agent environment bootstrap for 远穹 / Far Horizon.
#
# Why this script exists (things a plain `npm ci` does not cover):
#   1. Node >= 22.18: the `node --test` suite imports `.ts` sources directly and
#      relies on default TypeScript type stripping, which is only on by default
#      from Node 22.18+. The base image's nvm ships a suitable Node 22; select it.
#   2. vite.config.ts statically imports ./.openai/hosting.json, a git-ignored
#      local "Sites" tooling artifact. The simulator uses no D1/R2 bindings, so a
#      null placeholder is enough to let Vite config load (dev/build/typecheck).
#
# Idempotent: safe to run repeatedly. No secrets required for the deterministic
# physics-only mode; LLM keys are optional.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || nvm install 22
echo "Using Node $(node -v)"

mkdir -p .openai
if [ ! -f .openai/hosting.json ]; then
  printf '{ "d1": null, "r2": null }\n' > .openai/hosting.json
  echo "Wrote placeholder .openai/hosting.json"
fi

npm ci
