// Shared parameter sets for the screener's Dashboard-facing scans.
//
// The screener caches per FULL parameter tuple (mode, limit, dollar-vol, ADR,
// RVOL, day filter, every enrich flag, wide) — see the cache_key in
// screener/qullamaggie/router.py. A background warm job that differs in any one
// field therefore warms a key nobody ever reads, and the card still recomputes
// cold on every visit.
//
// That is exactly what had happened: the daily job warmed unusual_volume with
// `minAdr 0.015, wide:true, enrichBlocks:true`, while the Dashboard card asked
// for `minAdr 0.05, wide:false` — a different key, and a 226-name universe that
// returned a single row.
//
// So the presets live here and BOTH the Dashboard cards and the autorefresh jobs
// import them. Keeping them identical is now structural rather than a thing to
// remember.
//
// `wide` matters most: the volume-flavored modes gate on an RVOL surge today,
// and the curated universe (~226 names) almost never has more than one or two.
// The wide grouped universe is ~2300.

export const BREAKOUT_PRESETS = {
  volumeSurge: {
    mode: 'volume',
    limit: 24,
    minAdr: 0.05,
    minRvol: 1.5,
    wide: true,
  },
  unusualVolume: {
    mode: 'unusual_volume',
    limit: 24,
    minAdr: 0.05,
    minRvol: 2.0,
    dayFilter: 0,
    wide: true,
  },
  breakout: {
    mode: 'breakout',
    limit: 24,
    minAdr: 0.05,
    minRvol: 1.5,
  },
}
