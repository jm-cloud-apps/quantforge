import { Link } from 'react-router-dom'

// ---------------------------------------------------------------------------
// The Loop — how the pages fit together.
//
// The sidebar groups 36 pages by category, and the Dashboard's "Right now"
// strip enacts the routine one step at a time. Neither shows the *shape*: that
// each stage produces a record the next stage reads, and that skipping one
// doesn't just lose a step, it blinds the ones downstream. That's the thing
// worth seeing on one screen.
//
// Deliberately not a tutorial. It says what each stage produces and what breaks
// without it, because that's the part you can't infer from a page title.
// ---------------------------------------------------------------------------

const STAGES = [
  {
    n: 1,
    when: 'Weekend / evening',
    title: 'Prep',
    to: '/prep',
    tone: 'purple',
    does: 'Read the tape, run the leader scans, shortlist names with a trigger and a stop.',
    produces: 'A saved session — the market read at the time, and the names you were watching.',
    breaks: 'Without it the missed-trade suggester has nothing to match fills against, and "did I see this coming?" becomes unanswerable. It autosaves now, so this happens whether or not you remember.',
  },
  {
    n: 2,
    when: 'Pre-open',
    title: 'Trade Today',
    to: '/situational-awareness',
    tone: 'cyan',
    does: 'Score the tape, then log a plan: setup, entry, stop, target. Size comes off the stop.',
    produces: 'A trade plan for the day, and the gate verdict it unlocks.',
    breaks: 'The circuit breaker withholds the day’s verdict until a plan exists — a green light you didn’t plan against is how a Random trade starts.',
  },
  {
    n: 3,
    when: 'Session',
    title: 'Find & execute',
    to: '/setups',
    tone: 'accent',
    does: 'Setups Board aggregates the scanners; the trigger and the exits were set last night.',
    produces: 'Fills, which arrive in the workbook via the IB report pipeline.',
    breaks: 'Nothing downstream can tell a planned trade from an impulse if step 2 was skipped — it all lands as unplanned.',
  },
  {
    n: 4,
    when: 'After the close',
    title: 'Review & Missed Book',
    to: '/review',
    tone: 'warning',
    does: 'Tag each exit with a reason. Log the setups you didn’t take, and why.',
    produces: 'exit_reason on every trade; verdicts and R cost on every miss.',
    breaks: 'Post-exit excursion groups by exit reason, so untagged exits are invisible to the one analysis that asks whether you sell too early.',
  },
  {
    n: 5,
    when: 'Weekly / monthly',
    title: 'Discipline & analytics',
    to: '/discipline',
    tone: 'danger',
    does: 'Compliance, setup decay, holding-period edge, and what the omissions cost.',
    produces: 'The numbers that decide what to change next — and what to leave alone.',
    breaks: 'Every number here is only as honest as steps 1–4. Skip the record and this page measures the record, not the trading.',
  },
]

const TONES = {
  purple:  { text: 'text-purple',  ring: 'border-purple/40',  chip: 'bg-purple/15 text-purple',   bar: 'bg-purple' },
  cyan:    { text: 'text-cyan',    ring: 'border-cyan/40',    chip: 'bg-cyan/15 text-cyan',       bar: 'bg-cyan' },
  accent:  { text: 'text-accent',  ring: 'border-accent/40',  chip: 'bg-accent/15 text-accent',   bar: 'bg-accent' },
  warning: { text: 'text-warning', ring: 'border-warning/40', chip: 'bg-warning/15 text-warning', bar: 'bg-warning' },
  danger:  { text: 'text-danger',  ring: 'border-danger/40',  chip: 'bg-danger/15 text-danger',   bar: 'bg-danger' },
}

