#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

[ "$#" -eq 1 ] || usage_error 'docker-harness.sh build {base|speech}'
case "$1" in
  base|speech) ;;
  *) usage_error 'docker-harness.sh build {base|speech}' ;;
esac

echo "Building base image $base_image from $repository" >&2
"$docker_bin" build -f "$harness_root/Dockerfile" -t "$base_image" "$repository"
if [ "$1" = speech ]; then
  echo "Building speech image $speech_image from base $base_image" >&2
  "$docker_bin" build --build-arg "REDENCUT_HARNESS_BASE=$base_image" \
    -f "$harness_root/Dockerfile.speech" -t "$speech_image" "$repository"
fi
