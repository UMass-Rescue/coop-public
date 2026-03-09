FROM ghcr.io/facebook/threatexchange/hma:1.1.1

WORKDIR /app

# Install CLIP extension from public repo
RUN git clone -b main https://github.com/UMass-Rescue/tx-extension-clip.git /app/tx-extension-clip && \
    pip install /app/tx-extension-clip

COPY omm_config.py /app/omm_config.py
COPY local-entrypoint.sh /app/entrypoint.sh

# Make the entrypoint script executable
RUN chmod +x /app/entrypoint.sh

ENV OMM_CONFIG=/app/omm_config.py

ENTRYPOINT ["/app/entrypoint.sh"]
