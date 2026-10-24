"""Fail-closed auth tests for both Python servers (standalone script + package).

Run: python -m pytest tests/test_auth_fail_closed.py -v
"""
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _load_standalone():
    """Load top-level gemini_web2api.py without colliding with the package."""
    spec = importlib.util.spec_from_file_location(
        "gemini_web2api_standalone", ROOT / "gemini_web2api.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_package():
    from gemini_web2api import config, server
    return server.GeminiHandler, config


def _fake(headers=None, path="/v1/models"):
    return SimpleNamespace(headers=headers or {}, path=path)


@pytest.fixture(params=["standalone", "package"], scope="module")
def impl(request):
    if request.param == "standalone":
        mod = _load_standalone()
        return mod.GeminiHandler, mod
    return _load_package()


def test_unset_fails_closed(impl):
    handler, config = impl
    config.CONFIG["api_keys"] = None
    assert handler._authorized(_fake()) is False


def test_explicit_empty_is_open(impl):
    handler, config = impl
    config.CONFIG["api_keys"] = []
    assert handler._authorized(_fake()) is True


def test_whitelist(impl):
    handler, config = impl
    config.CONFIG["api_keys"] = ["k1", "k2"]
    assert handler._authorized(_fake({"x-api-key": "k2"})) is True
    assert handler._authorized(_fake({"Authorization": "Bearer k1"})) is True
    assert handler._authorized(_fake({"x-api-key": "sk-gemini"})) is False
    assert handler._authorized(_fake({})) is False


def test_defaults_fail_closed(impl):
    _, config = impl
    assert config.DEFAULT_CONFIG["api_keys"] is None
    assert config.DEFAULT_CONFIG["host"] == "127.0.0.1"


def test_example_config_has_no_known_key():
    cfg = json.loads((ROOT / "config.example.json").read_text())
    assert "api_keys" not in cfg, "example config must not ship a usable default key"
