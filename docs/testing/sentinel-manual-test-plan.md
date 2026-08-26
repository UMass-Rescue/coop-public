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
3. Check the item's rule execution result in **Investigation** — the signal's raw score should be
   visible there.

## 6. Scenario checklist

| #   | Scenario                                   | Exercises                                      | Expected result                                                                                                                                                              |
| --- | ------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sentinel not configured for org            | Dashboard tile + org config, `getDisabledInfo` | Disabled: _"Sentinel is not enabled for this organization..."_                                                                                                               |
| 2   | Configured, but Sentinel container stopped | HTTP client, signal error path                 | Disabled: _"Sentinel service is unavailable..."_; `docker compose stop sentinel` then retest                                                                                 |
| 3   | Configured, container up, no bank loaded   | `getDisabledInfo`                              | Disabled: _"Sentinel banks are not loaded..."_; call `POST /banks/unload` then retest                                                                                        |
| 4   | Healthy + banks loaded, single message     | Signal `run()`                                 | Returns a numeric score, no thread context involved                                                                                                                          |
| 5   | Same, but item type has a thread field     | Thread store pre-write + signal thread context | Submit 3+ messages in the same thread quickly; later scores should reflect earlier messages (check `observation_scores` count via the Sentinel `/score` call or a debug log) |
| 6   | Duplicate-submission guard                 | Signal dedup logic                             | The triggering message itself shouldn't be double-counted in thread context                                                                                                  |
| 7   | Per-org override vs deployment default     | Org config                                     | Org A leaves `apiUrl` blank (uses env default); Org B sets a different `topK`/`minScoreToConsider` — confirm each org's rule run uses its own config                         |
| 8   | Rule authoring UX                          | Signal + dashboard tile                        | Signal appears in the rule builder's signal gallery, docs link points to `github.com/Roblox/sentinel`, description text renders                                              |
| 9   | Existing signals unaffected (regression)   | All                                            | Run an existing rule using e.g. OpenAI moderation or PDQ image match — confirm no change in behavior                                                                         |
| 10  | Unrelated bug fix                          | itemType mutations (separate PR)               | Create/update an item type from the dashboard — mutation should return data instead of null on success                                                                       |

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
