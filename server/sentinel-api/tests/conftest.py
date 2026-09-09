import pytest
from fastapi.testclient import TestClient

from app.dependencies import index_manager
from app.main import app as fastapi_app


@pytest.fixture(autouse=True)
def reset_index_manager():
    """
    `index_manager` (see `app/dependencies.py`) is a module-level singleton
    shared by every route in the app. Without resetting it, a bank
    loaded/created in one test would leak into the next.
    """
    index_manager.unload()
    yield
    index_manager.unload()


@pytest.fixture
def client():
    # Entering via `with` runs the app's lifespan startup/shutdown, matching
    # how uvicorn runs it. `auto_load_banks_path` is unset by default, so
    # startup doesn't try to load a real bank.
    with TestClient(fastapi_app) as test_client:
        yield test_client
