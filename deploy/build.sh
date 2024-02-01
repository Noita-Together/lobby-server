#!/bin/bash

set -e

function usage() {
  echo "$1"
  echo "Use: $0 <$(bg_get_envs)> <$(bg_get_colors)>"
  exit 1
}

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck source=/dev/null
source "$HERE/.env"

# shellcheck source=/dev/null
source "$HERE/script-common.sh"

BASE="$(bg_get_base)" || exit 1
ENV_NAME="$(bg_check_dir "$BASE" "$1")" || usage "Unknown config dir: $1"
CONFIG_DIR="$BASE/$ENV_NAME"
COLOR_NAME="$(bg_check_color "$CONFIG_DIR" "$2")" || usage "Invalid color: $2"

TAG="$ENV_NAME-$COLOR_NAME"

docker build -t "$IMAGE_NAME:$TAG" .
