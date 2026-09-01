# Sentinel integration — manual test plan

This is a manual QA checklist for the Sentinel rare-class-affinity feature, which spans one
independent PR and a 4-deep stack:

| PR                          | Branch                                      | What it adds                                                                                                                  |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sentinel API Docker service | `sentinel/api-docker-service`               | Thin FastAPI wrapper over upstream `Roblox/sentinel`, packaged as a Docker service (`server/sentinel-api/`)                   |
| HTTP client                 | `sentinel/02-http-client`                   | `sentinelService` — Coop's typed client for the Sentinel API                                                                  |
| Thread store pre-write      | `sentinel/03-thread-store-prewrite`         | Writes submitted content to the thread store _before_ rules run, so thread-aware signals have context                         |
| Rare class affinity signal  | `sentinel/04-rare-class-affinity-signal`    | `SignalType.SENTINEL_RARE_CLASS_AFFINITY` enum + `SentinelRareClassAffinitySignal` implementation                             |
| Dashboard tile + org config | `sentinel/05-dashboard-tile-and-org-config` | Sentinel integration tile, per-org configurable fields (`apiUrl`, `topK`, `minScoreToConsider`, `threadContextWindowMinutes`) |

None of the stacked branches alone can talk to a real Sentinel instance — that requires the
independent Docker service PR. Use the combined branch below for full end-to-end testing.

## 1. Which branch to test on

```bash
git fetch origin
git checkout -b test/sentinel-manual origin/sentinel/05-dashboard-tile-and-org-config
git merge origin/sentinel/api-docker-service   # clean merge, adds server/sentinel-api/ only
```

