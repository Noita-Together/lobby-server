#!/bin/bash

set -e

function usage() {
  echo "$1"
  echo "Use: $0 <$(bg_getenvs)> <$(bg_getbgs)>"
  exit 1
}

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck source=/dev/null
source "$HERE/.env"

# shellcheck source=/dev/null
source "$HERE/script-common.sh"

BG_ENV="$(bg_getenv "$1")" || usage "Unknown env: $1";
BG_VALUE="$(bg_getbg "$2")" || usage "Unknown blue/green value: $2";

TAG="$BG_ENV-$BG_VALUE"

docker build -t "$IMAGE_NAME:$TAG" .
