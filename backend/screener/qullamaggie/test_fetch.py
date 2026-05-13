"""Quick sanity check: can we actually pull data from the configured provider?

Run from backend/ with venv active:
    python -m screener.qullamaggie.test_fetch
    QF_DATA_PROVIDER=yahoo python -m screener.qullamaggie.test_fetch
"""

import logging
import os

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

from dotenv import load_dotenv
load_dotenv()

from .cache import fetch_one

SAMPLES = ["AAPL", "NVDA", "IRDM", "PL", "LUNR"]

if __name__ == "__main__":
    print(f"Using provider: {os.getenv('QF_DATA_PROVIDER', 'massive')}")
    for sym in SAMPLES:
        df = fetch_one(sym, lookback_days=90)
        if df is None or df.empty:
            print(f"❌ {sym}: failed")
        else:
            last = df.iloc[-1]
            print(f"✅ {sym}: {len(df)} bars, last close {last['close']:.2f} on {df.index[-1].date()}")
