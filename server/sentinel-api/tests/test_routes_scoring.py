from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.dependencies import get_loaded_index
from app.main import app as fastapi_app


@pytest.fixture
def mock_index():
    """
    Overrides `get_loaded_index` so `/score` tests don't need a real bank
    loaded, and don't run real embedding/similarity computation.
    """
    index = MagicMock()
    index.calculate_rare_class_affinity.return_value = SimpleNamespace(
        rare_class_affinity_score=0.42,
        observation_scores={"hi": 0.1, "keep this between us": 0.9},
    )
    fastapi_app.dependency_overrides[get_loaded_index] = lambda: index
    yield index
    fastapi_app.dependency_overrides.pop(get_loaded_index, None)


def test_score_returns_index_result(client, mock_index):
    response = client.post(
        "/score", json={"texts": ["hi", "keep this between us"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["rare_class_affinity_score"] == 0.42
    assert body["observation_scores"] == {"hi": 0.1, "keep this between us": 0.9}
    assert body["num_observations"] == 2


def test_score_passes_request_params_to_index(client, mock_index):
    client.post(
        "/score",
        json={"texts": ["hi"], "top_k": 3, "min_score_to_consider": 0.25},
    )

    kwargs = mock_index.calculate_rare_class_affinity.call_args.kwargs
    assert kwargs["text_samples"] == ["hi"]
    assert kwargs["top_k"] == 3
    assert kwargs["min_score_to_consider"] == 0.25


def test_score_uses_schema_defaults_when_omitted(client, mock_index):
    client.post("/score", json={"texts": ["hi"]})

    kwargs = mock_index.calculate_rare_class_affinity.call_args.kwargs
    assert kwargs["top_k"] == 5
    assert kwargs["min_score_to_consider"] == 0.1


def test_score_rejects_empty_texts(client, mock_index):
    response = client.post("/score", json={"texts": []})
    assert response.status_code == 422
    mock_index.calculate_rare_class_affinity.assert_not_called()


def test_score_rejects_out_of_range_top_k(client, mock_index):
    response = client.post("/score", json={"texts": ["hi"], "top_k": 0})
    assert response.status_code == 422


def test_score_returns_503_when_no_banks_loaded(client):
    # No dependency override applied here, so this exercises the real
    # `get_loaded_index`, which should reject with 503 while
    # `index_manager.is_loaded` is False (see conftest.reset_index_manager).
    response = client.post("/score", json={"texts": ["hi"]})
    assert response.status_code == 503
