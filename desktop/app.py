import logging
import os
import sys
import threading
import webbrowser
from typing import Optional
from urllib.parse import urlsplit

import bottle
import webview
import webview.http as webview_http

from desktop.bridge import DeskConvertBridge
from utils.validators import Validators

logger = logging.getLogger("deskconvert.desktop")


def _resource_root() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def is_allowed_app_url(url: str, allowed_origin: str) -> bool:
    """Returns True only if url stays on the local app origin or is about:blank."""
    raw = str(url or "").strip()
    if not raw or raw == "about:blank":
        return True
    try:
        target = urlsplit(raw)
        origin = urlsplit(allowed_origin)
    except Exception:
        return False
    return (
        target.scheme == origin.scheme
        and (target.hostname or "").lower() == (origin.hostname or "").lower()
        and target.port == origin.port
    )


def handle_navigation_attempt(uri: str, allowed_origin: str) -> bool:
    """
    Navigation policy for the Desktop WebView:
    - Returns True if the WebView may navigate to `uri` (same local origin or about:blank).
    - Otherwise returns False (block navigation). If `uri` matches the strict external
      allowlist (https://github.com/kamal-hq/DeskConvert), opens it in the default browser.
    """
    if is_allowed_app_url(uri, allowed_origin):
        return True
    if Validators.is_allowed_external_url(uri):
        webbrowser.open(uri.strip(), new=2)
    else:
        logger.warning("Blocked WebView navigation to disallowed URI: %s", uri)
    return False


class DeskConvertLocalServer(webview_http.BottleServer):
    """
    Hardened local static HTTP server for pywebview:
    - Omits BottleServer's `/js_api/<uid>` HTTP endpoint (and its `Access-Control-Allow-Origin: *`).
      On Windows Edge WebView2, JS <-> Python calls use in-process `chrome.webview.postMessage` only.
    - Binds strictly to 127.0.0.1 on a random ephemeral port.
    - Permits GET and HEAD only; rejects foreign Host/Origin and cross-site browser requests.
    - Emits strict anti-framing / anti-sniffing / CORP headers on all responses.
    """

    @staticmethod
    def build_wsgi_app(root_path: Optional[str], port: int) -> bottle.Bottle:
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        allowed_origin = f"http://127.0.0.1:{port}"

        app = bottle.Bottle()

        @app.hook("before_request")
        def _enforce_local_request_policy():
            if bottle.request.method not in ("GET", "HEAD"):
                bottle.abort(405, "Method Not Allowed")

            host = (bottle.request.headers.get("Host") or "").strip().lower()
            if host and host not in allowed_hosts:
                bottle.abort(403, "Forbidden Host")

            origin = (bottle.request.headers.get("Origin") or "").strip()
            if origin and origin.lower() != allowed_origin:
                bottle.abort(403, "Cross-origin access is forbidden")

            fetch_site = (bottle.request.headers.get("Sec-Fetch-Site") or "").strip().lower()
            if fetch_site == "cross-site":
                bottle.abort(403, "Cross-site request forbidden")

        def _apply_security_headers(resp: bottle.BaseResponse) -> bottle.BaseResponse:
            resp.set_header("Cache-Control", "no-cache, no-store, must-revalidate")
            resp.set_header("Pragma", "no-cache")
            resp.set_header("Expires", "0")
            resp.set_header("X-Content-Type-Options", "nosniff")
            resp.set_header("X-Frame-Options", "DENY")
            resp.set_header("Referrer-Policy", "no-referrer")
            resp.set_header("Cross-Origin-Resource-Policy", "same-origin")
            return resp

        @app.route("/", method=["GET", "HEAD"])
        def _root_index():
            if not root_path:
                bottle.abort(404, "Not Found")
            return _apply_security_headers(bottle.static_file("index.html", root=root_path))

        @app.route("/<file:path>", method=["GET", "HEAD"])
        def _static_asset(file: str):
            if not root_path:
                bottle.abort(404, "Not Found")
            return _apply_security_headers(bottle.static_file(file, root=root_path))

        return app

    @classmethod
    def start_server(
        cls,
        urls: list[str],
        http_port: Optional[int] = None,
        keyfile: None = None,
        certfile: None = None,
    ):
        from webview import _state
        from webview.util import abspath, is_local_url

        server = cls()
        local_urls = [u.split("#")[0] for u in urls if is_local_url(u)]
        common_path = os.path.commonpath(local_urls) if local_urls else None
        if common_path is not None and not os.path.isdir(abspath(common_path)):
            common_path = os.path.dirname(common_path)
        server.root_path = abspath(common_path) if common_path is not None else None
        server.port = http_port or webview_http._get_random_port()
        allowed_origin = f"http://127.0.0.1:{server.port}"

        app = cls.build_wsgi_app(server.root_path, server.port)
        server.app = app
        server.thread = threading.Thread(
            target=lambda: bottle.run(
                app=app,
                host="127.0.0.1",
                server=webview_http.ThreadedAdapter,
                port=server.port,
                quiet=not _state["debug"],
            ),
            daemon=True,
        )
        server.thread.start()

        server.running = True
        server.address = f"{allowed_origin}/"
        cls.common_path = common_path
        # Explicitly disable HTTP JS API endpoint advertising
        server.js_api_endpoint = ""
        return server.address, common_path, server


