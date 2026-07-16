import { refreshBreadth } from '../api/breadth'
import { refreshWatchlist } from '../api/watchlists'
import { getEarnings } from '../api/calendar'
import { getEdgeValidation } from '../api/edgeValidation'
import { getFactorModel } from '../api/factorModel'
import { getReversalScan } from '../api/reversal'
import { get9MScan } from '../api/scanner9m'
import { getStageScan } from '../api/stageAnalysis'
import { getMAReclaimScan } from '../api/maReclaim'
import { getSetupsBoard } from '../api/setupsBoard'
import { getThemeRadarAnalysis } from '../api/themeRadar'
import { getSectorPerformance } from '../api/screener'

// Static catalog of pages whose server-side cache can be warmed in the
// background once a day. Each job's run() calls the SAME endpoint the page's
// Refresh button hits (with force/fresh so it actually rebuilds the cache) —
// using that page's DEFAULT filters, since that's the state the page opens in.
//
// These are intentionally module-level, NOT registered when a page mounts: the
// whole point is to warm pages you HAVEN'T opened yet, so a job can't depend on
// its page component being alive. Add a page here and drop a
// <RefreshControl jobId="…" /> into its header to wire it up.
//
// Auto is ON by default for every job listed here (see AutoRefreshProvider).
export const AUTO_REFRESH_JOBS = [
  {
    id: 'breadth',
    label: 'Market breadth',
    // One shared cache behind both Market Monitor and Trade Today (Situational
    // Awareness) — a single job, surfaced on both pages.
    hint: 'Pulls any missing trading days into the breadth cache.',
    run: () => refreshBreadth({ lookbackDays: 130 }),
  },
  {
    id: 'watchlist',
    label: 'Watchlist prices',
    hint: 'Re-prices every watchlist ticker.',
    run: () => refreshWatchlist(),
  },
  {
    id: 'earnings',
    label: 'Earnings calendar',
    hint: 'Rebuilds the upcoming-earnings calendar.',
    run: () => getEarnings({ days: 5, force: true }),
  },
  {
    id: 'edge-validation',
    label: 'Edge validation',
    hint: 'Replays the setup edge over the default 10-day horizon.',
    run: () => getEdgeValidation({ horizon: 10, force: true }),
  },
  {
    id: 'factor-model',
    label: 'Factor model',
    hint: 'Recomputes the factor-model ranking.',
    run: () => getFactorModel({ force: true }),
  },
  {
    id: 'reversal-setup',
    label: 'Reversal scan',
    hint: 'Re-runs the fresh-low reversal scan.',
    run: () => getReversalScan({ requireStrongTail: false, requireGreen: false, force: true }),
  },
  {
    id: 'scanner-9m',
    label: '$9M scanner',
    hint: 'Re-runs the $9M liquidity scan.',
    run: () => get9MScan({ requireCompression: false, requireNotLate: false, force: true }),
  },
  {
    id: 'stage-analysis',
    label: 'Stage analysis',
    hint: 'Re-runs the Weinstein stage scan.',
    run: () => getStageScan({ force: true }),
  },
  {
    id: 'ma-reclaim',
    label: '200 MA reclaim',
    hint: 'Re-runs the 200-day MA reclaim scan.',
    run: () => getMAReclaimScan({ requireMaTurning: false, requireRs: false, excludeExtended: false, force: true }),
  },
  {
    id: 'theme-radar',
    label: 'Theme radar',
    hint: 'Refreshes the theme-rotation read.',
    run: () => getThemeRadarAnalysis({ fresh: true }),
  },
  {
    id: 'screener',
    label: 'Sector performance',
    hint: 'Refreshes the sector-performance screener.',
    run: () => getSectorPerformance({ forceRefresh: true }),
  },
  {
    // Last on purpose: the board aggregates the scanner caches above, so it warms
    // after they do. force:false — it reads their just-warmed caches (and pulls the
    // breakouts lane, which has no job of its own) rather than re-forcing them.
    id: 'setups-board',
    label: 'Setups board',
    hint: 'Re-aggregates the Find-Setups board from each scanner’s cache.',
    run: () => getSetupsBoard({ force: false }),
  },
]

export const JOB_BY_ID = Object.fromEntries(AUTO_REFRESH_JOBS.map((j) => [j.id, j]))
