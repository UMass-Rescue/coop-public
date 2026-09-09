from app.config import Settings


def test_defaults_with_no_env_vars(monkeypatch):
    for var in (
        "SENTINEL_AUTO_LOAD_BANKS_PATH",
        "SENTINEL_DEFAULT_TOP_K",
        "SENTINEL_DEFAULT_MIN_SCORE",
        "SENTINEL_DEFAULT_MIN_SIZE_OF_SCORES",
    ):
        monkeypatch.delenv(var, raising=False)

    settings = Settings(_env_file=None)

    assert settings.auto_load_banks_path is None
    assert settings.default_top_k == 5
    assert settings.default_min_score == 0.1
    assert settings.default_min_size_of_scores == 5


def test_reads_sentinel_prefixed_env_vars(monkeypatch):
    monkeypatch.setenv("SENTINEL_AUTO_LOAD_BANKS_PATH", "/data/banks/grooming_model")
    monkeypatch.setenv("SENTINEL_DEFAULT_TOP_K", "7")
    monkeypatch.setenv("SENTINEL_DEFAULT_MIN_SCORE", "0.25")

    settings = Settings(_env_file=None)

    assert settings.auto_load_banks_path == "/data/banks/grooming_model"
    assert settings.default_top_k == 7
    assert settings.default_min_score == 0.25


def test_env_var_names_are_case_insensitive(monkeypatch):
    monkeypatch.setenv("sentinel_default_top_k", "9")
    settings = Settings(_env_file=None)
    assert settings.default_top_k == 9
