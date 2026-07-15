"""Shared security guards for file endpoints (extracted from main.py).

- `_enforce_upload_limit` caps upload size (25 MB → HTTP 413).
- `_safe_within` resolves a filename inside a base dir, rejecting path-traversal
  (absolute paths, `..`, symlink escapes).

main.py and the file-serving routers (e.g. playbook_router) both import these so
every upload / serve endpoint enforces the same limits. See SECURITY.md.
"""

import os

from fastapi import HTTPException


MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — trade workbooks / screenshots are far smaller


def _enforce_upload_limit(contents: bytes, kind: str = "File") -> None:
    """Reject an upload larger than MAX_UPLOAD_BYTES with a clean 413."""
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"{kind} too large ({len(contents) // (1024 * 1024)} MB). "
                   f"Max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )


def _safe_within(base_dir: str, filename: str) -> str:
    """Resolve `filename` inside `base_dir`, rejecting anything that escapes it
    (absolute paths, `..`, symlinks). Starlette's {filename} path param already
    excludes slashes, but validating the resolved path is cheap and keeps this
    correct if the route or server ever changes."""
    base = os.path.realpath(base_dir)
    target = os.path.realpath(os.path.join(base, filename))
    if target != base and not target.startswith(base + os.sep):
        raise HTTPException(status_code=400, detail="Invalid filename")
    return target
