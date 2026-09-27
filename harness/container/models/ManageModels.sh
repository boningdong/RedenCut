#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

[ "$#" -eq 1 ] || usage_error 'docker-harness.sh models {install|check}'
case "$1" in
  install|check) action=$1 ;;
  *) usage_error 'docker-harness.sh models {install|check}' ;;
esac

if [ "$action" = install ]; then
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
fi

require_image "$speech_image" speech
echo "Running models $action in $speech_image; source $repository; model volume $model_volume" >&2
if [ "$action" = install ]; then
  exec "$docker_bin" run --rm --user root \
    --mount "type=bind,source=$repository,target=/source,readonly" \
    --mount "type=volume,source=$model_volume,target=/models" \
    --mount "type=bind,source=$token_file,target=/run/secrets/hf_token,readonly" \
    --env PYTHONPATH=/source/speech-worker/src \
    --entrypoint /bin/sh "$speech_image" -c \
    'sh /opt/redencut-verify-speech-source.sh /source/speech-worker /opt/redencut-speech-worker && python -m redencut_speech_worker.provisioning --manifest /source/speech-worker/models.json --cache-root /models --token-path /run/secrets/hf_token && chown -R node:node /models'
fi
exec "$docker_bin" run --rm \
  --mount "type=bind,source=$repository,target=/source,readonly" \
  --mount "type=volume,source=$model_volume,target=/models" \
  --env PYTHONPATH=/source/speech-worker/src \
  --entrypoint /bin/sh "$speech_image" -c \
  'sh /opt/redencut-verify-speech-source.sh /source/speech-worker /opt/redencut-speech-worker && python -m redencut_speech_worker.preflight --json --manifest /source/speech-worker/models.json --cache-root /models'
