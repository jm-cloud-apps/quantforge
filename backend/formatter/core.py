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


def list_available_months() -> List[str]:
    """Return MM.YYYY folders under BASE_PATH_TRADES, newest first."""
    months = []
    if not os.path.isdir(BASE_PATH_TRADES):
        return months
    for name in os.listdir(BASE_PATH_TRADES):
        path = os.path.join(BASE_PATH_TRADES, name)
        if os.path.isdir(path) and re.match(r"^\d{2}\.\d{4}$", name):
            months.append(name)
    months.sort(key=lambda m: datetime.strptime(m, "%m.%Y"), reverse=True)
    return months
