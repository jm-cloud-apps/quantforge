// Shared trading-rules data + helpers. Imported by Rules.jsx (the editor)
// and by Layout.jsx (the ambient sidebar reminder) so both surfaces stay
// in sync as the user edits their rule set.

export const STORAGE_KEY = 'qf:trading-rules:v2'

export const CATEGORIES = ['MINDSET', 'RISK', 'ENTRY', 'EXIT']

// Default seed list — Qullamaggie-flavored discipline. Order matters: first
// read should feel like a calm, prioritized briefing.
export const DEFAULT_RULES = [
  // MINDSET
  { category: 'MINDSET', text: 'Patience is the edge — most of the time, do nothing. Wait for A+ setups.' },
  { category: 'MINDSET', text: 'Biggest size on the highest-conviction setups only. Small size on probes.' },
  { category: 'MINDSET', text: 'Trade with the market regime. Never fight a downtrend.' },
  { category: 'MINDSET', text: 'Sit on your hands during choppy, sideways markets. No setups, no trades.' },
  { category: 'MINDSET', text: 'After a string of losses, cut size in half or take a break. Reset the head.' },
  { category: 'MINDSET', text: 'No revenge trades. Walk away from the screen for 15 minutes after a meaningful loss.' },
  { category: 'MINDSET', text: 'Process over P&L. Grade your decisions, not your outcomes.' },
  { category: 'MINDSET', text: 'Pre-market plan: write down what you’ll trade and at what level before the bell.' },
  { category: 'MINDSET', text: 'Journal every trade with screenshots. Review weekly. The edge compounds.' },

  // RISK
  { category: 'RISK', text: 'Risk 0.25–1% of account per trade. Never more, no exceptions.' },
  { category: 'RISK', text: 'Cut losses fast. A small loss is the price of admission — never let it run.' },
  { category: 'RISK', text: 'Always know your stop before you enter. No stop, no trade.' },
  { category: 'RISK', text: 'Position size off the stop, not the conviction. Risk drives size — every time.' },
  { category: 'RISK', text: 'Never average down on a losing trade. Add only to winners.' },
  { category: 'RISK', text: 'Hold a max of 3–5 positions. Concentration beats diversification when risk is defined.' },
  { category: 'RISK', text: 'Define a maximum daily loss. Hit it, close the laptop. Tomorrow is another day.' },
  { category: 'RISK', text: 'Don’t hold through earnings unless that’s the explicit, planned trade.' },

  // ENTRY
  { category: 'ENTRY', text: 'Trade only A+ setups: Episodic Pivots, Breakouts, Parabolic Shorts.' },
  { category: 'ENTRY', text: 'Only buy stocks at or near 52-week / all-time highs. Leaders only.' },
  { category: 'ENTRY', text: 'Longs only above a rising 50-day MA with the rails stacked 10 > 20 > 50. MAs qualify the trade — the pivot times it.' },
  { category: 'ENTRY', text: 'Use 2x leveraged ETFs (TQQQ, SOXL, FNGU, NUGT, FAS) when the setup is A+ AND the market is in a confirmed uptrend.' },
  { category: 'ENTRY', text: 'Watch the leaders — they tell you what the market wants. Trade leaders, not laggards.' },
  { category: 'ENTRY', text: 'Trade leading sectors only. If the group is weak, the trade is weak.' },
  { category: 'ENTRY', text: 'Best moves usually come 3–5 days after the initial breakout — wait for the tight consolidation.' },
  { category: 'ENTRY', text: 'Require ADR > 5% — volatility is the raw material of returns.' },
  { category: 'ENTRY', text: 'Minimum $5M daily dollar volume. Liquidity matters when you need to exit.' },
  { category: 'ENTRY', text: 'The first 15–30 minutes is for amateurs. Let the open settle before entering.' },
  { category: 'ENTRY', text: 'Don’t chase. If the entry is gone, the entry is gone. Wait for the next one.' },
  { category: 'ENTRY', text: 'For Episodic Pivots, rank the catalyst before sizing in: Theme > Govt policy > Shortages > Sales / Products / Mgmt change. (Stockbee)' },

  // EXIT
  { category: 'EXIT', text: 'Sell 1/3 into strength on day 1. Lock in something on every winner.' },
  { category: 'EXIT', text: 'Trail the remaining position with the 10 or 20 EMA. Ride the trend.' },
  { category: 'EXIT', text: 'Choose the trail rail before entry — 10-day for the fastest movers, 20-day default, 50-day for core holds — and act only on daily closes below it.' },
  { category: 'EXIT', text: 'Move stop to breakeven once the trade extends meaningfully in your favor.' },
  { category: 'EXIT', text: 'The big money is made in the holding, not the trading. Let winners run.' },
]

