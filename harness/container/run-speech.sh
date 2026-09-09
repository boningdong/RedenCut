#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
docker_bin=${PODCUT_DOCKER_BIN:-docker}
image=${PODCUT_SPEECH_IMAGE:-podcut-harness-speech:local}
model_volume=${PODCUT_SPEECH_MODEL_VOLUME:-podcut-speech-models}
mode=${1:-preflight}

case "$mode" in
  build)
    exec "$docker_bin" build -f "$repository/harness/container/Dockerfile.speech" -t "$image" "$repository"
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
    exec "$docker_bin" run --rm --user root \
      --mount "type=volume,source=$model_volume,target=/models" \
      --mount "type=bind,source=$token_file,target=/run/secrets/hf_token,readonly" \
      --entrypoint /bin/sh "$image" -c \
      'python -m podcut_speech_worker.provisioning --manifest "$PODCUT_SPEECH_MANIFEST" --cache-root "$PODCUT_SPEECH_MODEL_CACHE" --token-path /run/secrets/hf_token && chown -R node:node "$PODCUT_SPEECH_MODEL_CACHE"'
    ;;
  preflight)
    exec "$docker_bin" run --rm \
      --mount "type=volume,source=$model_volume,target=/models" \
      --entrypoint python "$image" -m podcut_speech_worker.preflight --json \
      --manifest /opt/podcut-speech-worker/models.json --cache-root /models
    ;;
  *)
    echo "Usage: $0 {build|provision|preflight}" >&2
    exit 64
    ;;
esac
