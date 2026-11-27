import base64
import logging
import os
import subprocess
import sys
import uuid
import webbrowser
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlsplit
from weakref import WeakKeyDictionary

import webview

from core.cache_manager import CacheManager
from core.compression import CompressionEngine
from core.export import ExportEngine
from core.image_engine import ImageEngine
from core.ocr_engine import OcrEngine
from core.pdf_engine import PdfEngine
from utils.history import HistoryManager
from utils.settings import SettingsManager
from utils.validators import MAX_DESKTOP_UPLOAD_DROP_BYTES, Validators

logger = logging.getLogger("deskconvert.bridge")

ALLOWED_JS_API_METHODS = frozenset({
    "get_app_info",
    "get_settings",
    "save_settings",
    "pick_output_directory",
    "pick_files",
    "pick_folder",
    "stage_paths",
    "stage_uploaded_files",
    "get_full_res_preview",
    "get_history",
    "clear_history",
    "open_path",
    "open_external_url",
    "export_pdf_to_images",
    "export_images_to_pdf",
    "merge_files",
    "split_pdf",
    "batch_convert_images",
    "run_ocr",
})

_JS_API_INTERNAL_DUNDERS = frozenset({
    "__class__",
    "__dir__",
    "__doc__",
    "__module__",
    "__repr__",
    "__weakref__",
})

# Keep bridge instances out of JS-traversable object attributes so pywebview's
# reflective get_functions() / get_nested_attribute() cannot reach internal objects.
_JS_API_BRIDGE_MAP: "WeakKeyDictionary[DeskConvertJsApi, DeskConvertBridge]" = WeakKeyDictionary()


def _open_dialog_const(name: str, fallback: int) -> int:
    fd = getattr(webview, "FileDialog", None)
    if fd and hasattr(fd, name):
        return getattr(fd, name)
    return getattr(webview, f"{name}_DIALOG", fallback)


def _normalize_origin(url: str) -> Optional[str]:
    try:
        parsed = urlsplit(str(url or "").strip())
    except Exception:
        return None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    port_part = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{parsed.hostname.lower()}{port_part}"


def _safe_error(err: Exception, fallback: str) -> Exception:
    """Propagates intentional validation/user errors cleanly without raw stack/path leaks."""
    if isinstance(err, (ValueError, PermissionError, FileNotFoundError, RuntimeError)):
        msg = str(err).strip() or fallback
        return type(err)(msg)
    logger.exception("Unexpected desktop bridge error")
    return RuntimeError(fallback)


def _invoke_bridge(
    api_obj: "DeskConvertJsApi",
    method_name: str,
    *args: Any,
    fallback_msg: str = "Operation failed.",
) -> Any:
    bridge = _JS_API_BRIDGE_MAP.get(api_obj)
    if bridge is None:
        raise RuntimeError("Desktop bridge is no longer active.")
    bridge._assert_app_origin()
    try:
        return getattr(bridge, method_name)(*args)
    except Exception as err:
        raise _safe_error(err, fallback_msg) from None


