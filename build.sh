#!/bin/bash

set -e

IMAGE_NAME="lobby-server"

docker build --build-arg="UID=$(id nginx -u)" --build-arg="GID=$(id nginx -g)" -t "$IMAGE_NAME" .
