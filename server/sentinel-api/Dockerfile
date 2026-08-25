# Sentinel API — thin FastAPI wrapper over upstream Roblox/sentinel.
#
# Roblox's own Dockerfile/Dockerfile.cpu (github.com/Roblox/sentinel) package
# the `sentinel` *library* and run example scripts; they do not ship an HTTP
# service. Coop needs an HTTP API (`/score`, `/health`, `/banks/*`), so this
# image installs Roblox's library at a pinned commit and applies
# ./patches/0001-add-fastapi-api-layer.patch, which adds a small `sentinel.api`
# package (owned by Coop) exposing it over FastAPI. This replaces depending on
# the UMass-Rescue/Sentinel fork, which vendored an equivalent API layer
# directly into a full clone of the library.
#
# Bump SENTINEL_COMMIT deliberately when upgrading (no upstream version tags
# exist yet, so we pin to a commit SHA rather than a tag or `main`). If the
# patch fails to apply after a bump, see README.md for how to regenerate it.

# =============================================================================
# Stage 1: builder — install the pinned library, apply the API patch
# =============================================================================
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# build-essential: compile any dependency without a prebuilt wheel.
# git: required for `pip install git+https://...`.
# patch: applies patches/0001-add-fastapi-api-layer.patch below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        patch \
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
RUN pip install "sentinel[sbert] @ git+https://github.com/Roblox/sentinel.git@${SENTINEL_COMMIT}"

# Coop-owned HTTP layer. Not part of upstream Roblox/sentinel.
RUN pip install \
        "fastapi>=0.115.0" \
        "uvicorn[standard]>=0.34.0" \
        "pydantic-settings>=2.0.0"

# Add the `sentinel.api` package to the installed library by patching it in
# place, rather than vendoring a full copy of the files in this repo.
COPY patches/0001-add-fastapi-api-layer.patch /tmp/0001-add-fastapi-api-layer.patch
RUN SITE_PACKAGES="$(python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')" \
    && patch -p1 -d "${SITE_PACKAGES}/sentinel" < /tmp/0001-add-fastapi-api-layer.patch \
    && rm /tmp/0001-add-fastapi-api-layer.patch

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

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "sentinel.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
