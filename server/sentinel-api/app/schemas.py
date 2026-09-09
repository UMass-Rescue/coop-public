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

"""Pydantic schemas for Sentinel API requests and responses."""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


# ============================================================================
# Scoring Schemas
# ============================================================================


class ScoreRequest(BaseModel):
    """Request schema for scoring a conversation."""

    texts: List[str] = Field(
        ...,
        description="List of text samples (e.g., messages in a conversation) to score",
        min_length=1,
    )
    top_k: Optional[int] = Field(
        default=5,
        description="Number of nearest neighbors to consider for scoring",
        ge=1,
        le=100,
    )
    min_score_to_consider: Optional[float] = Field(
        default=0.1,
        description="Threshold below which individual scores are set to 0",
        ge=0.0,
        le=1.0,
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "texts": [
                        "Hello, how are you?",
                        "I'm doing great, thanks!",
                        "Want to meet up later?",
                    ],
                    "top_k": 5,
                    "min_score_to_consider": 0.1,
                }
            ]
        }
    }


class ScoreResponse(BaseModel):
    """Response schema for scoring results."""

    rare_class_affinity_score: float = Field(
        ...,
        description="Aggregated score indicating overall affinity to the rare class (using skewness)",
    )
    observation_scores: Dict[str, float] = Field(
        ...,
        description="Individual score for each input text sample",
    )
    num_observations: int = Field(
        ...,
        description="Number of text samples scored",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "rare_class_affinity_score": 0.234,
                    "observation_scores": {
                        "Hello, how are you?": 0.02,
                        "I'm doing great, thanks!": 0.01,
                        "Want to meet up later?": 0.15,
                    },
                    "num_observations": 3,
                }
            ]
        }
    }


# ============================================================================
# Bank Management Schemas
# ============================================================================


class LoadBanksRequest(BaseModel):
    """Request schema for loading existing banks from a path."""

    path: str = Field(
        ...,
        description="Path to the directory containing embeddings.safetensors and config JSON",
    )
    negative_to_positive_ratio: Optional[float] = Field(
        default=1.0,
        description="Ratio of negative examples to keep relative to positive examples",
        gt=0.0,
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "path": "/data/banks/hate_speech_model",
                    "negative_to_positive_ratio": 1.0,
                }
            ]
        }
    }


class CreateBanksRequest(BaseModel):
    """Request schema for creating new banks from text files."""

    positive_folder: str = Field(
        ...,
        description="Path to folder containing positive (rare class) text files",
    )
    negative_folder: str = Field(
        ...,
        description="Path to folder containing negative (common class) text files",
    )
    output_path: str = Field(
        ...,
        description="Path where the new banks will be saved",
    )
    model_name: Optional[str] = Field(
        default="all-MiniLM-L6-v2",
        description="Name of the sentence transformer model to use for embeddings",
    )
    file_extensions: Optional[List[str]] = Field(
        default=[".txt", ".md"],
        description="File extensions to include when reading text files",
    )
    model_card: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional metadata about the banks being created",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "positive_folder": "/data/positive_texts",
                    "negative_folder": "/data/negative_texts",
                    "output_path": "/data/banks/my_new_model",
                    "model_name": "all-MiniLM-L6-v2",
                    "file_extensions": [".txt", ".md"],
                    "model_card": {
                        "description": "Custom harm detection model",
                        "created_by": "user",
                    },
                }
            ]
        }
    }


class BankStatusResponse(BaseModel):
    """Response schema for bank status."""

    loaded: bool = Field(..., description="Whether banks are currently loaded")
    model_name: Optional[str] = Field(
        None, description="Name of the encoder model used"
    )
    positive_count: Optional[int] = Field(
        None, description="Number of positive (rare class) examples"
    )
    negative_count: Optional[int] = Field(
        None, description="Number of negative (common class) examples"
    )
    model_card: Optional[Dict[str, Any]] = Field(
        None, description="Metadata about the loaded model"
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "loaded": True,
                    "model_name": "all-MiniLM-L6-v2",
                    "positive_count": 2500,
                    "negative_count": 25000,
                    "model_card": {"description": "Hate speech detection model"},
                }
            ]
        }
    }


class LoadBanksResponse(BaseModel):
    """Response schema for loading banks."""

    success: bool = Field(..., description="Whether the banks were loaded successfully")
    message: str = Field(..., description="Status message")
    status: BankStatusResponse = Field(..., description="Current bank status")


class CreateBanksResponse(BaseModel):
    """Response schema for creating banks."""

    success: bool = Field(
        ..., description="Whether the banks were created successfully"
    )
    message: str = Field(..., description="Status message")
    output_path: str = Field(..., description="Path where the banks were saved")
    positive_count: int = Field(
        ..., description="Number of positive examples processed"
    )
    negative_count: int = Field(
        ..., description="Number of negative examples processed"
    )


# ============================================================================
# Health Check Schemas
# ============================================================================


class HealthResponse(BaseModel):
    """Response schema for health check endpoint."""

    status: str = Field(..., description="Health status")
    banks_loaded: bool = Field(..., description="Whether banks are loaded")
    version: str = Field(..., description="API version")
