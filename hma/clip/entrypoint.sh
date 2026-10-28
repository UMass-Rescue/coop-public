#!/bin/sh
set -e

/app/scripts/db-migrate.sh

# One worker: each worker would load its own copy of the CLIP model. The long
# timeout covers the first request, which downloads the model weights.
exec gunicorn --bind 0.0.0.0:5100 --timeout 1200 --workers 1 \
    --error-logfile - --capture-output --log-level info \
    "OpenMediaMatch.app:create_app()"