export function seedRules() {
  return DEFAULT_RULES.map((r, i) => ({ ...r, id: i + 1 }))
}

export function loadRules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedRules()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return seedRules()
    return parsed
  } catch {
    return seedRules()
  }
}

export function saveRules(rules) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)) } catch {}
}

// Stable day-of-year so the daily-rule pick stays put through the session
// and changes at the user's local midnight. UTC math would drift the
// transition into the trading day for west-coast users.
export function dayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0)
  const diff = date - start
  return Math.floor(diff / 86400000)
}

// Deterministic rotation through the full rule set. Over a couple of weeks
// the user has seen every rule they wrote — ambient repetition without
// nagging or randomness.
export function getRuleOfDay(rules, date = new Date()) {
  if (!rules || rules.length === 0) return null
  return rules[dayOfYear(date) % rules.length]
}

// EP catalyst ranking — Stockbee (Pradeep Bonde). Strongest catalyst at top.
// Surfaced as a dedicated framework on the Rules page; the one-liner version
// also lives in DEFAULT_RULES so it shows up in the daily rotation.
export const CATALYST_HIERARCHY = [
  { tier: 1, name: 'Theme',              blurb: 'The story everyone wants to own. AI, GLP-1, nuclear, EV — when capital decides what the next decade looks like.' },
  { tier: 2, name: 'Government policy',  blurb: 'Tariffs, subsidies, mandates, rate decisions. Re-prices entire industries overnight.' },
  { tier: 3, name: 'Shortages',          blurb: 'Supply shocks. Inelastic demand meets constrained supply — pricing power follows.' },
  { tier: 4, name: 'Sales acceleration', blurb: 'Numbers that re-rate the multiple. Quarter-over-quarter growth surprising to the upside.' },
  { tier: 5, name: 'New product launch', blurb: 'A real product, not a press release. Buyers can imagine the next four quarters.' },
  { tier: 6, name: 'Management change',  blurb: 'New operator, new story. Slowest to play out — give it time.' },
]

// Moving-average framework — which of the 10/20/50 rails to trust, on which
// timeframe, at which point in the momentum-swing workflow. Rendered as a
// dedicated framework panel on the Rules page (components/MARails.jsx);
// one-liner versions also live in DEFAULT_RULES so they join the daily
// rotation. `moments` keys reference MA_MOMENTS below.
export const MA_RAILS = [
  {
    key: '10',
    period: '10',
    type: 'EMA',
    tagline: 'The fast rail',
    tone: 'ma10',
    rider: 'The strongest one or two leaders of the cycle — high-ADR names going near-vertical after a breakout or EP.',
    daily: [
      'Trail rail for the fastest movers — stay in as long as it closes above.',
      'A stock that has surfed the 10-day for weeks is an A-leader: pullbacks to it are add points, not exit warnings.',
    ],
    breakRule: 'First daily close below the 10 → trim or exit. No waiting for a reclaim.',
    weeklyNote: 'No weekly role — two weekly bars is not a trend. This rail lives on the daily only.',
    moments: ['MANAGE'],
  },
  {
    key: '20',
    period: '20',
    type: 'EMA',
    tagline: 'The default swing rail',
    tone: 'ma20',
    rider: 'Most breakout and HTF swing trades — the workhorse rail for the bread-and-butter setups.',
    daily: [
      'Sell ⅓–½ into strength on days 3–5, then trail the rest here.',
      'First orderly pullback to a rising 20 in a strong uptrend is a re-entry / add zone.',
    ],
    breakRule: 'A decisive daily close below the 20 ends the swing thesis. Exit and reassess flat.',
    weeklyNote: 'Daily-only rail. On the weekly, structure — higher lows, tight closes — matters more than any short MA.',
    moments: ['SCAN', 'MANAGE'],
  },
  {
    key: '50',
    period: '50',
    type: 'SMA',
    tagline: 'The institution line',
    tone: 'ma50',
    rider: 'Every candidate you screen — and core positions that have already made multiple legs.',
    daily: [
      'Qualifier: longs only above a rising 50. No story overrides a declining 50.',
      'A leader’s first touch of the 50 in a fresh uptrend is the classic pullback buy.',
      'Core winners trail here instead of the 10/20 — wider rail, longer hold.',
    ],
    breakRule: 'Losing the 50 on heavy volume = broken stock. Off the leaders list; never average down into it.',
    weeklyNote: '≈ the 10-week line — the same line at two zooms. Weekend verdicts against the 10-week are verdicts against the daily 50.',
    moments: ['SCAN', 'ENTER', 'MANAGE', 'WEEKEND'],
  },
]

