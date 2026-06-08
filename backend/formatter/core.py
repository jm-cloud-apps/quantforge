"""Trade Log Formatter — thin wrapper that calls the original script as a subprocess.

The actual logic lives in the standalone trade-log-formatter repo.
This module just provides helpers for the FastAPI router.
"""

import os
import re
from datetime import datetime
from typing import List

BASE_PATH_TRADES = os.getenv(
    "TRADES_BASE_PATH",
    "/Users/michaeljacinto/Library/CloudStorage/OneDrive-Personal/Desktop - onedrive/trades",
)

SCRIPT_PATH = os.getenv(
    "FORMATTER_SCRIPT_PATH",
    "/Users/michaeljacinto/Library/CloudStorage/OneDrive-Personal/Desktop - onedrive/github/trade-log-formatter/trade-log-formatter.py",
)

RUN_DAILY_PATH = os.getenv(
    "RUN_DAILY_SCRIPT_PATH",
    "/Users/michaeljacinto/Library/CloudStorage/OneDrive-Personal/Desktop - onedrive/github/trade-log-formatter/run_daily.py",
)


def current_month_folder() -> str:
    """MM.YYYY name for the current month, e.g. '06.2026'."""
    return datetime.now().strftime("%m.%Y")


def ensure_current_month_folder() -> str:
    """Create trades/MM.YYYY for the current month if it doesn't exist yet.

    Keeps the month picker honest at a month rollover: the new month's folder
    appears (and becomes the default) before the first IB report lands in it,
    so the daily pipeline runs against the right month instead of last month's.
    Returns the MM.YYYY name. Best-effort — never raises into the request path.
    """
    name = current_month_folder()
    try:
        os.makedirs(os.path.join(BASE_PATH_TRADES, name), exist_ok=True)
    except OSError:
        pass
    return name


def list_available_months() -> List[str]:
    """Return MM.YYYY folders under BASE_PATH_TRADES, newest first.

    Always guarantees the current month is present (creating its folder if
    needed) so the UI can default to it even on the 1st of the month.
    """
    ensure_current_month_folder()
    months = []
    if not os.path.isdir(BASE_PATH_TRADES):
        return months
    for name in os.listdir(BASE_PATH_TRADES):
        path = os.path.join(BASE_PATH_TRADES, name)
        if os.path.isdir(path) and re.match(r"^\d{2}\.\d{4}$", name):
            months.append(name)
    months.sort(key=lambda m: datetime.strptime(m, "%m.%Y"), reverse=True)
    return months
