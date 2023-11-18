#!/bin/bash

set -e

IMAGE_NAME="lobby-server"

docker build -t "$IMAGE_NAME" .
