#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck disable=SC1091
source "$HERE/check-env.sh"

function usage() {
  ENVS="$(getenvs)"
  >&2 echo "$1"
  >&2 echo "Use: $0 <${ENVS:1}>"
  exit 1
}

ENVDIR="$(getenvdir "$1")" || usage "Unknown env: $1";

cat "$ENVDIR/active"