# Sentinel API — thin FastAPI wrapper over upstream Roblox/sentinel.
#
# Roblox's own Dockerfile/Dockerfile.cpu (github.com/Roblox/sentinel) package
# the `sentinel` *library* and run example scripts; they do not ship an HTTP
# service. Coop needs an HTTP API (`/score`, `/health`, `/banks/*`), so this
# image installs Roblox's library at a pinned commit as a normal dependency
# and layers Coop's own `app/` FastAPI package on top, which imports it like
# any other consumer would. This replaces depending on the UMass-Rescue/Sentinel
# fork, which vendored an equivalent API layer directly into a full clone of
# the library.
#
# Bump SENTINEL_COMMIT deliberately when upgrading (no upstream version tags
# exist yet, so we pin to a commit SHA rather than a tag or `main`). If a bump
# breaks the build, `sentinel`'s internal module paths have likely moved — see
# README.md for which ones `app/` depends on.

# =============================================================================
# Stage 1: builder — install the pinned library and Coop's FastAPI deps
# =============================================================================
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# build-essential: compile any dependency without a prebuilt wheel.
# git: required for `pip install git+https://...`.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        git \
    && rm -rf /var/lib/apt/lists/*

ARG SENTINEL_COMMIT=66c69854e806bd9f5c866379b6c75f3fcb4d2e6c

WORKDIR /app

# Install CPU-only torch FIRST, from PyTorch's dedicated CPU index. Doing this
# before installing `sentinel` means the later install sees a compatible
# torch already present and won't pull the default (CUDA) build, which drags
# in several GB of unused GPU libraries. Mirrors Roblox's own Dockerfile.cpu.
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.3.0,<3.0.0"

# Roblox's `sentinel` library (Apache-2.0), with the `sbert` extra
# (sentence-transformers) needed for embedding text at scoring/bank-build time.
# Installed unmodified — Coop's API layer (app/, copied in below) only
# imports it, the same as any other consumer of the package would.
RUN pip install "sentinel[sbert] @ git+https://github.com/Roblox/sentinel.git@${SENTINEL_COMMIT}"

# Coop-owned HTTP layer's dependencies. Not part of upstream Roblox/sentinel.
RUN pip install \
        "fastapi>=0.115.0" \
        "uvicorn[standard]>=0.34.0" \
        "pydantic-settings>=2.0.0"

# =============================================================================
# Stage 2: runtime
# =============================================================================
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/sentinel/.cache/huggingface \
    SENTINEL_APP_NAME="Sentinel API" \
    SENTINEL_DEBUG=false

# curl: used by the HEALTHCHECK below.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash sentinel

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

RUN mkdir -p /data/banks /data/texts "$HF_HOME" \
    && chown -R sentinel:sentinel /data /home/sentinel

USER sentinel
WORKDIR /home/sentinel

# Coop's own FastAPI app — plain source, not a patch. Reviewable/editable
# like any other file in this repo. See README.md for its layout.
COPY --chown=sentinel:sentinel app/ ./app/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
