#!/bin/bash

set -e

function usage() {
  echo "$1"
  echo "Use: $0 <$(bg_getenvs)>"
  exit 1
}

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck disable=SC1091
source "$HERE/script-common.sh"

ENVDIR="$(bg_getenvdir "$1")" || usage "Unknown env: $1";

if [ ! -d "$ENVDIR" ]; then
  echo "Resolved env dir: $ENVDIR but it doesn't exist!"
  exit 1
fi

cat "$ENVDIR/active"