#!/bin/bash

set -e

function bg_getenvbase() {
  HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
  if [ -d "/etc/ntbg" ]; then
    echo "/etc/ntbg"
    return 0
  elif [ -d "$HERE/ntbg" ]; then
    echo "$HERE/ntbg"
    return 0
  fi

  echo "Unable to find ntbg base dir"
  exit 1
}

function bg_getactive() {
  ENVDIR="$(bg_getenvdir "$1")" || return 1
  cat "$ENVDIR/active" || exit 1
  return 0
}

function bg_getport() {
  ENVDIR="$(bg_getenvdir "$1")" || return 1
  BG_VAL="$(bg_getbg "$2")" || return 1

  # shellcheck disable=SC1091
  source "$ENVDIR/env" || exit 1
  VARNAME="PORT_$(echo "$BG_VAL" | tr '[:lower:]' '[:upper:]')"

  echo "${!VARNAME}"
  return 0
}

function bg_getenv() {
  if [ "$1" == "live" ]; then
    echo "live"
    return 0
  elif [ "$1" == "dev" ]; then
    echo "dev"
    return 0
  fi
  return 1
}

function bg_getenvdir() {
  if [ "$1" == "live" ]; then
    echo "$(bg_getenvbase)/live"
    return 0
  elif [ "$1" == "dev" ]; then
    echo "$(bg_getenvbase)/dev"
    return 0
  fi
  return 1
}

function bg_getenvs() {
  ENV_BASE="$(bg_getenvbase)"
  ENVS=""
  while IFS=  read -r -d $'\0'; do
    ENVS="$ENVS|$(basename "$REPLY")"
  done < <(find "$ENV_BASE" -maxdepth 1 -type d -not -path "$ENV_BASE" -print0)
  echo "${ENVS:1}"
  return 0
}

function bg_getbg() {
  if [ "$1" == "blue" ]; then
    echo "blue"
    return 0
  elif [ "$1" == "green" ]; then
    echo "green"
    return 0
  fi
  return 1
}

function bg_getbgs() {
  echo "blue|green"
}
