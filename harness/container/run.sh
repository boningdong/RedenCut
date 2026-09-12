#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
git_directory=$(git -C "$repository" rev-parse --path-format=absolute --git-common-dir)
worktree_git_directory=$(git -C "$repository" rev-parse --absolute-git-dir)
artifacts="$repository/.harness-runs/container"
mkdir -p "$artifacts"

if [ "$#" -eq 0 ]; then
  set -- node --import tsx harness/server.ts
fi

# Docker's current context selects OrbStack or another compatible engine.
# No TTY, host display/socket sharing, network ports, or privileged mode.
exec docker run --rm -i --stop-timeout 20 --shm-size 1g \
  --label dev.redencut.harness=container \
  --name "${REDENCUT_CONTAINER_NAME:-redencut-harness-$(uuidgen | tr '[:upper:]' '[:lower:]')}" \
  --env "REDENCUT_GIT_DIRECTORY=$worktree_git_directory" \
  --mount "type=bind,source=$repository,target=/source,readonly" \
  --mount "type=bind,source=$git_directory,target=$git_directory,readonly" \
  --mount type=volume,target=/workspace/node_modules \
  --mount type=volume,target=/workspace/out \
  --mount "type=volume,source=${REDENCUT_SPEECH_MODEL_VOLUME:-redencut-speech-models},target=/models" \
  --mount "type=bind,source=$artifacts,target=/workspace/.harness-runs" \
  --env REDENCUT_SPEECH_WORKER_ROOT=/opt/redencut-speech-worker \
  --env REDENCUT_SPEECH_WORKER_PYTHON=/opt/redencut-speech-worker/.venv/bin/python \
  --env REDENCUT_SPEECH_MANIFEST=/opt/redencut-speech-worker/models.json \
  --env REDENCUT_SPEECH_MODEL_CACHE=/models \
  --env REDENCUT_WHISPER_MODEL_DIR=/models/transcription-smoke-multilingual-tiny/5359861c739e955e79d9a303bcbc70fb988958b1 \
  "${REDENCUT_HARNESS_IMAGE:-redencut-harness:local}" "$@"
