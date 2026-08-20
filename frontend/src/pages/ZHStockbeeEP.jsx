import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  SOURCE, TRADE_PLAN, FORMULA, FORMULA_NOTE, CATALYST_FAMILIES,
  THEME_DOCTRINE, THEME_SOURCES,
  SELECTION_GATE, SELECTION_NOTES, WHERE_TO_LOOK, DELAYED_REACTION,
  ENTRY_RULES, ENTRY_LAW, STOP_RULES, STOP_DIVERGENCE,
  TRIM_LADDER, TRIM_LADDER_FOOTNOTE, TRAIL_RAIL, HOURLY_RAIL, VARIANTS, TRIM_PRINCIPLE,
  TOPPING_TELLS, RISK_RULES, PORTFOLIO_SHAPE, MARKET_FILTER, MARKET_FILTER_NOTE,
  DRAWDOWN_PROTOCOL, DRAWDOWN_NOTES, MISSED_VS_PASSED, TRACKING, ROUTINE,
  DEEP_DIVE_ADVICE, CAVEATS,
} from '../utils/zhStockbeeEP'
import { TONE } from '../components/framework/tones'

// ---------------------------------------------------------------------------
// ZH Stockbee on EPs — one trader's episodic-pivot method, on its own page.
//
// Why a page and not another Rules panel: Rules is the house framework,
// distilled from many sources and written in the app's voice. This is
// attributable to one person, and it should stay legible AS theirs — including
// the places where it contradicts what Rules teaches. The stop rule is the
// clearest case: the Exits ticket moves a stop to breakeven after the first
// partial, and ZH never moves a stop at all. Folding that into Rules would
// force a false reconciliation; here both can stand, labelled, with the
// distinction stated (see the Stop section).
//
// Content lives in utils/zhStockbeeEP.js and this file stays presentation-only.
//
// LAYOUT NOTE — why almost nothing here is a card grid.
// The first build rendered every block as 2–4 columns of bordered, tinted
// cards. That is the right shape for comparing short parallel items and the
// wrong one for prose: at three columns the measure collapses to ~30 characters,
// the eye has to zigzag to follow a list, and when every item owns a coloured
// box the colour stops meaning anything. So the page now has one reading spine:
//   • StatRow  — label · value · note, as a hanging-indent list. Scannable down
//                the left edge, readable across, one column.
//   • NoteRow  — prose with a tone-coloured left rule instead of a full box.
//   • Cards    — kept ONLY for CATALYST_FAMILIES, where the three families are
//                genuinely read side by side and comparison is the point.
// Measure is capped (PROSE) rather than filling a 1000px content column.
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'plan', label: 'The plan' },
  { id: 'formula', label: 'Formula' },
  { id: 'families', label: 'Catalyst families' },
  { id: 'themes', label: 'Themes' },
  { id: 'selection', label: 'Selection' },
  { id: 'entry', label: 'Entry & stop' },
  { id: 'trim', label: 'Trim & trail' },
  { id: 'risk', label: 'Risk' },
  { id: 'filter', label: 'Market filter' },
  { id: 'process', label: 'Process' },
  { id: 'caveats', label: 'Caveats' },
]

const COLLAPSE_KEY = 'qf:zh-ep:collapsed:v1'

// Comfortable line length for body prose — roughly 70–75 characters here.
const PROSE = 'max-w-[64ch]'

// ── Primitives ──────────────────────────────────────────────────────────────

/** A group of rows in one bordered container. */
function RowList({ children, tone }) {
  const t = tone ? TONE[tone] : null
  return (
    <div className={`rounded-xl border ${t ? t.border : 'border-surface-700/40'} ${t ? t.bgSoft : 'bg-surface-900/30'} divide-y divide-surface-700/40 overflow-hidden`}>
      {children}
    </div>
  )
}

