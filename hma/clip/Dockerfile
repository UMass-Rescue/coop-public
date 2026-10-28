# Optional CLIP-enabled HMA instance for semantic image matching.
#
# Stock HMA (../Dockerfile) only hashes with PDQ. This image adds the
# tx-extension-clip signal and a patch that lets a signal be looked up with a
# JSON POST (a CLIP hash is ~4 KB, too long for a GET query string).
#
# CPU by default. For GPU, build with PYTORCH_CUDA, TORCH_VERSION and
# TORCHVISION_VERSION for your CUDA version; see docs/integrations/hma-clip.md.

ARG THREATEXCHANGE_COMMIT=aff3f3b803a99196009f5abaf47fdc2cdbce81c8
ARG TX_EXTENSION_CLIP_COMMIT=b0ff722d947c52152ae0a1e0f0e56cf2e9ff66ea

FROM python:3.11-trixie AS source
ARG THREATEXCHANGE_COMMIT
ARG TX_EXTENSION_CLIP_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends git patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /threatexchange
COPY patches/hma-clip-lookup.patch /tmp/hma-clip-lookup.patch
RUN git init -q . \
    && git remote add origin https://github.com/facebook/ThreatExchange.git \
    && git fetch -q --depth 1 origin ${THREATEXCHANGE_COMMIT} \
    && git checkout -q FETCH_HEAD \
    && git apply /tmp/hma-clip-lookup.patch \
    && rm -rf .git

WORKDIR /tx-extension-clip
RUN git init -q . \
    && git remote add origin https://github.com/UMass-Rescue/tx-extension-clip.git \
    && git fetch -q --depth 1 origin ${TX_EXTENSION_CLIP_COMMIT} \
    && git checkout -q FETCH_HEAD \
    && rm -rf .git

FROM python:3.11-trixie
ARG PYTORCH_CUDA=cpu
# Defaults are the CPU build. Each CUDA index carries different versions.
ARG TORCH_VERSION=2.15.0
ARG TORCHVISION_VERSION=0.29.2

ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install torch==${TORCH_VERSION} torchvision==${TORCHVISION_VERSION} \
    --index-url https://download.pytorch.org/whl/${PYTORCH_CUDA}

COPY --from=source /threatexchange/hasher-matcher-actioner/pyproject.toml ./
RUN pip install .[prod]

COPY --from=source /threatexchange/hasher-matcher-actioner/src /app
COPY --from=source /threatexchange/hasher-matcher-actioner/scripts /app/scripts

COPY --from=source /tx-extension-clip /app/tx-extension-clip
RUN pip install /app/tx-extension-clip \
    && python -c "from tx_extension_clip import CLIPFloatSignal"

COPY omm_config.py /app/omm_config.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV OMM_CONFIG=/app/omm_config.py
EXPOSE 5100
ENTRYPOINT ["/app/entrypoint.sh"]
