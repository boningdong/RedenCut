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
  --label dev.podcut.harness=container \
  --name "${PODCUT_CONTAINER_NAME:-podcut-harness-$(uuidgen | tr '[:upper:]' '[:lower:]')}" \
  --env "PODCUT_GIT_DIRECTORY=$worktree_git_directory" \
  --mount "type=bind,source=$repository,target=/source,readonly" \
  --mount "type=bind,source=$git_directory,target=$git_directory,readonly" \
  --mount type=volume,target=/workspace/node_modules \
  --mount type=volume,target=/workspace/out \
  --mount "type=bind,source=$artifacts,target=/workspace/.harness-runs" \
  "${PODCUT_HARNESS_IMAGE:-podcut-harness:local}" "$@"
