#!/bin/sh
set -eu

# Dependencies belong to the image, never to the host checkout.
if ! (cd /source && sha256sum --check --status /opt/podcut-dependencies.sha256); then
  echo 'DEPENDENCY_IMAGE_STALE: rebuild the harness image after package changes.' >&2
  exit 1
fi
# electron-vite writes temporary config files beside the source configuration.
# Snapshot into the container layer rather than making the host checkout writable.
snapshot=$(mktemp /tmp/podcut-source.XXXXXX.tar)
tar -C /source --exclude=./node_modules --exclude=./out --exclude=./dist \
  --exclude=./.harness-runs --exclude=./.worktrees --exclude=./.git \
  --exclude='./.env*' --exclude='./*.tsbuildinfo' -cf "$snapshot" .
tar -C /workspace -xf "$snapshot" --no-same-owner
rm "$snapshot"
printf 'gitdir: %s\n' "$PODCUT_GIT_DIRECTORY" > /workspace/.git
# Build output is a fresh private volume. Keep MCP stdout protocol-only.
npm run build >&2
# Xvfb reports its allocated display only after it is ready.
display_file=$(mktemp /tmp/podcut-display.XXXXXX)
Xvfb -displayfd 3 -screen 0 1280x800x24 -nolisten tcp 3>"$display_file" >&2 &
display_pid=$!
attempt=0
while [ ! -s "$display_file" ]; do
  if ! kill -0 "$display_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
    echo 'VIRTUAL_DISPLAY_NOT_READY: Xvfb failed to initialize.' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done
DISPLAY=":$(cat "$display_file")"
export DISPLAY
rm "$display_file"
exec node /opt/podcut-supervise.mjs "$@"
