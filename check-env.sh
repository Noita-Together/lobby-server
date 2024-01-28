#!/bin/bash

set -e

ENV_BASE="/etc/ntbg"

function getenvs() {
  ENVS=""
  while IFS=  read -r -d $'\0'; do
    ENVS="$ENVS|$(basename "$REPLY")"
  done < <(find "$ENV_BASE" -maxdepth 1 -type d -not -path "$ENV_BASE" -print0)
  echo "$ENVS"
  return 0
}

function getenvdir() {
  if [ "$1" == "LIVE" ]; then
    echo "$ENV_BASE/$1"
    return 0
  elif [ "$1" == "DEV" ]; then
    echo "$ENV_BASE/$1"
    return 0
  fi
  return 1
}