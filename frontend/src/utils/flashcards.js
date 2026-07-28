// Flashcard decks for the /rules content.
//
// Cards are DERIVED from the same data modules the Rules page renders, never
// re-typed. That matters for two reasons: the deck is exhaustive by
// construction (every framework item becomes a card), and editing a rule in
// tradingRules.js updates the study material automatically — there is no second
// copy of the content to drift.
//
// Card direction is deliberately "recognition": the front is what you'd
// actually SEE on a chart, the back is what it's called and what to DO. That's
// the direction the skill is used in. Ladder-shaped data (situation → verdict)
// already has that shape natively.
//
// Card shape:
//   { id, deck, kicker, front, answer, detail?, rule?, bullets? }

import {
  CATEGORIES,
  loadRules,
  CATALYST_HIERARCHY,
  MA_RAILS, WEEKLY_RAILS, MA_CROSSOVERS, MA_ANATOMY_PHASES, MA_DRILLS, MA_MOMENTS,
  VOLUME_PHASES, VOLUME_PATTERNS, VOLUME_METRICS,
  CANDLE_TELLS, GAP_TAXONOMY,
  RAIL_CANDLES, RAIL_TOUCH_LADDER,
  TREND_DEATH_TELLS, RAIL_CASCADE_LADDER,
  BASE_PATTERNS, BASE_QUALITY, BASE_COUNT_LADDER,
  LIFECYCLE, EXPOSURE_LADDER,
  SHORT_MIRROR, SHORT_SIDE, SHORT_ARC_LADDER,
} from './tradingRules'

// ── generic builders ────────────────────────────────────────────────────────

// what / why / rule items (volume patterns, candle tells, rail candles, base
// patterns, lifecycle phases, short-side steps). Front = the observation.
const fromSignal = (deck, arr, kicker = 'You see this') =>
  arr.map(x => ({
    id: `${deck}:${x.key}`,
    deck,
    kicker,
    front: x.what,
    answer: x.title,
    detail: x.why,
    rule: x.rule,
    tagline: x.tagline,
  }))

// label / verdict / note ladders — already a situation→verdict pair.
const fromLadder = (deck, arr, kicker = 'The situation') =>
  arr.map(x => ({
    id: `${deck}:${x.key}`,
    deck,
    kicker,
    front: x.label,
    answer: x.verdict,
    detail: x.note,
  }))

// label / value / note threshold strips.
const fromMetric = (deck, arr, kicker = 'The threshold') =>
  arr.map(x => ({
    id: `${deck}:${x.key}`,
    deck,
    kicker,
    front: `${x.label} — what's the number?`,
    answer: x.value,
    detail: x.note,
  }))

// ── per-deck card generation ────────────────────────────────────────────────

function maRailsCards() {
  const deck = 'ma-rails'
  return [
    // The three daily rails — role, who rides it, and the invalidation.
    ...MA_RAILS.map(r => ({
      id: `${deck}:rail-${r.key}`,
      deck,
      kicker: 'Daily rail',
      front: `The ${r.period}-day ${r.type} — who rides it, and what breaks it?`,
      answer: r.tagline,
      detail: r.rider,
      bullets: r.daily,
      rule: `Break rule — ${r.breakRule}`,
    })),
    // Weekly rails — context, not execution.
    ...WEEKLY_RAILS.map(r => ({
      id: `${deck}:wk-${r.key}`,
      deck,
      kicker: 'Weekly rail',
      front: `The ${r.period}-week ${r.type} — what job does it do?`,
      answer: r.tagline,
      detail: r.rider,
      bullets: r.lines,
      rule: `When it breaks — ${r.breakRule}`,
    })),
    // Crossovers — does the cross change the trade?
    ...MA_CROSSOVERS.map(c => ({
      id: `${deck}:cross-${c.key}`,
      deck,
      kicker: `Crossover · ${c.scope}`,
      front: `${c.pair} — ${c.title}. Does it change the trade?`,
      answer: c.verdict.label,
      detail: c.meaning,
      rule: c.verdict.text,
    })),
    // The lifecycle phases of one trade, read off the rails.
    ...MA_ANATOMY_PHASES.map(p => ({
      id: `${deck}:phase-${p.key}`,
      deck,
      kicker: `Trade anatomy · phase ${p.n}`,
      front: `${p.title} — what's happening, and what do you do?`,
      answer: p.text,
    })),
    // "What am I doing right now?" checklists.
    ...MA_MOMENTS.map(m => ({
      id: `${deck}:moment-${m.key}`,
      deck,
      kicker: 'Workflow moment',
      front: `${m.label} (${m.hint}) — what's the checklist?`,
      answer: `Timeframe: ${m.timeframe}`,
      bullets: m.checklist,
    })),
    // The existing rail drills, reused verbatim as scenario cards.
    ...MA_DRILLS.map(d => ({
      id: `${deck}:drill-${d.key}`,
      deck,
      kicker: 'Scenario',
      front: d.prompt,
      answer: (d.options.find(o => o.correct) || {}).text || '—',
      detail: d.explain,
    })),
  ]
}

function volumeCards() {
  const deck = 'volume'
  return [
    ...fromSignal(deck, VOLUME_PATTERNS),
    ...fromMetric(deck, VOLUME_METRICS),
    ...VOLUME_PHASES.map(p => ({
      id: `${deck}:phase-${p.key}`,
      deck,
      kicker: `Volume arc · phase ${p.n}`,
      front: `${p.title} — what does this phase tell you?`,
      answer: p.text,
    })),
  ]
}

