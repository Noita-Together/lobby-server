#!/bin/bash

set -e

function bg_read_secret() {
  HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

  USER_CLOUDFLARE_SECRET="$HOME/.cloudflare.secret"
  REPO_CLOUDFLARE_SECRET="$HERE/deploy/cloudflare.secret"

  if [ -r "$USER_CLOUDFLARE_SECRET" ]; then
    # shellcheck disable=SC1090
    source "$USER_CLOUDFLARE_SECRET"
    FOUND="USER_CLOUDFLARE_SECRET"
  elif [ -r "$REPO_CLOUDFLARE_SECRET" ]; then
    # shellcheck disable=SC1090
    source "$REPO_CLOUDFLARE_SECRET"
    FOUND="USER_CLOUDFLARE_SECRET"
  else
    >&2 echo "No secrets file found. Tried: $USER_CLOUDFLARE_SECRET $REPO_CLOUDFLARE_SECRET"
    return 1
  fi

  if [ -z "${!1}" ]; then
    >&2 echo "Secret $1 not present in secrets file ${!FOUND}"
    return 1
  fi

  printf "%s" "${!1}"
  return 0
}

function bg_get_base() {
  HERE=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

  SYSTEM_NTBG_BASE="/etc/ntbg"
  REPO_NTBG_BASE="$HERE/ntbg"
  
  FOUND=""
  if [ -d "$SYSTEM_NTBG_BASE" ]; then
    FOUND="$SYSTEM_NTBG_BASE"
  elif [ -d "$REPO_NTBG_BASE" ]; then
    FOUND="$REPO_NTBG_BASE"
  else
    >&2 echo "Unable to find ntbg base dir. Tried: $SYSTEM_NTBG_BASE $REPO_NTBG_BASE"
    return 1
  fi

  printf "%s" "${FOUND}"
  return 0
}

function bg_get_dirs() {
  BASE="$1"
  DIRS=""
  while IFS=  read -r -d $'\0'; do
    DIRS="$DIRS|$(basename "$REPLY")"
  done < <(find "$BASE" -maxdepth 1 -type d -not -path "$BASE" -print0)
  echo "${DIRS:1}"
  return 0
}

function bg_check_dir() {
  BASE="$1"
  DIR="$2"

  if [ -z "$BASE" ] || [ -z "$DIR" ]; then
    return 1
  fi

  if ! [ -d "$BASE/$DIR" ]; then
    return 1
  fi

  printf "%s" "$DIR"
  return 0
}

function bg_check_file() {
  BASE="$1"
  FILE="$2"

  if [ -z "$BASE" ] || [ -z "$FILE" ]; then
    return 1
  fi

  if ! [ -f "$BASE/$FILE" ]; then
    return 1
  fi

  printf "%s" "$FILE"
  return 0
}

function bg_check_color() {
  COLOR=""
  if [ "$2" == "blue" ]; then
    COLOR="blue"
  elif [ "$2" == "green" ]; then
    COLOR="green"
  fi

  if [ -z "$COLOR" ]; then
    >&2 "Invalid color: $COLOR"
    return 1
  fi

  printf "%s" "$COLOR"
  return 0
}

function bg_get_envs() {
  BASE="$(bg_get_base)" || exit 1
  ENVS="$(bg_get_dirs "$BASE")" || exit 1
  printf "%s" "$ENVS"
  return 0
}

function bg_get_colors() {
  echo "blue|green"
  return 0
}

function bg_get_config_dir() {
  BASE="$(bg_get_base)" || exit 1
  ENV="$(bg_check_dir "$BASE" "$1")" || exit 1
  COLOR="$(bg_check_dir "$ENV" "$2")" || exit 1
  printf "%s" "$COLOR"
  return 0
}
