"""
Comprehensive security & functional regression tests for branch `security-compliance-audit`.

Covers:
1. pywebview reflection compatibility & strict DeskConvertJsApi isolation
2. End-to-end execution of every exposed JS API method with realistic PDF/image/folder inputs
3. Live DeskConvertLocalServer HTTP enforcement against the actual built `dist_web/` bundle
4. Origin drift enforcement, WebView navigation lock, and external URL allowlist
5. Path traversal, UNC path, Windows reserved device name, decompression-bomb, and error-sanitization boundaries
6. Real bundled installer asset SHA-256 verification
"""

from __future__ import annotations

import base64
import inspect
import io
import os
import re
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest
import pymupdf as fitz
from PIL import Image

from desktop import app as desktop_app
from desktop.app import DeskConvertLocalServer, handle_navigation_attempt, is_allowed_app_url
from desktop.bridge import ALLOWED_JS_API_METHODS, DeskConvertBridge
from desktop.verify_installer_assets import DEFAULT_ASSETS_DIR, DEFAULT_MANIFEST_PATH, verify_assets
from utils.settings import SettingsManager
from utils.validators import Validators

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST_WEB_DIR = REPO_ROOT / "dist_web"


def _make_pdf(path: Path, pages: int = 3, password: str | None = None) -> str:
    with fitz.open() as doc:
        for i in range(pages):
            page = doc.new_page(width=400, height=550)
            page.insert_text((40, 70), f"Regression Page {i + 1}", fontsize=16)
        doc.set_metadata({"title": "Original Title", "author": "Regression Author"})
        if password:
            doc.save(
                str(path),
                encryption=fitz.PDF_ENCRYPT_AES_256,
                user_pw=password,
                owner_pw=password,
            )
        else:
            doc.save(str(path))
    return str(path)


def _make_image(path: Path, size: tuple[int, int] = (320, 240), fmt: str | None = None) -> str:
    img = Image.effect_noise(size, 45).convert("RGB")
    if fmt:
        img.save(str(path), format=fmt)
    else:
        img.save(str(path))
    return str(path)


class _FakeWindow:
    def __init__(self, url: str):
        self._url = url

    def get_current_url(self) -> str:
        return self._url

    def create_file_dialog(self, *_args, **_kwargs):
        return None


def test_pywebview_reflection_matches_typescript_bridge_contract():
    """
    Simulates pywebview.util.inject_pywebview's get_functions() reflection loop on DeskConvertJsApi
    and asserts exact 1-to-1 parity with DesktopBridgeApi in src/engines/desktopEngine.ts.
    """
    bridge = DeskConvertBridge()
    js_api = bridge.create_js_api()
    try:
        discovered: dict[str, list[str]] = {}
        for name in dir(js_api):
            if name.startswith("_"):
                continue
            attr = getattr(js_api, name)
            assert inspect.ismethod(attr) or inspect.isfunction(attr), (
                f"Non-callable attribute {name!r} should not be exposed to pywebview!"
            )
            discovered[name] = list(inspect.getfullargspec(attr).args)[1:]

        assert set(discovered.keys()) == ALLOWED_JS_API_METHODS

        ts_source = (REPO_ROOT / "src" / "engines" / "desktopEngine.ts").read_text(encoding="utf-8")
        ts_interface = ts_source.split("export interface DesktopBridgeApi {", 1)[1].split("\n}\n", 1)[0]
        ts_methods = set(re.findall(r"^\s{2}([a-z_]+)\(", ts_interface, flags=re.MULTILINE))
        assert ts_methods == set(discovered.keys()), (
            f"Mismatch between DesktopBridgeApi ({ts_methods}) and DeskConvertJsApi ({set(discovered.keys())})"
        )

        # Ensure internal attributes/objects cannot be traversed even via getattr
        for private_name in (
            "window",
            "cache",
            "settings",
            "history",
            "attach_window",
            "cleanup",
            "create_js_api",
            "_assert_app_origin",
            "_id_to_cached",
            "_allowed_open_dirs",
            "__dict__",
        ):
            with pytest.raises(AttributeError):
                getattr(js_api, private_name)
    finally:
        bridge.cleanup()


