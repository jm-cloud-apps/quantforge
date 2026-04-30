"""Deterministic Qullamaggie Episodic Pivot scorer.

Pure functions — no I/O. Each criterion returns a uniform dict so the
frontend can render a checklist without case-specific logic.
"""

from __future__ import annotations

from typing import Optional


CATALYST_KEYWORDS: dict[str, list[str]] = {
    "Earnings": [
        "earnings", "eps", "revenue beat", "quarterly results", "blowout",
        "beats estimates", "tops expectations", "guidance raise",
    ],
    "FDA Approval": ["fda", "approval", "approved", "clearance", "phase 3", "trial results"],
    "Mergers & Acquisitions": ["acquisition", "acquire", "merger", "buyout", "takeover"],
    "Contract / Partnership": [
        "contract", "awarded", "partnership", "collaboration", "signed",
        "strategic partnership", "joint venture",
    ],
    "Analyst Upgrade": [
        "upgrade", "price target raise", "price target hike",
        "overweight", "outperform", "buy rating",
    ],
    "New Product": [
        "new product", "product launch", "launches", "unveils",
        "introduces", "breakthrough",
    ],
    "Strategic Investment": [
        "strategic investment", "takes stake", "invests in",
        "investment from", "anchor investor",
    ],
    "Government / Policy": [
        "regulation", "subsidy", "tariff", "executive order", "policy change",
    ],
    "Theme Play": [
        "artificial intelligence", "ai model", "machine learning",
        "electric vehicle", "ev battery", "quantum computing", "autonomous",
    ],
}

GRADE_THRESHOLDS = [
    (90, "A+"),
    (82, "A"),
    (70, "B"),
    (55, "C"),
    (40, "D"),
    (0,  "F"),
]

VERDICT_BY_GRADE = {
    "A+": "Strong EP candidate",
    "A":  "Strong EP candidate",
    "B":  "Watchlist",
    "C":  "Marginal",
    "D":  "Skip",
    "F":  "Skip",
}


def _criterion(name: str, points: float, max_pts: float, value, threshold: str, why: str) -> dict:
    return {
        "name": name,
        "points": round(points, 1),
        "max": max_pts,
        "passed": points >= max_pts * 0.6,
        "value": value,
        "threshold": threshold,
        "why": why,
    }


def classify_catalyst(headline: str) -> Optional[str]:
    text = (headline or "").lower()
    for label, keywords in CATALYST_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return label
    return None


def score_catalyst(news: list[dict], eps_surprise: Optional[dict]) -> dict:
    max_pts = 25
    points = 0.0
    eps_part = ""
    news_part = ""

    if eps_surprise and eps_surprise.get("actual") is not None and eps_surprise.get("estimate") is not None:
        if eps_surprise["actual"] > eps_surprise["estimate"]:
            points += 18
            sp = eps_surprise.get("surprisePercent")
            eps_part = f"EPS beat ({sp:+.1f}% surprise)" if sp is not None else "EPS beat"
        else:
            eps_part = "EPS miss"

    catalyst_type = None
    catalyst_news = None
    for article in news or []:
        ct = classify_catalyst(article.get("title", ""))
        if ct:
            catalyst_type = ct
            catalyst_news = article
            break

    if catalyst_type:
        points += 7
        news_part = f"recent {catalyst_type} headline"

    if not eps_part and not news_part:
        why = "No EPS beat and no EP-grade catalyst keywords in last 3 days"
    else:
        why = "; ".join(p for p in (eps_part, news_part) if p)

    crit = _criterion(
        "Catalyst quality", points, max_pts,
        value=catalyst_type or ("EPS beat" if eps_part.startswith("EPS beat") else "none"),
        threshold="EPS beat + game-changing news",
        why=why,
    )
    crit["catalyst"] = (
        {
            "headline": catalyst_news.get("title"),
            "source": catalyst_news.get("site"),
            "url": catalyst_news.get("url"),
            "published_at": catalyst_news.get("publishedDate"),
            "type": catalyst_type,
        }
        if catalyst_news
        else None
    )
    return crit


def score_gap(gap_pct: Optional[float]) -> dict:
    max_pts = 15
    if gap_pct is None:
        return _criterion("Gap size", 0, max_pts, "n/a", "10–30% sweet spot", "No gap data")
    g = abs(gap_pct)
    if g < 5:    pts, why = 3,  f"Gap {gap_pct:+.1f}% — below 5% is too quiet"
    elif g < 10: pts, why = 8,  f"Gap {gap_pct:+.1f}% — borderline (need 10%+)"
    elif g < 20: pts, why = 13, f"Gap {gap_pct:+.1f}% — strong"
    elif g < 40: pts, why = 15, f"Gap {gap_pct:+.1f}% — ideal EP zone"
    elif g < 50: pts, why = 12, f"Gap {gap_pct:+.1f}% — large but still tradeable"
    else:        pts, why = 8,  f"Gap {gap_pct:+.1f}% — extended, watch for reversion"
    return _criterion("Gap size", pts, max_pts, f"{gap_pct:+.1f}%", "10–30% ideal", why)


def score_volume(volume_ratio: Optional[float]) -> dict:
    max_pts = 15
    if volume_ratio is None:
        return _criterion("Volume surge", 0, max_pts, "n/a", "≥3× avg ideal", "No volume data")
    r = volume_ratio
    if r < 1.5:  pts, why = 2,  f"{r:.1f}× avg — no real buying"
    elif r < 3:  pts, why = 6,  f"{r:.1f}× avg — moderate"
    elif r < 5:  pts, why = 11, f"{r:.1f}× avg — strong"
    elif r < 10: pts, why = 15, f"{r:.1f}× avg — institutional-grade"
    else:        pts, why = 13, f"{r:.1f}× avg — blow-off, watch close"
    return _criterion("Volume surge", pts, max_pts, f"{r:.1f}×", "≥3× ideal", why)


