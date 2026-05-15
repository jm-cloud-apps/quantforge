"""FastAPI router for the Trade Log Formatter — runs the original script as a
subprocess and streams its stdout/stderr to the frontend via SSE."""

import asyncio
import subprocess
import sys

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

import os

from .core import list_available_months, SCRIPT_PATH, RUN_DAILY_PATH

router = APIRouter(prefix="/api/formatter", tags=["formatter"])


@router.get("/months")
async def get_available_months():
    """Return available MM.YYYY month folders, newest first."""
    return {"months": list_available_months()}


@router.post("/run/{date_str}")
async def run_formatter(date_str: str, confirm: str = "no"):
    """Run the formatter script for a given month, streaming output as SSE.

    The script prompts twice via input():
      1. month folder  → we pipe `date_str`
      2. "Apply these changes? (y/N):" → we pipe `y` or `n` based on `confirm`

    The default `confirm=no` performs a safe dry-run preview (the script
    exits without writing). The frontend then re-runs with `confirm=yes`
    after the user clicks "Apply changes" on the preview.
    """

    apply = (confirm or "").strip().lower() in ("yes", "y", "true", "1")
    response = "y\n" if apply else "n\n"

    async def event_generator():
        proc = await asyncio.create_subprocess_exec(
            sys.executable, SCRIPT_PATH,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # Pre-feed both prompts and close stdin — the script reads them in
        # order. With both lines buffered the script never hits EOF.
        proc.stdin.write(f"{date_str}\n{response}".encode())
        await proc.stdin.drain()
        proc.stdin.close()

        # Stream stdout line by line
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip("\n")
            safe = text.replace("\n", "\\n")
            yield f"data: {safe}\n\n"

        await proc.wait()

        if proc.returncode != 0:
            yield f"data: __ERROR__Script exited with code {proc.returncode}\n\n"

        # Signal preview-vs-applied to the client so it can decide whether
        # to show the "Apply changes" button.
        yield f"data: __MODE__{'applied' if apply else 'preview'}\n\n"
        yield "data: __DONE__\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/run-daily/{month}")
async def run_daily(month: str):
    """Run the trade-log-formatter run_daily.py pipeline (fetch Gmail → format → summarize)
    for the given MM.YYYY month, streaming combined stdout/stderr as Server-Sent Events."""

    async def event_generator():
        script_dir = os.path.dirname(RUN_DAILY_PATH)
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, RUN_DAILY_PATH, "--month", month,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=script_dir,
            )
        except FileNotFoundError as e:
            yield f"data: __ERROR__Could not launch run_daily.py: {e}\n\n"
            yield "data: __DONE__\n\n"
            return

        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip("\n")
            safe = text.replace("\n", "\\n")
            yield f"data: {safe}\n\n"

        await proc.wait()

        if proc.returncode != 0:
            yield f"data: __ERROR__run_daily exited with code {proc.returncode}\n\n"

        yield "data: __DONE__\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/reset")
async def reset_formatter():
    """Run the formatter script with RESET + confirmation, streaming output as SSE."""

    async def event_generator():
        proc = await asyncio.create_subprocess_exec(
            sys.executable, SCRIPT_PATH,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # Send "RESET" then "y" to confirm
        proc.stdin.write(b"RESET\ny\n")
        await proc.stdin.drain()
        proc.stdin.close()

        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip("\n")
            safe = text.replace("\n", "\\n")
            yield f"data: {safe}\n\n"

        await proc.wait()

        if proc.returncode != 0:
            yield f"data: __ERROR__Script exited with code {proc.returncode}\n\n"

        yield "data: __DONE__\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
