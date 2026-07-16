"""Security guards — the path-traversal and upload-size checks that protect every
file-serving / upload endpoint. Now that they live in security.py, pin them down.
"""

import os

import pytest
from fastapi import HTTPException

from security import _safe_within, _enforce_upload_limit, MAX_UPLOAD_BYTES


def test_safe_within_allows_a_plain_filename(tmp_path):
    resolved = _safe_within(str(tmp_path), "chart.png")
    assert resolved == os.path.realpath(os.path.join(str(tmp_path), "chart.png"))


@pytest.mark.parametrize("evil", [
    "../secrets.env",
    "../../etc/passwd",
    "/etc/passwd",
    "sub/../../escape.txt",
])
def test_safe_within_rejects_escapes(tmp_path, evil):
    with pytest.raises(HTTPException) as exc:
        _safe_within(str(tmp_path), evil)
    assert exc.value.status_code == 400


def test_safe_within_rejects_symlink_escape(tmp_path):
    base = tmp_path / "base"
    base.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("nope")
    try:
        (base / "link").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not supported here")
    with pytest.raises(HTTPException):
        _safe_within(str(base), "link/secret.txt")


def test_upload_limit_allows_small_payloads():
    _enforce_upload_limit(b"x" * 1024)          # no raise


def test_upload_limit_rejects_oversized_payloads():
    with pytest.raises(HTTPException) as exc:
        _enforce_upload_limit(b"x" * (MAX_UPLOAD_BYTES + 1), kind="Screenshot")
    assert exc.value.status_code == 413
