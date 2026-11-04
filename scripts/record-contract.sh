#!/bin/sh
# Dev-only: records Super-agent panel API responses from a running ISOLATED instance into fixtures/contract/<name>/.
#   sh scripts/record-contract.sh <name> [base-url]
set -e
NAME=$1; BASE=${2:-http://127.0.0.1:3098/orchestrator/api}; H="x-orchestrator-request: 1"
OUT=$(dirname "$0")/../fixtures/contract/$NAME; mkdir -p "$OUT"
i=0; until [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "$H" "$BASE/state")" = 200 ]; do i=$((i+1)); [ $i -gt 30 ] && { echo "API not ready"; exit 1; }; sleep 1; done
for r in state overview "tickets?state=open&limit=1000" "tickets?state=ended&limit=1000" "decisions?limit=200" sources; do
  f=$(echo "$r" | sed 's/[?=&]/_/g'); curl -sf -H "$H" "$BASE/$r" > "$OUT/$f.json"; echo "$r -> $(wc -c < "$OUT/$f.json") bytes"
done