def score_liquidity(dollar_volume: Optional[float]) -> dict:
    max_pts = 10
    if dollar_volume is None:
        return _criterion("Liquidity", 0, max_pts, "n/a", "≥$5M/day", "No volume data")
    dv = dollar_volume
    if dv < 1_000_000:    pts, why = 0, f"${dv/1e6:.1f}M — unfundable"
    elif dv < 5_000_000:  pts, why = 4, f"${dv/1e6:.1f}M — thin"
    elif dv < 20_000_000: pts, why = 8, f"${dv/1e6:.1f}M — adequate"
    else:                 pts, why = 10, f"${dv/1e6:.1f}M — institutional-grade"
    return _criterion("Liquidity", pts, max_pts, f"${dv/1e6:.1f}M", "≥$5M ideal", why)


def score_float(float_shares: Optional[float]) -> dict:
    max_pts = 10
    if float_shares is None:
        return _criterion("Float", 0, max_pts, "n/a", "<200M ideal", "No float data")
    f = float_shares
    if f < 50_000_000:       pts, why = 10, f"{f/1e6:.0f}M — low float, explosive"
    elif f < 200_000_000:    pts, why = 8,  f"{f/1e6:.0f}M — manageable"
    elif f < 1_000_000_000:  pts, why = 5,  f"{f/1e6:.0f}M — heavier"
    else:                    pts, why = 2,  f"{f/1e9:.1f}B — too heavy for explosive moves"
    return _criterion("Float", pts, max_pts, f"{f/1e6:.0f}M shares", "<200M ideal", why)


def score_market_cap(market_cap: Optional[float]) -> dict:
    max_pts = 5
    if market_cap is None:
        return _criterion("Market cap", 0, max_pts, "n/a", "$100M–$10B sweet spot", "No mkt cap data")
    mc = market_cap
    # Finnhub returns market cap in millions
    mc_dollars = mc * 1_000_000 if mc < 10_000_000 else mc
    if 100_000_000 <= mc_dollars <= 10_000_000_000:
        pts, why = 5, f"${mc_dollars/1e9:.1f}B — sweet spot"
    elif 10_000_000_000 < mc_dollars <= 50_000_000_000:
        pts, why = 3, f"${mc_dollars/1e9:.1f}B — large but still movable"
    else:
        pts, why = 1, f"${mc_dollars/1e9:.2f}B — outside ideal range"
    return _criterion("Market cap", pts, max_pts, f"${mc_dollars/1e9:.2f}B", "$100M–$10B ideal", why)


def score_adr(adr_pct: Optional[float]) -> dict:
    max_pts = 10
    if adr_pct is None:
        return _criterion("ADR%", 0, max_pts, "n/a", ">5% ideal", "No ADR data")
    a = adr_pct
    if a > 5:    pts, why = 10, f"{a:.1f}% — high volatility, EP-friendly"
    elif a > 3:  pts, why = 7,  f"{a:.1f}% — workable"
    elif a > 2:  pts, why = 4,  f"{a:.1f}% — sluggish"
    else:        pts, why = 1,  f"{a:.1f}% — too quiet to move"
    return _criterion("ADR% (20d)", pts, max_pts, f"{a:.1f}%", ">5% ideal", why)


def score_consolidation(prior_move_pct: Optional[float]) -> dict:
    max_pts = 10
    if prior_move_pct is None:
        return _criterion("Prior consolidation", 0, max_pts, "n/a", "≤10% prior 20d", "No price history")
    m = abs(prior_move_pct)
    if m <= 10: pts, why = 10, f"{prior_move_pct:+.1f}% prior 20d — coiled spring"
    elif m <= 20: pts, why = 6, f"{prior_move_pct:+.1f}% prior 20d — modest trend"
    elif m <= 30: pts, why = 3, f"{prior_move_pct:+.1f}% prior 20d — getting extended"
    else:         pts, why = 0, f"{prior_move_pct:+.1f}% prior 20d — extended, no base"
    return _criterion("Prior consolidation", pts, max_pts, f"{prior_move_pct:+.1f}%", "≤10% prior 20d", why)


def _grade(total: float) -> str:
    for cutoff, letter in GRADE_THRESHOLDS:
        if total >= cutoff:
            return letter
    return "F"


def score_ep(metrics: dict) -> dict:
    """Aggregate all criteria into a final grade."""
    catalyst = score_catalyst(metrics.get("news", []), metrics.get("eps_surprise"))
    criteria = [
        catalyst,
        score_gap(metrics.get("gap_pct")),
        score_volume(metrics.get("volume_ratio")),
        score_liquidity(metrics.get("dollar_volume")),
        score_float(metrics.get("float_shares")),
        score_market_cap(metrics.get("market_cap")),
        score_adr(metrics.get("adr_pct")),
        score_consolidation(metrics.get("prior_move_pct")),
    ]
    total = sum(c["points"] for c in criteria)
    grade = _grade(total)
    return {
        "criteria": criteria,
        "total_score": round(total, 1),
        "grade": grade,
        "verdict": VERDICT_BY_GRADE[grade],
        "catalyst": catalyst.get("catalyst"),
    }
