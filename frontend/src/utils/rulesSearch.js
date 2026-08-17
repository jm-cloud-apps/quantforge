// Search across the Rules page.
//
// The page carries ~18k words over a dozen framework panels, and until now the
// only way to find "time stop" or "ADR" was to scroll. The index is built from
// the data module rather than from the DOM on purpose: a collapsed panel
// unmounts its content, so a DOM crawl would quietly stop finding anything the
// reader had folded away — exactly when search matters most.
//
// Entries are flattened to a common shape because the data uses whatever field
// names each framework needed (`title`, `label`, `name`, `pair`, `verdict`…).

import * as R from './tradingRules'

// panel id -> the exports that render inside it. Panel ids match SECTION_NAV
// and the DOM ids, so a hit can scroll straight to it.
const SOURCES = [
  ['ma-rails', 'MA Rails', [R.MA_RAILS, R.WEEKLY_RAILS, R.MA_CROSSOVERS, R.MA_ANATOMY_PHASES, R.MA_MOMENTS, R.MA_DRILLS]],
  ['volume', 'Volume', [R.VOLUME_PATTERNS, R.VOLUME_PHASES, R.VOLUME_METRICS, R.VOLUME_PACE]],
  ['candles', 'Candle Tells', [R.CANDLE_TELLS, R.GAP_TAXONOMY]],
  ['rail-candles', 'Candles × Rails', [R.RAIL_CANDLES, R.RAIL_TOUCH_LADDER]],
  ['exit', 'Exit — trend death', [R.TREND_DEATH_TELLS, R.RAIL_CASCADE_LADDER]],
  ['bases', 'Bases & Pivots', [R.BASE_PATTERNS, R.BASE_QUALITY, R.BASE_COUNT_LADDER, R.POLE_FORK, R.SETUP_MATRIX]],
  ['htf-setup', 'HTF Setup', [R.HTF_PRIOR_CHART, R.HTF_SETUP_GATE, R.HTF_SETUP_LADDER]],
  ['ep-setup', 'EP Setup', [R.EP_PRIOR_CHART, R.EP_CHART_GATE, R.EP_GAP_GATE, R.EP_NUMBERS, R.EP_NON_EARNINGS, R.EP_NUMBERS_LADDER]],
  ['catalysts', 'EP Catalysts', [R.CATALYST_HIERARCHY]],
  ['entries', 'Entries', [R.ENTRY_EP_TRIGGERS, R.ENTRY_HTF_TRIGGERS, R.ENTRY_MECHANICS, R.ENTRY_LADDER, R.ENTRY_SIZE_CAPS, R.ENTRY_REENTRY]],
  ['exits', 'Exits', [R.EXIT_TICKET, R.EXIT_MECHANICS, R.EXIT_LADDER]],
  ['lifecycle', 'Trade Lifecycle', [R.LIFECYCLE, R.EXPOSURE_LADDER]],
  ['short-side', 'Short Side', [R.SHORT_SIDE, R.SHORT_ARC_LADDER, R.SHORT_MIRROR]],
]

const TITLE_KEYS = ['title', 'label', 'name', 'pair', 'setup', 'reason', 'time']
const BODY_KEYS = [
  'rule', 'note', 'tagline', 'what', 'why', 'text', 'blurb', 'meaning', 'verdict',
  'value', 'price', 'when', 'holds', 'dies', 'want', 'avoid', 'test', 'means',
  'action', 'outcome', 'weight', 'breakRule', 'dailyNote', 'weeklyNote', 'rider',
  'explain', 'prompt', 'long', 'short', 'where', 'volume', 'hint', 'done',
]

function pick(obj, keys) {
  const out = []
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.trim()) out.push(v)
    else if (v && typeof v === 'object' && typeof v.text === 'string') out.push(v.text)
    else if (Array.isArray(v)) out.push(v.filter(x => typeof x === 'string').join(' '))
  }
  return out
}

function buildIndex() {
  const rows = []
  for (const [id, panel, groups] of SOURCES) {
    for (const group of groups) {
      if (!Array.isArray(group)) continue
      for (const item of group) {
        if (!item || typeof item !== 'object') continue
        const title = pick(item, TITLE_KEYS)[0] || panel
        const body = pick(item, BODY_KEYS).join(' · ')
        // Arrays of loose strings (checklists, examples) ride along too.
        const extra = Object.values(item)
          .filter(v => Array.isArray(v) && v.every(x => typeof x === 'string'))
          .flat().join(' ')
        rows.push({ id, panel, title, body, hay: `${title} ${body} ${extra}`.toLowerCase() })
      }
    }
  }
  return rows
}

// Built once at module load — the data is static for the session.
const INDEX = buildIndex()

export const RULES_INDEX_SIZE = INDEX.length

/** Ranked matches. Title hits outrank body hits; every term must appear. */
export function searchRules(query, limit = 12) {
  const q = (query || '').trim().toLowerCase()
  if (q.length < 2) return []
  const terms = q.split(/\s+/).filter(Boolean)

  const hits = []
  for (const row of INDEX) {
    if (!terms.every(t => row.hay.includes(t))) continue
    const title = row.title.toLowerCase()
    // Rank: whole phrase in the title, then any term in the title, then body.
    const score = title.includes(q) ? 0 : terms.some(t => title.includes(t)) ? 1 : 2
    hits.push({ ...row, score })
  }
  hits.sort((a, b) => a.score - b.score || a.title.length - b.title.length)
  return hits.slice(0, limit)
}

/** The matched fragment, with a little context either side. */
export function snippet(row, query, width = 90) {
  const q = (query || '').trim().toLowerCase().split(/\s+/)[0] || ''
  const body = row.body || ''
  const at = body.toLowerCase().indexOf(q)
  if (at < 0) return body.slice(0, width) + (body.length > width ? '…' : '')
  const start = Math.max(0, at - width / 3)
  const end = Math.min(body.length, start + width)
  return (start > 0 ? '…' : '') + body.slice(start, end).trim() + (end < body.length ? '…' : '')
}
