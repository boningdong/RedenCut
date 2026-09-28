#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
action=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
case "$action" in
  help|--help|-h)
    cat <<'EOF'
Usage: docker-harness.sh ACTION ...
  build base|speech                 Build image(s); speech builds base first.
  run base|speech [--models-path DIR] -- COMMAND [ARG...]  Use a built image; compile checkout at startup.
  test harness|e2e-base|e2e-speech|e2e-all [--models-path DIR]
  mcp [base|speech] [--models-path DIR]  Serve MCP over stdio.

Models resolve from --models-path, REDENCUT_MODELS_PATH, then the platform app models directory.
Existing host models mount read-only at /models; install with 'npm run setup:models --'.
EOF
    exit 0
    ;;
  build) exec sh "$root/build/BuildImages.sh" "$@" ;;
  run) exec sh "$root/run/RunContainer.sh" "$@" ;;
  test) exec sh "$root/test/RunSuites.sh" "$@" ;;
  mcp) exec sh "$root/mcp/ServeMcp.sh" "$@" ;;
  *)
    echo 'Usage: docker-harness.sh {build|run|test|mcp} ...' >&2
    exit 64
    ;;
esac
