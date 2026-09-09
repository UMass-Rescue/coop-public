from unittest.mock import MagicMock

import pytest

from app.dependencies import get_index_manager
from app.main import app as fastapi_app


@pytest.fixture
def mock_manager():
    """Overrides `get_index_manager` so route tests don't touch the real
    (torch/sentence-transformers-backed) singleton."""
    manager = MagicMock()
    fastapi_app.dependency_overrides[get_index_manager] = lambda: manager
    yield manager
    fastapi_app.dependency_overrides.pop(get_index_manager, None)


def test_bank_status_reflects_manager(client, mock_manager):
    mock_manager.get_status.return_value = {
        "loaded": True,
        "model_name": "all-MiniLM-L6-v2",
        "positive_count": 3,
        "negative_count": 3,
        "model_card": {},
    }

    response = client.get("/banks/status")

    assert response.status_code == 200
    body = response.json()
    assert body["loaded"] is True
    assert body["positive_count"] == 3


def test_load_banks_success(client, mock_manager):
    mock_manager.get_status.return_value = {
        "loaded": True,
        "model_name": "m",
        "positive_count": 1,
        "negative_count": 1,
        "model_card": {},
    }

    response = client.post("/banks/load", json={"path": "/data/banks/x"})

    assert response.status_code == 200
    assert response.json()["success"] is True
    mock_manager.load_from_path.assert_called_once_with(
        path="/data/banks/x", negative_to_positive_ratio=1.0
    )


def test_load_banks_not_found_returns_404(client, mock_manager):
    mock_manager.load_from_path.side_effect = FileNotFoundError("nope")

    response = client.post("/banks/load", json={"path": "/does/not/exist"})

    assert response.status_code == 404


def test_load_banks_unexpected_error_returns_500(client, mock_manager):
    mock_manager.load_from_path.side_effect = RuntimeError("boom")

    response = client.post("/banks/load", json={"path": "/data/banks/x"})

    assert response.status_code == 500


def test_create_banks_success(client, mock_manager):
    mock_manager.create_from_folders.return_value = {
        "positive_count": 2,
        "negative_count": 3,
    }

    response = client.post(
        "/banks/create",
        json={
            "positive_folder": "/data/pos",
            "negative_folder": "/data/neg",
            "output_path": "/data/out",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["positive_count"] == 2
    assert body["negative_count"] == 3


def test_create_banks_invalid_input_returns_400(client, mock_manager):
    mock_manager.create_from_folders.side_effect = ValueError("no files found")

    response = client.post(
        "/banks/create",
        json={"positive_folder": "/x", "negative_folder": "/y", "output_path": "/z"},
    )

    assert response.status_code == 400


def test_create_banks_unexpected_error_returns_500(client, mock_manager):
    mock_manager.create_from_folders.side_effect = RuntimeError("boom")

    response = client.post(
        "/banks/create",
        json={"positive_folder": "/x", "negative_folder": "/y", "output_path": "/z"},
    )

    assert response.status_code == 500


def test_unload_when_loaded(client, mock_manager):
    mock_manager.is_loaded = True

    response = client.post("/banks/unload")

    assert response.status_code == 200
    assert response.json()["message"] == "Banks unloaded successfully"
    mock_manager.unload.assert_called_once()


def test_unload_when_not_loaded_is_a_noop(client, mock_manager):
    mock_manager.is_loaded = False

    response = client.post("/banks/unload")

    assert response.status_code == 200
    assert response.json()["message"] == "No banks were loaded"
    mock_manager.unload.assert_not_called()