// The records that flow between stages. This is the part that makes the loop a
// loop rather than a list — each one is consumed by a stage after the one that
// produced it, and several of them were dark for a long time.
const RECORDS = [
  { key: 'session', name: 'Prep session', from: 'Prep', to: 'Missed Book · Discipline',
    note: 'Shortlist + market read. Matched against fills to propose misses, and to tell a planned trade from an unplanned one.' },
  { key: 'plan', name: 'Trade plan', from: 'Trade Today', to: 'Discipline',
    note: 'Entry, stop, size, min-hold. The compliance number is fills reconciled against these.' },
  { key: 'fills', name: 'Fills', from: 'IB daily report', to: 'Everything',
    note: 'PDF → Trades.xlsx via the formatter. A missed report doesn’t drop rows, it re-points the FIFO matcher.' },
  { key: 'reason', name: 'Exit reason', from: 'Review', to: 'Discipline',
    note: 'A controlled vocabulary, because free text can’t be aggregated. Post-exit excursion groups by it.' },
  { key: 'miss', name: 'Missed entry', from: 'Missed Book', to: 'Discipline',
    note: 'Verdict + R cost. Only real misses accrue cost; a correct pass is evidence the filters worked.' },
]

export default function Loop() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display font-bold text-2xl text-surface-50">The Loop</h1>
        <p className="text-[13px] text-surface-400 mt-1 max-w-[70ch] leading-relaxed">
          Thirty-six pages, five stages. The order matters because each stage leaves behind a record the next one
          reads — so skipping a step doesn’t just lose that step, it blinds everything downstream. The
          “Right now” strip on the <Link to="/dashboard" className="text-accent hover:underline">Dashboard</Link> walks
          you through this one step at a time; this is the shape it’s walking.
        </p>
      </div>

      <ol className="space-y-2.5">
        {STAGES.map((s, i) => {
          const t = TONES[s.tone]
          return (
            <li key={s.n} className="relative">
              <div className={`rounded-2xl border ${t.ring} bg-surface-900/60 overflow-hidden`}>
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${t.bar} opacity-70`} />
                <div className="pl-5 pr-4 py-3.5">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className={`text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded ${t.chip}`}>
                      {s.when}
                    </span>
                    <Link to={s.to} className={`text-[15px] font-display font-bold ${t.text} hover:underline`}>
                      {s.title} →
                    </Link>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-surface-200 leading-snug">{s.does}</p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
                    <p className="text-[11.5px] text-surface-400 leading-snug">
                      <span className="text-surface-300 font-semibold">Leaves behind · </span>{s.produces}
                    </p>
                    <p className="text-[11.5px] text-surface-500 leading-snug">
                      <span className="text-danger/90 font-semibold">Skip it · </span>{s.breaks}
                    </p>
                  </div>
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div className="flex justify-center py-1" aria-hidden="true">
                  <svg className="w-4 h-4 text-surface-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* What actually travels between the stages */}
      <div className="rounded-2xl border border-surface-700/50 bg-surface-900/40 p-4 sm:p-5">
        <h2 className="text-[13px] font-bold tracking-wider uppercase text-surface-300">What travels between them</h2>
        <p className="text-[11.5px] text-surface-500 mt-1 mb-3 max-w-[72ch] leading-snug">
          This is what makes it a loop rather than a list. Each record is written by one stage and read by a later
          one — which is why a step you skip shows up as a number that quietly stops meaning anything.
        </p>
        <div className="rounded-xl border border-surface-700/40 divide-y divide-surface-700/40 overflow-hidden">
          {RECORDS.map(r => (
            <div key={r.key} className="px-3.5 py-2.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12.5px] font-semibold text-surface-100 w-[120px] shrink-0">{r.name}</span>
                <span className="text-[11px] font-mono text-surface-500">{r.from} → {r.to}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] text-surface-400 leading-snug">{r.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-accent/25 bg-accent/[0.05] px-4 py-3">
        <p className="text-[12.5px] text-surface-200 leading-snug">
          <span className="font-semibold text-accent">Everything else is a drill-down.</span> The individual scanners,
          the research pages, the backtester — none of them are steps. They answer a question you already had, which is
          why they sit behind the daily path rather than in it. If you’re not sure what to do next, the{' '}
          <Link to="/dashboard" className="text-accent hover:underline">Dashboard</Link> strip will tell you; if you
          want to know why that’s the next thing, this page is the answer.
        </p>
      </div>
    </div>
  )
}
