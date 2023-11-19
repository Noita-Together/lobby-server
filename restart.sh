#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

source "$HERE/.env"

CONTAINER_NAME="lobby-server"
IMAGE_NAME="lobby-server"
TLS_SERVER_NAME="dev.noitatogether.com"

docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

docker run -d --name "$CONTAINER_NAME" \
  --network "nt" \
  --network-alias "$TLS_SERVER_NAME" \
  --restart "unless-stopped" \
  -v "/etc/letsencrypt/archive/$TLS_SERVER_NAME:/etc/letsencrypt/archive/$TLS_SERVER_NAME" \
  -v "/etc/letsencrypt/live/$TLS_SERVER_NAME:/etc/letsencrypt/live/$TLS_SERVER_NAME" \
  -p "$LOBBY_WEBSOCKET_PORT:$LOBBY_WEBSOCKET_PORT" \
  -e "DEBUG=*" \
  -e "JWT_SECRET=$SECRET_JWT_ACCESS" \
  -e "JWT_REFRESH=$SECRET_JWT_REFRESH" \
  -e "TLS_SERVER_NAME=$TLS_SERVER_NAME" \
  -e "TLS_CERT_FILE=/etc/letsencrypt/live/$TLS_SERVER_NAME/fullchain.pem" \
  -e "TLS_KEY_FILE=/etc/letsencrypt/live/$TLS_SERVER_NAME/privkey.pem" \
  -e "WS_PORT=$LOBBY_WEBSOCKET_PORT" \
  -e "STATS_URL_TEMPLATE=https://dev.noitatogether.com/api/stats/[ROOM_ID]/[STATS_ID]/html" \
  -e "WEBFACE_ORIGIN=https://dev.noitatogether.com" \
  "$IMAGE_NAME"
