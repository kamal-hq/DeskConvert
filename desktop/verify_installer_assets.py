"""
Verifies pinned SHA-256 checksums for bundled Windows installer assets
(installer_assets/tesseract-installer.exe and installer_assets/poppler/bin/*)
before packaging DeskConvert_Setup.exe via Inno Setup.

Usage:
    python desktop/verify_installer_assets.py            # Verify all assets (exit 0 on match, 1 on mismatch)
    python desktop/verify_installer_assets.py --generate # Regenerate desktop/installer_checksums.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Dict, List, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ASSETS_DIR = os.path.join(REPO_ROOT, "installer_assets")
DEFAULT_MANIFEST_PATH = os.path.join(REPO_ROOT, "desktop", "installer_checksums.json")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_assets(assets_dir: str) -> Dict[str, Dict[str, object]]:
    entries: Dict[str, Dict[str, object]] = {}
    for root, _, filenames in os.walk(assets_dir):
        for name in sorted(filenames):
            full_path = os.path.join(root, name)
            rel_path = os.path.relpath(full_path, assets_dir).replace("\\", "/")
            entries[rel_path] = {
                "size": os.path.getsize(full_path),
                "sha256": sha256_file(full_path),
            }
    return dict(sorted(entries.items()))


def verify_assets(
    assets_dir: str = DEFAULT_ASSETS_DIR,
    manifest_path: str = DEFAULT_MANIFEST_PATH,
) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    if not os.path.isfile(manifest_path):
        return False, [f"Checksum manifest not found: {manifest_path}"]
    if not os.path.isdir(assets_dir):
        return False, [f"Installer assets directory not found: {assets_dir}"]

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    expected: Dict[str, Dict[str, object]] = manifest.get("files", {})
    if not expected:
        return False, ["Checksum manifest contains no pinned files."]

    actual = scan_assets(assets_dir)

    for rel_path, meta in expected.items():
        if rel_path not in actual:
            errors.append(f"MISSING asset: {rel_path}")
            continue
        if actual[rel_path]["sha256"] != meta["sha256"]:
            errors.append(
                f"SHA-256 MISMATCH for {rel_path}: expected {meta['sha256']}, got {actual[rel_path]['sha256']}"
            )
        if actual[rel_path]["size"] != meta["size"]:
            errors.append(
                f"SIZE MISMATCH for {rel_path}: expected {meta['size']}, got {actual[rel_path]['size']}"
            )

    for rel_path in actual:
        if rel_path not in expected:
            errors.append(f"UNEXPECTED unpinned asset present: {rel_path}")

    return len(errors) == 0, errors


def generate_manifest(
    assets_dir: str = DEFAULT_ASSETS_DIR,
    manifest_path: str = DEFAULT_MANIFEST_PATH,
) -> Dict[str, object]:
    files = scan_assets(assets_dir)
    manifest = {
        "schema_version": 1,
        "description": "Pinned SHA-256 checksums for bundled Tesseract OCR installer and Poppler binaries.",
        "file_count": len(files),
        "files": files,
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    return manifest


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify pinned SHA-256 hashes of DeskConvert installer assets.")
    parser.add_argument("--generate", action="store_true", help="Generate/update desktop/installer_checksums.json")
    parser.add_argument("--assets-dir", default=DEFAULT_ASSETS_DIR, help="Path to installer_assets directory")
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST_PATH, help="Path to checksum manifest JSON")
    args = parser.parse_args(argv)

    if args.generate:
        manifest = generate_manifest(args.assets_dir, args.manifest)
        print(f"Generated SHA-256 manifest with {manifest['file_count']} pinned files at {args.manifest}")
        return 0

    ok, errors = verify_assets(args.assets_dir, args.manifest)
    if ok:
        with open(args.manifest, "r", encoding="utf-8") as f:
            count = json.load(f).get("file_count", 0)
        print(f"OK: Verified SHA-256 checksums for all {count} bundled installer asset(s).")
        return 0

    print("ERROR: Installer asset SHA-256 verification failed:", file=sys.stderr)
    for err in errors:
        print(f"  - {err}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
