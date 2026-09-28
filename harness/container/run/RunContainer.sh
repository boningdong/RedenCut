#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

usage='docker-harness.sh run {base|speech} [--models-path DIRECTORY] -- COMMAND [ARG...]'
[ "$#" -ge 1 ] || usage_error "$usage"
target=$1
shift
case "$target" in
  base) image=$base_image ;;
  speech) image=$speech_image ;;
  *) usage_error "$usage" ;;
esac
models=''
if [ "${1:-}" = --models-path ]; then
  [ "$#" -ge 2 ] || usage_error "$usage"
  models=$2
  shift 2
fi
[ "${1:-}" = -- ] || usage_error "$usage"
shift
[ "$#" -gt 0 ] || usage_error "$usage"
explicit_models=${models:-${REDENCUT_MODELS_PATH:-}}
models=$(resolve_models_path "$models")
if [ -n "$explicit_models" ] && [ ! -d "$models" ]; then
  echo "MODELS_PATH_MISSING: $models; install models with 'npm run setup:models -- --models-path DIRECTORY' or select an existing directory." >&2
  exit 1
fi
require_image "$image" "$target"

git_directory=$(git -C "$repository" rev-parse --path-format=absolute --git-common-dir)
worktree_git_directory=$(git -C "$repository" rev-parse --absolute-git-dir)
artifacts="$repository/.harness-runs/container"
mkdir -p "$artifacts"

set -- "$image" "$@"
if [ -d "$models" ]; then
  set -- --mount "type=bind,source=$models,target=/models,readonly" "$@"
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
  --mount "type=bind,source=$artifacts,target=/workspace/.harness-runs" \
  --env REDENCUT_SPEECH_WORKER_ROOT=/workspace/speech-worker \
  --env REDENCUT_SPEECH_MANIFEST=/workspace/speech-worker/models.json \
  --env REDENCUT_MODELS_PATH=/models \
  "$@"