function candleCards() {
  const deck = 'candles'
  return [
    ...fromSignal(deck, CANDLE_TELLS),
    ...GAP_TAXONOMY.map(g => ({
      id: `${deck}:gap-${g.key}`,
      deck,
      kicker: 'Which gap is it?',
      front: `A gap up ${g.where.toLowerCase()} — which gap, and what do you do?`,
      answer: `${g.label} → ${g.verdict}`,
      detail: g.note,
    })),
  ]
}

function railCandleCards() {
  const deck = 'rail-candles'
  return [
    ...fromSignal(deck, RAIL_CANDLES),
    ...fromLadder(deck, RAIL_TOUCH_LADDER, 'Rail touch · the 4:00 PM close'),
  ]
}

function exitCards() {
  const deck = 'exit'
  return [
    ...TREND_DEATH_TELLS.map(t => ({
      id: `${deck}:tell-${t.key}`,
      deck,
      kicker: 'Shakeout or trend death?',
      front: `${t.title} — how does this tell separate a shakeout from a dead trend?`,
      answer: t.tagline,
      bullets: [`Shakeout (hold): ${t.holds}`, `Trend death (exit): ${t.dies}`],
      detail: t.why,
    })),
    ...fromLadder(deck, RAIL_CASCADE_LADDER, 'Rails failing in sequence'),
  ]
}

function baseCards() {
  const deck = 'bases'
  return [
    ...fromSignal(deck, BASE_PATTERNS),
    ...fromMetric(deck, BASE_QUALITY, 'Base quality gate'),
    ...fromLadder(deck, BASE_COUNT_LADDER, 'Base count'),
  ]
}

function catalystCards() {
  const deck = 'catalysts'
  return CATALYST_HIERARCHY.map(c => ({
    id: `${deck}:tier-${c.tier}`,
    deck,
    kicker: `Catalyst tier ${c.tier}`,
    front: `Tier ${c.tier} — name it, and what qualifies?`,
    answer: c.name,
    detail: c.blurb,
    bullets: c.examples,
  }))
}

function lifecycleCards() {
  const deck = 'lifecycle'
  return [
    ...fromSignal(deck, LIFECYCLE, 'Where the trade is'),
    ...fromLadder(deck, EXPOSURE_LADDER, 'Exposure — how big?'),
  ]
}

function shortCards() {
  const deck = 'short-side'
  return [
    ...fromSignal(deck, SHORT_SIDE),
    ...fromLadder(deck, SHORT_ARC_LADDER, 'Where in the short arc'),
    ...SHORT_MIRROR.map((m, i) => ({
      id: `${deck}:mirror-${i}`,
      deck,
      kicker: 'Mirror the long rule',
      front: `Long side: ${m.long} — what's the short-side mirror?`,
      answer: m.short,
    })),
  ]
}

// Your own codified rules, as cloze recall — the cue is the opening of the rule
// and the answer is the whole thing. If you can't finish your own rule from its
// first few words, it isn't operating on you when it matters.
function myRuleCards() {
  const deck = 'my-rules'
  let rules = []
  try {
    rules = loadRules() || []
  } catch {
    rules = []
  }
  return rules.map((r, i) => {
    const words = String(r.text || '').split(/\s+/).filter(Boolean)
    const cut = Math.max(2, Math.ceil(words.length * 0.45))
    const cue = words.slice(0, cut).join(' ')
    return {
      id: `${deck}:${r.id ?? i}`,
      deck,
      kicker: `Your rule · ${r.category}`,
      front: `Finish the rule: “${cue}…”`,
      answer: r.text,
      detail: CATEGORIES.includes(r.category) ? `Category: ${r.category}` : undefined,
    }
  })
}

// ── deck catalog ────────────────────────────────────────────────────────────
// `tone` keys match the Rules page section nav so the two read as one system.

export const DECKS = [
  { id: 'ma-rails',     label: 'MA Rails',        tone: 'cyan',    build: maRailsCards },
  { id: 'volume',       label: 'Volume',          tone: 'accent',  build: volumeCards },
  { id: 'candles',      label: 'Candles',         tone: 'warning', build: candleCards },
  { id: 'rail-candles', label: 'Candles × Rails', tone: 'purple',  build: railCandleCards },
  { id: 'exit',         label: 'Exit',            tone: 'danger',  build: exitCards },
  { id: 'bases',        label: 'Bases',           tone: 'accent',  build: baseCards },
  { id: 'catalysts',    label: 'EP Catalysts',    tone: 'accent',  build: catalystCards },
  { id: 'lifecycle',    label: 'Lifecycle',       tone: 'cyan',    build: lifecycleCards },
  { id: 'short-side',   label: 'Short Side',      tone: 'danger',  build: shortCards },
  { id: 'my-rules',     label: 'My Rules',        tone: 'neutral', build: myRuleCards },
]

// Built fresh on each call: My Rules reads localStorage, which the user can
// edit on the Rules page between visits.
export function buildAllCards() {
  return DECKS.flatMap(d => {
    try {
      return d.build()
    } catch {
      return []
    }
  })
}

// Deterministic-per-session shuffle (Fisher-Yates on a copy).
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const MASTERED_KEY = 'qf:flashcards:mastered:v1'

export function loadMastered() {
  try {
    const raw = localStorage.getItem(MASTERED_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export function saveMastered(set) {
  try {
    localStorage.setItem(MASTERED_KEY, JSON.stringify([...set]))
  } catch { /* storage full or blocked — study still works in-session */ }
}
