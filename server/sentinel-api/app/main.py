# Copyright 2025 Roblox Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""FastAPI application entry point for Sentinel."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .schemas import HealthResponse
from .routes.scoring import router as scoring_router
from .routes.banks import router as banks_router
from .dependencies import index_manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
LOG = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    LOG.info("Starting Sentinel API")

    # Auto-load banks if configured
    if settings.auto_load_banks_path:
        LOG.info(f"Auto-loading banks from {settings.auto_load_banks_path}")
        try:
            index_manager.load_from_path(settings.auto_load_banks_path)
            LOG.info("Banks auto-loaded successfully")
        except Exception as e:
            LOG.error(f"Failed to auto-load banks: {e}")
            # Continue startup even if auto-load fails

    yield

    # Shutdown
    LOG.info("Shutting down...")
    if index_manager.is_loaded:
        index_manager.unload()


# Create FastAPI application
app = FastAPI(
    title="Sentinel API",
    description="""
## Sentinel API

Sentinel is a semantic scoring system for detecting rare text patterns using contrastive learning.

### Core Concepts

- **Positive Bank**: Contains examples of the rare class you want to detect (e.g., harmful content)
- **Negative Bank**: Contains examples of common/normal content
- **Contrastive Score**: Measures how similar text is to the positive bank vs. the negative bank
- **Skewness Aggregation**: Detects if a conversation has outlier high-scoring messages

### Quick Start

1. **Load banks**: `POST /banks/load` with path to pre-computed embeddings
2. **Score text**: `POST /score` with list of text samples
3. **Check status**: `GET /banks/status` to see loaded bank information

### Creating New Banks

If you don't have pre-computed embeddings, use `POST /banks/create` to generate them
from folders of text files.
""",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(scoring_router)
app.include_router(banks_router)


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Health check",
    description="Check if the API is running and whether banks are loaded.",
)
async def health_check() -> HealthResponse:
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        banks_loaded=index_manager.is_loaded,
        version="1.0.0",
    )


@app.get("/", include_in_schema=False)
async def root():
    """Root endpoint redirects to docs."""
    return {
        "message": "Sentinel API",
        "docs": "/docs",
        "health": "/health",
    }
