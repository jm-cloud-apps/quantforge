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
async def run_formatter(date_str: str):
    """Run the formatter script for a given month, streaming output as SSE."""

    async def event_generator():
        proc = await asyncio.create_subprocess_exec(
            sys.executable, SCRIPT_PATH,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # Send the date string as input (the script does input(...))
        proc.stdin.write(f"{date_str}\n".encode())
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

        yield "data: __DONE__\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/run-daily")
async def run_daily():
    """Run the trade-log-formatter run_daily.py pipeline (fetch Gmail → format → summarize),
    streaming combined stdout/stderr as Server-Sent Events."""

    async def event_generator():
        script_dir = os.path.dirname(RUN_DAILY_PATH)
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, RUN_DAILY_PATH,
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
