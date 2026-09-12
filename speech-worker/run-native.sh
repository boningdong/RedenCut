#!/bin/sh
set -eu

worker_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
uv_bin=${RIFFCUT_UV_BIN:-uv}
cache_root=${RIFFCUT_SPEECH_MODEL_CACHE:-${XDG_CACHE_HOME:-${HOME:?HOME is required}/Library/Caches}/RiffCut/speech-models}
mode=${1:-preflight}

case "$mode" in
  setup)
    exec "$uv_bin" sync --project "$worker_root" --frozen
    ;;
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
    exec "$worker_root/.venv/bin/python" -m riffcut_speech_worker.provisioning \
      --manifest "$worker_root/models.json" --cache-root "$cache_root" --token-path "$token_file"
    ;;
  preflight)
    exec "$worker_root/.venv/bin/python" -m riffcut_speech_worker.preflight --json \
      --manifest "$worker_root/models.json" --cache-root "$cache_root"
    ;;
  *)
    echo "Usage: $0 {setup|provision|preflight}" >&2
    exit 64
    ;;
esac
