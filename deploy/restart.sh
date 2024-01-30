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
shift; shift

TAG="$BG_ENV-$BG_VALUE"
CONTAINER_NAME="$CONTAINER_NAME-$TAG"

CONTAINER_PORT="$(bg_getport "$BG_ENV" "$BG_VALUE")" || exit 1

IMAGE_HASH="$(docker image ls -q "$IMAGE_NAME:$TAG")"
if [ -z "$IMAGE_HASH" ]; then
  echo "Image not found: $IMAGE_NAME:$TAG"
  echo "Maybe run ./build.sh first?"
  exit 1
fi

declare -a MOUNTS=()
declare -a RUN_ARGS=()

LE_ROOT="/etc/letsencrypt"

CONTAINER_LIVE_DIR="/certs/live/$TLS_SERVER_NAME"
CONTAINER_ARCHIVE_DIR="/certs/archive/$TLS_SERVER_NAME"
TLS_KEY_FILE="$CONTAINER_LIVE_DIR/privkey.pem"
TLS_CERT_FILE="$CONTAINER_LIVE_DIR/fullchain.pem"

if [ -n "$LOCAL" ]; then
  ANCHOR_IP="0.0.0.0"
else
  ANCHOR_IP="$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/anchor_ipv4/address)"
fi

if [ -f "$HERE/tls/privkey.pem" ] && [ -f "$HERE/tls/fullchain.pem" ] ; then
  # when using ./tls the certs are just files, so we only need to mount the live dir
  MOUNTS=(
    "-v" "$HERE/tls:$CONTAINER_LIVE_DIR:ro"
  )
elif [ -d "$LE_ROOT/live" ] && [ -d "$LE_ROOT/archive" ]; then
  # we can't test for the files directly, because we run this script as a user that doesn't
  # have access. so we'll just check that the general directory structure exists and hope
  # for the best

  # when using let's encrypt, the certs are symlinks to versioned files in the sibling
  # "archive" directory, so we have to mount both (since the targeted filename in the
  # archive directory isn't something we can know directly)
  MOUNTS=(
    "-v" "$LE_ROOT/live/$TLS_SERVER_NAME:$CONTAINER_LIVE_DIR:ro"
    "-v" "$LE_ROOT/archive/$TLS_SERVER_NAME:$CONTAINER_ARCHIVE_DIR:ro"
  )
elif [ -n "$TLS_SERVER_NAME" ]; then
  # if we specify TLS_SERVER_NAME, the application will attempt to load certificates and listen on TLS. uWS will segfault
  # if the files aren't found and the container will crash loop. provide a more useful warning of an invalid configuration...
  echo "TLS_SERVER_NAME is specified, but cannot find an appropriate certificate path to mount (tried: '$HERE/tls', '$LE_ROOT'). No certificates can be mounted into the container."
  exit 1
fi

if [ $# -eq 0 ]; then
  # when no args are passed, re-launch the container with the current env arguments
  # and the latest image
  RUN_ARGS=(
    -d --name "$CONTAINER_NAME"
    --restart "unless-stopped"
    -p "$ANCHOR_IP:$CONTAINER_PORT:$APP_LISTEN_PORT" \
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
  "$IMAGE_NAME:$TAG" "$@"
