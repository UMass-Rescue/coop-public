# Copyright (c) Meta Platforms, Inc. and affiliates.

"""
OpenMediaMatch config for the optional CLIP-enabled HMA instance.

Unlike the stock instance (../omm_config.py), this one hashes and matches with
CLIP only. PDQ and MD5 stay on the stock instance.
"""

import os

from OpenMediaMatch.storage.postgres.impl import DefaultOMMStore
from threatexchange.content_type.photo import PhotoContent
from tx_extension_clip import CLIPFloatSignal

DBUSER = os.environ.get("POSTGRES_USER", "postgres")
DBPASS = os.environ.get("POSTGRES_PASSWORD", "postgres123")
DBHOST = os.environ.get("POSTGRES_HOST", "hma-clip-postgres")
DBNAME = os.environ.get("POSTGRES_DB", "postgres")
DATABASE_URI = f"postgresql+psycopg2://{DBUSER}:{DBPASS}@{DBHOST}/{DBNAME}"

PRODUCTION = False
ROLE_HASHER = True
ROLE_MATCHER = True
ROLE_CURATOR = True
UI_ENABLED = True

TASK_FETCHER = True
TASK_INDEXER = True
TASK_INDEX_CACHE = True

TASK_INDEXER_INTERVAL_SECONDS = 60 * 2
TASK_INDEX_CACHE_INTERVAL_SECONDS = 60
MAX_REMOTE_FILE_SIZE = 100 * 1024 * 1024  # 100MB

# HMA fetches any URL it is given. Set HMA_ALLOWED_HOSTNAMES to a
# comma-separated list (subdomains included) to restrict where it may fetch
# from. Empty allows any http(s) URL.
ALLOWED_HOSTNAMES = {
    host.strip()
    for host in os.environ.get("HMA_ALLOWED_HOSTNAMES", "").split(",")
    if host.strip()
}

STORAGE_IFACE_INSTANCE = DefaultOMMStore(
    signal_types=[CLIPFloatSignal],
    content_types=[PhotoContent],
    exchange_types=[],
)
