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

BASE="$(bg_get_base)" || exit 1
ENV_NAME="$(bg_check_dir "$BASE" "$1")" || usage "Unknown env dir: $1"
CONFIG_DIR="$BASE/$ENV_NAME"
ACTIVE_FILE_PATH="$CONFIG_DIR/$(bg_check_file "$CONFIG_DIR" "active")" || usage "No 'active' file present in $CONFIG_DIR"

cat "$ACTIVE_FILE_PATH"