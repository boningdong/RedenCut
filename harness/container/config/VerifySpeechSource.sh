#!/bin/sh
set -eu
[ "$#" -eq 2 ] || { echo 'Usage: VerifySpeechSource.sh SOURCE INSTALLED' >&2; exit 64; }
for file in pyproject.toml uv.lock; do
  if ! cmp -s "$1/$file" "$2/$file"; then
    echo "SPEECH_IMAGE_STALE: $file differs from the speech image; run 'sh harness/container/docker-harness.sh build speech'." >&2
    exit 1
  fi
done
