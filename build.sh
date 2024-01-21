#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck source=/dev/null
source "$HERE/.env"

docker build -t "$IMAGE_NAME" .
