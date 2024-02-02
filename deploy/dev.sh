#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck source=/dev/null
set -o allexport
source "$HERE/.env"
set +o allexport

pushd "$HERE/.." >/dev/null
exec env npx nodemon
