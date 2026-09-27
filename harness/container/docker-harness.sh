#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
action=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
case "$action" in
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
