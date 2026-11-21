import base64
import os
import subprocess
import sys
import uuid
from typing import Any, Dict, List, Optional

import webview

from core.cache_manager import CacheManager
from core.compression import CompressionEngine
from core.export import ExportEngine
from core.image_engine import ImageEngine
from core.ocr_engine import OcrEngine
from core.pdf_engine import PdfEngine
from utils.history import HistoryManager
from utils.settings import SettingsManager
from utils.validators import Validators


def _open_dialog_const(name: str, fallback: int) -> int:
    fd = getattr(webview, "FileDialog", None)
    if fd and hasattr(fd, name):
        return getattr(fd, name)
    return getattr(webview, f"{name}_DIALOG", fallback)


class DeskConvertBridge:
    """Native JS <-> Python API exposed inside pywebview for offline desktop execution."""

    def __init__(self):
        self.settings = SettingsManager()
        self.history = HistoryManager(self.settings)
        self.cache = CacheManager()
        self.window: Optional[webview.Window] = None
        self._id_to_cached: Dict[str, str] = {}
        self._id_to_original: Dict[str, str] = {}

    def attach_window(self, window: webview.Window) -> None:
        self.window = window

    def cleanup(self) -> None:
        self.cache.clear_cache()

    def get_app_info(self) -> Dict[str, Any]:
        return {
            "version": "2.0.0",
            "platform": sys.platform,
            "isDesktop": True,
        }

    def get_settings(self) -> Dict[str, Any]:
        return self.settings.to_dict()

    def save_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        return self.settings.update_from_dict(updates or {})

    def get_history(self) -> List[Dict[str, Any]]:
        return self.history.get_detailed_entries()

    def clear_history(self) -> None:
        self.history.clear_all()

    def open_path(self, target_path: str) -> None:
        if not target_path or not os.path.exists(target_path):
            return
        folder = target_path if os.path.isdir(target_path) else os.path.dirname(target_path)
        if sys.platform == "win32":
            os.startfile(folder)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])

    def pick_output_directory(self) -> Optional[str]:
        if not self.window:
            return None
        res = self.window.create_file_dialog(
            _open_dialog_const("FOLDER", 20),
            directory=self.settings.get_default_output_directory() or os.path.expanduser("~"),
        )
        return res[0] if res else None

    def pick_files(self) -> List[str]:
        if not self.window:
            return []
        file_types = ("Supported Files (*.pdf;*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tiff;*.tif)", "All files (*.*)")
        res = self.window.create_file_dialog(
            _open_dialog_const("OPEN", 10),
            allow_multiple=True,
            file_types=file_types,
        )
        return list(res) if res else []

    def pick_folder(self) -> List[str]:
        if not self.window:
            return []
        res = self.window.create_file_dialog(_open_dialog_const("FOLDER", 20))
        return list(res) if res else []

    def stage_paths(self, paths: List[str]) -> Dict[str, Any]:
        expanded: List[str] = []
        for p in paths or []:
            if os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for f in sorted(files):
                        expanded.append(os.path.join(root, f))
            elif os.path.isfile(p):
                expanded.append(p)

        rejected: List[str] = []
        encrypted: List[str] = []
        items: List[Dict[str, Any]] = []

        for orig_path in expanded:
            name = os.path.basename(orig_path)
            if not Validators.is_supported_file(orig_path):
                rejected.append(name)
                continue
            if Validators.is_password_protected(orig_path):
                encrypted.append(name)
                continue

            cached_path = self.cache.stage_file(orig_path)
            source_id = f"dsrc_{uuid.uuid4().hex[:10]}"
            self._id_to_cached[source_id] = cached_path
            self._id_to_original[source_id] = orig_path

            kind = "pdf" if Validators.is_pdf(orig_path) else "image"
            page_count = self.cache.get_page_count(cached_path)
            size_bytes = os.path.getsize(cached_path)

            for page_idx in range(page_count):
                thumb_url = self.cache.get_thumbnail_data_url(cached_path, page_idx)
                items.append({
                    "id": f"ditem_{uuid.uuid4().hex[:10]}",
                    "sourceId": source_id,
                    "fileName": name,
                    "kind": kind,
                    "pageIndex": page_idx,
                    "pageLabel": f"Page {page_idx + 1}" if kind == "pdf" else name,
                    "thumbnailUrl": thumb_url,
                    "sizeBytes": size_bytes,
                    "selected": False,
                })

            self.history.add_entry(orig_path)

        return {"items": items, "rejected": rejected, "encrypted": encrypted}

    def stage_uploaded_files(self, files_payload: List[Dict[str, str]]) -> Dict[str, Any]:
        """Stages browser-dropped files into OS temp cache when dragged onto the Desktop WebView."""
        staged_temp_paths: List[str] = []
        rejected: List[str] = []
        encrypted: List[str] = []
        items: List[Dict[str, Any]] = []

        for entry in files_payload or []:
            orig_name = os.path.basename(entry.get("name", "file"))
            b64 = entry.get("base64", "")
            if not Validators.is_supported_file(orig_name):
                rejected.append(orig_name)
                continue
            raw_bytes = base64.b64decode(b64)
            base, ext = os.path.splitext(orig_name)
            cached_path = os.path.join(self.cache.temp_dir, f"{base}_{uuid.uuid4().hex[:8]}{ext}")
            with open(cached_path, "wb") as f:
                f.write(raw_bytes)
            staged_temp_paths.append(cached_path)

            if Validators.is_password_protected(cached_path):
                encrypted.append(orig_name)
                continue

            source_id = f"dsrc_{uuid.uuid4().hex[:10]}"
            self._id_to_cached[source_id] = cached_path
            self._id_to_original[source_id] = orig_name
            kind = "pdf" if Validators.is_pdf(orig_name) else "image"
            page_count = self.cache.get_page_count(cached_path)
            size_bytes = len(raw_bytes)

            for page_idx in range(page_count):
                thumb_url = self.cache.get_thumbnail_data_url(cached_path, page_idx)
                items.append({
                    "id": f"ditem_{uuid.uuid4().hex[:10]}",
                    "sourceId": source_id,
                    "fileName": orig_name,
                    "kind": kind,
                    "pageIndex": page_idx,
                    "pageLabel": f"Page {page_idx + 1}" if kind == "pdf" else orig_name,
                    "thumbnailUrl": thumb_url,
                    "sizeBytes": size_bytes,
                    "selected": False,
                })

        return {"items": items, "rejected": rejected, "encrypted": encrypted}

    def get_full_res_preview(self, source_id: str, page_index: int) -> str:
        cached = self._id_to_cached.get(source_id)
        if not cached:
            raise FileNotFoundError("Cached source file not found.")
        return self.cache.get_full_res_data_url(cached, int(page_index))

    def _resolve_storyboard(self, items_payload: List[Dict[str, Any]]) -> List[tuple]:
        resolved = []
        for entry in items_payload:
            sid = entry["sourceId"]
            cached = self._id_to_cached.get(sid)
            if cached and os.path.isfile(cached):
                resolved.append((cached, int(entry.get("pageIndex", 0))))
        if not resolved:
            raise ValueError("No valid staged files found.")
        return resolved

    def _choose_output_dir(self) -> Optional[str]:
        default_dir = ExportEngine.get_default_directory(self.settings)
        if self.settings.get_quick_save_enabled() or not self.window:
            return default_dir
        res = self.window.create_file_dialog(_open_dialog_const("FOLDER", 20), directory=default_dir)
        return res[0] if res else None

    def _choose_save_file(self, stem: str, ext: str, filter_label: str) -> Optional[str]:
        default_dir = ExportEngine.get_default_directory(self.settings)
        if self.settings.get_quick_save_enabled() or not self.window:
            return ExportEngine.safe_output_path(default_dir, stem, ext)
        res = self.window.create_file_dialog(
            _open_dialog_const("SAVE", 30),
            directory=default_dir,
            save_filename=f"{stem}_converted{ext}",
            file_types=(filter_label, "All files (*.*)"),
        )
        chosen = res[0] if isinstance(res, (list, tuple)) and res else (res if isinstance(res, str) else None)
        if chosen and not chosen.lower().endswith(ext.lower()):
            chosen += ext
        return chosen

    def _materialize_working_pdf(self, ordered_items: List[tuple]) -> str:
        working_pdf = os.path.join(self.cache.temp_dir, f"working_{uuid.uuid4().hex[:8]}.pdf")
        return PdfEngine.build_working_pdf(ordered_items, working_pdf)

    def export_pdf_to_images(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        out_dir = self._choose_output_dir()
        if not out_dir:
            return None
        working_pdf = self._materialize_working_pdf(ordered)
        first_sid = payload["items"][0]["sourceId"]
        stem = os.path.splitext(os.path.basename(self._id_to_original.get(first_sid, "document.pdf")))[0]
        paths = PdfEngine.pdf_to_images(
            working_pdf,
            out_dir,
            stem,
            dpi=int(payload.get("dpi", 300)),
            fmt=str(payload.get("format", "jpg")).lower(),
            watermark_enabled=bool(payload.get("watermarkEnabled", True)),
            metadata_action=str(payload.get("metadataAction", "keep")),
        )
        if paths:
            self.history.add_entry(paths[0])
        return {
            "summary": f"Exported {len(paths)} image(s) to {out_dir}",
            "outputCount": len(paths),
            "artifacts": [{"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "image/*"} for p in paths],
            "outputDir": out_dir,
        }

    def export_images_to_pdf(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self.merge_files(payload)

    def merge_files(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        first_sid = payload["items"][0]["sourceId"]
        stem = os.path.splitext(os.path.basename(self._id_to_original.get(first_sid, "merged.pdf")))[0]
        out_path = self._choose_save_file(stem, ".pdf", "PDF Files (*.pdf)")
        if not out_path:
            return None

        compression_bytes = payload.get("compressionBytes")
        wm = bool(payload.get("watermarkEnabled", True))
        meta = str(payload.get("metadataAction", "keep"))

        if compression_bytes and int(compression_bytes) > 0:
            working_pdf = self._materialize_working_pdf(ordered)
            CompressionEngine.compress_pdf(
                working_pdf,
                out_path,
                int(compression_bytes),
                watermark_enabled=wm,
                metadata_action=meta,
            )
        else:
            PdfEngine.merge_to_pdf(ordered, out_path, watermark_enabled=wm, metadata_action=meta)

        self.history.add_entry(out_path)
        return {
            "summary": f"Saved PDF: {out_path}",
            "outputCount": 1,
            "artifacts": [{"fileName": os.path.basename(out_path), "savedPath": out_path, "sizeBytes": os.path.getsize(out_path), "mimeType": "application/pdf"}],
            "outputDir": os.path.dirname(out_path),
        }

    def split_pdf(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        working_pdf = self._materialize_working_pdf(ordered)
        first_sid = payload["items"][0]["sourceId"]
        stem = os.path.splitext(os.path.basename(self._id_to_original.get(first_sid, "split.pdf")))[0]
        mode = str(payload.get("mode", "single"))
        ranges = [(int(r["from"]), int(r["to"])) for r in payload.get("ranges", [])]
        wm = bool(payload.get("watermarkEnabled", True))
        meta = str(payload.get("metadataAction", "keep"))

        if mode == "single":
            dest = self._choose_save_file(f"{stem}_split", ".pdf", "PDF Files (*.pdf)")
        else:
            dest = self._choose_output_dir()
        if not dest:
            return None

        paths = PdfEngine.split_pdf(
            working_pdf,
            ranges,
            mode,
            dest,
            stem,
            watermark_enabled=wm,
            metadata_action=meta,
        )
        if paths:
            self.history.add_entry(paths[0])
        out_dir = dest if mode == "individual" else os.path.dirname(dest)
        return {
            "summary": f"Created {len(paths)} split PDF file(s) in {out_dir}",
            "outputCount": len(paths),
            "artifacts": [{"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "application/pdf"} for p in paths],
            "outputDir": out_dir,
        }

    def batch_convert_images(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        image_paths = [p for p, _ in ordered if Validators.is_image(p)]
        if not image_paths:
            raise ValueError("No image files loaded for batch conversion.")

        out_dir = self._choose_output_dir()
        if not out_dir:
            return None

        fmt = str(payload.get("format", "png")).lower()
        wm = bool(payload.get("watermarkEnabled", True))
        meta = str(payload.get("metadataAction", "keep"))
        compression_bytes = payload.get("compressionBytes")

        out_paths: List[str] = []
        if compression_bytes and int(compression_bytes) > 0:
            for p in image_paths:
                stem = os.path.splitext(os.path.basename(p))[0]
                ext = "jpg" if fmt == "jpeg" else fmt
                out_p = ExportEngine.safe_output_path(out_dir, stem, f".{ext}")
                CompressionEngine.compress_image(
                    p, out_p, int(compression_bytes), watermark_enabled=wm, metadata_action=meta
                )
                out_paths.append(out_p)
        else:
            out_paths = ImageEngine.batch_convert(
                image_paths, out_dir, fmt, watermark_enabled=wm, metadata_action=meta
            )

        if out_paths:
            self.history.add_entry(out_paths[0])
        return {
            "summary": f"Converted {len(out_paths)} image(s) to {out_dir}",
            "outputCount": len(out_paths),
            "artifacts": [{"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "image/*"} for p in out_paths],
            "outputDir": out_dir,
        }

    def run_ocr(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        working_pdf = self._materialize_working_pdf(ordered)
        first_sid = payload["items"][0]["sourceId"]
        stem = os.path.splitext(os.path.basename(self._id_to_original.get(first_sid, "ocr.pdf")))[0]
        mode = str(payload.get("mode", "searchable_pdf"))

        if mode == "text_file":
            out_path = self._choose_save_file(f"{stem}_ocr", ".txt", "Text Files (*.txt)")
            if not out_path:
                return None
            OcrEngine.to_text_file(working_pdf, out_path)
            mime = "text/plain"
        else:
            out_path = self._choose_save_file(f"{stem}_searchable", ".pdf", "PDF Files (*.pdf)")
            if not out_path:
                return None
            OcrEngine.to_searchable_pdf(working_pdf, out_path)
            mime = "application/pdf"

        self.history.add_entry(out_path)
        return {
            "summary": f"OCR output saved: {out_path}",
            "outputCount": 1,
            "artifacts": [{"fileName": os.path.basename(out_path), "savedPath": out_path, "sizeBytes": os.path.getsize(out_path), "mimeType": mime}],
            "outputDir": os.path.dirname(out_path),
        }