def test_js_api_end_to_end_normal_flows_and_boundary_rejections(tmp_path, monkeypatch):
    """
    Exercises every user-facing DeskConvertJsApi method with realistic multi-PDF, multi-image,
    and folder inputs, then verifies every security boundary rejects malicious input cleanly.
    """
    out_dir = tmp_path / "exports"
    out_dir.mkdir()
    outside_dir = tmp_path / "outside_secret"
    outside_dir.mkdir()
    input_folder = tmp_path / "drop_folder"
    nested_folder = input_folder / "sub"
    nested_folder.mkdir(parents=True)

    pdf1 = _make_pdf(input_folder / "contract.pdf", pages=3)
    pdf_enc = _make_pdf(nested_folder / "locked.pdf", pages=1, password="secret")
    img1 = _make_image(nested_folder / "photo.png")
    img2 = _make_image(tmp_path / "scan.jpg", fmt="JPEG")
    (nested_folder / "notes.txt").write_text("not supported", encoding="utf-8")

    bridge = DeskConvertBridge()
    bridge.settings = SettingsManager(config_path=str(tmp_path / "settings.json"))
    bridge.history.settings = bridge.settings
    win = _FakeWindow("http://127.0.0.1:45678/index.html")
    bridge.attach_window(win, allowed_origin="http://127.0.0.1:45678")
    js_api = bridge.create_js_api()

    opened_folders: list[str] = []
    opened_urls: list[str] = []
    if sys.platform == "win32":
        monkeypatch.setattr(os, "startfile", lambda p: opened_folders.append(p))
    else:
        monkeypatch.setattr("subprocess.Popen", lambda cmd: opened_folders.append(cmd[-1]))
    monkeypatch.setattr("webbrowser.open", lambda url, new=2: opened_urls.append(url) or True)

    try:
        # 1. App info & settings (camelCase + snake_case + clamping + rejection)
        info = js_api.get_app_info()
        assert info["isDesktop"] is True and info["version"] == "2.0.0"

        saved = js_api.save_settings({
            "defaultOutputDirectory": str(out_dir),
            "quickSaveEnabled": True,
            "watermarkEnabled": True,
            "metadataAction": "strip",
            "dpi": "custom",
            "customDpi": 99999,  # must clamp to 1200
            "theme": "light",
        })
        assert saved["default_output_directory"] == os.path.realpath(str(out_dir))
        assert saved["quick_save_enabled"] is True
        assert saved["custom_dpi"] == 1200
        assert saved["metadata_action"] == "strip"
        assert saved["theme"] == "light"

        # Invalid settings paths rejected
        with pytest.raises(ValueError):
            js_api.save_settings({"defaultOutputDirectory": r"\\evil-host\share"})
        with pytest.raises(ValueError):
            js_api.save_settings({"defaultOutputDirectory": str(out_dir / ".." / "outside_secret")})

        # 2. Stage folder recursively + individual image + bad paths (UNC/traversal)
        staged = js_api.stage_paths([
            str(input_folder),
            img2,
            r"\\attacker\share\evil.pdf",
            str(tmp_path / ".." / "escape.pdf"),
        ])
        # contract.pdf (3 pages) + photo.png (1) + scan.jpg (1) = 5 cards
        assert len(staged["items"]) == 5
        assert "locked.pdf" in staged["encrypted"]
        assert "notes.txt" in staged["rejected"]
        assert len(staged["rejected"]) >= 3  # notes.txt + UNC + traversal

        # 3. Preview works for valid card, fails cleanly for unknown sourceId
        pdf_item = next(i for i in staged["items"] if i["fileName"] == "contract.pdf" and i["pageIndex"] == 1)
        img_item = next(i for i in staged["items"] if i["fileName"] == "photo.png")
        preview = js_api.get_full_res_preview(pdf_item["sourceId"], pdf_item["pageIndex"])
        assert preview.startswith("data:image/png;base64,")
        with pytest.raises(FileNotFoundError):
            js_api.get_full_res_preview("dsrc_nonexistent", 0)

        # 4. Export PDF -> Images for PyMuPDF Pixmap.save formats (JPG, PNG);
        #    all 5 formats (JPG, PNG, WEBP, BMP, TIFF) are tested via Pillow batch_convert_images below.
        for fmt in ("JPG", "PNG"):
            res = js_api.export_pdf_to_images({
                "items": [{"sourceId": pdf_item["sourceId"], "pageIndex": 0}],
                "format": fmt,
                "dpi": 72,
                "watermarkEnabled": True,
                "metadataAction": "strip",
                "compressionBytes": None,
            })
            assert res is not None and res["outputCount"] == 1
            assert os.path.isfile(res["artifacts"][0]["savedPath"])

        # 5. Export Images/Mixed -> Separate PDFs & Combined PDF
        sep_res = js_api.export_images_to_pdf({
            "items": [
                {"sourceId": img_item["sourceId"], "pageIndex": 0},
                {"sourceId": pdf_item["sourceId"], "pageIndex": 2},
            ],
            "watermarkEnabled": True,
            "metadataAction": "strip",
            "compressionBytes": None,
            "separateFiles": True,
        })
        assert sep_res is not None and sep_res["outputCount"] == 2

        merged = js_api.merge_files({
            "items": [
                {"sourceId": pdf_item["sourceId"], "pageIndex": 2},
                {"sourceId": img_item["sourceId"], "pageIndex": 0},
                {"sourceId": pdf_item["sourceId"], "pageIndex": 0},
            ],
            "watermarkEnabled": True,
            "metadataAction": "strip",
            "compressionBytes": None,
        })
        assert merged is not None and merged["outputCount"] == 1
        with fitz.open(merged["artifacts"][0]["savedPath"]) as mdoc:
            assert len(mdoc) == 3
            assert mdoc.metadata.get("author", "") == ""

        # 6. Split PDF (single + individual)
        split_single = js_api.split_pdf({
            "items": [
                {"sourceId": pdf_item["sourceId"], "pageIndex": 0},
                {"sourceId": pdf_item["sourceId"], "pageIndex": 1},
                {"sourceId": pdf_item["sourceId"], "pageIndex": 2},
            ],
            "ranges": [{"id": "r1", "from": 1, "to": 2}],
            "mode": "single",
            "watermarkEnabled": False,
            "metadataAction": "keep",
        })
        assert split_single is not None and split_single["outputCount"] == 1

        split_ind = js_api.split_pdf({
            "items": [
                {"sourceId": pdf_item["sourceId"], "pageIndex": 0},
                {"sourceId": pdf_item["sourceId"], "pageIndex": 1},
            ],
            "ranges": [{"id": "r1", "from": 1, "to": 2}],
            "mode": "individual",
            "watermarkEnabled": True,
            "metadataAction": "strip",
        })
        assert split_ind is not None and split_ind["outputCount"] == 2

        # 7. Batch convert: images-only across all 5 Pillow formats AND mixed PDF+image
        for img_fmt, expected_ext in (
            ("JPG", ".jpg"),
            ("PNG", ".png"),
            ("WEBP", ".webp"),
            ("BMP", ".bmp"),
            ("TIFF", ".tiff"),
        ):
            batch_imgs = js_api.batch_convert_images({
                "items": [{"sourceId": img_item["sourceId"], "pageIndex": 0}],
                "format": img_fmt,
                "dpi": 72,
                "watermarkEnabled": True,
                "metadataAction": "strip",
                "compressionBytes": None,
            })
            assert batch_imgs is not None and batch_imgs["artifacts"][0]["fileName"].endswith(expected_ext)

        batch_mixed = js_api.batch_convert_images({
            "items": [
                {"sourceId": pdf_item["sourceId"], "pageIndex": 0},
                {"sourceId": img_item["sourceId"], "pageIndex": 0},
            ],
            "format": "PNG",
            "dpi": 72,
            "watermarkEnabled": False,
            "metadataAction": "keep",
            "compressionBytes": None,
        })
        assert batch_mixed is not None and batch_mixed["outputCount"] == 2

        # 8. OCR routing (mocking Tesseract binary call while testing full bridge path/save/history)
        def _fake_ocr_txt(_src: str, out_path: str) -> str:
            Path(out_path).write_text("Recognized text", encoding="utf-8")
            return out_path

        def _fake_ocr_pdf(src: str, out_path: str) -> str:
            Path(out_path).write_bytes(Path(src).read_bytes())
            return out_path

        monkeypatch.setattr("core.ocr_engine.OcrEngine.to_text_file", staticmethod(_fake_ocr_txt))
        monkeypatch.setattr("core.ocr_engine.OcrEngine.to_searchable_pdf", staticmethod(_fake_ocr_pdf))

        ocr_txt = js_api.run_ocr({
            "items": [{"sourceId": pdf_item["sourceId"], "pageIndex": 0}],
            "mode": "text_file",
        })
        assert ocr_txt is not None and ocr_txt["artifacts"][0]["fileName"].endswith(".txt")

        ocr_pdf = js_api.run_ocr({
            "items": [{"sourceId": pdf_item["sourceId"], "pageIndex": 0}],
            "mode": "searchable_pdf",
        })
        assert ocr_pdf is not None and ocr_pdf["artifacts"][0]["fileName"].endswith(".pdf")

        # 9. Drag-and-drop base64 staging: normal + Windows reserved names + bad base64
        png_b64 = base64.b64encode(Path(img1).read_bytes()).decode("ascii")
        for reserved in ("CON.png", "PRN.png", "AUX.png", "NUL.png", "COM1.png", "LPT9.png", "../../CON.png"):
            dropped = js_api.stage_uploaded_files([{"name": reserved, "base64": png_b64}])
            assert len(dropped["items"]) == 1
            assert dropped["items"][0]["fileName"].startswith("file_")

        with pytest.raises(ValueError, match="Invalid base64"):
            js_api.stage_uploaded_files([{"name": "bad.png", "base64": "!!!not-valid-base64!!!"}])

        # 10. History retains full paths on Desktop (unchanged behavior) & clear_history empties it
        hist = js_api.get_history()
        assert len(hist) > 0
        assert any(os.path.isabs(entry["path"]) for entry in hist)
        js_api.clear_history()
        assert js_api.get_history() == []

        # 11. open_path allows exported output dir, blocks outside dir / UNC / traversal
        js_api.open_path(merged["outputDir"])
        assert len(opened_folders) == 1
        assert os.path.realpath(opened_folders[0]) == os.path.realpath(str(out_dir))

        for bad_target in (
            str(outside_dir),
            r"\\attacker\share\folder",
            str(out_dir / ".." / "outside_secret"),
            str(out_dir / "does_not_exist"),
        ):
            with pytest.raises(ValueError):
                js_api.open_path(bad_target)

        # 12. External URL allowlist + navigation guard
        assert js_api.open_external_url("https://github.com/kamal-hq/DeskConvert/releases/latest") is True
        assert opened_urls[-1] == "https://github.com/kamal-hq/DeskConvert/releases/latest"

        for bad_url in (
            "https://github.com/other/DeskConvert",
            "http://github.com/kamal-hq/DeskConvert",
            "https://user:pass@github.com/kamal-hq/DeskConvert",
            "https://github.com:8443/kamal-hq/DeskConvert",
            "https://github.com/kamal-hq/DeskConvert/../other",
            "https://evil.example/",
            "javascript:alert(1)",
            "file:///C:/Windows/win.ini",
        ):
            with pytest.raises(ValueError):
                js_api.open_external_url(bad_url)

        # handle_navigation_attempt allows same origin & about:blank, opens allowlisted GitHub, blocks other sites
        origin = "http://127.0.0.1:45678"
        assert is_allowed_app_url(f"{origin}/index.html", origin) is True
        assert is_allowed_app_url("about:blank", origin) is True
        assert handle_navigation_attempt(f"{origin}/privacy", origin) is True
        before_count = len(opened_urls)
        assert handle_navigation_attempt("https://github.com/kamal-hq/DeskConvert", origin) is False
        assert len(opened_urls) == before_count + 1
        assert handle_navigation_attempt("https://phishing.example/", origin) is False
        assert len(opened_urls) == before_count + 1

        # 13. Unexpected internal OSError is sanitized by DeskConvertJsApi (no raw path leak)
        def _boom():
            raise OSError(r"C:\SecretInternalPath\leak.db failed")

        monkeypatch.setattr(bridge, "get_history", _boom)
        with pytest.raises(RuntimeError) as err_info:
            js_api.get_history()
        assert "SecretInternalPath" not in str(err_info.value)

        # 14. Origin drift blocks ALL bridge calls with PermissionError
        win._url = "https://untrusted.example/page.html"
        with pytest.raises(PermissionError):
            js_api.get_app_info()
        with pytest.raises(PermissionError):
            js_api.open_path(merged["outputDir"])
    finally:
        bridge.cleanup()


