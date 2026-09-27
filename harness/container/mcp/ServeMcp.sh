#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

usage='docker-harness.sh mcp [base|speech] [--models ABSOLUTE_DIRECTORY]'
target=base
if [ "${1:-}" = base ] || [ "${1:-}" = speech ]; then
  target=$1
  shift
fi
if [ "${1:-}" = --models ]; then
  [ "$target" = speech ] && [ "$#" -eq 2 ] || usage_error "$usage"
  exec sh "$harness_root/run/RunContainer.sh" speech --models "$2" -- node --import tsx harness/server.ts
fi
[ "$#" -eq 0 ] || usage_error "$usage"
exec sh "$harness_root/run/RunContainer.sh" "$target" -- node --import tsx harness/server.ts
