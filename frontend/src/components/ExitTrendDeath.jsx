import { TREND_DEATH_TELLS, RAIL_CASCADE_LADDER } from '../utils/tradingRules'
import { Candle } from './MARailsVisuals'
import { VOL_COLORS } from './volumeCharts'
import PanelShell from './framework/PanelShell'
import VerdictLadder from './framework/VerdictLadder'
import { TONE } from './framework/tones'

// Exit — Trend Death vs Shakeout. The position-level counterpart to the
// RAIL_TOUCH_LADDER in Candles × Rails: that one reads a single rail on a
// single day, this one answers "is the whole trend over?"
//
// The panel is built around one idea worth stating plainly: a lone MA break is
// weak evidence, because in a live stage-2 trend most pullbacks to a rising
// rail resolve upward. Confidence comes from independent tells agreeing. Data
// lives in utils/tradingRules.js; the two scenes below are presentation-only.

// Weight = discriminating power (how much the tell moves the estimate), not
// certainty. Literal classes for Tailwind's JIT.
const WEIGHT_META = {
  high:    { label: 'HIGH SIGNAL', cls: 'bg-danger/10 text-danger border-danger/30' },
  med:     { label: 'MEDIUM',      cls: 'bg-warning/10 text-warning border-warning/30' },
  confirm: { label: 'CONFIRMS',    cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
}

// The three daily rails, colored to match the MA Rails panel (10 = accent,
// 20 = cyan, 50 = purple) so the same line means the same thing page-wide.
const RAIL_HEX = { 10: TONE.good.hex, 20: TONE.info.hex, 50: TONE.purple.hex }

// Scene specs — viewBox 220×96, same stage as the framework Scene. The shared
// renderer only draws ONE rail; a cascade needs all three stacked, so this
// panel carries its own small multi-rail scene.
const SHAKEOUT = {
  rails: [
    { period: 10, x0: 10, y0: 52, x1: 210, y1: 30 },
    { period: 20, x0: 10, y0: 60, x1: 210, y1: 40 },
    { period: 50, x0: 10, y0: 70, x1: 210, y1: 52 },
  ],
  // Grind up → one bar wicks through the 10 toward the 20 → closes back above.
  candles: [
    { x: 30,  top: 50, bot: 56, hi: 48, lo: 58, up: true },
    { x: 60,  top: 44, bot: 50, hi: 42, lo: 52, up: true },
    { x: 90,  top: 38, bot: 44, hi: 36, lo: 46, up: true },
    { x: 120, top: 38, bot: 44, hi: 36, lo: 48, up: true },  // the tag — long lower wick
    { x: 150, top: 32, bot: 38, hi: 30, lo: 40, up: true },
    { x: 180, top: 24, bot: 32, hi: 22, lo: 34, up: true },
  ],
  vols: [0.40, 0.45, 0.40, 0.28, 0.50, 0.70],  // the dip is the QUIETEST bar
  hiVol: 3,
  mark: { x: 120, y: 46, r: 11 },
}

const CASCADE = {
  rails: [
    { period: 10, x0: 10, y0: 34, x1: 210, y1: 46 },  // rolled over
    { period: 20, x0: 10, y0: 40, x1: 210, y1: 44 },  // flattening
    { period: 50, x0: 10, y0: 56, x1: 210, y1: 52 },  // barely rising
  ],
  // Climax high → three red bodies taking out 10, then 20, then 50 in sequence.
  candles: [
    { x: 30,  top: 22, bot: 30, hi: 20, lo: 32, up: true },
    { x: 60,  top: 18, bot: 26, hi: 14, lo: 30, up: true },   // climax
    { x: 90,  top: 26, bot: 42, hi: 24, lo: 44, up: false },  // loses the 10
    { x: 120, top: 42, bot: 50, hi: 40, lo: 52, up: false },  // loses the 20
    { x: 150, top: 50, bot: 60, hi: 48, lo: 62, up: false },  // loses the 50
    { x: 180, top: 58, bot: 66, hi: 56, lo: 68, up: false },
  ],
  vols: [0.30, 0.50, 0.80, 0.90, 1.00, 0.85],  // supply expanding all the way down
  hiVol: 4,
  mark: { x: 150, y: 55, r: 12 },
}

const VOL_BASE = 90
const VOL_MAX_H = 20
const MONO = 'JetBrains Mono, monospace'

function CascadeScene({ spec, toneHex, label }) {
  return (
    <svg viewBox="0 0 220 96" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img" aria-label={label}>
      {spec.rails.map(r => (
        <g key={r.period}>
          <line x1={r.x0} y1={r.y0} x2={r.x1} y2={r.y1}
            stroke={RAIL_HEX[r.period]} strokeWidth="1.5" strokeOpacity="0.85" strokeLinecap="round" />
          <text x={r.x0 + 1} y={r.y0 - 3} fontSize="6.5" fontWeight="700"
            fill={RAIL_HEX[r.period]} fontFamily={MONO} fillOpacity="0.9">
            {r.period}
          </text>
        </g>
      ))}
      {spec.candles.map((c, i) => (
        <Candle key={i} x={c.x} top={c.top} bot={c.bot} hi={c.hi} lo={c.lo} up={c.up} w={11} />
      ))}
      {spec.vols.map((m, i) => {
        const c = spec.candles[i]
        const h = m * VOL_MAX_H
        const hi = spec.hiVol === i
        return (
          <rect key={`v${i}`} x={c.x - 5} y={VOL_BASE - h} width={10} height={h} rx="1"
            fill={hi ? toneHex : VOL_COLORS.muted} fillOpacity={hi ? 0.9 : 0.55} />
        )
      })}
      {spec.mark && (
        <circle cx={spec.mark.x} cy={spec.mark.y} r={spec.mark.r} fill="none"
          stroke={toneHex} strokeWidth="1.2" strokeDasharray="3 2.5" strokeOpacity="0.9" />
      )}
    </svg>
  )
}

function TellCard({ t }) {
  const w = WEIGHT_META[t.weight]
  return (
    <div className="rounded-2xl border border-surface-700/40 bg-surface-900/40 p-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13.5px] font-bold tracking-tight text-surface-100">{t.title}</div>
          <div className="text-[11px] text-surface-500 mt-0.5">{t.tagline}</div>
        </div>
        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${w.cls}`}>
          {w.label}
        </span>
      </div>

      {/* The contrast — same location on the chart, opposite meaning */}
      <div className="mt-3 space-y-2">
        <div className="rounded-lg border border-accent/25 bg-accent/[0.05] px-3 py-2">
          <div className="text-[9px] font-bold tracking-widest text-accent uppercase mb-0.5">Shakeout — hold</div>
          <p className="text-[11.5px] text-surface-300 leading-snug">{t.holds}</p>
        </div>
        <div className="rounded-lg border border-danger/25 bg-danger/[0.05] px-3 py-2">
          <div className="text-[9px] font-bold tracking-widest text-danger uppercase mb-0.5">Trend death — exit</div>
          <p className="text-[11.5px] text-surface-300 leading-snug">{t.dies}</p>
        </div>
      </div>

      <div className="flex-1" />

      <p className="mt-2.5 text-[11.5px] text-surface-500 leading-snug italic">{t.why}</p>
    </div>
  )
}

export default function ExitTrendDeath({ collapsible = false, collapsed = false, onToggle, id }) {
  return (
    <PanelShell
      id={id}
      titleId="exit-trend-death-title"
      title="Exit — Trend Death vs Shakeout"
      subtitle={<>When to leave for good. One rail break is <span className="text-surface-300">weak evidence</span> — independent tells agreeing is not.</>}
      icon={(
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6c3 0 5 3 7.5 3S15 4 18 4M3 13c3 0 5 2 7 2s3-1 4 1 2 4 4 4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v5h-5" />
        </svg>
      )}
      iconTone="bg-danger/10 border-danger/30 text-danger"
      border="border-danger/25"
      accent="from-danger via-warning to-cyan"
      orb="bg-danger/10"
      orbSide="right"
      badges={[
        { text: 'POSITION', cls: 'bg-danger/10 text-danger border-danger/30' },
        { text: 'FRAMEWORK', cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
      ]}
      collapsible={collapsible}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <>
        {/* The thesis — why a single break is not a signal */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            Exiting is an <span className="text-surface-200">estimate, not a rule</span>. In a live stage-2 trend most
            pullbacks to a rising rail resolve upward — that base rate is the entire reason trailing a rail works, and
            it’s why one MA break on its own is <span className="text-surface-200">weak evidence</span>. What actually
            raises the odds the trend is finished is <span className="text-surface-200">independent tells agreeing</span>:
            volume says who acted, slope says whether the engine still runs, RS says whether sponsorship already left,
            and the reclaim window says whether the sellers were weak hands or size. Because each answers a different
            question, agreement is real information — not the same fact counted four times.
          </p>
        </div>

        {/* The visual contrast — identical rails, opposite outcomes */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The same three rails, two outcomes</span>
          <span className="text-[11px] text-surface-500">what you’re trying to tell apart in real time</span>
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-accent/30 bg-accent/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12.5px] font-bold text-accent">Shakeout</span>
              <span className="text-[11px] text-surface-500">— the 20 catches it</span>
            </div>
            <CascadeScene spec={SHAKEOUT} toneHex={TONE.good.hex}
              label="Shakeout: price wicks through the rising 10 on the lightest volume of the move and closes back above it, with the 20 and 50 still rising underneath." />
            <p className="mt-2.5 text-[11.5px] text-surface-400 leading-snug">
              One bar tags through the 10 on the <span className="text-surface-200">quietest volume of the move</span> and
              closes back above it. Rails still stacked and rising — the trend used the rail, it didn’t lose it.
            </p>
          </div>
          <div className="rounded-2xl border border-danger/30 bg-danger/[0.05] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12.5px] font-bold text-danger">Cascade</span>
              <span className="text-[11px] text-surface-500">— nothing catches it</span>
            </div>
            <CascadeScene spec={CASCADE} toneHex={TONE.bad.hex}
              label="Trend death: after a climax high, three wide red bodies close below the 10, then the 20, then the 50 on expanding volume, with the 10 rolled over." />
            <p className="mt-2.5 text-[11.5px] text-surface-400 leading-snug">
              After a climax high, wide red bodies take out the 10, then the 20, then the 50 on
              <span className="text-surface-200"> expanding volume</span>, with no reclaim. Three independent bids failed
              in sequence — that’s structure, not noise.
            </p>
          </div>
        </div>

        {/* The ladder — tiered action, not a binary */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The cascade ladder — how much to sell, and when
          </div>
          <VerdictLadder rows={RAIL_CASCADE_LADDER} />
          <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
            Deliberately tiered rather than binary. Exiting a good trend early forfeits the fat tail that pays for every
            small loss, while riding a dead one gives back the whole advance — the costs aren’t symmetric, so neither is
            the response.
          </p>
        </div>

        {/* The discriminators */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The discriminators</span>
          <span className="text-[11px] text-surface-500">ranked by how much each one moves the estimate</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {TREND_DEATH_TELLS.map(t => (
            <TellCard key={t.key} t={t} />
          ))}
        </div>

        {/* Extension gauge — the leading flag, not a trigger */}
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-warning uppercase">Extension gauge</span>
            <span className="text-[10px] font-mono text-surface-500">— stretch above the 50 sets the prior</span>
          </div>
          <p className="text-[12px] text-surface-400 leading-snug">
            Before the break ever happens, <span className="text-surface-200">how far price has stretched above the 50</span>
            {' '}(ATR-normalised, so it’s comparable across names) tells you what a break would <em>mean</em>. Extreme
            extension only occurs near exhaustion, so a break from there has poor reversal odds — while the identical
            break from an un-stretched trend is ordinary noise.
          </p>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            Read it as a <span className="text-surface-200">leading flag, never a trigger</span>: extreme stretch doesn’t
            say sell, it says <span className="text-surface-200">pre-commit your exit now</span> — decide the level and the
            size while you’re still calm, because the decision gets much worse once the first red bar prints.
          </p>
        </div>

        {/* The asymmetry principle */}
        <div className="mt-3 rounded-xl border border-cyan/25 bg-surface-900/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">The asymmetry</span>
            <span className="text-[10px] font-mono text-surface-500">— slow on one rail, fast on structure</span>
          </div>
          <p className="text-[12px] text-surface-400 leading-snug">
            For anything you intend to <span className="text-surface-200">hold</span>, be slow at the single-rail level and
            fast at the structural one. Whipsawing out on a 10-day wick destroys the compounding that pays for the whole
            strategy; sitting through a distribution cascade hands back the entire trend.
          </p>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            The classic error is doing it backwards — <span className="text-surface-200">managing a core hold with the
            tight 10</span>, then reaching for the 100 or 200 as a stop after the structure already died at the 50.
            The 200 is a <span className="text-surface-200">stage filter, not a stop</span>; by the time it’s in play the
            trade ended a long way back.
          </p>
        </div>

        {/* Calibration — the honest quant footnote */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Calibrate it</span>
            <span className="mx-1.5">·</span>
            The weights on this panel are <span className="text-surface-300">conventions from the momentum lineage, not
            measured probabilities</span>. The real edge is checking them against your own history — tag each exit with
            which tells were present and compare the forward returns of the ones you sold against the ones you sat
            through. <span className="text-surface-300">Edge Validation</span> and the regime backtester already do this
            kind of forward-return scoring; a tell that doesn’t separate outcomes in your log is a tell you should stop
            paying attention to.
          </p>
        </div>
      </>
    </PanelShell>
  )
}
