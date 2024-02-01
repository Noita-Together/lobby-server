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

# shellcheck disable=SC1091
source "$HERE/script-common.sh"

BASE="$(bg_get_base)" || exit 1
ENV_NAME="$(bg_check_dir "$BASE" "$1")" || usage "Unknown env dir: $1"
CONFIG_DIR="$BASE/$ENV_NAME"
ACTIVE_COLOR="$(cat "$CONFIG_DIR/active")" || usage "No 'active' file present in $CONFIG_DIR"
NEW_COLOR="$(bg_check_color "$CONFIG_DIR" "$2")" || usage "Invalid color: $2"
COLOR_FILE_PATH="$CONFIG_DIR/$(bg_check_file "$CONFIG_DIR" "$NEW_COLOR")" || usage "No '$NEW_COLOR' file present in $CONFIG_DIR"
CONFIG_FILE_PATH="$CONFIG_DIR/$(bg_check_file "$CONFIG_DIR" "config")" || usage "No 'config' file present in $CONFIG_DIR"

# shellcheck disable=SC1090
source "$COLOR_FILE_PATH"

# shellcheck disable=SC1090
source "$CONFIG_FILE_PATH"

API_KEY="$(bg_read_secret "API_KEY")" || usage "No API_KEY"

cat << EOT
ACTIVE_COLOR: $ACTIVE_COLOR
NEW_COLOR: $NEW_COLOR
BACKEND_PORT: $BACKEND_PORT
BACKEND_HOSTNAME: $BACKEND_HOSTNAME
BACKEND_IP: $BACKEND_IP
ZONE_ID: $ZONE_ID
RULESET_ID: $RULESET_ID
RULE_ID: $RULE_ID
EOT

if [ "$ACTIVE_COLOR" == "$NEW_COLOR" ]; then
  echo "Already active: $NEW_COLOR"
  exit 0
fi


function healthcheck() {
  SCHEME="http"
  if [ -n "$TLS_SERVER_NAME" ]; then
    SCHEME="https"
  fi

  curl -k -s -o /dev/null -w "%{http_code}" --resolve "$BACKEND_HOSTNAME:$BACKEND_PORT:$BACKEND_IP" "$SCHEME://$BACKEND_HOSTNAME:$BACKEND_PORT/api/health" || true
}

echo "Preparing to switch $BACKEND_HOSTNAME from $ACTIVE_COLOR -> $NEW_COLOR"
echo "Checking health on $BACKEND_IP:$BACKEND_PORT ..."

MAX_RETRIES=2
for i in $(seq 1 "$MAX_RETRIES"); do
  STATUS="$(healthcheck || aoeu)"

  if [ "$STATUS" == "200" ]; then
    echo "Backend is up"
    break
  fi

  printf "Backend returned %s, " "$STATUS"
  if [ "$i" -lt "$MAX_RETRIES" ]; then
    echo "will retry ($i/$MAX_RETRIES)"
    sleep 1
  else
    echo "giving up ($i/$MAX_RETRIES)"
    exit 1
  fi
done

function cf_set_backend_port() {
  curl -s -o /dev/null -w "%{http_code}" \
    -X PATCH \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID/rules/$RULE_ID" \
    --data '{"action":"route","expression":"true","description": "Noita Together B/G ('"$ENV_NAME"':'"$COLOR_NAME"')","action_parameters":{"origin":{"port": '"$1"'}}}' || true
}


printf "Updating Cloudflare origin rule, "
APICALL_STATUS="$(cf_set_backend_port "$BACKEND_PORT")"
echo "status=$APICALL_STATUS"

if [[ "$APICALL_STATUS" == 2* ]]; then
  echo "Success. $1=$2"
  echo "$NEW_COLOR" > "$CONFIG_DIR/active"
  exit 0
else
  echo "Failure. $1=$ACTIVE_COLOR"
  exit 2
fi