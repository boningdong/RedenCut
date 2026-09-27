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
  run base|speech [--models DIR] -- COMMAND [ARG...]  Use a built image; compile checkout at startup.
  test harness|e2e-base|e2e-speech|e2e-all [--models DIR]
  models install|check              Install may download; check is offline.
  mcp [base|speech] [--models DIR]  Serve MCP over stdio.

Model stores are distinct:
  /models          persistent Docker volume used by models install/check
  /test-models     read-only app fixture supplied by --models for speech E2Es
  .runtime/models  optional checkout-managed diarization fixture
EOF
    exit 0
    ;;
  build) exec sh "$root/build/BuildImages.sh" "$@" ;;
  run) exec sh "$root/run/RunContainer.sh" "$@" ;;
  test) exec sh "$root/test/RunSuites.sh" "$@" ;;
  models) exec sh "$root/models/ManageModels.sh" "$@" ;;
  mcp) exec sh "$root/mcp/ServeMcp.sh" "$@" ;;
  *)
    echo 'Usage: docker-harness.sh {build|run|test|models|mcp} ...' >&2
    exit 64
    ;;
esac
