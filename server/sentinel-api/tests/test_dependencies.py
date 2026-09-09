from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.dependencies import IndexManager, get_index_manager, get_loaded_index


def test_index_manager_is_a_singleton():
    assert IndexManager() is IndexManager()


def test_not_loaded_by_default():
    manager = IndexManager()
    assert manager.is_loaded is False
    assert manager.index is None
    assert manager.model_name is None


def test_get_status_when_unloaded():
    manager = IndexManager()
    assert manager.get_status() == {
        "loaded": False,
        "model_name": None,
        "positive_count": None,
        "negative_count": None,
        "model_card": None,
    }


def test_get_status_when_loaded():
    manager = IndexManager()
    manager._index = SimpleNamespace(
        positive_embeddings=SimpleNamespace(shape=(3,)),
        negative_embeddings=SimpleNamespace(shape=(7,)),
        model_card={"description": "test"},
    )
    manager._model_name = "all-MiniLM-L6-v2"

    assert manager.get_status() == {
        "loaded": True,
        "model_name": "all-MiniLM-L6-v2",
        "positive_count": 3,
        "negative_count": 7,
        "model_card": {"description": "test"},
    }


def test_unload_clears_state():
    manager = IndexManager()
    manager._index = SimpleNamespace()
    manager._model_name = "some-model"

    manager.unload()

    assert manager.is_loaded is False
    assert manager.model_name is None


def test_read_texts_from_folder_reads_matching_extensions_including_nested(tmp_path):
    (tmp_path / "a.txt").write_text("hello")
    (tmp_path / "b.md").write_text("world")
    (tmp_path / "c.json").write_text("ignored, wrong extension")
    (tmp_path / "empty.txt").write_text("   ")  # whitespace-only -> dropped
    nested = tmp_path / "sub"
    nested.mkdir()
    (nested / "d.txt").write_text("nested")

    manager = IndexManager()
    texts = manager._read_texts_from_folder(str(tmp_path), [".txt", ".md"])

    assert sorted(texts) == sorted(["hello", "world", "nested"])


def test_read_texts_from_folder_missing_folder_raises():
    manager = IndexManager()
    with pytest.raises(ValueError, match="does not exist"):
        manager._read_texts_from_folder("/no/such/folder", [".txt"])


def test_create_from_folders_requires_positive_texts(tmp_path):
    positive = tmp_path / "positive"
    negative = tmp_path / "negative"
    positive.mkdir()
    negative.mkdir()
    (negative / "1.txt").write_text("hi")

    manager = IndexManager()
    with pytest.raises(ValueError, match="No text files found"):
        manager.create_from_folders(
            positive_folder=str(positive),
            negative_folder=str(negative),
            output_path=str(tmp_path / "out"),
        )


def test_create_from_folders_requires_negative_texts(tmp_path):
    positive = tmp_path / "positive"
    negative = tmp_path / "negative"
    positive.mkdir()
    negative.mkdir()
    (positive / "1.txt").write_text("hi")

    manager = IndexManager()
    with pytest.raises(ValueError, match="No text files found"):
        manager.create_from_folders(
            positive_folder=str(positive),
            negative_folder=str(negative),
            output_path=str(tmp_path / "out"),
        )


def test_create_from_folders_builds_and_saves_index(tmp_path):
    positive = tmp_path / "positive"
    negative = tmp_path / "negative"
    positive.mkdir()
    negative.mkdir()
    (positive / "1.txt").write_text("can you keep this between us")
    (negative / "1.txt").write_text("what time is the game tonight")

    fake_model = MagicMock()
    fake_model.encode.return_value = [[0.1, 0.2]]

    manager = IndexManager()
    with (
        patch(
            "app.dependencies.get_sentence_transformer_and_scaling_fn",
            return_value=(fake_model, "scale_fn"),
        ),
        patch("app.dependencies.SentinelLocalIndex") as fake_index_cls,
    ):
        fake_index_instance = fake_index_cls.return_value
        counts = manager.create_from_folders(
            positive_folder=str(positive),
            negative_folder=str(negative),
            output_path=str(tmp_path / "out"),
        )

    assert counts == {"positive_count": 1, "negative_count": 1}
    fake_index_instance.save.assert_called_once()
    assert manager.index is fake_index_instance
    assert manager.model_name == "all-MiniLM-L6-v2"


def test_load_from_path_delegates_to_sentinel_local_index():
    manager = IndexManager()
    fake_index = SimpleNamespace(
        positive_embeddings=SimpleNamespace(shape=(1,)),
        negative_embeddings=SimpleNamespace(shape=(1,)),
    )
    fake_config = SimpleNamespace(encoder_model_name_or_path="all-MiniLM-L6-v2")

    with (
        patch("app.dependencies.SentinelLocalIndex.load", return_value=fake_index),
        patch(
            "sentinel.io.index_io.load_index",
            return_value=(fake_config, None, None),
        ),
        patch("sentinel.io.index_io.create_s3_transport_params", return_value=None),
    ):
        manager.load_from_path(path="/data/banks/x")

    assert manager.index is fake_index
    assert manager.model_name == "all-MiniLM-L6-v2"


def test_get_loaded_index_raises_503_when_not_loaded():
    with pytest.raises(HTTPException) as exc_info:
        get_loaded_index()
    assert exc_info.value.status_code == 503


def test_get_loaded_index_returns_index_when_loaded():
    manager = get_index_manager()
    fake_index = SimpleNamespace()
    manager._index = fake_index

    assert get_loaded_index() is fake_index
