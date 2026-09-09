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

"""Scoring endpoint for Sentinel API."""

import logging
from fastapi import APIRouter, Depends

from sentinel.sentinel_local_index import SentinelLocalIndex
from ..schemas import ScoreRequest, ScoreResponse
from ..dependencies import get_loaded_index
from ..config import settings

LOG = logging.getLogger(__name__)

router = APIRouter(tags=["Scoring"])


@router.post(
    "/score",
    response_model=ScoreResponse,
    summary="Score a conversation",
    description="""
Score a list of text samples (e.g., messages in a conversation) against the loaded banks.

**How scoring works:**

1. Each text sample is encoded into an embedding vector
2. For each sample, we find the top-k nearest neighbors in both positive (rare/harmful) 
   and negative (common/normal) banks
3. A contrastive score is computed: `log(mean(exp(pos_similarities)) / mean(exp(neg_similarities)))`
4. Individual scores are aggregated using **skewness** to detect patterns across the conversation

**Interpreting results:**

- `rare_class_affinity_score`: Overall score for the conversation. Higher values indicate 
  more affinity to the rare (harmful) class. Skewness captures if there are outlier 
  high-scoring messages.
- `observation_scores`: Per-message scores. High individual scores indicate messages 
  similar to the positive (rare) bank.

**Note:** Banks must be loaded before calling this endpoint. Use `POST /banks/load` first.
""",
)
async def score_text(
    request: ScoreRequest,
    index: SentinelLocalIndex = Depends(get_loaded_index),
) -> ScoreResponse:
    """
    Score a conversation against loaded banks.

    Args:
        request: The scoring request containing text samples.
        index: The loaded SentinelLocalIndex (injected via dependency).

    Returns:
        ScoreResponse with overall and individual scores.
    """
    LOG.info(f"Scoring {len(request.texts)} text samples")

    # Use request parameters or fall back to defaults
    top_k = request.top_k or settings.default_top_k
    min_score = request.min_score_to_consider or settings.default_min_score

    # Import skewness with configurable min_size_of_scores
    from sentinel.score_formulae import skewness
    from functools import partial

    aggregation_fn = partial(skewness, min_size_of_scores=settings.default_min_size_of_scores)

    # Calculate rare class affinity using the loaded index
    result = index.calculate_rare_class_affinity(
        text_samples=request.texts,
        top_k=top_k,
        min_score_to_consider=min_score,
        aggregation_function=aggregation_fn,
    )

    LOG.info(f"Scoring complete. Affinity score: {result.rare_class_affinity_score:.4f}")

    return ScoreResponse(
        rare_class_affinity_score=result.rare_class_affinity_score,
        observation_scores=result.observation_scores,
        num_observations=len(request.texts),
    )
