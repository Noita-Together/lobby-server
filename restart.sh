#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

source "$HERE/.env"

CONTAINER_NAME="lobby-server"
IMAGE_NAME="lobby-server"

docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

docker run -d --name "$CONTAINER_NAME" \
  -u "$(id nginx -u):$(id nginx -g)" \
  --restart "unless-stopped" \
  -v '/srv/socket/lobby-server/:/srv/socket/lobby-server/' \
  -e "DEBUG=*" \
  -e "JWT_SECRET=$SECRET_JWT_ACCESS" \
  -e "JWT_REFRESH=$SECRET_JWT_REFRESH" \
  -e "WS_UNIX_SOCKET=/srv/socket/lobby-server/nt.sock" \
  "$IMAGE_NAME"
