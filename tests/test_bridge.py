import base64
import io
import os
import pytest
import pymupdf as fitz
from PIL import Image

from desktop.app import DeskConvertLocalServer, handle_navigation_attempt, is_allowed_app_url
from desktop.bridge import ALLOWED_JS_API_METHODS, DeskConvertBridge
from utils.settings import SettingsManager
from utils.validators import Validators


def _make_pdf(path: str, pages: int = 2) -> None:
    with fitz.open() as doc:
        for i in range(pages):
            p = doc.new_page(width=300, height=400)
            p.insert_text((40, 60), f"Bridge Page {i + 1}", fontsize=16)
        doc.save(path)


def test_desktop_bridge_workflows(tmp_path):
    out_dir = tmp_path / "exports"
    out_dir.mkdir()
    cfg = str(tmp_path / "settings.json")

    bridge = DeskConvertBridge()
    bridge.settings = SettingsManager(config_path=cfg)
    bridge.history.settings = bridge.settings
    bridge.settings.set_default_output_directory(str(out_dir))
    bridge.settings.set_quick_save_enabled(True)

    pdf_path = str(tmp_path / "sample.pdf")
    _make_pdf(pdf_path, pages=2)
    img_path = str(tmp_path / "pic.png")
    Image.new("RGB", (200, 150), (80, 130, 170)).save(img_path)
    (tmp_path / "ignore.txt").write_text("unsupported")

    try:
        staged = bridge.stage_paths([pdf_path, img_path, str(tmp_path / "ignore.txt")])
        assert len(staged["items"]) == 3
        assert staged["rejected"] == ["ignore.txt"]

        preview_url = bridge.get_full_res_preview(staged["items"][0]["sourceId"], 0)
        assert preview_url.startswith("data:image/png;base64,")

        # Export reordered storyboard (page 2, image, page 1) to merged PDF
        reordered = [
            {"sourceId": staged["items"][1]["sourceId"], "pageIndex": 1},
            {"sourceId": staged["items"][2]["sourceId"], "pageIndex": 0},
            {"sourceId": staged["items"][0]["sourceId"], "pageIndex": 0},
        ]
        merged = bridge.merge_files({
            "items": reordered,
            "watermarkEnabled": True,
            "metadataAction": "strip",
            "compressionBytes": None,
        })
        assert merged is not None
        assert os.path.isfile(merged["artifacts"][0]["savedPath"])

        # Export PDF pages to PNG
        imgs_out = bridge.export_pdf_to_images({
            "items": [reordered[0], reordered[2]],
            "format": "PNG",
            "dpi": 72,
            "watermarkEnabled": False,
            "metadataAction": "keep",
        })
        assert imgs_out is not None
        assert imgs_out["outputCount"] == 2

        # Split individual
        split_out = bridge.split_pdf({
            "items": reordered,
            "ranges": [{"id": "r1", "from": 1, "to": 2}],
            "mode": "individual",
            "watermarkEnabled": True,
            "metadataAction": "keep",
        })
        assert split_out is not None
        assert split_out["outputCount"] == 2

        # Upload drop simulation via base64
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        dropped = bridge.stage_uploaded_files([{"name": "dropped.png", "base64": b64}])
        assert len(dropped["items"]) == 1

        batch_out = bridge.batch_convert_images({
            "items": [{"sourceId": dropped["items"][0]["sourceId"], "pageIndex": 0}],
            "format": "WEBP",
            "watermarkEnabled": True,
            "metadataAction": "strip",
        })
        assert batch_out is not None
        assert batch_out["artifacts"][0]["fileName"].endswith(".webp")
    finally:
        bridge.cleanup()


def test_bridge_js_api_isolation_and_origin_enforcement(tmp_path):
    bridge = DeskConvertBridge()
    bridge.settings = SettingsManager(config_path=str(tmp_path / "settings.json"))
    bridge.history.settings = bridge.settings
    js_api = bridge.create_js_api()

    try:
        exposed = set(dir(js_api))
        assert exposed == ALLOWED_JS_API_METHODS
        # Internal objects & lifecycle methods MUST NOT be reachable via JS reflection
        for forbidden in ("window", "cache", "settings", "history", "attach_window", "cleanup", "_id_to_cached"):
            assert forbidden not in exposed
            with pytest.raises(AttributeError):
                getattr(js_api, forbidden)

        # Simulate origin enforcement when attached to a window
        class FakeWindow:
            def __init__(self, url: str):
                self._url = url

            def get_current_url(self) -> str:
                return self._url

        fake_win = FakeWindow("http://127.0.0.1:43210/index.html")
        bridge.attach_window(fake_win, allowed_origin="http://127.0.0.1:43210")
        assert js_api.get_app_info()["isDesktop"] is True

        # Navigating away to an untrusted origin blocks bridge calls
        fake_win._url = "https://evil.example/exploit.html"
        with pytest.raises(PermissionError):
            js_api.get_app_info()
    finally:
        bridge.cleanup()