/**
 * A definition row: label + value in a fixed left column, note beside it.
 *
 * Two columns rather than a stack, because stacking the note UNDER the value
 * cost roughly a third of the page's height for no readability gain — the note
 * is capped at a ~65-character measure either way, so the space to its right
 * was simply empty. Side by side, the left edge is still a clean column of
 * labels to run your eye down, and the row is as tall as its note instead of
 * its note plus a line. Below `sm` it stacks, where there is no room to pair.
 */
function StatRow({ tone, label, value, note }) {
  const t = TONE[tone] || TONE.info
  return (
    <div className="px-4 py-2.5 sm:flex sm:gap-4">
      <div className="sm:w-[268px] shrink-0 leading-tight">
        <div className={`text-[10.5px] font-bold tracking-widest uppercase ${t.text}`}>{label}</div>
        {value && <div className="font-mono text-[12.5px] text-surface-100 mt-0.5">{value}</div>}
      </div>
      {note && (
        <p className={`mt-1 sm:mt-0 text-[12px] text-surface-400 leading-relaxed ${PROSE}`}>{note}</p>
      )}
    </div>
  )
}

/** Prose with a tone rule instead of a box — the calm version of NoteCard. */
function NoteRow({ tone, title, body }) {
  const t = TONE[tone] || TONE.info
  return (
    <div className={`border-l-2 ${t.border} pl-4 py-1`}>
      <div className={`text-[12.5px] font-bold tracking-tight ${t.text}`}>{title}</div>
      <p className={`mt-1 text-[12.5px] text-surface-300 leading-relaxed ${PROSE}`}>{body}</p>
    </div>
  )
}

/** A single called-out block — used sparingly, for the page's few key claims. */
function Callout({ tone = 'purple', title, body, children, to, linkLabel }) {
  const t = TONE[tone]
  return (
    <div className={`rounded-xl border ${t.border} ${t.bgSoft} px-4 py-3.5`}>
      {title && <div className={`text-[12.5px] font-bold tracking-tight ${t.text}`}>{title}</div>}
      {body && <p className={`mt-1.5 text-[12.5px] text-surface-300 leading-relaxed ${PROSE}`}>{body}</p>}
      {children}
      {to && (
        <Link to={to} className="inline-block mt-2 text-[11.5px] text-cyan hover:underline">{linkLabel} →</Link>
      )}
    </div>
  )
}

function GroupLabel({ children, className = '' }) {
  return (
    <div className={`text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2 ${className}`}>
      {children}
    </div>
  )
}