// The annotated lifecycle drawn at the top of the MA Rails panel — one full
// trade from base to exit (components/MARailsVisuals.jsx). Keys must match
// HERO.markers in components/maRailsCharts.js; `moments` keys reference
// MA_MOMENTS so selecting a moment lights up the phases it owns.
export const MA_ANATOMY_PHASES = [
  {
    key: 'base', n: 1, title: 'Coiled base', moments: ['SCAN'],
    text: 'Price tightens while the rails flatten and stack 10 > 20 > 50 underneath. Nothing to do yet — this is where the watchlist gets built.',
  },
  {
    key: 'breakout', n: 2, title: 'Pivot buy', moments: ['ENTER'],
    text: 'Entry is the pivot through the base high, stop at low of day. The rails qualified the trade; the pivot times it.',
  },
  {
    key: 'surf', n: 3, title: 'Surf the 10', moments: ['MANAGE'],
    text: 'The steepest leg. Fast movers ride the 10-day — every shallow dip that holds it is strength, and an add point rather than a warning.',
  },
  {
    key: 'pb20', n: 4, title: 'First pullback to the 20', moments: ['MANAGE'],
    text: 'An orderly dip onto a rising 20 is the re-entry / add zone for the standard swing. Panic here is how winners get sold early.',
  },
  {
    key: 'tag50', n: 5, title: 'Tag of the 50', moments: ['MANAGE', 'WEEKEND'],
    text: 'Time, not just price, lets the 50 catch up. A leader’s first touch is the classic pullback buy — and the last line of defense.',
  },
  {
    key: 'exit', n: 6, title: 'Close below the rail', moments: ['MANAGE', 'WEEKEND'],
    text: 'A decisive daily close below the chosen rail ends the trade. Exit and reassess flat — reclaims can be re-bought, hope can’t.',
  },
]

// Rail Reps — active-recall drill at the bottom of the MA Rails panel
// (components/MARailsDrill.jsx). Each scenario shows a chart situation and
// asks for the call; retrieval practice is what turns the framework into a
// reflex. `chart` keys reference DRILL_CHARTS in components/maRailsCharts.js
// ('wick' and 'closeBelow' are drawn as candle scenes in the component).
// Options are shuffled per rep; exactly one has correct: true.
export const MA_DRILLS = [
  {
    key: 'wick',
    chart: 'wick',
    prompt: '2:30 PM. You’re trailing the 20 and price knifed through it an hour ago — it’s back above now.',
    options: [
      { text: 'Sell — the rail broke' },
      { text: 'Nothing until 4:00 PM', correct: true },
      { text: 'Add — the shakeout held' },
    ],
    explain: 'Iron law: rails are judged on the daily close, never the wick. At 2:30 there is no signal yet — acting on the wick is how planned trades turn Random.',
  },
  {
    key: 'closeBelow',
    chart: 'closeBelow',
    prompt: '4:00 PM print. Your trail rail is the 20 — today’s body closed decisively below it.',
    options: [
      { text: 'Hold — it can reclaim tomorrow' },
      { text: 'Exit — the swing thesis is over', correct: true },
      { text: 'Drop the trail to the 50 for room' },
    ],
    explain: 'A decisive daily close below the chosen rail ends the trade — exit and reassess flat. Switching to a wider rail mid-drawdown is rationalizing, not managing.',
  },
  {
    key: 'pb20',
    chart: 'pb20',
    prompt: 'Day 6 after the breakout. The first orderly pullback has just settled onto the rising 20.',
    options: [
      { text: 'Exit — momentum is fading' },
      { text: 'Add / re-enter at the rail', correct: true },
      { text: 'Wait for the 10 to be reclaimed' },
    ],
    explain: 'The first orderly pullback to a rising 20 in a strong trend is the re-entry / add zone — that’s the rail doing its job, not a warning.',
  },
  {
    key: 'dip10',
    chart: 'dip10',
    prompt: 'Your fastest mover has ridden the 10 for three weeks. Today it dipped to the rail and closed on it — still above.',
    options: [
      { text: 'Trim — it’s losing steam' },
      { text: 'Hold — surfing the 10 is strength', correct: true },
      { text: 'Move the trail out to the 50' },
    ],
    explain: 'A leader that surfs the 10 for weeks is an A-leader — dips to the rail that hold are add points. Rail changes are decided at entry or after a partial, never to give a position more room.',
  },
  {
    key: 'tangled',
    chart: 'tangled',
    prompt: 'Screener pings a bounce: price just tapped the 20 and bounced hard.',
    options: [
      { text: 'Buy the bounce off the 20' },
      { text: 'Skip — the rails are braided', correct: true },
      { text: 'Half size, stop at the 50' },
    ],
    explain: 'When the rails braid through price, no rail is support — every touch is a coin flip. MAs only mean something once they’re stacked and fanning apart.',
  },
  {
    key: 'notStacked',
    chart: 'notStacked',
    prompt: 'Great story, price is 25% off the lows and back above all three MAs. Buyable momentum name?',
    options: [
      { text: 'Yes — story plus momentum' },
      { text: 'Not until 10 > 20 > 50', correct: true },
      { text: 'Yes, with the 50 as the stop' },
    ],
    explain: 'Above the MAs isn’t the filter — stacked 10 > 20 > 50 under price is. An early bounce with inverted rails is a counter-trend trade, not a momentum candidate. No exceptions for a good story.',
  },
  {
    key: 'tag50',
    chart: 'tag50',
    prompt: 'A two-leg winner has corrected sideways for five weeks and just tagged the rising 50 for the first time.',
    options: [
      { text: 'Classic pullback buy zone', correct: true },
      { text: 'Broken — take it off the list' },
      { text: 'Dead money — move on' },
    ],
    explain: 'Time, not just price, lets the 50 catch up. A leader’s first tag of a rising 50 is the classic pullback buy — and the line every core hold is judged against.',
  },
  {
    key: 'break50',
    chart: 'break50',
    prompt: 'Ugly session on triple average volume — the close is well below the 50.',
    options: [
      { text: 'Average down — best discount in months' },
      { text: 'Off the leaders list — broken stock', correct: true },
      { text: 'Hold and wait for the weekly close' },
    ],
    explain: 'Losing the 50 on heavy volume is a broken stock — off the list, and never average down into it. The weekly can confirm later; the daily verdict already printed.',
  },
]

