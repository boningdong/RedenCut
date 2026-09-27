#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

usage='docker-harness.sh test {harness|e2e-base|e2e-speech|e2e-all} [--models ABSOLUTE_DIRECTORY]'
[ "$#" -ge 1 ] || usage_error "$usage"
suite=$1
shift
case "$suite" in
  harness) target=base; npm_script=test:harness:all ;;
  e2e-base) target=base; npm_script=test:e2e:base ;;
  e2e-speech) target=speech; npm_script=test:e2e:speech ;;
  e2e-all) target=speech; npm_script=test:e2e:all ;;
  *) usage_error "$usage" ;;
esac

models=''
if [ "${1:-}" = --models ]; then
  [ "$target" = speech ] && [ "$#" -eq 2 ] || usage_error "$usage"
  models=$2
  shift 2
fi
[ "$#" -eq 0 ] || usage_error "$usage"
if [ "$target" = speech ]; then
  [ -n "$models" ] || { echo 'MODEL_FIXTURE_REQUIRED: pass --models ABSOLUTE_DIRECTORY.' >&2; exit 1; }
  case "$models" in /*) ;; *) usage_error "$usage" ;; esac
  [ -d "$models" ] || { echo "MODEL_FIXTURE_REQUIRED: $models is not a directory." >&2; exit 1; }
  marker=$(find "$models" -name installation.json -type f -print -quit)
  [ -n "$marker" ] || { echo 'MODEL_FIXTURE_INVALID: no installed app model marker found.' >&2; exit 1; }
  exec sh "$harness_root/run/RunContainer.sh" speech --models "$models" -- npm run "$npm_script"
fi
exec sh "$harness_root/run/RunContainer.sh" base -- npm run "$npm_script"
