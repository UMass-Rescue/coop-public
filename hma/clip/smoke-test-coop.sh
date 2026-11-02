#!/usr/bin/env bash
# Happy-path smoke test for CLIP matching through Coop.
#
# Part 1 seeds a CLIP bank from hma/clip/fixtures/bank and checks, on the CLIP
# instance alone, that a resized copy of the image matches and an unrelated
# image does not. Part 2 submits both through the Coop API and checks that the
# rule fires for the resized copy only. Prints each command it runs, exits
# nonzero on failure, and removes what it added on exit.
#
# One-time setup (see docs/integrations/hma-clip.md, "Run the Coop smoke test"):
# an org with CLIP turned on, a CLIP bank, an item type with an image field, a
# custom action whose callback URL is http://localhost:$CALLBACK_PORT/, and a
# proactive rule "Image similarity (CLIP) >= 0.95 in the bank -> that action".
#
# Usage: hma/clip/smoke-test-coop.sh
#   API_KEY        Coop API key for the org (required)
#   ORG_ID         organization id (required)
#   BANK_NAME      name of the CLIP bank, as shown in Coop (required)
#   ITEM_TYPE_ID   id of an item type with an image field (required)
#   IMAGE_FIELD    name of that image field (required)
#   COOP_URL       default http://localhost:8080
#   HMA_CLIP_URL   default http://localhost:9877
#   IMAGE_HOST     host the CLIP instance uses to reach this machine
#                  (default host.docker.internal)
#   FILE_PORT      port serving the fixture images (default 8765)
#   CALLBACK_PORT  port receiving the action callback (default 8766)
#   SEED_CMD       command that runs the seed script, run from server/
#                  (default: node on transpiled/bin/seed-clip-bank.js, which
#                  exists after `pnpm start` or a build in server/)
set -euo pipefail

: "${API_KEY:?set API_KEY}" "${ORG_ID:?set ORG_ID}" "${BANK_NAME:?set BANK_NAME}"
: "${ITEM_TYPE_ID:?set ITEM_TYPE_ID}" "${IMAGE_FIELD:?set IMAGE_FIELD}"
COOP_URL="${COOP_URL:-http://localhost:8080}"
HMA_CLIP_URL="${HMA_CLIP_URL:-http://localhost:9877}"
IMAGE_HOST="${IMAGE_HOST:-host.docker.internal}"
FILE_PORT="${FILE_PORT:-8765}"
CALLBACK_PORT="${CALLBACK_PORT:-8766}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$HERE/../../server"
SEED_CMD="${SEED_CMD:-node --env-file-if-exists=.env transpiled/bin/seed-clip-bank.js}"
TMP="$(mktemp -d)"
RUN_ID="clip-smoke-$$"
PIDS=()
HMA_BANK=""
CONTENT_IDS=()

