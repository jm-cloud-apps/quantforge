"""App-boot + route-registration guard.

Importing `main` builds the whole FastAPI app (every router included). This test
fails if the app can't import or if any critical route stops being registered —
which is exactly the safety net for moving endpoints out of main.py into routers:
the paths must stay identical no matter where the handler lives.
"""

import importlib


def _app_paths():
    main = importlib.import_module("main")
    return {getattr(r, "path", None) for r in main.app.routes}


def test_app_imports_cleanly():
    main = importlib.import_module("main")
    assert main.app is not None


def test_critical_routes_are_registered():
    paths = _app_paths()
    required = [
        # Find-Setups scanners (extraction target — must survive the refactor)
        "/api/scanner/9m",
        "/api/scanner/reversal",
        "/api/scanner/stage",
        "/api/scanner/ma-reclaim",
        "/api/scanner/parabolic",
        "/api/scanner/breakdown",
        "/api/setups/board",
        # Extracted CRUD routers (journal_router / playbook_router)
        "/api/journal/entries",
        "/api/journal/stats",
        "/api/journal/calendar",       # stayed in main.py — must still be here
        "/api/playbook/entries",
        "/api/playbook/screenshots/{filename}",
        # Trade analytics (trading_analysis_router; parsing core in trade_data.py)
        "/api/trading-analysis/load-default",
        "/api/trading-analysis/file-status",
        # Backtesting (backtest_router)
        "/api/strategies",
        "/api/backtest/run",
        "/api/backtest/breakout",
        # Research/validation + tools routers
        "/api/analyze/factors",
        "/api/analyze/edge-validation",
        "/api/tools/position-size",
        "/api/tools/checklist/template",
        # Sector-performance + news / per-ticker analysis routers
        "/api/screener/sector-performance",
        "/api/news",
        "/api/news/cache",
        "/api/movers",
        "/api/analysis/premarket/{ticker}",
        "/api/analysis/qulla-ep/{ticker}",
        # A few load-bearing endpoints from elsewhere in the app
        "/api/breadth/situational",
        "/api/breadth/snapshot",
        "/api/breadth/signal-scorecard",
        "/api/breadth/calibration",
        # Pre-market prep (prep_router)
        "/api/prep/leaders",
        "/api/prep/session",
        "/api/screener/qullamaggie",
        "/api/trade-plans",
        # Discipline / process analytics (discipline_router)
        "/api/discipline/scorecard",
        "/api/discipline/today",
        # Missed Book — the omission side of the loop (missed_router)
        "/api/missed/entries",
        "/api/missed/summary",
        "/api/missed/price-check",
        "/api/missed/screenshots/{filename}",
    ]
    missing = [p for p in required if p not in paths]
    assert not missing, f"routes missing from the app: {missing}"
