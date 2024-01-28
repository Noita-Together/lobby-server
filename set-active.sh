#!/bin/bash

set -e

HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# shellcheck disable=SC1091
source "$HERE/check-env.sh"

function usage() {
  ENVS="$(getenvs)"
  >&2 echo "$1"
  >&2 echo "Use: $0 <${ENVS:1}> <BLUE|GREEN>"
  exit 1
}

ENVDIR="$(getenvdir "$1")" || usage "Unknown env: $1";
ACTIVE="$(cat "$ENVDIR/active")"

if [ "$2" == "BLUE" ]; then
  DESIRED_VALUE="BLUE"
elif [ "$2" == "GREEN" ]; then
  DESIRED_VALUE="GREEN"
else
  usage "Unknown blue/green value: $2"
fi

if [ "$ACTIVE" == "$DESIRED_VALUE" ]; then
  >&2 echo "Already active: $DESIRED_VALUE"
  exit 0
fi

PORTNAME="PORT_$DESIRED_VALUE"
# shellcheck disable=SC1091
source "$ENVDIR/env"
BACKEND_PORT="${!PORTNAME}"

function healthcheck() {
  curl -s -o /dev/null -w "%{http_code}" --resolve "$BACKEND_HOSTNAME:$BACKEND_PORT:$BACKEND_IP" "https://$BACKEND_HOSTNAME:$BACKEND_PORT/api/health" || true
}

>&2 echo "Preparing to switch $BACKEND_HOSTNAME from $ACTIVE -> $DESIRED_VALUE"
>&2 echo "Checking health on $BACKEND_IP:$BACKEND_PORT ..."

MAX_RETRIES=2
for i in $(seq 1 "$MAX_RETRIES"); do
  STATUS="$(healthcheck || aoeu)"

  if [ "$STATUS" == "200" ]; then
    >&2 echo "Backend is up"
    break
  fi

  >&2 printf "Backend returned %s, " "$STATUS"
  if [ "$i" -lt "$MAX_RETRIES" ]; then
    >&2 echo "will retry ($i/$MAX_RETRIES)"
    sleep 1
  else
    >&2 echo "giving up ($i/$MAX_RETRIES)"
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


>&2 printf "Updating Cloudflare origin rule, "
APICALL_STATUS="$(cf_set_backend_port "$BACKEND_PORT")"
>&2 echo "status=$APICALL_STATUS"

if [[ "$APICALL_STATUS" == 2* ]]; then
  >&2 echo "Success. $1=$2"
  >"$ENVDIR/active" echo "$DESIRED_VALUE"
  exit 0
else
  >&2 echo "Failure. $1=$ACTIVE"
  exit 2
fi