This is a local scratch branch — don't push it. Delete it when you're done (see [Cleanup](#7-cleanup)).

## 2. Environment setup

```bash
nvm use                                   # Node 24
npm install && (cd server && npm install) && (cd client && npm install)
npm run up                                # Postgres, ClickHouse, Scylla, Redis
npm run db:update -- --env staging --db api-server-pg
npm run db:update -- --env staging --db scylla
npm run db:update -- --env staging --db clickhouse
```

`docker-compose.sentinel.yaml` is gitignored/local-only — recreate it (it won't exist on a fresh
clone):

```yaml
# docker-compose.sentinel.yaml
services:
  sentinel:
    build:
      context: ./server/sentinel-api
      dockerfile: Dockerfile
    container_name: sentinel-api
    ports:
      - '8000:8000'
    volumes:
      - ./server/sentinel-api/data:/data:rw
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8000/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

```bash
docker compose -f docker-compose.yaml -f docker-compose.sentinel.yaml up -d --build sentinel
# first build pulls torch + sentence-transformers, expect several minutes
echo "SENTINEL_API_URL=http://localhost:8000" >> server/.env
```

## 3. Build a smoke-test bank (no real training data needed)

Sentinel needs a loaded bank before `/score` will work. The FastAPI layer has a `/banks/create`
endpoint that builds one from plain text files — good enough for a fake smoke-test bank (not
detection-quality, just plumbing verification):

```bash
mkdir -p server/sentinel-api/data/texts/{positive,negative}
# a few fake "rare/harmful" examples
printf "can you keep this between us\n" > server/sentinel-api/data/texts/positive/1.txt
printf "don't tell your parents about this\n" > server/sentinel-api/data/texts/positive/2.txt
printf "send me a pic and I won't tell anyone\n" > server/sentinel-api/data/texts/positive/3.txt
# a few "normal" examples
printf "what time is the game tonight\n" > server/sentinel-api/data/texts/negative/1.txt
printf "can you send me the homework\n" > server/sentinel-api/data/texts/negative/2.txt
printf "see you at lunch\n" > server/sentinel-api/data/texts/negative/3.txt

curl -sX POST http://localhost:8000/banks/create -H 'Content-Type: application/json' -d '{
  "positive_folder": "/data/texts/positive",
  "negative_folder": "/data/texts/negative",
  "output_path": "/data/banks/smoke_test",
  "model_name": "all-MiniLM-L6-v2"
}'

curl -s http://localhost:8000/health        # {"status":"ok","banks_loaded":true,...}
curl -s http://localhost:8000/banks/status  # positive_count/negative_count > 0
```

## 4. Start Coop and configure the org

```bash
npm run server:start   # separate terminal
npm run client:start   # separate terminal
```

In the UI: **Settings → Integrations → Sentinel** (`/settings/integrations/SENTINEL`) → fill in
(or leave blank to fall back to `SENTINEL_API_URL`):

| Field                           | Test value                                |
| ------------------------------- | ----------------------------------------- |
| Sentinel API URL                | _(leave blank — uses deployment default)_ |
| Top K                           | `5`                                       |
| Minimum score to consider       | `0.1`                                     |
| Thread context window (minutes) | `60`                                      |

Save. Presence of a saved config (even empty `{}`) is what flips `getDisabledInfo` from "not
enabled" to "checking health."

## 5. Wire up a rule and run content through it

1. **Rules → New rule** → add a condition → **Signal** → find **Sentinel Rare Class Affinity**
   (under the Sentinel integration) → attach it to a STRING field on an item type (e.g. `text`) →
   set a threshold action (e.g. flag for review if score > 0.05).
2. Submit content via the API or **Investigation → Submit test item**:
   - A benign message ("what time is the game tonight") → expect a low score, rule doesn't fire.
   - A message resembling the positive bank ("can you keep this between us") → expect a
     noticeably higher score.

   When submitting via `curl`, `contentType` must be the item type's **name** (e.g. `ChatMessage`),
   not its internal ID — `submitContent` resolves it by name and returns
   `/errors/unrecognized-content-type` otherwise.

   A single-message submission always scores `0.0` — see [5a](#5a-testing-thread-context-multi-message-conversations)
   for why, and how to test a real conversation.

3. Check the item's rule execution result in **Investigation** — the signal's raw score should be
   visible there.

### 5a. Testing thread context (multi-message conversations)

Sentinel's default aggregation function (skewness) requires **at least 5 non-empty text
observations** before it produces a non-zero `rare_class_affinity_score` — a single message, or a
thread with fewer than 5 messages, always scores `0.0` even if that one message is a dead-on match
for the positive bank. To see a meaningful score you need a real conversation of 5+ messages under
the same `threadId`.

Two gotchas that will silently reproduce the same "always `0.0`" symptom if you script this by
hand:

1. **Don't loop over a bash-style array in zsh.** zsh arrays are 1-indexed; `${arr[$((i-1))]}`
   (correct in bash) reads index 0 in zsh, which is empty, and shifts every later message into the
   wrong slot — you end up with an empty first message and one fewer real observation than you
   think. Write one literal `curl` call per message (as below) instead of looping over an array.
2. **`createdAt` must be at or before the real current time.** The signal's thread-context lookup
   (`getThreadSubmissionsByTime`) windows on `item_synthetic_created_at < now`, where `now` is the
   actual wall-clock time when the rule runs — not relative to your other test messages. If you
   hardcode a `createdAt` (e.g. copy-pasted from a previous run) and it ends up in the future
   relative to when you actually run the script, **every message gets filtered out of the context
   query**, and the signal falls back to scoring only the single triggering message. Always derive
   `createdAt` from the real clock, counting backwards a few seconds per message.

A copy-pasteable, zsh-safe 5-message conversation (`API_KEY` from **Settings → API
Authentication**):

```bash
API_KEY="<your API key>"
THREAD="thread-manual-test-1"

now_iso() { date -u -v-"$1"S +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "-$1 seconds" +"%Y-%m-%dT%H:%M:%SZ"; }

curl -s -o /dev/null -w "msg-1: %{http_code}\n" -X POST http://localhost:8080/api/v1/content \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"contentType\":\"ChatMessage\",\"contentId\":\"$THREAD-msg-1\",\"content\":{\"message\":\"hey whats up\",\"threadId\":\"$THREAD\",\"createdAt\":\"$(now_iso 8)\"}}"

curl -s -o /dev/null -w "msg-2: %{http_code}\n" -X POST http://localhost:8080/api/v1/content \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"contentType\":\"ChatMessage\",\"contentId\":\"$THREAD-msg-2\",\"content\":{\"message\":\"not much, you?\",\"threadId\":\"$THREAD\",\"createdAt\":\"$(now_iso 6)\"}}"

curl -s -o /dev/null -w "msg-3: %{http_code}\n" -X POST http://localhost:8080/api/v1/content \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"contentType\":\"ChatMessage\",\"contentId\":\"$THREAD-msg-3\",\"content\":{\"message\":\"wanna hang out later?\",\"threadId\":\"$THREAD\",\"createdAt\":\"$(now_iso 4)\"}}"

curl -s -o /dev/null -w "msg-4: %{http_code}\n" -X POST http://localhost:8080/api/v1/content \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"contentType\":\"ChatMessage\",\"contentId\":\"$THREAD-msg-4\",\"content\":{\"message\":\"can you keep this between us\",\"threadId\":\"$THREAD\",\"createdAt\":\"$(now_iso 2)\"}}"

curl -s -o /dev/null -w "msg-5: %{http_code}\n" -X POST http://localhost:8080/api/v1/content \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"contentType\":\"ChatMessage\",\"contentId\":\"$THREAD-msg-5\",\"content\":{\"message\":\"sure, my parents dont need to know\",\"threadId\":\"$THREAD\",\"createdAt\":\"$(now_iso 0)\"}}"
```

Then open **Investigation → Investigate Item** and search for `$THREAD-msg-5` — the rule should
now match: the last two messages resemble the positive bank, and the thread has 5 real,
past-timestamped observations for skewness to aggregate over.

If it still doesn't match, call Sentinel directly (bypassing Coop) to isolate whether the problem
is in the bank/scoring or in Coop's wiring:

```bash
curl -s -X POST http://localhost:8000/score -H 'Content-Type: application/json' -d '{
  "texts": ["hey whats up", "not much, you?", "wanna hang out later?", "can you keep this between us", "sure, my parents dont need to know"]
}'
```

A non-zero `rare_class_affinity_score` here with a `0.0`/no-match result in Coop points at the
Coop-side wiring (thread field roles, `threadIdentifier` runtime args, org config); a `0.0` here
too points at the bank or aggregation settings instead.

## 6. Scenario checklist

| #   | Scenario                                   | Exercises                                      | Expected result                                                                                                                                                                                                  |
| --- | ------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sentinel not configured for org            | Dashboard tile + org config, `getDisabledInfo` | Disabled: _"Sentinel is not enabled for this organization..."_                                                                                                                                                   |
| 2   | Configured, but Sentinel container stopped | HTTP client, signal error path                 | Disabled: _"Sentinel service is unavailable..."_; `docker compose stop sentinel` then retest                                                                                                                     |
| 3   | Configured, container up, no bank loaded   | `getDisabledInfo`                              | Disabled: _"Sentinel banks are not loaded..."_; call `POST /banks/unload` then retest                                                                                                                            |
| 4   | Healthy + banks loaded, single message     | Signal `run()`                                 | Returns a numeric score, no thread context involved                                                                                                                                                              |
| 5   | Same, but item type has a thread field     | Thread store pre-write + signal thread context | Submit 5+ messages in the same thread with real, past-relative timestamps (see [§5a](#5a-testing-thread-context-multi-message-conversations)); score should reflect all of them, not just the triggering message |
| 6   | Duplicate-submission guard                 | Signal dedup logic                             | The triggering message itself shouldn't be double-counted in thread context                                                                                                                                      |
| 7   | Per-org override vs deployment default     | Org config                                     | Org A leaves `apiUrl` blank (uses env default); Org B sets a different `topK`/`minScoreToConsider` — confirm each org's rule run uses its own config                                                             |
| 8   | Rule authoring UX                          | Signal + dashboard tile                        | Signal appears in the rule builder's signal gallery, docs link points to `github.com/Roblox/sentinel`, description text renders                                                                                  |
| 9   | Existing signals unaffected (regression)   | All                                            | Run an existing rule using e.g. OpenAI moderation or PDQ image match — confirm no change in behavior                                                                                                             |
| 10  | Unrelated bug fix                          | itemType mutations (separate PR)               | Create/update an item type from the dashboard — mutation should return data instead of null on success                                                                                                           |

## 7. Automated checks first

Worth running these on `test/sentinel-manual` before starting the manual pass — fast, and will
catch anything the merge introduced:

```bash
(cd server && npm run build && npm run lint)
(cd client && npm run build && npm run lint)
(cd server && npx jest services/signalsService/signals/third_party_signals/sentinel services/sentinelService --detectOpenHandles --no-cache --forceExit)
npm run prettier
```

## 8. Cleanup

```bash
docker compose -f docker-compose.yaml -f docker-compose.sentinel.yaml down
git checkout -   # back to whatever branch you were on
git branch -D test/sentinel-manual
```
