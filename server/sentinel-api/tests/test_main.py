from fastapi.testclient import TestClient

from app import main as main_module


def test_health_when_no_banks_loaded(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "banks_loaded": False,
        "version": "1.0.0",
    }


def test_health_reflects_loaded_banks(client, monkeypatch):
    monkeypatch.setattr(main_module.index_manager, "_index", object())
    response = client.get("/health")
    assert response.json()["banks_loaded"] is True


def test_root_points_at_docs_and_health(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {
        "message": "Sentinel API",
        "docs": "/docs",
        "health": "/health",
    }


def test_lifespan_auto_loads_banks_when_configured(monkeypatch):
    monkeypatch.setattr(main_module.settings, "auto_load_banks_path", "/data/banks/x")
    calls = []
    monkeypatch.setattr(
        main_module.index_manager,
        "load_from_path",
        lambda path: calls.append(path),
    )

    with TestClient(main_module.app):
        pass

    assert calls == ["/data/banks/x"]


def test_lifespan_swallows_auto_load_errors(monkeypatch):
    """
    A misconfigured/unreachable `SENTINEL_AUTO_LOAD_BANKS_PATH` shouldn't
    crash the whole app on startup - the health check exists precisely so
    this failure mode is observable instead of fatal.
    """
    monkeypatch.setattr(main_module.settings, "auto_load_banks_path", "/data/banks/x")

    def _boom(path):
        raise RuntimeError("boom")

    monkeypatch.setattr(main_module.index_manager, "load_from_path", _boom)

    with TestClient(main_module.app) as test_client:
        response = test_client.get("/health")
        assert response.status_code == 200
        assert response.json()["banks_loaded"] is False
