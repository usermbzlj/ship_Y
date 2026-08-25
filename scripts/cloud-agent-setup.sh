#!/usr/bin/env bash
# Cloud Agent environment bootstrap for 远穹 / Far Horizon.
#
# vite.config.ts statically imports ./.openai/hosting.json, a git-ignored local
# "Sites" tooling artifact. Without it, Vite config fails to load, breaking
# dev/build/typecheck. The simulator uses no D1/R2 bindings, so a null
# placeholder is enough. Everything else is a plain `npm ci`.
#
# Node: the base image's Node (>= 22.13) is sufficient. The node --test suite
# imports .ts sources; scripts/run-tests.mjs enables TypeScript type stripping
# explicitly on Node < 22.18, so no version manager is required here.
#
# Idempotent and secret-free: the deterministic physics-only mode needs no keys;
# LLM keys are optional.
set -euo pipefail

mkdir -p .openai
if [ ! -f .openai/hosting.json ]; then
  printf '{ "d1": null, "r2": null }\n' > .openai/hosting.json
  echo "Wrote placeholder .openai/hosting.json"
fi

npm ci
