#!/bin/bash

set -e

function usage() {
  echo "$1"
  echo "Use: $0 <$(bg_getenvs)> <$(bg_getbgs)>"
  exit 1
}

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck disable=SC1091
source "$HERE/script-common.sh"

BG_ENV="$(bg_getenv "$1")" || usage "Unknown env: $1";
BG_VAL="$(bg_getbg "$2")" || usage "Unknown blue/green value: $2";

ENVDIR="$(bg_getenvdir "$1")" || return 1

ACTIVE="$(bg_getactive "$BG_ENV")" || exit 1
BACKEND_PORT="$(bg_getport "$BG_ENV" "$BG_VAL")" || exit 1

if [ "$ACTIVE" == "$BG_VAL" ]; then
  echo "Already active: $BG_VAL"
  exit 0
fi

# shellcheck disable=SC1091
source "$(bg_getenvdir "$BG_ENV")/env"

function healthcheck() {
  curl -k -s -o /dev/null -w "%{http_code}" --resolve "$BACKEND_HOSTNAME:$BACKEND_PORT:$BACKEND_IP" "https://$BACKEND_HOSTNAME:$BACKEND_PORT/api/health" || true
}

echo "Preparing to switch $BACKEND_HOSTNAME from $ACTIVE -> $BG_VAL"
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
    --data '{"action":"route","expression":"true","action_parameters":{"origin":{"port": '"$1"'}}}' || true
}


printf "Updating Cloudflare origin rule, "
APICALL_STATUS="$(cf_set_backend_port "$BACKEND_PORT")"
echo "status=$APICALL_STATUS"

if [[ "$APICALL_STATUS" == 2* ]]; then
  echo "Success. $1=$2"
  echo "$BG_VAL" > "$ENVDIR/active"
  exit 0
else
  echo "Failure. $1=$ACTIVE"
  exit 2
fi