function Section({ id, title, kicker, collapsed, onToggle, children }) {
  return (
    <section id={id} className="scroll-mt-[104px] border-t border-surface-800/60 pt-6">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className="flex items-baseline gap-3 flex-wrap mb-4 cursor-pointer select-none group"
      >
        <h2 className="text-[18px] font-display font-bold text-surface-50 tracking-tight group-hover:text-white">
          {title}
        </h2>
        {kicker && <span className="text-[12px] text-surface-500">{kicker}</span>}
        <svg
          className={`w-4 h-4 ml-auto text-surface-600 shrink-0 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {!collapsed && <div className="space-y-5">{children}</div>}
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ZHStockbeeEP() {
  const [active, setActive] = useState('plan')
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {} } catch { return {} }
  })
  const { hash } = useLocation()

  const toggle = useCallback((id) => {
    setCollapsed(prev => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }, [])

  const setAll = useCallback((value) => {
    const next = value ? Object.fromEntries(SECTIONS.map(s => [s.id, true])) : {}
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }, [])

  // Deep links (/zh-stockbee-ep#trim). Opens the section first — a link that
  // scrolls to a collapsed heading looks broken.
  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    setCollapsed(prev => (prev[id] ? { ...prev, [id]: false } : prev))
    const el = document.getElementById(id)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [hash])

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (vis) setActive(vis.target.id)
      },
      { rootMargin: '-90px 0px -70% 0px', threshold: 0 },
    )
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  const jump = (id) => {
    setCollapsed(prev => (prev[id] ? { ...prev, [id]: false } : prev))
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const allCollapsed = SECTIONS.every(s => collapsed[s.id])
  const sec = (id) => ({ collapsed: !!collapsed[id], onToggle: () => toggle(id) })

  return (
    <div className="max-w-[920px] pb-20">
      {/* Hero */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold tracking-widest border bg-warning/10 text-warning border-warning/30">
            EPISODIC PIVOTS
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold tracking-widest border bg-surface-800/60 text-surface-400 border-surface-700">
            ONE TRADER'S METHOD
          </span>
        </div>
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
          ZH Stockbee on EPs
        </h1>
        <p className={`text-surface-400 text-[13px] mt-1.5 leading-relaxed ${PROSE}`}>
          {SOURCE.subtitle} — {SOURCE.pages} pages, distilled into rules and grouped by decision.
        </p>
        <p className={`text-surface-500 text-[12px] mt-2 leading-relaxed ${PROSE}`}>
          This is a method, not the house framework — where it disagrees with{' '}
          <Link to="/rules" className="text-cyan hover:underline">Rules</Link>, both are shown and the difference is
          named rather than smoothed over.
        </p>
      </div>

      {/* Sticky section nav */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 mt-6 mb-2 bg-surface-950/90 backdrop-blur border-b border-surface-800/60">
        {/* Wraps rather than scrolls: at this content width the eleven chips
            overflow by ~20px, and a horizontal scroller silently clipped the
            last one ("Caveats") with nothing to say it was there. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-colors ${
                  active === s.id && !collapsed[s.id]
                    ? 'bg-warning/10 text-warning border-warning/30'
                    : 'bg-surface-900/60 text-surface-400 border-surface-700/50 hover:text-surface-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </>
          <button
            type="button"
            onClick={() => setAll(!allCollapsed)}
            className="ml-auto shrink-0 text-[11px] text-surface-500 hover:text-surface-300 whitespace-nowrap pl-2"
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>

      <div className="space-y-7">
        {/* ── THE PLAN ───────────────────────────────────────────────────── */}
        <Section id="plan" title="The plan, on one card"
          kicker="everything else on this page is detail on these seven lines" {...sec('plan')}>
          <RowList tone="warn">
            {TRADE_PLAN.map(r => <StatRow key={r.key} {...r} />)}
          </RowList>
        </Section>

        {/* ── FORMULA ────────────────────────────────────────────────────── */}
        <Section id="formula" title="The formula"
          kicker="what decides magnitude, not just whether it works" {...sec('formula')}>
          <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-5 py-4">
            <div className="font-mono text-[13px] text-accent font-bold text-center leading-relaxed">
              Neglect + Surprise + Low float + Low cap + $100M dollar volume
              <span className="text-surface-400"> = </span>
              <span className="text-surface-100">explosive move</span>
            </div>
          </div>
          <RowList>
            {FORMULA.map(f => <StatRow key={f.key} tone="info" label={f.label} note={f.note} />)}
          </RowList>
          <p className={`text-[12.5px] text-surface-400 leading-relaxed ${PROSE}`}>{FORMULA_NOTE}</p>
        </Section>

        {/* ── FAMILIES — the one place cards earn their keep ──────────────── */}
        <Section id="families" title="Catalyst families"
          kicker="classify the catalyst — it decides the exit posture" {...sec('families')}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {CATALYST_FAMILIES.map(f => {
              const t = TONE[f.tone]
              return (
                <div key={f.key} className={`rounded-xl border ${t.border} ${t.bgSoft} px-4 py-4 flex flex-col`}>
                  <div className={`text-[15px] font-display font-bold tracking-tight ${t.text}`}>{f.name}</div>
                  <div className="text-[11px] text-surface-500 mt-0.5">{f.tagline}</div>
                  <p className="mt-2.5 text-[12px] text-surface-300 leading-relaxed">{f.blurb}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {f.examples.map(e => (
                      <span key={e} className={`text-[10.5px] px-2 py-0.5 rounded-full border ${t.chip}`}>{e}</span>
                    ))}
                  </div>
                  <p className="mt-3 pt-2.5 border-t border-surface-700/40 text-[11.5px] text-surface-400 leading-snug">
                    <span className="text-surface-300 font-semibold">Exit: </span>{f.exit}
                  </p>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── THEMES ─────────────────────────────────────────────────────── */}
        <Section id="themes" title="Themes"
          kicker="the largest idea in the document, scattered across the most answers" {...sec('themes')}>
          <div className="space-y-3.5">
            {THEME_DOCTRINE.map(({ key, ...rest }) => <NoteRow key={key} {...rest} />)}
          </div>
          <div>
            <GroupLabel>Where the theme is found</GroupLabel>
            <RowList>
              {THEME_SOURCES.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
          </div>
          <p className={`text-[12px] text-surface-500 leading-relaxed ${PROSE}`}>
            QuantForge tracks theme velocity on{' '}
            <Link to="/theme-radar" className="text-cyan hover:underline">Theme Radar</Link>, and sector rotation on{' '}
            <Link to="/screener" className="text-cyan hover:underline">Sector Scan</Link> — but neither keeps the
            written themes list this section describes. That part stays manual.
          </p>
        </Section>

        {/* ── SELECTION ──────────────────────────────────────────────────── */}
        <Section id="selection" title="Selection"
          kicker="chart · price action · catalyst — all three, every time" {...sec('selection')}>
          <RowList>
            {SELECTION_GATE.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
          </RowList>
          <div className="space-y-3.5">
            {SELECTION_NOTES.map(({ key, ...rest }) => <NoteRow key={key} {...rest} />)}
          </div>
          <div>
            <GroupLabel>Where the candidates come from</GroupLabel>
            <RowList>
              {WHERE_TO_LOOK.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
            <p className={`mt-2.5 text-[12px] text-surface-500 leading-relaxed ${PROSE}`}>
              QuantForge covers several of these:{' '}
              <Link to="/earnings" className="text-cyan hover:underline">Earnings</Link> for the calendar,{' '}
              <Link to="/scanner-9m" className="text-cyan hover:underline">$9M Scanner</Link> for the EP screen, and{' '}
              <Link to="/setups" className="text-cyan hover:underline">Setups Board</Link> for the day's aggregate.
            </p>
          </div>
          <Callout title={DELAYED_REACTION.title} body={DELAYED_REACTION.body} />
        </Section>

        {/* ── ENTRY & STOP ───────────────────────────────────────────────── */}
        <Section id="entry" title="Entry & stop"
          kicker="one entry technique, one stop, no negotiation" {...sec('entry')}>
          <RowList>
            {ENTRY_RULES.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
          </RowList>
          <div className="rounded-xl border border-accent/25 bg-accent/[0.06] px-4 py-3">
            <p className={`text-[12.5px] text-surface-200 leading-relaxed ${PROSE}`}>{ENTRY_LAW}</p>
          </div>
          <div>
            <GroupLabel>The stop</GroupLabel>
            <RowList>
              {STOP_RULES.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
          </div>
          <Callout
            title={STOP_DIVERGENCE.title}
            body={STOP_DIVERGENCE.body}
            to={STOP_DIVERGENCE.ref.to}
            linkLabel={STOP_DIVERGENCE.ref.label}
          />
        </Section>

        {/* ── TRIM & TRAIL ───────────────────────────────────────────────── */}
        <Section id="trim" title="Trim & trail"
          kicker="the part no scanner can give you — exits are catalyst-specific" {...sec('trim')}>
          <div>
            <RowList>
              {TRIM_LADDER.map(row => {
                const t = TONE[row.tone]
                return (
                  <div key={row.key} className="px-4 py-3.5">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className={`text-[13px] font-bold tracking-tight w-[62px] shrink-0 ${t.text}`}>{row.day}</span>
                      <span className="font-mono text-[12.5px] text-surface-100">{row.action}</span>
                      <span className="text-[11px] text-surface-500">{row.when}</span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border shrink-0 ${t.chip}`}>
                        APPLIES TO
                      </span>
                      <span className="text-[12px] text-surface-300">{row.trigger}</span>
                    </div>
                    <p className={`mt-1.5 text-[12px] text-surface-400 leading-relaxed ${PROSE}`}>{row.note}</p>
                  </div>
                )
              })}
            </RowList>
            <p className="mt-2 text-[11.5px] text-surface-500">{TRIM_LADDER_FOOTNOTE}</p>
          </div>

          <div>
            <GroupLabel>Which rail you trail on</GroupLabel>
            <RowList>
              {TRAIL_RAIL.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
          </div>

          <Callout tone="info" title={HOURLY_RAIL.title} body={HOURLY_RAIL.body} />

          <div>
            <GroupLabel>Six variants, six exit postures</GroupLabel>
            <div className="space-y-3.5">
              {VARIANTS.map(v => {
                const t = TONE[v.tone]
                return (
                  <div key={v.key} className={`border-l-2 ${t.border} pl-4 py-1`}>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-[13px] font-bold tracking-tight ${t.text}`}>{v.name}</span>
                      <span className="text-[11px] text-surface-500">{v.tagline}</span>
                    </div>
                    <p className={`mt-1 text-[12.5px] text-surface-200 leading-relaxed ${PROSE}`}>{v.posture}</p>
                    {/* A constraint, not a value — monospace made it read as code. */}
                    <p className={`mt-1 text-[12px] text-surface-500 italic leading-relaxed ${PROSE}`}>{v.cap}</p>
                    <p className={`mt-1.5 text-[12px] text-surface-400 leading-relaxed ${PROSE}`}>{v.why}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <GroupLabel>Identifying tops — for the explosive variants only</GroupLabel>
            <RowList>
              {TOPPING_TELLS.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
          </div>

          <div>
            <GroupLabel>Why you are selling</GroupLabel>
            <RowList>
              {TRIM_PRINCIPLE.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
          </div>
        </Section>

        {/* ── RISK ───────────────────────────────────────────────────────── */}
        <Section id="risk" title="Risk & size"
          kicker="consistency first — size is the reward, not the route" {...sec('risk')}>
          <RowList>
            {RISK_RULES.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
          </RowList>
          <div>
            <GroupLabel>What the book looks like</GroupLabel>
            <RowList>
              {PORTFOLIO_SHAPE.map(({ key, ...rest }) => <StatRow key={key} {...rest} />)}
            </RowList>
          </div>
          <p className={`text-[12px] text-surface-500 leading-relaxed ${PROSE}`}>
            The sizing arithmetic is the same one the app uses at the ticket —{' '}
            <Link to="/risk" className="text-cyan hover:underline">Risk Management</Link> prices it against your own
            measured win rate and payoff.
          </p>
        </Section>

        {/* ── MARKET FILTER ──────────────────────────────────────────────── */}
        <Section id="filter" title="Market filter"
          kicker="the setup is seasonal — this decides whether it is in season" {...sec('filter')}>
          <RowList>
            {MARKET_FILTER.map(m => {
              const t = TONE[m.tone]
              return (
                <div key={m.key} className="px-4 py-3">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border shrink-0 ${t.chip}`}>
                      {m.action}
                    </span>
                    <span className="font-mono text-[12px] text-surface-200">{m.regime}</span>
                  </div>
                  <p className={`mt-1.5 text-[12px] text-surface-400 leading-relaxed ${PROSE}`}>{m.note}</p>
                </div>
              )
            })}
          </RowList>
          <p className={`text-[12.5px] text-surface-400 leading-relaxed ${PROSE}`}>{MARKET_FILTER_NOTE}</p>
          <p className={`text-[12px] text-surface-500 leading-relaxed ${PROSE}`}>
            QuantForge's version of that filter is the exposure score on{' '}
            <Link to="/situational-awareness" className="text-cyan hover:underline">Trade Today</Link>, with the raw
            breadth on <Link to="/market-monitor" className="text-cyan hover:underline">Market Monitor</Link>.
          </p>
        </Section>

        {/* ── PROCESS ────────────────────────────────────────────────────── */}
        <Section id="process" title="Process"
          kicker="drawdown, tracking, routine — the parts that survive a bad month" {...sec('process')}>
          <div>
            <GroupLabel>The drawdown protocol</GroupLabel>
            <div className="rounded-xl border border-danger/25 bg-danger/[0.05] px-4 py-3.5">
              {/* Column-major: row flow would number the left column 1,3,5,7,9,
                  which reads as a broken sequence even with the numbers shown. */}
              <ol className="grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-5 sm:grid-flow-col gap-x-6 gap-y-1.5">
                {DRAWDOWN_PROTOCOL.map((step, i) => (
                  <li key={step} className="flex items-baseline gap-2.5 text-[12.5px] text-surface-300">
                    <span className="font-mono text-[10.5px] text-danger w-4 shrink-0">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="space-y-3.5">
            {DRAWDOWN_NOTES.map(({ key, ...rest }) => <NoteRow key={key} {...rest} />)}
          </div>

          <Callout tone="good" title={MISSED_VS_PASSED.title} body={MISSED_VS_PASSED.body}>
            <p className={`mt-2 text-[12px] text-surface-400 leading-relaxed ${PROSE}`}>
              {MISSED_VS_PASSED.quantforge}{' '}
              <Link to={MISSED_VS_PASSED.ref.to} className="text-cyan hover:underline">
                {MISSED_VS_PASSED.ref.label} →
              </Link>
            </p>
          </Callout>

          <div>
            <GroupLabel>Tracking</GroupLabel>
            <div className="space-y-3.5">
              {TRACKING.map(({ key, ...rest }) => <NoteRow key={key} {...rest} />)}
            </div>
          </div>

          <div>
            <GroupLabel>The daily routine</GroupLabel>
            <RowList>
              {ROUTINE.map(r => {
                const t = TONE[r.tone]
                return (
                  <div key={r.key} className="px-4 py-2.5 sm:flex sm:gap-4">
                    <div className="sm:w-[268px] shrink-0 leading-tight">
                      <div className={`text-[11px] font-bold tracking-tight ${t.text}`}>{r.time}</div>
                      <div className="text-[12.5px] text-surface-100 mt-0.5">{r.what}</div>
                    </div>
                    <p className={`mt-1 sm:mt-0 text-[12px] text-surface-400 leading-relaxed ${PROSE}`}>{r.note}</p>
                  </div>
                )
              })}
            </RowList>
          </div>

          <div>
            <GroupLabel>Deep dives</GroupLabel>
            <div className="space-y-3.5">
              {DEEP_DIVE_ADVICE.map(({ key, ...rest }) => <NoteRow key={key} {...rest} />)}
            </div>
          </div>
        </Section>

        {/* ── CAVEATS ────────────────────────────────────────────────────── */}
        <Section id="caveats" title="Read this before copying any of it"
          kicker="ZH's own numbers and qualifications, kept together" {...sec('caveats')}>
          <div className="space-y-3.5">
            {CAVEATS.map(c => (
              <div key={c.key} className="border-l-2 border-surface-600 pl-4 py-1">
                <div className="text-[12.5px] font-bold text-surface-200 tracking-tight">{c.title}</div>
                <p className={`mt-1 text-[12.5px] text-surface-400 leading-relaxed ${PROSE}`}>{c.body}</p>
              </div>
            ))}
          </div>
          <p className={`text-[11.5px] text-surface-500 leading-relaxed ${PROSE}`}>
            Source: <span className="text-surface-400">{SOURCE.title}</span> — a Stockbee member Q&amp;A with ZH,
            moderated by EG. Distilled and reorganised here; the framing, ordering and cross-references to QuantForge
            are this page's, and the trading judgements are ZH's.
          </p>
        </Section>
      </div>
    </div>
  )
}
