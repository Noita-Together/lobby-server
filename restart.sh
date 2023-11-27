#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

source "$HERE/.env"

CONTAINER_NAME="lobby-server"
IMAGE_NAME="lobby-server"
TLS_SERVER_NAME="lobby.noitatogether.com"
ANCHOR_IP="$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/anchor_ipv4/address)"

docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

docker run -d --name "$CONTAINER_NAME" \
  --restart "unless-stopped" \
  --network "nt" \
  --network-alias "$TLS_SERVER_NAME" \
  -v "/etc/letsencrypt/archive/$TLS_SERVER_NAME:/etc/letsencrypt/archive/$TLS_SERVER_NAME" \
  -v "/etc/letsencrypt/live/$TLS_SERVER_NAME:/etc/letsencrypt/live/$TLS_SERVER_NAME" \
  -p "$ANCHOR_IP:443:443" \
  -e "DEBUG=*" \
  -e "JWT_SECRET=$SECRET_JWT_ACCESS" \
  -e "JWT_REFRESH=$SECRET_JWT_REFRESH" \
  -e "TLS_SERVER_NAME=$TLS_SERVER_NAME" \
  -e "TLS_CERT_FILE=/etc/letsencrypt/live/$TLS_SERVER_NAME/fullchain.pem" \
  -e "TLS_KEY_FILE=/etc/letsencrypt/live/$TLS_SERVER_NAME/privkey.pem" \
  -e "APP_LISTEN_PORT=443" \
  -e "STATS_URL_TEMPLATE=https://noitatogether.com/api/stats/[ROOM_ID]/[STATS_ID]/html" \
  -e "WEBFACE_ORIGIN=https://noitatogether.com" \
  "$IMAGE_NAME"