run() { echo "+ $*" >&2; "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [ -n "$HMA_BANK" ]; then
    for id in ${CONTENT_IDS[@]+"${CONTENT_IDS[@]}"}; do
      curl -fsS -X DELETE "$HMA_CLIP_URL/c/bank/$HMA_BANK/content/$id" >/dev/null 2>&1 || true
    done
  fi
  mv "$TMP" "$HOME/.Trash/$(basename "$TMP")-clip-smoke" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

hash_of() { curl -fsS --max-time 900 -G --data-urlencode "url=$1" "$HMA_CLIP_URL/h/hash" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip_float'])"; }
# Restricted to the seeded bank so other banks holding the image cannot satisfy the check.
lookup() { curl -fsS -X POST "$HMA_CLIP_URL/m/lookup" -H 'Content-Type: application/json' -d "{\"signal_type\":\"clip_float\",\"signal\":\"$1\",\"banks\":\"$HMA_BANK\"}"; }

run curl -fsS "$HMA_CLIP_URL/status" >/dev/null || fail "CLIP HMA is not reachable at $HMA_CLIP_URL"
run curl -fsS -o /dev/null "$COOP_URL/" || fail "Coop is not reachable at $COOP_URL"

for port in "$FILE_PORT" "$CALLBACK_PORT"; do
  ! (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null || fail "port $port is already in use; set FILE_PORT or CALLBACK_PORT"
done

echo "+ python3 -m http.server $FILE_PORT (serving $HERE/fixtures/probe)" >&2
python3 -m http.server "$FILE_PORT" --bind 0.0.0.0 --directory "$HERE/fixtures/probe" >/dev/null 2>&1 &
PIDS+=($!)
for _ in $(seq 1 20); do curl -fs -o /dev/null "http://localhost:$FILE_PORT/scene-resized.jpg" && break; sleep 0.5; done
curl -fsS -o /dev/null "http://localhost:$FILE_PORT/scene-resized.jpg" || fail "the fixture file server did not start on port $FILE_PORT"

echo "+ listening for the action callback on port $CALLBACK_PORT" >&2
cat > "$TMP/listener.py" <<'PY'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        open(sys.argv[2], "ab").write(body + b"\n")
        self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    def log_message(self, *a): pass
http.server.HTTPServer(("0.0.0.0", int(sys.argv[1])), H).serve_forever()
PY
: > "$TMP/callbacks.log"
python3 "$TMP/listener.py" "$CALLBACK_PORT" "$TMP/callbacks.log" &
PIDS+=($!)

echo "+ seed the bank: (cd server && $SEED_CMD --org $ORG_ID --bank '$BANK_NAME' --dir $HERE/fixtures/bank)" >&2
# shellcheck disable=SC2086
SEED_RC=0
(cd "$SERVER_DIR" && $SEED_CMD --org "$ORG_ID" --bank "$BANK_NAME" --dir "$HERE/fixtures/bank") >"$TMP/seed.out" 2>&1 || SEED_RC=$?
cat "$TMP/seed.out" >&2
# Record what was added before checking the result, so a partial run is cleaned up.
HMA_BANK=$(sed -n 's/^Bank ".*" (\(.*\)) on the CLIP instance$/\1/p' "$TMP/seed.out")
while read -r id; do CONTENT_IDS+=("$id"); done < <(sed -n 's/.*HMA content id \([0-9]*\).*/\1/p' "$TMP/seed.out")
[ "$SEED_RC" -eq 0 ] || fail "seeding the bank failed"
[ -n "$HMA_BANK" ] || fail "could not read the HMA bank name from the seed output"

NEAR_URL="http://$IMAGE_HOST:$FILE_PORT/scene-resized.jpg"
OTHER_URL="http://$IMAGE_HOST:$FILE_PORT/other.jpg"

echo "== Part 1: CLIP instance only" >&2
echo "+ hash $NEAR_URL (first run downloads the model; this can take a while)" >&2
NEAR_HASH=$(hash_of "$NEAR_URL")
[ "${#NEAR_HASH}" -eq 4096 ] || fail "expected a 4096-character clip_float hash, got ${#NEAR_HASH}"
echo "+ POST $HMA_CLIP_URL/m/lookup (retrying until HMA has indexed the bank, up to 5 minutes)" >&2
RESULT="{}"
for _ in $(seq 1 30); do
  # HMA answers 503 until its first index is built; treat that as no match yet.
  RESULT=$(lookup "$NEAR_HASH" || echo "{}")
  [ "$RESULT" != "{}" ] && break
  sleep 10
done
echo "$RESULT" | python3 -c "
import json,sys
m=json.load(sys.stdin).get('$HMA_BANK')
assert m, 'the resized image did not match the bank'
assert float(m[0]['distance']) < 0.1, 'distance too large: %r' % m
" || fail "the resized image should match the seeded bank"
echo "+ hash $OTHER_URL and look it up" >&2
OTHER_RESULT=$(lookup "$(hash_of "$OTHER_URL")") || fail "looking up the unrelated image failed"
[ "$OTHER_RESULT" = "{}" ] || fail "the unrelated image should not match"
echo "PASS: part 1, the CLIP instance matches the resized image and not the unrelated one" >&2

echo "== Part 2: through the Coop API" >&2
submit() {
  echo "+ curl -X POST $COOP_URL/api/v1/items/async/ -H 'X-API-KEY: <API_KEY>' (item $1)" >&2
  curl -fsS -X POST "$COOP_URL/api/v1/items/async/" -H "X-API-KEY: $API_KEY" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"id\":\"$1\",\"typeId\":\"$ITEM_TYPE_ID\",\"data\":{\"$IMAGE_FIELD\":\"$2\"}}]}" >/dev/null
}
submit "$RUN_ID-other" "$OTHER_URL"
submit "$RUN_ID-near" "$NEAR_URL"

echo "+ waiting up to 2 minutes for the action callback for $RUN_ID-near" >&2
for _ in $(seq 1 60); do
  grep -q "$RUN_ID-near" "$TMP/callbacks.log" && break
  sleep 2
done
grep -q "$RUN_ID-near" "$TMP/callbacks.log" || fail "the rule did not fire for the resized image (check the rule, the bank and that CLIP is on for the org)"
# A negative check can only wait: the rule engine is asynchronous.
sleep 10
! grep -q "$RUN_ID-other" "$TMP/callbacks.log" || fail "the rule fired for the unrelated image"
echo "PASS: part 2, the rule fired for the resized image and not for the unrelated one" >&2
echo "PASS: CLIP matching works through Coop"
