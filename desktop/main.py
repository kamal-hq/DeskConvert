import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from desktop.app import launch_desktop_app


def main() -> None:
    launch_desktop_app()


if __name__ == "__main__":
    main()
