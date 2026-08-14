import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getScorecard, WINDOWS } from '../api/discipline'
import { getMissedSummary } from '../api/missed'
import RefreshControl from '../components/RefreshControl'
import TickerLink from '../components/TickerLink'

// ---------------------------------------------------------------------------
// "Discipline" — the process scorecard.
//
// Every other page in section 4 measures outcomes. This one measures whether
// the trade that happened was the trade that was planned. Four questions, in
// the order they're worth asking:
//
//   1. What fraction of trades were planned at all?  (the compliance number)
//   2. When a plan existed, how did the fill depart from it?
//   3. Is the holding period earning its keep?  (tested, not assumed)
//   4. Which setups have stopped working?
//
// It deliberately defaults to a TRAILING WINDOW rather than all-time. A
// lifetime total can stay positive through a long drawdown, which is exactly
// the reading that lets a decaying process go unnoticed.
// ---------------------------------------------------------------------------

const fmt$ = (n, digits = 0) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const v = Number(n)
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: digits })}`
}
const fmtPct = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${Number(n).toFixed(digits)}%`
const signed$ = (n) => (n > 0 ? `+${fmt$(n)}` : fmt$(n))
const pnlTone = (n) => (n > 0 ? 'text-emerald-300' : n < 0 ? 'text-red-300' : 'text-surface-400')

// Compliance banding. These are process thresholds, not performance ones — at
// under a third planned, the trade log is describing a different trader than
// the playbook does.
function complianceTone(pct) {
  if (pct === null || pct === undefined) return { ring: 'text-surface-500', wrap: 'border-surface-700/50 bg-surface-900/60', verdict: 'No data' }
  if (pct >= 80) return { ring: 'text-emerald-300', wrap: 'border-emerald-400/30 bg-emerald-500/5', verdict: 'The log matches the playbook.' }
  if (pct >= 50) return { ring: 'text-amber-300', wrap: 'border-amber-400/30 bg-amber-500/5', verdict: 'Half your trades are improvised.' }
  return { ring: 'text-rose-300', wrap: 'border-rose-400/30 bg-rose-500/5', verdict: 'The playbook is not what you are trading.' }
}