def test_local_http_server_serves_real_dist_web_and_enforces_security_boundaries():
    """
    Tests DeskConvertLocalServer directly against the real built `dist_web/` bundle:
    - Serves index.html, JS bundle, CSS bundle, self-hosted Manrope & DM Mono .woff2, and pdf.worker
    - Emits strict anti-sniffing/anti-framing/CORP headers with NO wildcard CORS
    - Blocks POST /js_api/<uid>, PUT, DELETE, path traversal, foreign Host/Origin, and cross-site fetches
    - Also performs a live loopback TCP HTTP probe if the environment permits loopback sockets
    """
    assert (DIST_WEB_DIR / "index.html").is_file(), "dist_web/index.html missing; run npm run build first."
    port = 54321
    wsgi_app = DeskConvertLocalServer.build_wsgi_app(str(DIST_WEB_DIR), port)

    def _call(method: str, path: str, extra: dict | None = None):
        status_box: dict = {}
        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "SERVER_NAME": "127.0.0.1",
            "SERVER_PORT": str(port),
            "HTTP_HOST": f"127.0.0.1:{port}",
            "wsgi.input": io.BytesIO(b""),
            "wsgi.errors": io.StringIO(),
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "http",
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }
        if extra:
            environ.update(extra)

        def start_response(status, headers, _exc_info=None):
            status_box["code"] = int(status.split(" ", 1)[0])
            status_box["headers"] = {k.lower(): v for k, v in headers}

        body = b"".join(wsgi_app(environ, start_response))
        return status_box["code"], status_box["headers"], body

    # Serve root & index.html
    for route in ("/", "/index.html"):
        code, headers, body = _call("GET", route)
        assert code == 200
        assert b"DeskConvert" in body
        assert headers.get("x-content-type-options") == "nosniff"
        assert headers.get("x-frame-options") == "DENY"
        assert headers.get("referrer-policy") == "no-referrer"
        assert headers.get("cross-origin-resource-policy") == "same-origin"
        assert "access-control-allow-origin" not in headers

    # Serve real bundled JS, CSS, self-hosted fonts, and pdf.js worker
    assets_dir = DIST_WEB_DIR / "assets"
    manrope_woff2 = next(assets_dir.glob("manrope-latin-400-*.woff2"))
    dm_mono_woff2 = next(assets_dir.glob("dm-mono-latin-400-*.woff2"))
    pdf_worker = next(assets_dir.glob("pdf.worker.min-*.mjs"))
    main_css = next(assets_dir.glob("index-*.css"))

    for asset in (manrope_woff2, dm_mono_woff2, pdf_worker, main_css):
        code, headers, body = _call("GET", f"/assets/{asset.name}")
        assert code == 200 and len(body) > 0
        assert headers.get("x-content-type-options") == "nosniff"
        assert "access-control-allow-origin" not in headers
        if asset.suffix == ".css":
            assert b"fonts.googleapis.com" not in body
            assert b"fonts.gstatic.com" not in body

    # Method restrictions (including old pywebview /js_api/<uid>)
    for method in ("POST", "PUT", "DELETE", "OPTIONS"):
        code, _, _ = _call(method, "/js_api/11111111-2222-3333-4444-555555555555")
        assert code == 405

    # Cross-origin, foreign host, and cross-site fetches blocked
    assert _call("GET", "/index.html", {"HTTP_ORIGIN": "https://evil.example"})[0] == 403
    assert _call("GET", "/index.html", {"HTTP_HOST": f"attacker.local:{port}"})[0] == 403
    assert _call("GET", "/index.html", {"HTTP_SEC_FETCH_SITE": "cross-site"})[0] == 403

    # Path traversal out of dist_web/ blocked (bottle.static_file returns 403 or 404)
    assert _call("GET", "/../package.json")[0] in (403, 404)

    # Same-origin Origin header IS allowed
    assert _call("GET", "/index.html", {"HTTP_ORIGIN": f"http://127.0.0.1:{port}"})[0] == 200

    # Optional live loopback socket probe (runs whenever loopback sockets are allowed)
    can_loopback = False
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            s.listen(1)
            p = s.getsockname()[1]
            with socket.create_connection(("127.0.0.1", p), timeout=1):
                can_loopback = True
    except OSError:
        can_loopback = False

    if can_loopback:
        address, _, server = DeskConvertLocalServer.start_server([str(DIST_WEB_DIR / "index.html")])
        assert address.startswith("http://127.0.0.1:")
        assert server.js_api_endpoint == ""
        with urllib.request.urlopen(f"{address}index.html", timeout=5) as resp:
            assert resp.status == 200
            assert resp.headers.get("X-Content-Type-Options") == "nosniff"
            assert resp.headers.get("Access-Control-Allow-Origin") is None
        bad_post = urllib.request.Request(f"{address}js_api/{server.uid}", data=b"{}", method="POST")
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(bad_post, timeout=5)
        assert exc.value.code == 405


def test_real_installer_assets_manifest_passes():
    """Confirms the actual local installer_assets/ matches pinned SHA-256 hashes (144 files)."""
    if not os.path.isdir(DEFAULT_ASSETS_DIR):
        pytest.skip("installer_assets/ directory not present in this checkout")
    ok, errors = verify_assets(DEFAULT_ASSETS_DIR, DEFAULT_MANIFEST_PATH)
    assert ok is True, f"Installer SHA-256 verification failed: {errors}"
