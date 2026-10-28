#!/usr/bin/env bash
# Happy-path smoke test for the optional CLIP HMA instance.
#
# Hashes an image, adds it to a temporary bank, and checks that the same image
# matches while a different image does not. Prints each command it runs, exits
# nonzero on failure, and deletes the temporary bank on exit.
#
# Usage: hma/clip/smoke-test.sh
#   HMA_CLIP_URL   default http://localhost:9877
#   IMAGE_URL      image added to the bank (default: a public JPEG)
#   OTHER_URL      a different image that should not match (default: a public PNG)
set -euo pipefail

BASE="${HMA_CLIP_URL:-http://localhost:9877}"
IMAGE_URL="${IMAGE_URL:-https://httpbin.org/image/jpeg}"
OTHER_URL="${OTHER_URL:-https://httpbin.org/image/png}"
BANK="CLIP_SMOKE_TEST_$$"
JSON='Content-Type: application/json'

run() { echo "+ $*" >&2; "$@"; }
hash_of() { curl -fsS --max-time 900 -G --data-urlencode "url=$1" "$BASE/h/hash" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip_float'])"; }
# Restricted to the temporary bank so other banks holding the same image cannot satisfy the check.
lookup() { curl -fsS -X POST "$BASE/m/lookup" -H "$JSON" -d "{\"signal_type\":\"clip_float\",\"signal\":\"$1\",\"banks\":\"$BANK\"}"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() { curl -fsS -X DELETE "$BASE/c/bank/$BANK" >/dev/null 2>&1 || true; }
trap cleanup EXIT

run curl -fsS "$BASE/status" >/dev/null || fail "HMA CLIP is not reachable at $BASE"

echo "+ hash $IMAGE_URL (first run downloads the model; this can take a while)" >&2
HASH=$(hash_of "$IMAGE_URL")
[ "${#HASH}" -eq 4096 ] || fail "expected a 4096-character clip_float hash, got ${#HASH}"

run curl -fsS -X POST "$BASE/c/banks" -H "$JSON" -d "{\"name\":\"$BANK\",\"enabled_ratio\":\"1.0\"}" >/dev/null
run curl -fsS -X POST -G --data-urlencode "url=$IMAGE_URL" "$BASE/c/bank/$BANK/content" >/dev/null

echo "+ POST $BASE/m/lookup (retrying until HMA has indexed the bank, up to 5 minutes)" >&2
for _ in $(seq 1 30); do
  # HMA answers 503 until its first index is built; treat that as no match yet.
  RESULT=$(lookup "$HASH" || echo "{}")
  [ "$RESULT" != "{}" ] && break
  sleep 10
done
echo "$RESULT" | python3 -c "
import json,sys
r=json.load(sys.stdin)
m=r.get('$BANK')
assert m, 'same image did not match: %r' % r
assert float(m[0]['distance']) < 0.01, 'distance too large: %r' % m
" || fail "same image should match its bank"

echo "+ hash $OTHER_URL and look it up" >&2
OTHER=$(hash_of "$OTHER_URL")
[ "$(lookup "$OTHER")" = "{}" ] || fail "a different image should not match"

echo "PASS: CLIP HMA hashes, indexes and matches as expected"
