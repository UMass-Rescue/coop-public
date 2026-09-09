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

"""Configuration for the Sentinel FastAPI application."""

from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Bank auto-loading (e.g., /data/banks/my_model)
    auto_load_banks_path: Optional[str] = None

    # Scoring defaults
    default_top_k: int = 5
    default_min_score: float = 0.1
    default_min_size_of_scores: int = 5

    class Config:
        env_prefix = "SENTINEL_"
        case_sensitive = False


# Global settings instance
settings = Settings()