const DECAY_TONE = {
  dead: { chip: 'bg-rose-500/15 text-rose-300 border-rose-400/30', label: 'Dead' },
  decaying: { chip: 'bg-amber-500/15 text-amber-300 border-amber-400/30', label: 'Decaying' },
  healthy: { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', label: 'Healthy' },
  thin: { chip: 'bg-surface-700/60 text-surface-400 border-surface-600/40', label: 'Thin' },
}

const FAMILY_LABEL = {
  HTF: 'HTF (playbook)',
  EP: 'EP (playbook)',
  RANDOM: 'Random / NA',
  UNTAGGED: 'Untagged',
}

export default function Discipline() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [windowDays, setWindowDays] = useState(180)

  const load = useCallback(async (force = false, days = windowDays) => {
    setLoading(true)
    setError(null)
    try {
      setData(await getScorecard({ windowDays: days, force }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [windowDays])

  useEffect(() => { load(false, windowDays) }, [windowDays])   // eslint-disable-line react-hooks/exhaustive-deps

  const recon = data?.reconciliation
  const summary = recon?.summary
  const hold = data?.hold_time
  const decay = data?.decay
  const tone = complianceTone(summary?.compliance_pct)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Discipline</h1>
          <p className="text-surface-400 text-[13px] mt-1 max-w-2xl">
            Not what your trades returned — whether they were the trades you planned. Compliance, deviations,
            holding period, and setup decay over a trailing window.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-surface-700">
            {WINDOWS.map((w) => (
              <button key={w.days} onClick={() => setWindowDays(w.days)}
                className={`text-[11px] px-2.5 py-1.5 ${windowDays === w.days ? 'bg-accent/20 text-accent' : 'bg-surface-800 text-surface-500 hover:text-surface-300'}`}>
                {w.label}
              </button>
            ))}
          </div>
          <RefreshControl jobId="discipline" onRefresh={() => load(true)} refreshing={loading} busyLabel="Scoring…" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {loading && !data && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/50 px-4 py-8 text-center text-sm text-surface-500">
          Scoring the log…
        </div>
      )}

      {summary && (
        <>
          {/* ── 1. Compliance hero ─────────────────────────────────────── */}
          <div className={`rounded-2xl border p-5 ${tone.wrap}`}>
            <div className="flex items-start gap-6 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold">Plan compliance</div>
                <div className={`text-5xl font-semibold tabular-nums mt-1 ${tone.ring}`}>
                  {summary.compliance_pct === null ? '—' : fmtPct(summary.compliance_pct)}
                </div>
                <div className="text-[13px] text-surface-300 mt-1">
                  <span className="font-semibold text-surface-100">{summary.planned_trades}</span> of{' '}
                  <span className="font-semibold text-surface-100">{summary.total_trades}</span> trades had a plan
                </div>
                <div className="text-[12px] text-surface-500 mt-0.5">{tone.verdict}</div>
              </div>

              <div className="grid grid-cols-3 gap-3 flex-1 min-w-[320px]">
                <ClassCard title="Followed" stats={summary.followed} tone="emerald"
                  hint="Plan existed, fill matched it" />
                <ClassCard title="Deviated" stats={summary.deviated} tone="amber"
                  hint="Plan existed, execution drifted" />
                <ClassCard title="Unplanned" stats={summary.unplanned} tone="rose"
                  hint="No plan was logged" />
              </div>
            </div>

            {summary.plans_logged === 0 && (
              <div className="mt-4 rounded-lg bg-surface-800/60 border border-surface-700/50 px-3 py-2.5 text-[12px] text-surface-300">
                <span className="text-amber-300 font-medium">No plans have been logged.</span>{' '}
                Compliance reads 0% because the plan store is empty, not because the trades were bad — this number
                only becomes meaningful once you start logging plans on{' '}
                <Link to="/situational-awareness" className="text-accent hover:underline">Trade Today</Link>.
              </div>
            )}
            {summary.plans_unexecuted > 0 && (
              <div className="mt-3 text-[12px] text-surface-500">
                {summary.plans_unexecuted} logged plan{summary.plans_unexecuted === 1 ? '' : 's'} never became a trade.
              </div>
            )}

            <OmissionStrip />
          </div>

          {/* ── 2. Where the unplanned money goes ──────────────────────── */}
          <Panel title="The unplanned tax"
            sub="Trades with no logged plan, split by what they were tagged as afterwards. The Random/Untagged rows are the ones with no thesis at any point.">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {['RANDOM', 'UNTAGGED', 'HTF', 'EP'].map((fam) => {
                const s = recon.unplanned_by_family?.[fam]
                if (!s || !s.n) return null
                const bad = fam === 'RANDOM' || fam === 'UNTAGGED'
                return (
                  <div key={fam} className={`rounded-xl border px-3 py-2.5 ${bad ? 'bg-rose-500/5 border-rose-400/25' : 'bg-surface-800/50 border-surface-700/40'}`}>
                    <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold">{FAMILY_LABEL[fam]}</div>
                    <div className={`text-xl font-semibold tabular-nums ${pnlTone(s.pnl)}`}>{signed$(s.pnl)}</div>
                    <div className="text-[11px] text-surface-500">{s.n} trades · {fmtPct(s.win_rate)} win</div>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* ── 3. How execution drifts when a plan does exist ─────────── */}
          {recon.deviation_reasons?.length > 0 && (
            <Panel title="How the execution drifts"
              sub="Recurring departures from a logged plan, ranked by what they cost.">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-surface-500 text-left">
                    <th className="pb-2 font-semibold">Deviation</th>
                    <th className="pb-2 font-semibold text-right">Trades</th>
                    <th className="pb-2 font-semibold text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.deviation_reasons.map((d) => (
                    <tr key={d.kind} className="border-t border-surface-800">
                      <td className="py-2 text-surface-200 capitalize">{d.kind}</td>
                      <td className="py-2 text-right text-surface-400 tabular-nums">{d.n}</td>
                      <td className={`py-2 text-right tabular-nums ${pnlTone(d.pnl)}`}>{signed$(d.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {/* ── 4. Holding period ──────────────────────────────────────── */}
          {hold && (
            <Panel title="Does holding longer actually pay?"
              sub="The bucket table below is the naive read. The verdict beside it is the tested one.">
              <div className="grid lg:grid-cols-[1fr_320px] gap-5">
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-surface-500 text-left">
                        <th className="pb-2 font-semibold">Hold</th>
                        <th className="pb-2 font-semibold text-right">Trades</th>
                        <th className="pb-2 font-semibold text-right">Win</th>
                        <th className="pb-2 font-semibold text-right">P&amp;L</th>
                        <th className="pb-2 font-semibold text-right">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hold.buckets.map((b) => (
                        <tr key={b.label} className="border-t border-surface-800">
                          <td className="py-2 text-surface-200">{b.label}</td>
                          <td className="py-2 text-right text-surface-400 tabular-nums">{b.n}</td>
                          <td className="py-2 text-right text-surface-400 tabular-nums">{fmtPct(b.win_rate)}</td>
                          <td className={`py-2 text-right tabular-nums ${pnlTone(b.pnl)}`}>{signed$(b.pnl)}</td>
                          <td className={`py-2 text-right tabular-nums ${pnlTone(b.avg)}`}>{signed$(b.avg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-surface-600 mt-2">
                    Median hold: {hold.median_hold_days ?? '—'} days.
                  </p>
                </div>

                {hold.verdict && (
                  <div className={`rounded-xl border p-4 ${hold.verdict.supported ? 'bg-emerald-500/5 border-emerald-400/30' : 'bg-amber-500/5 border-amber-400/30'}`}>
                    <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold">
                      Tested on every closed trade
                    </div>
                    <div className={`text-[15px] font-semibold mt-1 ${hold.verdict.supported ? 'text-emerald-200' : 'text-amber-200'}`}>
                      {hold.verdict.headline}
                    </div>
                    <p className="text-[11.5px] text-surface-400 mt-2 leading-relaxed">{hold.verdict.detail}</p>
                    {hold.post_exit && (
                      <div className="mt-3 pt-3 border-t border-surface-700/50 grid grid-cols-2 gap-2 text-[11px]">
                        <Stat label="Exits too early" value={hold.post_exit.exits_too_early} />
                        <Stat label="Exits justified" value={hold.post_exit.exits_justified} />
                        <Stat label="Median if held" value={fmtPct(hold.post_exit.median_held_pct, 1)} />
                        <Stat label="Median best case" value={fmtPct(hold.post_exit.median_max_pct, 1)}
                          hint="upper bound — nobody sells the high" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Exit-reason breakdown — empty until exits get tagged in Review. */}
              {hold.post_exit?.by_reason?.length > 0 && (
                <div className="mt-5 pt-4 border-t border-surface-800">
                  <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
                    By exit reason
                  </div>
                  {hold.post_exit.by_reason.length === 1 && hold.post_exit.by_reason[0].reason === '(untagged)' ? (
                    <p className="text-[12px] text-surface-500">
                      No exits are tagged yet. Tag them on the{' '}
                      <Link to="/review" className="text-accent hover:underline">Review</Link> page and this splits the
                      exits your process chose from the ones you chose in the moment.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-surface-500 text-left">
                          <th className="pb-2 font-semibold">Reason</th>
                          <th className="pb-2 font-semibold text-right">Trades</th>
                          <th className="pb-2 font-semibold text-right">If held</th>
                          <th className="pb-2 font-semibold text-right">Median</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hold.post_exit.by_reason.map((r) => (
                          <tr key={r.reason} className="border-t border-surface-800">
                            <td className="py-2 text-surface-200">{r.reason}</td>
                            <td className="py-2 text-right text-surface-400 tabular-nums">{r.n}</td>
                            <td className={`py-2 text-right tabular-nums ${pnlTone(r.held_dollars)}`}>{signed$(r.held_dollars)}</td>
                            <td className="py-2 text-right text-surface-400 tabular-nums">{fmtPct(r.median_held_pct, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {hold.post_exit?.worst?.length > 0 && (
                <div className="mt-5 pt-4 border-t border-surface-800">
                  <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
                    Biggest gaps — exits that ran without you ({hold.post_exit.sessions} sessions)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hold.post_exit.worst.slice(0, 10).map((w, i) => (
                      <div key={`${w.symbol}-${w.exit_date}-${i}`}
                        className="rounded-lg bg-surface-800/50 border border-surface-700/40 px-2.5 py-1.5 text-[11px]">
                        <TickerLink symbol={w.symbol} className="font-semibold text-surface-100" />
                        <span className="text-emerald-300 ml-1.5 tabular-nums">+{w.held_pct}%</span>
                        <span className="text-surface-500 ml-1.5">{fmt$(w.held_dollars)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          )}

          {/* ── 5. Setup decay ─────────────────────────────────────────── */}
          {decay?.setups?.length > 0 && (
            <Panel title="Setup decay"
              sub={`Rolling ${decay.window}-trade health per setup. A setup only gets a verdict once the recent sample is big enough to mean something.`}>
              {decay.retire?.length > 0 && (
                <div className="mb-3 rounded-lg bg-rose-500/10 border border-rose-400/30 px-3 py-2 text-[12px] text-rose-200">
                  <span className="font-semibold">Retire:</span> {decay.retire.join(', ')} — losing with a win rate
                  under 20% across the last window.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-surface-500 text-left">
                      <th className="pb-2 font-semibold">Setup</th>
                      <th className="pb-2 font-semibold">Verdict</th>
                      <th className="pb-2 font-semibold text-right">Recent</th>
                      <th className="pb-2 font-semibold text-right">Prior</th>
                      <th className="pb-2 font-semibold">Read</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decay.setups.map((s) => {
                      const t = DECAY_TONE[s.verdict]
                      return (
                        <tr key={s.setup} className="border-t border-surface-800">
                          <td className="py-2 text-surface-200">{s.setup}</td>
                          <td className="py-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${t.chip}`}>{t.label}</span>
                          </td>
                          <td className={`py-2 text-right tabular-nums ${pnlTone(s.recent.pnl)}`}>
                            {signed$(s.recent.pnl)}<span className="text-surface-600 text-[11px]"> ·{s.recent.n}</span>
                          </td>
                          <td className={`py-2 text-right tabular-nums ${s.prior.n ? pnlTone(s.prior.pnl) : 'text-surface-600'}`}>
                            {s.prior.n ? signed$(s.prior.pnl) : '—'}
                          </td>
                          <td className="py-2 text-[11.5px] text-surface-500">{s.why}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <p className="text-[11px] text-surface-600">
            {data.trade_count} closed trades in window
            {data.window_days ? ` (last ${data.window_days} days)` : ' (all time)'}
            {data.generated_at ? ` · scored ${data.generated_at.replace('T', ' ')}` : ''}
          </p>
        </>
      )}
    </div>
  )
}

// The other half of the same question. Everything above this counts trades that
// were taken and shouldn't have been; the Missed Book counts the reverse. Kept
// to one line and rendered only when the book has entries — an empty prompt on
// a page about compliance would just be an advert. Fails silent: if the missed
// endpoint is down, the compliance number must still render.
function OmissionStrip() {
  const [s, setS] = useState(null)

  useEffect(() => {
    let alive = true
    getMissedSummary().then(d => { if (alive) setS(d) }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!s || s.missed.count === 0) return null
  const top = s.by_reason[0]

  return (
    <div className="mt-4 rounded-lg bg-surface-800/40 border border-surface-700/50 px-3 py-2.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px]">
      <span className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold">Omission</span>
      <span className="text-surface-300">
        <span className="font-semibold text-surface-100 tabular-nums">{s.missed.count}</span> logged miss
        {s.missed.count === 1 ? '' : 'es'}
        {s.missed.r_real_sum != null && (
          <> · <span className="font-semibold text-surface-100 tabular-nums">
            {s.missed.r_real_sum > 0 ? '+' : ''}{s.missed.r_real_sum.toFixed(1)}R
          </span> left on the table over {s.missed.r_real_n} priced</>
        )}
      </span>
      {top && (
        <span className="text-surface-500">
          most often: <span className="text-surface-300">{top.reason}</span> ({top.count})
        </span>
      )}
      {s.passed.count > 0 && (
        <span className="text-emerald-300/80">{s.passed.count} correct pass{s.passed.count === 1 ? '' : 'es'}</span>
      )}
      <Link to="/missed" className="ml-auto text-accent hover:underline">Missed Book →</Link>
    </div>
  )
}

function Panel({ title, sub, children }) {
  return (
    <div className="rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5">
      <h2 className="text-[15px] font-semibold text-surface-100">{title}</h2>
      {sub && <p className="text-[12px] text-surface-500 mt-0.5 mb-4 max-w-3xl">{sub}</p>}
      {children}
    </div>
  )
}

function ClassCard({ title, stats, tone, hint }) {
  const ring = {
    emerald: 'border-emerald-400/25 bg-emerald-500/5',
    amber: 'border-amber-400/25 bg-amber-500/5',
    rose: 'border-rose-400/25 bg-rose-500/5',
  }[tone]
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${ring}`}>
      <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold">{title}</div>
      <div className="text-2xl font-semibold text-surface-100 tabular-nums">{stats?.n ?? 0}</div>
      <div className={`text-[12px] tabular-nums ${pnlTone(stats?.pnl)}`}>{signed$(stats?.pnl ?? 0)}</div>
      <div className="text-[10px] text-surface-600 mt-0.5">{hint}</div>
    </div>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <div className="text-surface-500">{label}</div>
      <div className="text-surface-200 tabular-nums font-medium">{value}</div>
      {hint && <div className="text-[10px] text-surface-600">{hint}</div>}
    </div>
  )
}