// Workflow moments — the "when do I actually look at this" half of the MA
// framework. Selecting one on the Rules page highlights the rails that
// matter at that moment and surfaces its checklist.
export const MA_MOMENTS = [
  {
    key: 'SCAN',
    label: 'Scanning',
    hint: 'Building the watchlist',
    timeframe: 'Weekly first → then daily',
    checklist: [
      'Weekly: stage-2 structure — higher highs and lows, a tightening base, price above a rising 10-week.',
      'Daily: price above a rising 50-day with the rails stacked 10 > 20 > 50.',
      'Not stacked = not a momentum candidate. Skip it — no exceptions for a good story.',
    ],
  },
  {
    key: 'ENTER',
    label: 'Entering',
    hint: 'Pulling the trigger',
    timeframe: 'Daily only',
    checklist: [
      'MAs qualify the trade — the pivot times it. Never buy just because price touched a rail.',
      'The stop lives at the pivot / low of day, not at an MA.',
      'Write the trail rail into the trade plan before entry: 10, 20, or 50. Deciding mid-trade is how rails get rationalized.',
    ],
  },
  {
    key: 'MANAGE',
    label: 'Managing',
    hint: 'In an open trade',
    timeframe: 'Daily closes only',
    checklist: [
      'Only the chosen rail’s daily close matters. Intraday wicks through an MA are noise, not signals.',
      'Fast mover → 10-day. Standard swing → 20-day. Core multi-leg hold → 50-day.',
      'Rail changes are decided at entry or after a partial — never mid-drawdown to give a loser more room.',
    ],
  },
  {
    key: 'WEEKEND',
    label: 'Weekend review',
    hint: 'Saturday routine',
    timeframe: 'Weekly',
    checklist: [
      'Every open position: still above the 10-week with the thesis intact → hold. Don’t micro-manage winners on the daily.',
      'Prune leaders: anything that closed the week below the 10-week — or lost the daily 50 on volume — comes off the list.',
      'Rebuild the scan list from weekly structure, not from Friday’s daily-bar noise.',
    ],
  },
]

