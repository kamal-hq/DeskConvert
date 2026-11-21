import os
import sys
import webview

from desktop.bridge import DeskConvertBridge


def _resource_root() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def launch_desktop_app() -> None:
    root = _resource_root()
    index_html = os.path.join(root, "dist_web", "index.html")
    icon_path = os.path.join(root, "assets", "icon.ico")
    if not os.path.isfile(index_html):
        raise FileNotFoundError(
            f"Web bundle not found at {index_html}. Run 'npm run build' before launching desktop mode."
        )

    bridge = DeskConvertBridge()
    window = webview.create_window(
        title="DeskConvert — Local PDF & Image Studio",
        url=index_html,
        js_api=bridge,
        width=1320,
        height=840,
        min_size=(960, 640),
        background_color="#080a0c",
    )
    if window is not None:
        bridge.attach_window(window)
        window.events.closed += bridge.cleanup

    webview.start(
        http_server=True,
        icon=icon_path if os.path.isfile(icon_path) else None,
    )