def test_bridge_path_validation_reserved_names_and_external_allowlist(tmp_path):
    out_dir = tmp_path / "exports"
    out_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()

    bridge = DeskConvertBridge()
    bridge.settings = SettingsManager(config_path=str(tmp_path / "settings.json"))
    bridge.history.settings = bridge.settings
    bridge.settings.set_default_output_directory(str(out_dir))
    bridge.settings.set_quick_save_enabled(True)

    try:
        # UNC paths and traversal must be rejected
        with pytest.raises(ValueError):
            bridge.open_path(r"\\attacker-server\share\folder")
        with pytest.raises(ValueError):
            bridge.open_path(str(out_dir / ".." / "outside"))
        with pytest.raises(ValueError):
            bridge.open_path(str(outside_dir))

        # save_settings rejects UNC or traversal default output dir
        with pytest.raises(ValueError):
            bridge.save_settings({"defaultOutputDirectory": r"\\evil\share"})
        with pytest.raises(ValueError):
            bridge.save_settings({"defaultOutputDirectory": str(out_dir / ".." / "outside")})

        # Windows reserved names & traversal in uploaded filenames are safely sanitized
        img_path = tmp_path / "tiny.png"
        Image.new("RGB", (40, 40), (10, 20, 30)).save(img_path)
        b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")

        for bad_name in ("CON.png", "nul.png", "COM1.png", "..\\..\\LPT9.png", "dir/../../PRN.png"):
            res = bridge.stage_uploaded_files([{"name": bad_name, "base64": b64}])
            assert len(res["items"]) == 1
            staged_name = res["items"][0]["fileName"]
            assert staged_name.startswith("file_")
            assert ".." not in staged_name and "/" not in staged_name and "\\" not in staged_name

        # External URL allowlist
        assert Validators.is_allowed_external_url("https://github.com/kamal-hq/DeskConvert") is True
        assert Validators.is_allowed_external_url(
            "https://github.com/kamal-hq/DeskConvert/releases/latest/download/DeskConvert_Setup.exe"
        ) is True
        for blocked_url in (
            "http://github.com/kamal-hq/DeskConvert",
            "https://github.com/other-user/DeskConvert",
            "https://github.com/kamal-hq/DeskConvert/../other",
            "https://evil.example/phish",
            "javascript:alert(1)",
            "file:///C:/Windows/win.ini",
        ):
            assert Validators.is_allowed_external_url(blocked_url) is False
            with pytest.raises(ValueError):
                bridge.open_external_url(blocked_url)

        # Navigation policy
        assert is_allowed_app_url("http://127.0.0.1:5050/index.html", "http://127.0.0.1:5050") is True
        assert is_allowed_app_url("https://evil.example/", "http://127.0.0.1:5050") is False
        assert handle_navigation_attempt("https://evil.example/", "http://127.0.0.1:5050") is False
    finally:
        bridge.cleanup()


def test_hardened_local_http_server_blocks_js_api_and_cross_origin(tmp_path):
    static_dir = tmp_path / "web"
    static_dir.mkdir()
    index_file = static_dir / "index.html"
    index_file.write_text("<!doctype html><html><body>ok</body></html>", encoding="utf-8")

    port = 51234
    wsgi_app = DeskConvertLocalServer.build_wsgi_app(str(static_dir), port)

    def _call_wsgi(method: str, path: str, extra_headers: dict | None = None):
        status_box = {}
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
        if extra_headers:
            environ.update(extra_headers)

        def start_response(status, headers, _exc_info=None):
            status_box["code"] = int(status.split(" ", 1)[0])
            status_box["headers"] = {k.lower(): v for k, v in headers}

        body = b"".join(wsgi_app(environ, start_response))
        return status_box["code"], status_box["headers"], body

    # 1. Valid local GET succeeds with strict headers and NO wildcard CORS
    code, headers, body = _call_wsgi("GET", "/index.html")
    assert code == 200
    assert b"ok" in body
    assert headers.get("x-content-type-options") == "nosniff"
    assert headers.get("x-frame-options") == "DENY"
    assert headers.get("cross-origin-resource-policy") == "same-origin"
    assert "access-control-allow-origin" not in headers

    # 2. POST to /js_api/<uid> is rejected (405 Method Not Allowed) — route omitted completely
    code, _, _ = _call_wsgi("POST", "/js_api/any-uid")
    assert code == 405

    # 3. Cross-origin GET from a foreign website is rejected (403 Forbidden)
    code, _, _ = _call_wsgi("GET", "/index.html", {"HTTP_ORIGIN": "https://evil.example"})
    assert code == 403

    # 4. Foreign Host header (DNS rebinding) is rejected (403 Forbidden)
    code, _, _ = _call_wsgi("GET", "/index.html", {"HTTP_HOST": "evil.example:51234"})
    assert code == 403

    # 5. Cross-site Sec-Fetch-Site is rejected (403 Forbidden)
    code, _, _ = _call_wsgi("GET", "/index.html", {"HTTP_SEC_FETCH_SITE": "cross-site"})
    assert code == 403