// Volume framework — the "second opinion" on every price/rail signal. Rendered
// as a dedicated panel on the Rules page (components/VolumePatterns.jsx),
// deliberately paired with the MA Rails panel: the rail says *where*, volume
// says *whether to believe it*. VOLUME_PHASES annotates the hero chart (one
// trade seen through volume); keys match VOLUME_HERO events in
// components/volumeCharts.js. VOLUME_PATTERNS are the individual signatures;
// `glyph` keys reference VOLUME_GLYPHS in the same file.
export const VOLUME_PHASES = [
  {
    key: 'base', n: 1, title: 'Dry-up base', tone: 'info',
    text: 'Volume bleeds out as the base tightens — sellers exhausted, the float gone quiet. The drier the tape here, the more fuel stored for the break.',
  },
  {
    key: 'breakout', n: 2, title: 'Breakout surge', tone: 'good',
    text: 'The pivot fires on a wall of volume — 1.5–3×+ average on a wide, close-strong bar. That’s institutions voting; a breakout on thin volume is a trap.',
  },
  {
    key: 'pullback', n: 3, title: 'Pullback dry-up', tone: 'info',
    text: 'Price eases back onto the rail and volume vanishes — nobody rushing to sell. A light-volume pullback to a rising rail is the add, not the exit.',
  },
  {
    key: 'leg2', n: 4, title: 'Next-leg surge', tone: 'good',
    text: 'Demand returns on expansion — volume re-expands as the next leg breaks. Confirmation the trend still has sponsors behind it.',
  },
  {
    key: 'climax', n: 5, title: 'Climax / blow-off', tone: 'warn',
    text: 'The widest bar of the run on the heaviest volume of the run. That’s exhaustion, not strength — the last buyers piling in. Sell into it, don’t chase it.',
  },
]

export const VOLUME_PATTERNS = [
  {
    key: 'dryup', glyph: 'dryup', tone: 'info', signal: 'confirm',
    title: 'Volume dry-up', tagline: 'The coiled spring',
    what: 'Volume contracts to multi-week lows as the base tightens — often under half the 50-day average.',
    why: 'Sellers are exhausted and supply is scarce. The tighter the range and the drier the tape, the more explosive the release.',
    rule: 'Hunt for the driest volume at the apex of a tight base. Dry-up + tight range = ready to go.',
  },
  {
    key: 'breakout', glyph: 'breakout', tone: 'good', signal: 'confirm',
    title: 'Breakout expansion', tagline: 'Institutions vote',
    what: 'The pivot day prints 1.5–3×+ average volume on a wide bar that closes near its high.',
    why: 'Real demand from size. Volume is the proof the move is sponsored, not a head-fake off the algos.',
    rule: 'No volume, no trust. A breakout on below-average volume is guilty until proven — pass or keep it tiny.',
  },
  {
    key: 'pullback', glyph: 'pullback', tone: 'info', signal: 'confirm',
    title: 'Light-volume pullback', tagline: 'Healthy rest',
    what: 'Price eases back to a rising 10 / 20 rail while volume fades to below average.',
    why: 'No urgency to sell — just profit-takers thinning out. Rail + dry volume marks the low-risk add.',
    rule: 'Add / re-enter on the light-volume touch of the rail. Heavy volume into the dip flips it to a warning.',
  },
  {
    key: 'accumulation', glyph: 'accumulation', tone: 'good', signal: 'confirm',
    title: 'Up / down volume', tagline: 'Who’s in control',
    what: 'Up days carry visibly heavier volume than down days through the base and the trend.',
    why: 'Green-on-volume, red-on-quiet is the footprint of accumulation. The reverse is distribution — step aside.',
    rule: 'Favour names where the biggest bars are up bars. If the heavy volume is on red days, the story is over.',
  },
  {
    key: 'climax', glyph: 'climax', tone: 'warn', signal: 'caution',
    title: 'Climax / exhaustion', tagline: 'The blow-off',
    what: 'After an extended run, a huge volume spike on the widest up-bar — often a gap or vertical push.',
    why: 'The last buyers pile in while smart money sells to them. Peak volume near peak price is exhaustion.',
    rule: 'Sell into the climax, don’t buy it. Take profits into the spike and trail the rest tight.',
  },
  {
    key: 'distribution', glyph: 'distribution', tone: 'bad', signal: 'caution',
    title: 'Heavy-volume breakdown', tagline: 'Institutions leaving',
    what: 'A high-volume down day that closes below the rail — bigger than any recent up-bar.',
    why: 'Size is hitting the bid. A break on heavy volume is far more serious than a quiet drift below.',
    rule: 'A close below the 50 on heavy volume = broken stock. Off the list, and never average down into it.',
  },
]
