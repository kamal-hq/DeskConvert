import os
from typing import Dict, List, Optional
import pymupdf as fitz
from .settings import SettingsManager


class HistoryManager:
    def __init__(self, settings: Optional[SettingsManager] = None):
        self.settings = settings or SettingsManager()
        self.max_history = 10

    def add_entry(self, filepath: str) -> None:
        history = self.settings.get_history()
        if filepath in history:
            history.remove(filepath)
        history.insert(0, filepath)
        history = history[: self.max_history]
        self.settings.set_history(history)

    def remove_entry(self, filepath: str) -> None:
        history = self.settings.get_history()
        if filepath in history:
            history.remove(filepath)
            self.settings.set_history(history)

    def clear_all(self) -> None:
        self.settings.set_history([])

    def get_all(self) -> List[str]:
        return self.settings.get_history()

    def validate_entry(self, filepath: str) -> bool:
        return os.path.exists(filepath) and os.path.isfile(filepath)

    def get_detailed_entries(self) -> List[Dict]:
        """Returns rich metadata for UI rendering without mutating stored order."""
        entries: List[Dict] = []
        for filepath in self.get_all():
            exists = self.validate_entry(filepath)
            ext = os.path.splitext(filepath)[1].lower()
            kind = "pdf" if ext == ".pdf" else "image"
            size_bytes = os.path.getsize(filepath) if exists else 0
            page_count = 1
            if exists and kind == "pdf":
                try:
                    with fitz.open(filepath) as doc:
                        page_count = max(1, len(doc))
                except Exception:
                    page_count = 1
            entries.append({
                "path": filepath,
                "name": os.path.basename(filepath),
                "kind": kind,
                "sizeBytes": size_bytes,
                "pageCount": page_count,
                "exists": exists,
            })
        return entries
