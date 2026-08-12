# Sentinel API

Thin FastAPI wrapper around upstream [Roblox/sentinel](https://github.com/Roblox/sentinel), giving Coop's
`server/services/sentinelService` an HTTP endpoint (`/score`, `/health`, `/banks/*`) to talk to.

## Why this exists

Roblox's own [`Dockerfile`](https://github.com/Roblox/sentinel/blob/main/Dockerfile) /
[`Dockerfile.cpu`](https://github.com/Roblox/sentinel/blob/main/Dockerfile.cpu) package the `sentinel`
_library_ and run example scripts — there's no HTTP service upstream. Coop previously depended on the
[UMass-Rescue/Sentinel](https://github.com/UMass-Rescue/Sentinel) fork, which vendored an equivalent FastAPI
layer directly into a full clone of the library. This directory replaces that fork: the `Dockerfile` installs
the **unmodified upstream Roblox library** at a pinned commit, then applies
`patches/0001-add-fastapi-api-layer.patch` to it, which adds a small `sentinel.api` package (owned by Coop) on
top so `sentinel.api.*` imports resolve against the installed `sentinel` package.

```text
server/sentinel-api/
  Dockerfile                                   # installs Roblox/sentinel (pinned), applies the patch below
  patches/0001-add-fastapi-api-layer.patch      # adds sentinel/api/{main,config,schemas,dependencies,routes/*}.py
```

Patching the installed library (instead of vendoring the FastAPI files directly in this repo) keeps this
directory's footprint small — a Dockerfile plus a small amount of config, the same shape as `hma/` at the
repo root — rather than a full mini Python package sitting in the Coop monorepo. It lives under `server/`
because `server/services/sentinelService` is its only consumer.

The files added by the patch are not Coop originals — they were carried over from the API layer the UMass
fork built, since re-deriving the same FastAPI wrapper would just reproduce the same code. They carry
Roblox's original Apache-2.0 license header from that fork and are unmodified aside from import paths, which
already matched the upstream `sentinel` package layout.

## Upgrading the pinned commit

Roblox has not cut a version tag yet, so `SENTINEL_COMMIT` in the `Dockerfile` pins a commit SHA rather than
a tag or `main`. To bump it:

1. Pick a new commit from [Roblox/sentinel](https://github.com/Roblox/sentinel/commits/main).
2. Update `ARG SENTINEL_COMMIT=...` in `Dockerfile`.
3. Rebuild: `docker build -t sentinel-api .`. If the patch step fails to apply, the API layer's imports have
   drifted from the new commit — see "Editing the API layer" below to inspect and regenerate it. It depends on
   `sentinel.sentinel_local_index`, `sentinel.embeddings.sbert`, `sentinel.score_formulae`, and
   `sentinel.io.index_io`; if Roblox renames/moves any of those, the patched files need the same update.
4. Smoke test: `docker run --rm -p 8000:8000 sentinel-api`, then `curl http://localhost:8000/health`.

This is a new external dependency pinned by commit SHA (Apache-2.0, compatible with Coop's license) —
per `AGENTS.md`, it needs human sign-off before merging, same as any new/upgraded package.

## Editing the API layer

The patch adds files under `sentinel/api/` (relative to the installed `sentinel` package, i.e. what would be
`src/sentinel/api/` in an upstream Roblox checkout). To change one of those files:

1. Apply the current patch to a scratch copy of the pinned commit and edit there, or edit the patch's `+`
   lines directly for small changes.
2. Regenerate the patch from the edited tree, e.g.:

   ```bash
   # from a directory containing only the old sentinel/api/ tree ("orig") and the new one ("new")
   diff -ruN orig new > server/sentinel-api/patches/0001-add-fastapi-api-layer.patch
   ```

3. Confirm it applies cleanly: `docker build -t sentinel-api server/sentinel-api/`.

## Local dev

Wired via `docker-compose.sentinel.yaml` (gitignored, local-only):

```bash
docker compose -f docker-compose.yaml -f docker-compose.sentinel.yaml up -d sentinel
curl http://localhost:8000/health
```

See `server/.env.example` for the `SENTINEL_API_URL` / bank-related env vars Coop's server expects.
