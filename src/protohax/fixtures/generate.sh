#!/bin/bash

HERE="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

(
  cd "$HERE/../../.." && \
  npx pbjs --es6 -w es6 -t static-module ./src/protohax/fixtures/protohax.proto -o ./src/protohax/fixtures/protohax_pb.js && \
  npx pbts -o ./src/protohax/fixtures/protohax_pb.d.ts ./src/protohax/fixtures/protohax_pb.js && \
  npx pbjs -t json ./src/protohax/fixtures/protohax.proto -o ./src/protohax/fixtures/protohax_pb.json
)