import pytest
from pydantic import ValidationError

from app.schemas import LoadBanksRequest, ScoreRequest


def test_score_request_requires_at_least_one_text():
    with pytest.raises(ValidationError):
        ScoreRequest(texts=[])


def test_score_request_defaults():
    request = ScoreRequest(texts=["hi"])
    assert request.top_k == 5
    assert request.min_score_to_consider == 0.1


@pytest.mark.parametrize("top_k", [0, -1, 101])
def test_score_request_rejects_out_of_range_top_k(top_k):
    with pytest.raises(ValidationError):
        ScoreRequest(texts=["hi"], top_k=top_k)


@pytest.mark.parametrize("top_k", [1, 5, 100])
def test_score_request_accepts_boundary_top_k(top_k):
    assert ScoreRequest(texts=["hi"], top_k=top_k).top_k == top_k


@pytest.mark.parametrize("min_score", [-0.1, 1.1])
def test_score_request_rejects_out_of_range_min_score(min_score):
    with pytest.raises(ValidationError):
        ScoreRequest(texts=["hi"], min_score_to_consider=min_score)


def test_load_banks_request_ratio_must_be_positive():
    with pytest.raises(ValidationError):
        LoadBanksRequest(path="/x", negative_to_positive_ratio=0)
    with pytest.raises(ValidationError):
        LoadBanksRequest(path="/x", negative_to_positive_ratio=-1)


def test_load_banks_request_defaults():
    request = LoadBanksRequest(path="/x")
    assert request.negative_to_positive_ratio == 1.0