def _attach_navigation_guard(window: webview.Window, bridge: DeskConvertBridge) -> None:
    """Locks navigation to the local app origin and enforces the GitHub external allowlist."""
    allowed_origin = (window._url_prefix or "").rstrip("/")
    if not allowed_origin:
        return
    bridge.set_allowed_origin(allowed_origin)

    def _on_before_load() -> None:
        current = window.get_current_url() or ""
        if current and not is_allowed_app_url(current, allowed_origin):
            logger.warning("Reverting unauthorized WebView navigation: %s", current)
            window.load_url(f"{allowed_origin}/index.html")

    window.events.before_load += _on_before_load

    # Hook native WebView2 NavigationStarting & NewWindowRequested when running on Windows
    def _hook_native_webview2() -> None:
        try:
            native = getattr(window, "native", None)
            browser = getattr(native, "browser", None) if native is not None else None
            wv = getattr(browser, "webview", None) if browser is not None else None
            if wv is None:
                return

            def _on_nav_starting(_sender, args) -> None:
                uri = str(args.Uri)
                if not handle_navigation_attempt(uri, allowed_origin):
                    args.Cancel = True

            wv.NavigationStarting += _on_nav_starting

            core_wv2 = getattr(wv, "CoreWebView2", None)
            if core_wv2 is not None:
                def _on_new_window(_sender, args) -> None:
                    args.Handled = True
                    handle_navigation_attempt(str(args.Uri), allowed_origin)

                core_wv2.NewWindowRequested += _on_new_window
        except Exception as err:
            logger.debug("Native WebView2 navigation hook skipped: %s", err)

    window.events.loaded += _hook_native_webview2


def launch_desktop_app() -> None:
    root = _resource_root()
    index_html = os.path.join(root, "dist_web", "index.html")
    icon_path = os.path.join(root, "assets", "icon.ico")
    if not os.path.isfile(index_html):
        raise FileNotFoundError(
            f"Web bundle not found at {index_html}. Run 'npm run build' before launching desktop mode."
        )

    # Harden pywebview global settings before window creation
    webview.settings["ALLOW_FILE_URLS"] = False
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
    webview.settings["ALLOW_DOWNLOADS"] = False

    bridge = DeskConvertBridge()
    js_api = bridge.create_js_api()

    window = webview.create_window(
        title="DeskConvert — Local PDF & Image Studio",
        url=index_html,
        js_api=js_api,
        width=1320,
        height=840,
        min_size=(960, 640),
        background_color="#080a0c",
    )
    if window is not None:
        bridge.attach_window(window)
        window.events.initialized += lambda _renderer: _attach_navigation_guard(window, bridge)
        window.events.closed += bridge.cleanup

    webview.start(
        debug=False,
        http_server=True,
        server=DeskConvertLocalServer,
        icon=icon_path if os.path.isfile(icon_path) else None,
    )
