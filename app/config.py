"""Local settings storage.

Only the Anthropic API key and Qualia URL are stored (in app_data/config.json,
which is gitignored). Qualia credentials are NEVER stored — they live in
memory for the duration of a session only.
"""

import json
from pathlib import Path

APP_DATA = Path(__file__).resolve().parent.parent / "app_data"
CONFIG_FILE = APP_DATA / "config.json"

DEFAULTS = {
    "qualia_url": "https://dds.qualia.io",
    "anthropic_api_key": "",
}


def load() -> dict:
    cfg = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(CONFIG_FILE.read_text()))
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


def save(updates: dict) -> dict:
    cfg = load()
    for key in DEFAULTS:
        if key in updates and updates[key] is not None:
            cfg[key] = str(updates[key]).strip()
    APP_DATA.mkdir(exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    return cfg
