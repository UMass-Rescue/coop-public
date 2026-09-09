# Sentinel API

Thin FastAPI wrapper around upstream [Roblox/sentinel](https://github.com/Roblox/sentinel), giving Coop's
`server/services/sentinelService` an HTTP endpoint (`/score`, `/health`, `/banks/*`) to talk to.

## Why this exists

Roblox's own [`Dockerfile`](https://github.com/Roblox/sentinel/blob/main/Dockerfile) /
[`Dockerfile.cpu`](https://github.com/Roblox/sentinel/blob/main/Dockerfile.cpu) package the `sentinel`
_library_ and run example scripts — there's no HTTP service upstream. Coop previously depended on the
[UMass-Rescue/Sentinel](https://github.com/UMass-Rescue/Sentinel) fork, which vendored an equivalent FastAPI
layer directly into a full clone of the library. This directory replaces that fork: the `Dockerfile` installs
the **unmodified upstream Roblox library** at a pinned commit as a normal Python dependency, and `app/` is
Coop's own small FastAPI application that imports it — the same way any other consumer of the `sentinel`
package would.

```text
server/sentinel-api/
  Dockerfile              # installs Roblox/sentinel (pinned) + FastAPI deps, copies app/ in
  app/                    # Coop-owned FastAPI app — plain source, reviewable/editable like any other file
    main.py                 # app factory, lifespan (auto-loads banks on startup), /health route
    config.py                # env-driven settings (SENTINEL_* prefix)
    dependencies.py           # IndexManager: loads/holds a SentinelLocalIndex, wraps sentinel.* calls
    schemas.py                 # request/response models
    routes/
      scoring.py                # POST /score
      banks.py                   # /banks/{status,load,create,unload}
```

`app/` lives under `server/sentinel-api/` (not e.g. `server/services/`) because it's a separate Python
process, packaged into its own image — the same shape as `hma/` at the repo root. It's the only thing in this
directory that's Coop-authored; everything it depends on (`fastapi`, `uvicorn`, `pydantic-settings`, and the
`sentinel` package itself) is installed normally in the `Dockerfile`.

`app/` originated as the API layer the UMass fork built directly into a `sentinel` clone; moving here, its
files were adapted to import the **installed** `sentinel` package (`from sentinel.sentinel_local_index import
...`, etc.) instead of relative imports into a sibling source tree, and its own internal imports
(`app.config`, `app.schemas`, ...) were made relative to `app/` rather than nested under `sentinel.api.*`.
They keep the original Apache-2.0 license header. `app/dependencies.py` and `app/routes/scoring.py` are the
files that actually reach into `sentinel`'s internals (`sentinel.sentinel_local_index`,
`sentinel.embeddings.sbert`, `sentinel.score_formulae`, `sentinel.io.index_io`) — if Roblox renames or moves
any of those, those two files need matching updates.

## Upgrading the pinned commit

Roblox has not cut a version tag yet, so `SENTINEL_COMMIT` in the `Dockerfile` pins a commit SHA rather than
a tag or `main`. To bump it:

1. Pick a new commit from [Roblox/sentinel](https://github.com/Roblox/sentinel/commits/main).
2. Update `ARG SENTINEL_COMMIT=...` in `Dockerfile`.
3. Rebuild: `docker build -t sentinel-api server/sentinel-api/`. If it fails on import errors from `app/`,
   `sentinel`'s internal module layout has moved — update the imports in `app/dependencies.py` and/or
   `app/routes/scoring.py` to match (see the previous section for exactly which modules they touch).
4. Smoke test: `docker run --rm -p 8000:8000 sentinel-api`, then `curl http://localhost:8000/health`.

This is a new external dependency pinned by commit SHA (Apache-2.0, compatible with Coop's license) —
per `AGENTS.md`, it needs human sign-off before merging, same as any new/upgraded package.

## Editing the API layer

`app/` is normal Python source, versioned directly in this repo — edit it like any other file in Coop. No
patch generation or regeneration step is needed; changes show up as an ordinary diff in review.

## Tests

`tests/` covers `app/` with `pytest` — routes are tested through `fastapi.testclient.TestClient` with
`get_loaded_index`/`get_index_manager` overridden to avoid needing a real bank or model download;
`app/dependencies.py`'s `IndexManager` is tested directly, mocking only the `sentinel` calls that would
otherwise hit real model weights (`SentinelLocalIndex`, `get_sentence_transformer_and_scaling_fn`).

`pytest` and `httpx` (required by `TestClient`) are dev-only — they're in `requirements-dev.txt`, not the
`Dockerfile`, so they never ship in the runtime image. Running them locally still needs the same production
dependencies as the image itself (`torch`, `sentinel[sbert]`, `fastapi`, `uvicorn`, `pydantic-settings`), so
the easiest way to run them is against the `builder` stage, which already has all of that installed:

```bash
docker build --target builder -t sentinel-api-builder server/sentinel-api/
docker run --rm -v "$(pwd)/server/sentinel-api":/workspace -w /workspace sentinel-api-builder \
  bash -c "pip install -q -r requirements-dev.txt && python -m pytest tests/ -v"
```

## Local dev

Wired via `docker-compose.sentinel.yaml` (gitignored, local-only):

```bash
docker compose -f docker-compose.yaml -f docker-compose.sentinel.yaml up -d sentinel
curl http://localhost:8000/health
```

See `server/.env.example` for the `SENTINEL_API_URL` / bank-related env vars Coop's server expects.