class DeskConvertJsApi:
    """
    Isolated pywebview JS API facade.
    Exposes ONLY ALLOWED_JS_API_METHODS and blocks attribute traversal to
    internal window/cache/settings/history objects.
    """

    __slots__ = ("__weakref__",)

    def __init__(self, bridge: "DeskConvertBridge"):
        _JS_API_BRIDGE_MAP[self] = bridge

    def __dir__(self) -> List[str]:
        return sorted(ALLOWED_JS_API_METHODS)

    def __getattribute__(self, name: str) -> Any:
        if name in ALLOWED_JS_API_METHODS or name in _JS_API_INTERNAL_DUNDERS:
            return object.__getattribute__(self, name)
        raise AttributeError(f"Attribute '{name}' is not exposed to the WebView JS API.")

    def get_app_info(self) -> Dict[str, Any]:
        return _invoke_bridge(self, "get_app_info", fallback_msg="Unable to read app info.")

    def get_settings(self) -> Dict[str, Any]:
        return _invoke_bridge(self, "get_settings", fallback_msg="Unable to load settings.")

    def save_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        return _invoke_bridge(self, "save_settings", updates, fallback_msg="Unable to save settings.")

    def pick_output_directory(self) -> Optional[str]:
        return _invoke_bridge(self, "pick_output_directory", fallback_msg="Unable to pick directory.")

    def pick_files(self) -> List[str]:
        return _invoke_bridge(self, "pick_files", fallback_msg="Unable to open file picker.")

    def pick_folder(self) -> List[str]:
        return _invoke_bridge(self, "pick_folder", fallback_msg="Unable to open folder picker.")

    def stage_paths(self, paths: List[str]) -> Dict[str, Any]:
        return _invoke_bridge(self, "stage_paths", paths, fallback_msg="Unable to stage selected files.")

    def stage_uploaded_files(self, files_payload: List[Dict[str, str]]) -> Dict[str, Any]:
        return _invoke_bridge(self, "stage_uploaded_files", files_payload, fallback_msg="Unable to stage dropped files.")

    def get_full_res_preview(self, source_id: str, page_index: int) -> str:
        return _invoke_bridge(self, "get_full_res_preview", source_id, page_index, fallback_msg="Unable to render preview.")

    def get_history(self) -> List[Dict[str, Any]]:
        return _invoke_bridge(self, "get_history", fallback_msg="Unable to load recent history.")

    def clear_history(self) -> None:
        return _invoke_bridge(self, "clear_history", fallback_msg="Unable to clear history.")

    def open_path(self, target_path: str) -> None:
        return _invoke_bridge(self, "open_path", target_path, fallback_msg="Unable to open output folder.")

    def open_external_url(self, url: str) -> bool:
        return _invoke_bridge(self, "open_external_url", url, fallback_msg="External link blocked.")

    def export_pdf_to_images(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _invoke_bridge(self, "export_pdf_to_images", payload, fallback_msg="Image export failed.")

    def export_images_to_pdf(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _invoke_bridge(self, "export_images_to_pdf", payload, fallback_msg="PDF export failed.")

    def merge_files(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _invoke_bridge(self, "merge_files", payload, fallback_msg="Merge failed.")

    def split_pdf(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _invoke_bridge(self, "split_pdf", payload, fallback_msg="Split failed.")

    def batch_convert_images(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _invoke_bridge(self, "batch_convert_images", payload, fallback_msg="Batch conversion failed.")

    def run_ocr(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _invoke_bridge(self, "run_ocr", payload, fallback_msg="OCR failed.")


class DeskConvertBridge:
    """Native JS <-> Python API exposed inside pywebview for offline desktop execution."""

    def __init__(self):
        self.settings = SettingsManager()
        self.history = HistoryManager(self.settings)
        self.cache = CacheManager()
        self.window: Optional[webview.Window] = None
        self._allowed_origin: Optional[str] = None
        self._allowed_open_dirs: Set[str] = set()
        self._id_to_cached: Dict[str, str] = {}
        self._id_to_original: Dict[str, str] = {}

    def create_js_api(self) -> DeskConvertJsApi:
        """Returns the strictly isolated JS API facade to pass to pywebview.create_window()."""
        return DeskConvertJsApi(self)

    def attach_window(self, window: webview.Window, allowed_origin: Optional[str] = None) -> None:
        self.window = window
        if allowed_origin:
            self._allowed_origin = _normalize_origin(allowed_origin)

    def set_allowed_origin(self, origin: str) -> None:
        self._allowed_origin = _normalize_origin(origin)

    def _assert_app_origin(self) -> None:
        """Ensures bridge calls only execute while the WebView is on the local app origin."""
        if self.window is None or not self._allowed_origin:
            return
        try:
            current_url = self.window.get_current_url()
        except Exception:
            current_url = None
        if not current_url:
            return
        current_origin = _normalize_origin(current_url)
        if current_origin != self._allowed_origin:
            raise PermissionError("Bridge calls are restricted to the DeskConvert application origin.")

    def _register_allowed_open_dir(self, directory: str) -> None:
        try:
            safe_dir = Validators.validate_local_path(directory, must_exist=True, expect_dir=True)
            self._allowed_open_dirs.add(safe_dir)
        except ValueError:
            pass

    def _current_allowed_open_dirs(self) -> Set[str]:
        allowed = set(self._allowed_open_dirs)
        default_dir = ExportEngine.get_default_directory(self.settings)
        if default_dir and os.path.isdir(default_dir):
            allowed.add(os.path.realpath(os.path.abspath(default_dir)))
        return allowed

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
        if not isinstance(updates, dict):
            raise ValueError("Invalid settings payload.")
        sanitized: Dict[str, Any] = {}
        key_aliases = {
            "defaultOutputDirectory": "default_output_directory",
            "default_output_directory": "default_output_directory",
            "watermarkEnabled": "watermark_enabled",
            "watermark_enabled": "watermark_enabled",
            "metadataAction": "metadata_action",
            "metadata_action": "metadata_action",
            "dpi": "dpi",
            "customDpi": "custom_dpi",
            "custom_dpi": "custom_dpi",
            "quickSaveEnabled": "quick_save_enabled",
            "quick_save_enabled": "quick_save_enabled",
            "theme": "theme",
        }
        for incoming_key, canonical_key in key_aliases.items():
            if incoming_key not in updates:
                continue
            val = updates[incoming_key]
            if canonical_key == "default_output_directory":
                raw_dir = str(val or "").strip()
                if raw_dir:
                    safe_dir = Validators.validate_local_path(raw_dir, must_exist=True, expect_dir=True)
                    sanitized[canonical_key] = safe_dir
                    self._register_allowed_open_dir(safe_dir)
                else:
                    sanitized[canonical_key] = ""
            elif canonical_key in ("watermark_enabled", "quick_save_enabled"):
                sanitized[canonical_key] = bool(val)
            elif canonical_key == "metadata_action":
                sanitized[canonical_key] = "strip" if val == "strip" else "keep"
            elif canonical_key == "dpi":
                sanitized[canonical_key] = val if val in ("screen", "print", "custom") else "print"
            elif canonical_key == "custom_dpi":
                try:
                    dpi_int = int(val)
                except (TypeError, ValueError):
                    dpi_int = 300
                sanitized[canonical_key] = max(72, min(1200, dpi_int))
            elif canonical_key == "theme":
                sanitized[canonical_key] = "light" if val == "light" else "dark"

        return self.settings.update_from_dict(sanitized)

    def get_history(self) -> List[Dict[str, Any]]:
        return self.history.get_detailed_entries()

    def clear_history(self) -> None:
        self.history.clear_all()

    def open_external_url(self, url: str) -> bool:
        """Opens an allowlisted DeskConvert GitHub URL in the user's default browser."""
        if not Validators.is_allowed_external_url(url):
            raise ValueError(
                "Blocked external URL: only links under https://github.com/kamal-hq/DeskConvert are permitted."
            )
        webbrowser.open(url.strip(), new=2)
        return True

    def open_path(self, target_path: str) -> None:
        """Opens an allowed local export directory in the OS file explorer (never executes files)."""
        resolved = Validators.validate_local_path(target_path, must_exist=True)
        folder = resolved if os.path.isdir(resolved) else os.path.dirname(resolved)
        folder = Validators.validate_local_path(folder, must_exist=True, expect_dir=True)

        allowed_dirs = self._current_allowed_open_dirs()
        if not any(Validators.is_path_within(folder, allowed) for allowed in allowed_dirs):
            raise ValueError("Access denied: requested path is outside allowed output directories.")

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
        chosen = res[0] if res else None
        if chosen:
            chosen = Validators.validate_local_path(chosen, must_exist=True, expect_dir=True)
            self._register_allowed_open_dir(chosen)
        return chosen

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
        rejected: List[str] = []

        for p in paths or []:
            try:
                safe_p = Validators.validate_local_path(p, must_exist=True)
            except ValueError:
                rejected.append(Validators.sanitize_filename(str(p or "invalid")))
                continue

            if os.path.isdir(safe_p):
                for root, _, files in os.walk(safe_p):
                    for f in sorted(files):
                        candidate = os.path.join(root, f)
                        try:
                            safe_child = Validators.validate_local_path(
                                candidate, must_exist=True, expect_file=True
                            )
                            if Validators.is_path_within(safe_child, safe_p):
                                expanded.append(safe_child)
                        except ValueError:
                            rejected.append(Validators.sanitize_filename(f))
            elif os.path.isfile(safe_p):
                expanded.append(safe_p)

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
        rejected: List[str] = []
        encrypted: List[str] = []
        items: List[Dict[str, Any]] = []

        for entry in files_payload or []:
            if not isinstance(entry, dict):
                continue
            raw_name = str(entry.get("name", "file"))
            orig_name = Validators.sanitize_filename(raw_name, fallback_stem="file")
            b64 = str(entry.get("base64", ""))
            if not Validators.is_supported_file(orig_name):
                rejected.append(orig_name)
                continue
            est_decoded_bytes = (len(b64) * 3) // 4
            if est_decoded_bytes > MAX_DESKTOP_UPLOAD_DROP_BYTES:
                limit_mb = MAX_DESKTOP_UPLOAD_DROP_BYTES // (1024 * 1024)
                raise ValueError(
                    f"Dropped file '{orig_name}' exceeds the {limit_mb} MB drag-and-drop cap. Use 'Browse Files' for larger files."
                )
            try:
                raw_bytes = base64.b64decode(b64, validate=True)
            except Exception:
                raise ValueError(f"Invalid base64 payload for '{orig_name}'.")
            if len(raw_bytes) > MAX_DESKTOP_UPLOAD_DROP_BYTES:
                limit_mb = MAX_DESKTOP_UPLOAD_DROP_BYTES // (1024 * 1024)
                raise ValueError(
                    f"Dropped file '{orig_name}' exceeds the {limit_mb} MB drag-and-drop cap."
                )

            base, ext = os.path.splitext(orig_name)
            safe_base = Validators.sanitize_filename_stem(base, fallback="file")
            cached_path = os.path.join(self.cache.temp_dir, f"{safe_base}_{uuid.uuid4().hex[:8]}{ext}")
            if not Validators.is_path_within(cached_path, self.cache.temp_dir):
                raise ValueError("Refused to stage file outside temporary cache directory.")

            with open(cached_path, "wb") as f:
                f.write(raw_bytes)

            try:
                if Validators.is_password_protected(cached_path):
                    os.remove(cached_path)
                    encrypted.append(orig_name)
                    continue
                if Validators.is_image(orig_name):
                    Validators.validate_image_safety(cached_path, display_name=orig_name)
                elif Validators.is_pdf(orig_name):
                    Validators.validate_pdf_safety(cached_path, display_name=orig_name)
            except ValueError:
                try:
                    os.remove(cached_path)
                except OSError:
                    pass
                raise

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

    def _get_verified_cached_path(self, source_id: str) -> str:
        if not isinstance(source_id, str) or source_id not in self._id_to_cached:
            raise FileNotFoundError("Cached source file not found.")
        cached = self._id_to_cached[source_id]
        if not Validators.is_path_within(cached, self.cache.temp_dir) or not os.path.isfile(cached):
            raise FileNotFoundError("Cached source file is no longer available.")
        return cached

    def get_full_res_preview(self, source_id: str, page_index: int) -> str:
        cached = self._get_verified_cached_path(source_id)
        return self.cache.get_full_res_data_url(cached, max(0, int(page_index)))

    def _resolve_storyboard(self, items_payload: List[Dict[str, Any]]) -> List[tuple]:
        resolved = []
        for entry in items_payload or []:
            if not isinstance(entry, dict) or "sourceId" not in entry:
                continue
            sid = str(entry["sourceId"])
            try:
                cached = self._get_verified_cached_path(sid)
            except FileNotFoundError:
                continue
            resolved.append((cached, max(0, int(entry.get("pageIndex", 0)))))
        if not resolved:
            raise ValueError("No valid staged files found.")
        return resolved

    def _choose_output_dir(self) -> Optional[str]:
        default_dir = ExportEngine.get_default_directory(self.settings)
        if self.settings.get_quick_save_enabled() or not self.window:
            safe_dir = Validators.validate_local_path(default_dir, must_exist=True, expect_dir=True)
            self._register_allowed_open_dir(safe_dir)
            return safe_dir
        res = self.window.create_file_dialog(_open_dialog_const("FOLDER", 20), directory=default_dir)
        chosen = res[0] if res else None
        if not chosen:
            return None
        safe_dir = Validators.validate_local_path(chosen, must_exist=True, expect_dir=True)
        self._register_allowed_open_dir(safe_dir)
        return safe_dir

    def _choose_save_file(self, stem: str, ext: str, filter_label: str) -> Optional[str]:
        safe_stem = Validators.sanitize_filename_stem(stem, fallback="document")
        default_dir = ExportEngine.get_default_directory(self.settings)
        if self.settings.get_quick_save_enabled() or not self.window:
            out_path = ExportEngine.safe_output_path(default_dir, safe_stem, ext)
            self._register_allowed_open_dir(os.path.dirname(out_path))
            return out_path
        res = self.window.create_file_dialog(
            _open_dialog_const("SAVE", 30),
            directory=default_dir,
            save_filename=f"{safe_stem}_converted{ext}",
            file_types=(filter_label, "All files (*.*)"),
        )
        chosen = res[0] if isinstance(res, (list, tuple)) and res else (res if isinstance(res, str) else None)
        if not chosen:
            return None
        chosen = Validators.validate_local_path(chosen)
        if not chosen.lower().endswith(ext.lower()):
            chosen += ext
        self._register_allowed_open_dir(os.path.dirname(chosen))
        return chosen

    def _materialize_working_pdf(self, ordered_items: List[tuple]) -> str:
        working_pdf = os.path.join(self.cache.temp_dir, f"working_{uuid.uuid4().hex[:8]}.pdf")
        return PdfEngine.build_working_pdf(ordered_items, working_pdf)

    def _safe_stem_for_source(self, source_id: str, fallback: str) -> str:
        raw = self._id_to_original.get(source_id, fallback)
        stem = os.path.splitext(os.path.basename(raw))[0]
        return Validators.sanitize_filename_stem(stem, fallback=fallback)

    def export_pdf_to_images(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        out_dir = self._choose_output_dir()
        if not out_dir:
            return None
        working_pdf = self._materialize_working_pdf(ordered)
        first_sid = payload["items"][0]["sourceId"]
        stem = self._safe_stem_for_source(first_sid, "document")
        wm = bool(payload.get("watermarkEnabled", True))
        meta = "strip" if payload.get("metadataAction") == "strip" else "keep"
        compression_bytes = payload.get("compressionBytes")
        dpi = max(72, min(1200, int(payload.get("dpi", 300))))
        paths = PdfEngine.pdf_to_images(
            working_pdf,
            out_dir,
            stem,
            dpi=dpi,
            fmt=str(payload.get("format", "jpg")).lower(),
            watermark_enabled=wm,
            metadata_action=meta,
        )
        if compression_bytes and int(compression_bytes) > 0:
            for p in paths:
                if os.path.getsize(p) > int(compression_bytes):
                    CompressionEngine.compress_image(
                        p, p, int(compression_bytes), watermark_enabled=False, metadata_action=meta
                    )
        if paths:
            self.history.add_entry(paths[0])
        return {
            "summary": f"Exported {len(paths)} image(s) to {out_dir}",
            "outputCount": len(paths),
            "artifacts": [
                {"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "image/*"}
                for p in paths
            ],
            "outputDir": out_dir,
        }

    def export_images_to_pdf(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if payload.get("separateFiles"):
            ordered = self._resolve_storyboard(payload["items"])
            out_dir = self._choose_output_dir()
            if not out_dir:
                return None
            wm = bool(payload.get("watermarkEnabled", True))
            meta = "strip" if payload.get("metadataAction") == "strip" else "keep"
            compression_bytes = payload.get("compressionBytes")
            saved_paths: List[str] = []
            for idx, (cached_path, page_idx) in enumerate(ordered):
                stem = Validators.sanitize_filename_stem(
                    os.path.splitext(os.path.basename(cached_path))[0], fallback="document"
                )
                out_path = ExportEngine.safe_output_path(out_dir, f"{stem}_p{idx + 1}", ".pdf")
                if compression_bytes and int(compression_bytes) > 0:
                    temp_pdf = self._materialize_working_pdf([(cached_path, page_idx)])
                    CompressionEngine.compress_pdf(
                        temp_pdf, out_path, int(compression_bytes), watermark_enabled=wm, metadata_action=meta
                    )
                else:
                    PdfEngine.merge_to_pdf(
                        [(cached_path, page_idx)], out_path, watermark_enabled=wm, metadata_action=meta
                    )
                saved_paths.append(out_path)
            if saved_paths:
                self.history.add_entry(saved_paths[0])
            return {
                "summary": f"Exported {len(saved_paths)} separate PDF(s) to {out_dir}",
                "outputCount": len(saved_paths),
                "artifacts": [
                    {"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "application/pdf"}
                    for p in saved_paths
                ],
                "outputDir": out_dir,
            }
        return self.merge_files(payload)

    def merge_files(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        first_sid = payload["items"][0]["sourceId"]
        stem = self._safe_stem_for_source(first_sid, "merged")
        out_path = self._choose_save_file(stem, ".pdf", "PDF Files (*.pdf)")
        if not out_path:
            return None

        compression_bytes = payload.get("compressionBytes")
        wm = bool(payload.get("watermarkEnabled", True))
        meta = "strip" if payload.get("metadataAction") == "strip" else "keep"

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
            "artifacts": [
                {"fileName": os.path.basename(out_path), "savedPath": out_path, "sizeBytes": os.path.getsize(out_path), "mimeType": "application/pdf"}
            ],
            "outputDir": os.path.dirname(out_path),
        }

    def split_pdf(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        working_pdf = self._materialize_working_pdf(ordered)
        first_sid = payload["items"][0]["sourceId"]
        stem = self._safe_stem_for_source(first_sid, "split")
        mode = str(payload.get("mode", "single"))
        ranges = [(int(r["from"]), int(r["to"])) for r in payload.get("ranges", [])]
        wm = bool(payload.get("watermarkEnabled", True))
        meta = "strip" if payload.get("metadataAction") == "strip" else "keep"

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
        self._register_allowed_open_dir(out_dir)
        return {
            "summary": f"Created {len(paths)} split PDF file(s) in {out_dir}",
            "outputCount": len(paths),
            "artifacts": [
                {"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "application/pdf"}
                for p in paths
            ],
            "outputDir": out_dir,
        }

    def batch_convert_images(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        has_pdf = any(Validators.is_pdf(p) for p, _ in ordered)
        if has_pdf:
            return self.export_pdf_to_images(payload)

        image_paths = [p for p, _ in ordered if Validators.is_image(p)]
        if not image_paths:
            raise ValueError("No files loaded for batch conversion.")

        out_dir = self._choose_output_dir()
        if not out_dir:
            return None

        fmt = str(payload.get("format", "png")).lower()
        wm = bool(payload.get("watermarkEnabled", True))
        meta = "strip" if payload.get("metadataAction") == "strip" else "keep"
        compression_bytes = payload.get("compressionBytes")

        out_paths: List[str] = []
        if compression_bytes and int(compression_bytes) > 0:
            for p in image_paths:
                stem = Validators.sanitize_filename_stem(
                    os.path.splitext(os.path.basename(p))[0], fallback="image"
                )
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
            "artifacts": [
                {"fileName": os.path.basename(p), "savedPath": p, "sizeBytes": os.path.getsize(p), "mimeType": "image/*"}
                for p in out_paths
            ],
            "outputDir": out_dir,
        }

    def run_ocr(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ordered = self._resolve_storyboard(payload["items"])
        working_pdf = self._materialize_working_pdf(ordered)
        first_sid = payload["items"][0]["sourceId"]
        stem = self._safe_stem_for_source(first_sid, "ocr")
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
            "artifacts": [
                {"fileName": os.path.basename(out_path), "savedPath": out_path, "sizeBytes": os.path.getsize(out_path), "mimeType": mime}
            ],
            "outputDir": os.path.dirname(out_path),
        }
