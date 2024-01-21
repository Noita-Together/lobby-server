#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck source=/dev/null
source "$HERE/.env"

declare -a MOUNTS=()
declare -a RUN_ARGS=()

LETSENCRYPT_PATH="/etc/letsencrypt/live/$TLS_SERVER_NAME"

TLS_KEY_FILE="$LETSENCRYPT_PATH/privkey.pem"
TLS_CERT_FILE="$LETSENCRYPT_PATH/fullchain.pem"

if [ -n "$LOCAL" ]; then
  ANCHOR_IP="127.0.0.1"
  MOUNTS=(
    "-v" "$HERE/tls:$LETSENCRYPT_PATH"
  )
else
  ANCHOR_IP="$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/anchor_ipv4/address)"
fi

# .env listen address wins, otherwise fall back to anchor ip
if [ -z "$APP_LISTEN_ADDRESS" ] && [ -n "$ANCHOR_IP" ]; then
  APP_LISTEN_ADDRESS="$ANCHOR_IP"
fi

if [ $# -eq 0 ]; then
  # when no args are passed, re-launch the container with the current env arguments
  # and the latest image
  RUN_ARGS=(
    -d --name "$CONTAINER_NAME"
    --restart "unless-stopped"
  )
  docker stop "$CONTAINER_NAME" || true
  docker rm "$CONTAINER_NAME" || true
else
  # when args are passed, run interactively - e.g. for troubleshooting/testing
  RUN_ARGS=(
    --rm -it
  )
fi

docker run "${RUN_ARGS[@]}" \
  --network "nt" \
  --network-alias "$TLS_SERVER_NAME" \
  "${MOUNTS[@]}" \
  -e "JWT_SECRET=$JWT_SECRET" \
  -e "JWT_REFRESH=$JWT_REFRESH" \
  -e "TLS_KEY_FILE=$TLS_KEY_FILE" \
  -e "TLS_CERT_FILE=$TLS_CERT_FILE" \
  -e "DEBUG=nt,nt:*" \
  -e "TLS_SERVER_NAME=$TLS_SERVER_NAME" \
  -e "APP_UNIX_SOCKET=$APP_UNIX_SOCKET" \
  -e "APP_LISTEN_ADDRESS=$APP_LISTEN_ADDRESS" \
  -e "APP_LISTEN_PORT=$APP_LISTEN_PORT" \
  -e "WS_PATH=$WS_PATH" \
  -e "API_PATH=$API_PATH" \
  -e "DEV_MODE=$DEV_MODE" \
  -e "WEBFACE_ORIGIN=$WEBFACE_ORIGIN" \
  -e "DRAIN_DROP_DEAD_TIMEOUT_S=$DRAIN_DROP_DEAD_TIMEOUT_S" \
  -e "DRAIN_GRACE_TIMEOUT_S=$DRAIN_GRACE_TIMEOUT_S" \
  -e "DRAIN_NOTIFY_INTERVAL_S=$DRAIN_NOTIFY_INTERVAL_S" \
  -e "UWS_IDLE_TIMEOUT_S=$UWS_IDLE_TIMEOUT_S" \
  -e "UWS_MAX_PAYLOAD_LENGTH_BYTES=$UWS_MAX_PAYLOAD_LENGTH_BYTES" \
  -e "WARN_PAYLOAD_LENGTH_BYTES=$WARN_PAYLOAD_LENGTH_BYTES" \
  "$IMAGE_NAME" "$@"