#!/bin/sh
set -eu
. "$(dirname -- "$0")/../config/HarnessEnvironment.sh"

usage='docker-harness.sh test {harness|e2e-base|e2e-speech|e2e-all} [--models-path DIRECTORY]'
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
if [ "${1:-}" = --models-path ]; then
  [ "$#" -eq 2 ] || usage_error "$usage"
  models=$2
  shift 2
fi
[ "$#" -eq 0 ] || usage_error "$usage"
explicit_models=${models:-${REDENCUT_MODELS_PATH:-}}
models=$(resolve_models_path "$models")
if [ -n "$explicit_models" ] && [ ! -d "$models" ]; then
  echo "MODELS_PATH_MISSING: $models; install models with 'npm run setup:models -- --models-path DIRECTORY' or select an existing directory." >&2
  exit 1
fi
if [ "$target" = speech ]; then
  node --import tsx "$repository/scripts/models/Models.ts" check --set default --models-path "$models"
fi
if [ -d "$models" ]; then
  exec sh "$harness_root/run/RunContainer.sh" "$target" --models-path "$models" -- npm run "$npm_script"
fi
exec sh "$harness_root/run/RunContainer.sh" "$target" -- npm run "$npm_script"
