#!/bin/sh
# Sourced by private action scripts. The dispatcher is the public interface.
harness_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
repository=$(CDPATH= cd -- "$harness_root/../.." && pwd -P)
docker_bin=${REDENCUT_DOCKER_BIN:-docker}
base_image=${REDENCUT_HARNESS_IMAGE:-redencut-harness:local}
speech_image=${REDENCUT_SPEECH_IMAGE:-redencut-harness-speech:local}

usage_error() {
  echo "Usage: $1" >&2
  exit 64
}

require_image() {
  if ! "$docker_bin" image inspect "$1" >/dev/null 2>&1; then
    echo "HARNESS_IMAGE_MISSING: $1; run 'sh harness/container/docker-harness.sh build $2'." >&2
    exit 1
  fi
}

resolve_models_path() {
  if [ -n "$1" ]; then
    node --import tsx "$repository/scripts/models/Models.ts" path --models-path "$1"
  else
    node --import tsx "$repository/scripts/models/Models.ts" path
  fi
}
