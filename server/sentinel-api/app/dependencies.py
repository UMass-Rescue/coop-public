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

"""Shared dependencies for the Sentinel FastAPI application."""

import logging
import os
from pathlib import Path
from threading import Lock
from typing import Optional, List, Dict, Any

import torch

from sentinel.sentinel_local_index import SentinelLocalIndex
from sentinel.embeddings.sbert import get_sentence_transformer_and_scaling_fn

LOG = logging.getLogger(__name__)


class IndexManager:
    """
    Singleton manager for the SentinelLocalIndex.

    Provides thread-safe loading, unloading, and access to the index.
    """

    _instance: Optional["IndexManager"] = None
    _lock: Lock = Lock()

    def __new__(cls) -> "IndexManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._index: Optional[SentinelLocalIndex] = None
        self._model_name: Optional[str] = None
        self._index_lock: Lock = Lock()
        self._initialized = True

    @property
    def is_loaded(self) -> bool:
        """Check if an index is currently loaded."""
        return self._index is not None

    @property
    def index(self) -> Optional[SentinelLocalIndex]:
        """Get the current index (may be None if not loaded)."""
        return self._index

    @property
    def model_name(self) -> Optional[str]:
        """Get the model name of the loaded index."""
        return self._model_name

    def get_status(self) -> Dict[str, Any]:
        """Get the current status of the index manager."""
        with self._index_lock:
            if self._index is None:
                return {
                    "loaded": False,
                    "model_name": None,
                    "positive_count": None,
                    "negative_count": None,
                    "model_card": None,
                }
            return {
                "loaded": True,
                "model_name": self._model_name,
                "positive_count": (
                    self._index.positive_embeddings.shape[0]
                    if self._index.positive_embeddings is not None
                    else 0
                ),
                "negative_count": (
                    self._index.negative_embeddings.shape[0]
                    if self._index.negative_embeddings is not None
                    else 0
                ),
                "model_card": self._index.model_card,
            }

    def load_from_path(
        self,
        path: str,
        negative_to_positive_ratio: float = 1.0,
        aws_access_key_id: Optional[str] = None,
        aws_secret_access_key: Optional[str] = None,
    ) -> None:
        """
        Load an index from a path.

        Args:
            path: Path to the directory containing the index files.
            negative_to_positive_ratio: Ratio of negative examples to keep.
            aws_access_key_id: Optional AWS access key for S3 paths.
            aws_secret_access_key: Optional AWS secret key for S3 paths.
        """
        with self._index_lock:
            LOG.info(f"Loading index from {path}")

            self._index = SentinelLocalIndex.load(
                path=path,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key,
                negative_to_positive_ratio=negative_to_positive_ratio,
            )

            # Try to extract model name from the loaded config
            # The model name is stored when loading
            from sentinel.io.index_io import load_index, create_s3_transport_params

            transport_params = create_s3_transport_params(
                aws_access_key_id, aws_secret_access_key
            )
            config, _, _ = load_index(path=path, transport_params=transport_params)
            self._model_name = config.encoder_model_name_or_path

            LOG.info(
                f"Index loaded successfully. "
                f"Positive: {self._index.positive_embeddings.shape[0]}, "
                f"Negative: {self._index.negative_embeddings.shape[0]}"
            )

    def create_from_folders(
        self,
        positive_folder: str,
        negative_folder: str,
        output_path: str,
        model_name: str = "all-MiniLM-L6-v2",
        file_extensions: List[str] = [".txt", ".md"],
        model_card: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, int]:
        """
        Create new banks from folders of text files.

        Args:
            positive_folder: Path to folder with positive (rare class) text files.
            negative_folder: Path to folder with negative (common class) text files.
            output_path: Path where the new index will be saved.
            model_name: Name of the sentence transformer model to use.
            file_extensions: File extensions to include.
            model_card: Optional metadata about the model.

        Returns:
            Dictionary with counts of positive and negative examples.
        """
        with self._index_lock:
            LOG.info(f"Creating new banks from {positive_folder} and {negative_folder}")

            # Read text files from both folders
            positive_texts = self._read_texts_from_folder(
                positive_folder, file_extensions
            )
            negative_texts = self._read_texts_from_folder(
                negative_folder, file_extensions
            )

            if not positive_texts:
                raise ValueError(f"No text files found in {positive_folder}")
            if not negative_texts:
                raise ValueError(f"No text files found in {negative_folder}")

            LOG.info(
                f"Found {len(positive_texts)} positive and "
                f"{len(negative_texts)} negative texts"
            )

            # Get the sentence transformer model
            sentence_model, scale_fn = get_sentence_transformer_and_scaling_fn(
                model_name
            )

            # Generate embeddings
            LOG.info("Generating positive embeddings...")
            positive_embeddings = sentence_model.encode(
                positive_texts,
                normalize_embeddings=True,
                show_progress_bar=True,
            )

            LOG.info("Generating negative embeddings...")
            negative_embeddings = sentence_model.encode(
                negative_texts,
                normalize_embeddings=True,
                show_progress_bar=True,
            )

            # Convert to tensors
            positive_embeddings = torch.tensor(positive_embeddings)
            negative_embeddings = torch.tensor(negative_embeddings)

            # Create the index
            self._index = SentinelLocalIndex(
                sentence_model=sentence_model,
                positive_embeddings=positive_embeddings,
                negative_embeddings=negative_embeddings,
                scale_fn=scale_fn,
                positive_corpus=positive_texts,
                negative_corpus=negative_texts,
                model_card=model_card or {},
            )
            self._model_name = model_name

            # Save the index
            os.makedirs(output_path, exist_ok=True)
            self._index.save(
                path=output_path,
                encoder_model_name_or_path=model_name,
            )

            LOG.info(f"Banks created and saved to {output_path}")

            return {
                "positive_count": len(positive_texts),
                "negative_count": len(negative_texts),
            }

    def _read_texts_from_folder(
        self, folder_path: str, extensions: List[str]
    ) -> List[str]:
        """
        Read all text files from a folder.

        Args:
            folder_path: Path to the folder.
            extensions: List of file extensions to include.

        Returns:
            List of text contents from all matching files.
        """
        texts = []
        folder = Path(folder_path)

        if not folder.exists():
            raise ValueError(f"Folder does not exist: {folder_path}")

        for ext in extensions:
            for file_path in folder.glob(f"**/*{ext}"):
                try:
                    content = file_path.read_text(encoding="utf-8").strip()
                    if content:
                        texts.append(content)
                except Exception as e:
                    LOG.warning(f"Failed to read {file_path}: {e}")

        return texts

    def unload(self) -> None:
        """Unload the current index."""
        with self._index_lock:
            self._index = None
            self._model_name = None
            LOG.info("Index unloaded")


# Global index manager instance
index_manager = IndexManager()


def get_index_manager() -> IndexManager:
    """Dependency to get the index manager."""
    return index_manager


def get_loaded_index() -> SentinelLocalIndex:
    """
    Dependency to get the loaded index.

    Raises HTTPException if no index is loaded.
    """
    from fastapi import HTTPException

    manager = get_index_manager()
    if not manager.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="No banks loaded. Please load banks first using POST /banks/load",
        )
    return manager.index
