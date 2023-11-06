#!/bin/bash

HERE="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

(cd "$HERE/../../.." && protoc -I=. --plugin ./node_modules/.bin/protoc-gen-es --es_out . --es_opt target=ts ./nt-web-app/recorder/fixtures/protohax.proto)