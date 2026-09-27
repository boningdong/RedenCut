#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

usage='docker-harness.sh run {base|speech} [--models ABSOLUTE_DIRECTORY] -- COMMAND [ARG...]'
[ "$#" -ge 1 ] || usage_error "$usage"
target=$1
shift
case "$target" in
  base) image=$base_image ;;
  speech) image=$speech_image ;;
  *) usage_error "$usage" ;;
esac
models=''
if [ "${1:-}" = --models ]; then
  [ "$target" = speech ] && [ "$#" -ge 2 ] || usage_error "$usage"
  models=$2
  case "$models" in /*) ;; *) usage_error "$usage" ;; esac
  [ -d "$models" ] || { echo "MODEL_FIXTURE_MISSING: $models" >&2; exit 1; }
  shift 2
fi
[ "${1:-}" = -- ] || usage_error "$usage"
shift
[ "$#" -gt 0 ] || usage_error "$usage"
require_image "$image" "$target"

git_directory=$(git -C "$repository" rev-parse --path-format=absolute --git-common-dir)
worktree_git_directory=$(git -C "$repository" rev-parse --absolute-git-dir)
artifacts="$repository/.harness-runs/container"
mkdir -p "$artifacts"

set -- "$image" "$@"
if [ -n "$models" ]; then
  set -- --mount "type=bind,source=$models,target=/test-models,readonly" "$@"
fi
managed_models=${REDENCUT_TEST_MANAGED_MODEL_FIXTURE:-$repository/.runtime/models}
if [ -d "$managed_models" ]; then
  set -- --mount "type=bind,source=$managed_models,target=/managed-models,readonly" "$@"
fi
if [ "$target" = speech ]; then
  set -- --env REDENCUT_REQUIRE_SPEECH_SOURCE=1 "$@"
fi

echo "Running $target image $image; source $repository; app models ${models:-none}" >&2
exec "$docker_bin" run --rm -i --stop-timeout 20 --shm-size 1g \
  --label dev.redencut.harness=container \
  --name "${REDENCUT_CONTAINER_NAME:-redencut-harness-$(uuidgen | tr '[:upper:]' '[:lower:]')}" \
  --env "REDENCUT_GIT_DIRECTORY=$worktree_git_directory" \
  --mount "type=bind,source=$repository,target=/source,readonly" \
  --mount "type=bind,source=$git_directory,target=$git_directory,readonly" \
  --mount type=volume,target=/workspace/node_modules \
  --mount type=volume,target=/workspace/out \
  --mount "type=volume,source=$model_volume,target=/models" \
  --mount "type=bind,source=$artifacts,target=/workspace/.harness-runs" \
  --env REDENCUT_SPEECH_WORKER_ROOT=/workspace/speech-worker \
  --env REDENCUT_SPEECH_MANIFEST=/workspace/speech-worker/models.json \
  --env REDENCUT_SPEECH_MODEL_CACHE=/models \
  --env REDENCUT_MODELS_ROOT=/managed-models \
  --env REDENCUT_WHISPER_MODEL_DIR=/models/transcription-smoke-multilingual-tiny/5359861c739e955e79d9a303bcbc70fb988958b1 \
  "$@"
