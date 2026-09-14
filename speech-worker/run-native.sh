#!/bin/sh
set -eu

worker_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
uv_bin=${REDENCUT_UV_BIN:-uv}
cache_root=${REDENCUT_SPEECH_MODEL_CACHE:-${XDG_CACHE_HOME:-${HOME:?HOME is required}/Library/Caches}/RedenCut/speech-models}
mode=${1:-preflight}

case "$mode" in
# setup:speech is the documented developer entry point.
# speech:native:setup remains an alias for existing scripts and older instructions, not a harness requirement.
  setup)
    if ! command -v "$uv_bin" >/dev/null 2>&1; then
      echo "uv is required. Install it using https://docs.astral.sh/uv/getting-started/installation/ then run npm run setup:speech again." >&2
      exit 20
    fi
    exec "$uv_bin" sync --project "$worker_root" --frozen
    ;;
# setup:speech-models provisions the standalone worker cache, not the app ResourceManager.
# speech:native:provision remains an alias for existing developer scripts and older instructions.
  provision)
    if [ -n "${HF_TOKEN_PATH:-}" ]; then
      token_file=$HF_TOKEN_PATH
    elif [ -n "${HF_HOME:-}" ]; then
      token_file=$HF_HOME/token
    else
      token_file=${HOME:?HOME is required}/.cache/huggingface/token
    fi
    if [ ! -f "$token_file" ] || [ ! -r "$token_file" ]; then
      echo "HF_TOKEN_UNAVAILABLE: authenticate with 'hf auth login' or set HF_TOKEN_PATH." >&2
      exit 20
    fi
    exec "$worker_root/.venv/bin/python" -m redencut_speech_worker.provisioning \
      --manifest "$worker_root/models.json" --cache-root "$cache_root" --token-path "$token_file"
    ;;
  preflight)
    exec "$worker_root/.venv/bin/python" -m redencut_speech_worker.preflight --json \
      --manifest "$worker_root/models.json" --cache-root "$cache_root"
    ;;
  *)
    echo "Usage: $0 {setup|provision|preflight}" >&2
    exit 64
    ;;
esac
