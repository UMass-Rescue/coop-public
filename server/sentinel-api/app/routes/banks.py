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

"""Bank management endpoints for Sentinel API."""

import logging
from fastapi import APIRouter, Depends, HTTPException

from ..schemas import (
    LoadBanksRequest,
    LoadBanksResponse,
    CreateBanksRequest,
    CreateBanksResponse,
    BankStatusResponse,
)
from ..dependencies import IndexManager, get_index_manager

LOG = logging.getLogger(__name__)

router = APIRouter(prefix="/banks", tags=["Bank Management"])


@router.get(
    "/status",
    response_model=BankStatusResponse,
    summary="Get bank status",
    description="Get the current status of loaded banks, including counts and model information.",
)
async def get_bank_status(
    manager: IndexManager = Depends(get_index_manager),
) -> BankStatusResponse:
    """Get the current status of the loaded banks."""
    status = manager.get_status()
    return BankStatusResponse(**status)


@router.post(
    "/load",
    response_model=LoadBanksResponse,
    summary="Load existing banks",
    description="""
Load existing banks from a path containing pre-computed embeddings.

The path should contain:
- `sentinel_local_index_config.json`: Configuration file with model name and settings
- `embeddings.safetensors`: Pre-computed embeddings for positive and negative banks

Supports both local filesystem paths and S3 URIs (s3://bucket/path).

**Note:** Loading new banks will replace any previously loaded banks.
""",
)
async def load_banks(
    request: LoadBanksRequest,
    manager: IndexManager = Depends(get_index_manager),
) -> LoadBanksResponse:
    """
    Load existing banks from a path.

    Args:
        request: The load request containing the path.
        manager: The index manager (injected via dependency).

    Returns:
        LoadBanksResponse with success status and bank information.
    """
    LOG.info(f"Loading banks from {request.path}")

    try:
        manager.load_from_path(
            path=request.path,
            negative_to_positive_ratio=request.negative_to_positive_ratio,
        )

        status = manager.get_status()
        return LoadBanksResponse(
            success=True,
            message=f"Banks loaded successfully from {request.path}",
            status=BankStatusResponse(**status),
        )

    except FileNotFoundError as e:
        LOG.error(f"Failed to load banks: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"Banks not found at {request.path}: {str(e)}",
        )
    except Exception as e:
        LOG.error(f"Failed to load banks: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load banks: {str(e)}",
        )


@router.post(
    "/create",
    response_model=CreateBanksResponse,
    summary="Create new banks from text files",
    description="""
Create new banks by processing text files from specified folders.

**Process:**
1. Reads all text files (matching specified extensions) from the positive and negative folders
2. Generates embeddings for each text using the specified sentence transformer model
3. Saves the embeddings as a new bank at the output path
4. Loads the newly created banks for immediate use

**Folder structure:**
- Each `.txt` or `.md` file in the positive folder becomes one positive example
- Each `.txt` or `.md` file in the negative folder becomes one negative example
- Files can be nested in subdirectories

**Note:** This operation can take several minutes depending on the number of files 
and the model used. The newly created banks are automatically loaded after creation.
""",
)
async def create_banks(
    request: CreateBanksRequest,
    manager: IndexManager = Depends(get_index_manager),
) -> CreateBanksResponse:
    """
    Create new banks from folders of text files.

    Args:
        request: The creation request with folder paths and settings.
        manager: The index manager (injected via dependency).

    Returns:
        CreateBanksResponse with creation status and counts.
    """
    LOG.info(
        f"Creating new banks from positive={request.positive_folder}, "
        f"negative={request.negative_folder}"
    )

    try:
        counts = manager.create_from_folders(
            positive_folder=request.positive_folder,
            negative_folder=request.negative_folder,
            output_path=request.output_path,
            model_name=request.model_name or "all-MiniLM-L6-v2",
            file_extensions=request.file_extensions or [".txt", ".md"],
            model_card=request.model_card,
        )

        return CreateBanksResponse(
            success=True,
            message=f"Banks created and loaded successfully",
            output_path=request.output_path,
            positive_count=counts["positive_count"],
            negative_count=counts["negative_count"],
        )

    except ValueError as e:
        LOG.error(f"Invalid input: {e}")
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )
    except Exception as e:
        LOG.error(f"Failed to create banks: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create banks: {str(e)}",
        )


@router.post(
    "/unload",
    summary="Unload current banks",
    description="Unload the currently loaded banks from memory.",
)
async def unload_banks(
    manager: IndexManager = Depends(get_index_manager),
) -> dict:
    """Unload the currently loaded banks."""
    if not manager.is_loaded:
        return {"success": True, "message": "No banks were loaded"}

    manager.unload()
    return {"success": True, "message": "Banks unloaded successfully"}
