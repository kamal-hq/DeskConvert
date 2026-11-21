import json
import os
import sys
from typing import Any, Dict, List, Optional


def _default_config_path() -> str:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "DeskConvert", "settings.json")


DEFAULT_SETTINGS: Dict[str, Any] = {
    "default_output_directory": "",
    "watermark_enabled": True,
    "metadata_action": "keep",
    "dpi": "print",
    "custom_dpi": 300,
    "quick_save_enabled": False,
    "theme": "dark",
    "history": [],
}


class SettingsManager:
    """JSON-backed settings manager (portable, zero UI toolkit dependency)."""

    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or _default_config_path()
        self._data: Dict[str, Any] = dict(DEFAULT_SETTINGS)
        self._load()

    def _load(self) -> None:
        if os.path.isfile(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    self._data.update(loaded)
            except Exception:
                pass

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        tmp_path = f"{self.config_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2)
        os.replace(tmp_path, self.config_path)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)

    def update_from_dict(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        for key in DEFAULT_SETTINGS:
            if key in updates:
                self._data[key] = updates[key]
        self._save()
        return self.to_dict()

    def get_default_output_directory(self) -> str:
        return str(self._data.get("default_output_directory", ""))

    def set_default_output_directory(self, value: str) -> None:
        self._data["default_output_directory"] = str(value or "")
        self._save()

    def get_watermark_enabled(self) -> bool:
        val = self._data.get("watermark_enabled", True)
        if isinstance(val, str):
            return val.lower() == "true"
        return bool(val)

    def set_watermark_enabled(self, value: bool) -> None:
        self._data["watermark_enabled"] = bool(value)
        self._save()

    def get_metadata_action(self) -> str:
        val = str(self._data.get("metadata_action", "keep"))
        return val if val in ("keep", "strip") else "keep"

    def set_metadata_action(self, value: str) -> None:
        self._data["metadata_action"] = "strip" if value == "strip" else "keep"
        self._save()

    def get_dpi(self) -> str:
        return str(self._data.get("dpi", "print"))

    def set_dpi(self, value: str) -> None:
        self._data["dpi"] = str(value)
        self._save()

    def get_custom_dpi(self) -> int:
        try:
            return int(self._data.get("custom_dpi", 300))
        except (TypeError, ValueError):
            return 300

    def set_custom_dpi(self, value: int) -> None:
        self._data["custom_dpi"] = max(72, min(1200, int(value)))
        self._save()

    def get_quick_save_enabled(self) -> bool:
        val = self._data.get("quick_save_enabled", False)
        if isinstance(val, str):
            return val.lower() == "true"
        return bool(val)

    def set_quick_save_enabled(self, value: bool) -> None:
        self._data["quick_save_enabled"] = bool(value)
        self._save()

    def get_theme(self) -> str:
        return "light" if self._data.get("theme") == "light" else "dark"

    def set_theme(self, value: str) -> None:
        self._data["theme"] = "light" if value == "light" else "dark"
        self._save()

    def get_history(self) -> List[str]:
        val = self._data.get("history", [])
        if isinstance(val, list):
            return [str(x) for x in val]
        if isinstance(val, str) and val:
            return [val]
        return []

    def set_history(self, history: List[str]) -> None:
        self._data["history"] = [str(x) for x in history]
        self._save()
