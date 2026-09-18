#!/bin/sh
set -eu

worker_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repository=$(dirname "$worker_root")
runtime_root=${REDENCUT_RUNTIME_ROOT:-}
export PYTHONPATH="$worker_root/src"
cache_root=${REDENCUT_SPEECH_MODEL_CACHE:-${XDG_CACHE_HOME:-${HOME:?HOME is required}/Library/Caches}/RedenCut/speech-models}
mode=${1:-preflight}

case "$mode" in
# setup delegates to the managed runtime installer.
# speech:native:setup remains an alias for existing scripts and older instructions, not a harness requirement.
  setup)
    exec node "$repository/scripts/runtime/SetupRuntime.mjs"
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
    exec node "$repository/scripts/runtime/RunPython.mjs" ${runtime_root:+--runtime-root "$runtime_root"} --python-path "$worker_root/src" -- -m redencut_speech_worker.provisioning \
      --manifest "$worker_root/models.json" --cache-root "$cache_root" --token-path "$token_file"
    ;;
  preflight)
    exec node "$repository/scripts/runtime/RunPython.mjs" ${runtime_root:+--runtime-root "$runtime_root"} --python-path "$worker_root/src" -- -m redencut_speech_worker.preflight --json \
      --manifest "$worker_root/models.json" --cache-root "$cache_root"
    ;;
  *)
    echo "Usage: $0 {setup|provision|preflight}" >&2
    exit 64
    ;;
esac
