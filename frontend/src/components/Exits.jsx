import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { EXIT_TICKET, EXIT_MECHANICS, EXIT_LADDER } from '../utils/tradingRules'
import PanelShell from './framework/PanelShell'
import VerdictLadder from './framework/VerdictLadder'
import { TONE } from './framework/tones'

// The Exits panel — the mirror of Entries, and deliberately the shortest
// framework on the page.
//
// Three panels already cover exits well: Trade Lifecycle has the day-by-day
// protocol, Exit (trend death vs shakeout) answers "is it over", Candles ×
// Rails shows how the touch prints. This one does not re-teach any of it — a
// fourth explanation would make the page longer without making the decision
// easier. It exists because all three describe exits as *conditions* and none
// of them gives a price. Every row here links back to the panel that owns the
// reasoning.

// Worked from the same numbers the Entries panel uses, so the two ends of the
// trade are priced off one entry.
const EG = { entry: 42.10, stop: 41.40, adr: 6.0 }

function Exits({ collapsible = false, collapsed = false, onToggle, id }) {
  const eg = useMemo(() => {
    const risk = EG.entry - EG.stop
    const adr$ = EG.entry * (EG.adr / 100)
    return {
      risk,
      partial2: EG.entry + 2 * risk,
      partial3: EG.entry + 3 * risk,
      stretch: EG.entry + 3 * adr$,   // 3 ADR above, proxied from the entry
      adr$,
    }
  }, [])

  return (
    <PanelShell
      id={id}
      titleId="exits-title"
      title="Exits"
      subtitle={<>Where the sell order goes — the partial, the stop and the trail as <span className="text-surface-300">prices</span>, not conditions.</>}
      icon={(
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3m7-4l4-4m0 0l-4-4m4 4H10" />
        </svg>
      )}
      iconTone="bg-cyan/10 border-cyan/30 text-cyan"
      border="border-cyan/25"
      accent="from-cyan via-accent to-warning"
      orb="bg-cyan/10"
      orbSide="right"
      badges={[
        { text: 'EXITS', cls: 'bg-cyan/10 text-cyan border-cyan/30' },
        { text: 'TICKET', cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
      ]}
      collapsible={collapsible}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <>
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            Every other exit framework on this page describes a{' '}
            <span className="text-surface-200">condition</span> — “a decisive close below the rail”, “sell into
            strength”, “no follow-through by day 3–5”. All true, and none of them is a number you can put on a ticket
            the night before. This is that number. It re-teaches nothing: each row points at the panel that owns the
            reasoning behind it.
          </p>
          <p className="mt-2 text-[12px] text-surface-400 leading-snug">
            One schedule, deliberately. Episodic pivots do not share it —{' '}
            <Link to="/zh-stockbee-ep#trim" className="text-cyan hover:underline">ZH Stockbee on EPs</Link> carries a
            trim-and-trail ladder indexed on day <em>and</em> catalyst type, which is the axis this ticket has no room
            for.
          </p>
        </div>

        {/* THE TICKET */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40 overflow-hidden">
          {EXIT_TICKET.map(row => {
            const tone = TONE[row.tone]
            return (
              <div key={row.key} className="px-4 py-3">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className={`text-[12.5px] font-bold tracking-tight w-[150px] shrink-0 ${tone.text}`}>{row.label}</span>
                  <span className="font-mono text-[12.5px] text-surface-100">{row.price}</span>
                  <span className="text-[11px] text-surface-500">{row.when}</span>
                  <Link to={row.ref.to}
                    className="ml-auto text-[10.5px] text-surface-500 hover:text-accent whitespace-nowrap">
                    {row.ref.label} →
                  </Link>
                </div>
                <p className="mt-1 text-[11.5px] text-surface-400 leading-snug">{row.note}</p>
              </div>
            )
          })}
        </div>

        {/* Worked from the Entries example, so both ends share one trade */}
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-accent uppercase mb-1.5">The same trade the Entries panel sizes</div>
          <p className="text-[12px] text-surface-300 leading-snug">
            Entry <span className="font-mono text-surface-100">{EG.entry.toFixed(2)}</span>, stop{' '}
            <span className="font-mono text-surface-100">{EG.stop.toFixed(2)}</span> — risk{' '}
            <span className="font-mono text-surface-100">{eg.risk.toFixed(2)}</span> a share, ADR {EG.adr}% ≈{' '}
            <span className="font-mono text-surface-100">{eg.adr$.toFixed(2)}</span>. So before the bell you already
            know every exit: first partial between{' '}
            <span className="font-mono font-bold text-accent">{eg.partial2.toFixed(2)}</span> and{' '}
            <span className="font-mono font-bold text-accent">{eg.partial3.toFixed(2)}</span> (2–3R), the stretch exit
            near <span className="font-mono font-bold text-warning">{eg.stretch.toFixed(2)}</span> if it gets there
            first, the stop at <span className="font-mono text-surface-100">{EG.stop.toFixed(2)}</span> until that
            partial fills and breakeven after. Three prices, no mid-trade decisions.
          </p>
        </div>

        {/* MECHANICS */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">The mechanics</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {EXIT_MECHANICS.map(m => {
              const tone = TONE[m.tone]
              return (
                <div key={m.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-3.5 py-3`}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-bold tracking-widest text-surface-400 uppercase">{m.label}</span>
                    <span className={`font-mono font-bold text-[12px] ${tone.text}`}>{m.value}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-surface-400 leading-snug">{m.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* LADDER */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Same open position — six mornings
          </div>
          <VerdictLadder rows={EXIT_LADDER} />
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-cyan">Every exit price is set before the entry fills.</span> The only
              decision left open in a live trade is which of them the market reaches first — and that is a decision the
              market makes, not you.
            </p>
          </div>
        </div>
      </>
    </PanelShell>
  )
}

export default memo(Exits)
