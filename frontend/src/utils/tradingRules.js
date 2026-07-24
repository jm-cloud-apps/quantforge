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
  {
    tier: 1,
    name: 'Theme',
    blurb: 'The story everyone wants to own — when capital decides what the next decade looks like.',
    examples: [
      'A secular narrative capital is repricing around — AI, GLP-1, nuclear / uranium, quantum, stablecoins.',
      'Bellwether backing: a leader takes a stake or partners with a name (e.g. NVDA invests in an AI company) — smart-money validation plus a halo bid on the whole group.',
      'The group’s ETF and peers gap together — it’s the theme moving, not one stock.',
    ],
  },
  {
    tier: 2,
    name: 'Government policy',
    blurb: 'Re-prices entire industries overnight — the rules of the game change, not one company.',
    examples: [
      'Tariffs or export bans that re-price a supply chain overnight.',
      'Subsidies and mandates — IRA credits, defense budgets, EV / solar incentives.',
      'Regulatory approval, or a Fed / rate decision that changes the math for a whole sector.',
    ],
  },
  {
    tier: 3,
    name: 'Shortages',
    blurb: 'Supply shocks — inelastic demand meets constrained supply, and pricing power follows.',
    examples: [
      'A squeeze in a critical input — HBM memory, rare earths, uranium, shipping capacity.',
      'Constrained supply → pricing power and margin expansion across the group.',
      'A competitor’s outage or recall hands everyone else the volume.',
    ],
  },
  {
    tier: 4,
    name: 'Sales acceleration',
    blurb: 'Numbers that re-rate the multiple — growth surprising AND accelerating, not just a beat.',
    examples: [
      'A blowout quarter — revenue growth accelerating QoQ, not merely beating the estimate.',
      'Raised guidance, or a huge booking / backlog that re-rates the forward multiple.',
      'A design win or supply contract with a mega-cap customer — future revenue made concrete.',
    ],
  },
  {
    tier: 5,
    name: 'New product launch',
    blurb: 'A real product, not a press release — buyers can imagine the next four quarters.',
    examples: [
      'A shipping product with real demand — not a roadmap slide.',
      'A category-defining launch the market can model out several quarters.',
      'Platform expansion into a new, larger addressable market.',
    ],
  },
  {
    tier: 6,
    name: 'Management change',
    blurb: 'New operator, new story — the slowest to play out, so give it time.',
    examples: [
      'A proven operator or activist takes the helm — a new capital-allocation story.',
      'A strategic review, spin-off, or buyback that unlocks trapped value.',
      'Slowest to play out — measure the thesis in quarters, not days.',
    ],
  },
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

// The weekly-chart companion to MA_RAILS. Different lines, different job: the
// daily rails execute (entries, trails, exits); the weekly rails give context
// (trend, stage, regime) and decide whether the daily is worth trading at all.
// 10w ≈ 50-day, 30w ≈ 150-day (Weinstein stage line), 40w ≈ 200-day. Rendered
// as a parallel card row under the daily rails in components/MARails.jsx.
export const WEEKLY_RAILS = [
  {
    key: '10w',
    period: '10',
    type: 'SMA',
    tagline: 'The trend line',
    tone: 'wk10',
    rider: 'Core holds and true leaders — the line a monster trends above for months without a second thought.',
    lines: [
      'Same line as the daily 50, one zoom out. The weekend “is the trend still intact?” verdict is made here.',
      'A leader that keeps closing each week above a rising 10-week is still in its run — hold the core, stop micro-managing the daily.',
    ],
    breakRule: 'First weekly close below a flattening 10-week after a long advance = character change. Lighten the core — the easy trend is over.',
    dailyNote: 'Enforced on the daily: a weekly verdict against the 10-week is executed as a daily close below the 50 — never sold off a half-printed weekly bar.',
  },
  {
    key: '30w',
    period: '30',
    type: 'SMA',
    tagline: 'The stage gate',
    tone: 'wk30',
    rider: 'Every name you consider — it sets the stage before you look at a single daily pivot.',
    lines: [
      'Weinstein Stage 2 = price above a rising 30-week. That is the only stage you buy breakouts in.',
      'Below a falling 30-week = Stage 4: no “it’s basing,” that’s a pass or a short — worked on the Stage Analysis page, not here.',
    ],
    breakRule: 'Price breaking a rising 30-week is Stage 3 topping until proven otherwise — stop starting new longs in the name.',
    dailyNote: 'A filter, never a trail. It says whether the daily is scannable at all; it never times an entry or sets a stop.',
  },
  {
    key: '40w',
    period: '40',
    type: 'SMA',
    tagline: 'The regime line',
    tone: 'wk40',
    rider: 'The index first, then your leaders — the one line that says risk-on or risk-off at the highest zoom.',
    lines: [
      'Index above a rising 40-week = bull backdrop: breakouts work, hold winners longer, press size.',
      'Index below a falling 40-week = bear backdrop: breakouts fail, cut size, respect shorts.',
    ],
    breakRule: 'Index losing the 40-week on rising volume = risk-off. Cut gross exposure first, ask questions later.',
    dailyNote: '≈ the 200-day — the same backdrop check the daily crowd runs. It sets your aggression, not your entries.',
  },
]

// Crossover events — what a cross *means*, and whether it changes the trade.
// The through-line: a cross confirms or gates, it never triggers. The entry is
// always the pivot; the exit is always a daily close below the rail. `scope`
// tags the chart it lives on; `verdict.label` is the one-word call. Rendered as
// the Crossovers panel in components/MARails.jsx.
export const MA_CROSSOVERS = [
  {
    key: 'px50',
    pair: 'price × 50',
    scope: 'DAILY',
    tone: 'gate',
    title: 'The qualifier',
    meaning: 'Price reclaiming a rising 50 turns a name back on; a heavy-volume close below turns it off.',
    verdict: { label: 'GATE', text: 'A state filter, not a signal. Above a rising 50 = eligible to trade; a decisive close below = off the leaders list. The 50 qualifies, the pivot times.' },
  },
  {
    key: '10x20',
    pair: '10 × 20',
    scope: 'DAILY',
    tone: 'confirm',
    title: 'Momentum shift',
    meaning: '10 crossing back above the 20 says the pullback is spent; slipping below says the fast leg is cooling.',
    verdict: { label: 'CONFIRM', text: 'Confirms, never triggers. The recross tells you the dip is over — but the buy is still the pivot back through the base high, not the cross itself.' },
  },
  {
    key: 'stack',
    pair: '10 › 20 › 50',
    scope: 'DAILY',
    tone: 'confirm',
    title: 'Stack forming / flipping',
    meaning: 'Rails fanning into 10 > 20 > 50 = momentum on. Braiding together = coin flip. Inverting to 10 < 20 < 50 = momentum gone.',
    verdict: { label: 'FILTER', text: 'The two-second scan filter. Stacked and fanning = tradeable; braided = skip; inverted = no longs, no exceptions for a good story.' },
  },
  {
    key: '10x30w',
    pair: '10w × 30w',
    scope: 'WEEKLY',
    tone: 'context',
    title: 'Stage transition',
    meaning: 'The 10-week crossing up through the 30-week is the classic Stage 1 → 2 turn; crossing down is Stage 3 → 4.',
    verdict: { label: 'WATCH', text: 'A watchlist tell, not a buy. The weekly cross flags a name entering Stage 2 — confirm with a daily base and pivot before risking a cent.' },
  },
  {
    key: '50x200',
    pair: '50 × 200',
    scope: 'INDEX',
    tone: 'backdrop',
    title: 'Golden / death cross',
    meaning: 'The 50-day crossing the 200-day — the headline “golden cross” (up) and “death cross” (down), read on the index.',
    verdict: { label: 'BACKDROP', text: 'Lagging backdrop, never a trigger. By the time it prints the move is old — use it to set aggression on the index, never to time a name.' },
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
    key: 'pocketpivot', glyph: 'pocketpivot', tone: 'good', signal: 'confirm',
    title: 'Pocket pivot', tagline: 'The early tell inside the base',
    what: 'An up-day still inside the base whose volume tops the highest down-day volume of the prior ~10 sessions — a green bar bigger than any recent red one.',
    why: 'Supply just got overwhelmed before the pivot even prints. Institutions accumulating inside the range show up as up-volume swamping every recent down-day — the footprint that precedes the breakout.',
    rule: 'Use it as an early, lower-risk entry off a rising 10 / 20 inside a proper base — stop under the pivot bar. Not a breakout substitute: a pocket pivot in a loose, sloppy base is just a bounce.',
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

// Quantified volume thresholds — the "put numbers on it" strip under the
// pattern cards. Values are working conventions from the momentum playbook
// (O'Neil / Qullamaggie lineage), meant to be checked against your own trade
// log, not physical constants. Everything is measured against the stock's own
// 50-day average volume — volume is only meaningful relative to itself.
export const VOLUME_METRICS = [
  {
    key: 'rvol', label: 'Breakout day', value: '≥ 1.5–3× avg', tone: 'good',
    note: 'RVOL vs the 50-day average volume. Intraday, judge the pace — volume by 10:30 vs a normal day by 10:30 — not the running total against the full-day bar.',
  },
  {
    key: 'dryup', label: 'Base apex', value: '≤ ½ × avg', tone: 'info',
    note: 'The quietest bars of the whole base should print where the range is tightest. Quiet + tight = coiled; loud + tight = crowded and contested.',
  },
  {
    key: 'breakdown', label: 'Breakdown bar', value: '> any up-bar', tone: 'bad',
    note: 'A rail break counts as distribution when its volume beats every up-day in the pattern. Heavier than the buyers ever were = supply, not noise.',
  },
  {
    key: 'floor', label: 'Tradability floor', value: '≥ $5M / day', tone: 'warn',
    note: 'Dollar volume, not share count — same floor as the entry rules. Below it, spreads and slippage make every volume signal on this panel unreliable.',
  },
]

// Candle tells — how the momentum lineage actually reads candles: not named
// Japanese patterns, but supply/demand math — how wide the bar is, where it
// closed, on how much volume. Rendered as the Candle Tells panel
// (components/CandleTells.jsx); `glyph` keys reference the scene specs there.
// signal: confirm = act-with, caution = act-against, context = a lens.
export const CANDLE_TELLS = [
  {
    key: 'demand', glyph: 'demand', tone: 'good', signal: 'confirm',
    title: 'Demand bar', tagline: 'The bar a breakout must be',
    what: 'A wide-range up day that closes in its top quarter on ≥1.5× average volume.',
    why: 'Buyers kept paying up into the close — that’s institutions reaching for stock, not a morning pop that faded.',
    rule: 'The breakout day must be one of these. Wide bar + strong close + volume, or don’t trust the pivot.',
  },
  {
    key: 'inside', glyph: 'inside', tone: 'info', signal: 'confirm',
    title: 'Tight / inside days', tagline: 'The coil after the thrust',
    what: 'After a strong move, small bars inside the prior range — closes stacked within a few percent, volume fading.',
    why: 'Digestion, not distribution. Holders are sitting and sellers are done; this is what the next pivot is made of.',
    rule: 'Tight closes + dry volume near highs = a setup forming. Wide-and-loose bars in the same spot = walk away.',
  },
  {
    key: 'wick', glyph: 'wick', tone: 'warn', signal: 'caution',
    title: 'Upper-wick rejection', tagline: 'Supply overhead',
    what: 'A long topping tail after extension — price reached well above, closed far off the high, volume heavy.',
    why: 'Someone sold hard into the reach. The wick is where demand met a wall of supply and lost.',
    rule: 'One wick after extension = warning shot. Wick on the run’s heaviest volume = sell into the next strength.',
  },
  {
    key: 'reclaim', glyph: 'reclaim', tone: 'good', signal: 'confirm',
    title: 'Undercut & reclaim', tagline: 'The shakeout',
    what: 'A flush through an obvious level or rail that closes back above it the same day.',
    why: 'Stops cleared, weak hands gone — the bear trap that often launches the next leg with less supply overhead.',
    rule: 'The reclaim close is the signal, never the flush. Same iron law: nothing is true until 4:00 PM prints.',
  },
  {
    key: 'churn', glyph: 'churn', tone: 'bad', signal: 'caution',
    title: 'Churn', tagline: 'Effort without result',
    what: 'Huge volume, tiny range, no progress — usually late in a long run.',
    why: 'All that buying got absorbed. Size is selling into strength — distribution dressed up as a strong tape.',
    rule: 'Heaviest volume of the run + smallest gain of the run = someone big is leaving. Tighten the trail.',
  },
  {
    key: 'outside', glyph: 'outside', tone: 'bad', signal: 'caution',
    title: 'Outside reversal', tagline: 'The key reversal',
    what: 'After extension: a bar that trades above the prior day’s high, then engulfs it and closes below the prior day’s low — on heavy volume.',
    why: 'Buyers made the new high and were overwhelmed the same session. One bar trapped everyone who bought yesterday — that supply now sits overhead.',
    rule: 'After a long run, an outside-down day is a sell-into-strength cue: take partials and tighten the trail on that same close.',
  },
  {
    key: 'follow', glyph: 'follow', tone: 'good', signal: 'confirm',
    title: 'Follow-through', tagline: 'Days 2–5 tell the truth',
    what: 'After the demand bar: tight bars holding the top third of the breakout candle, dips getting bought before each close, volume staying warm.',
    why: 'Real breakouts get defended — the institutions that bought day 1 keep supporting day 2 and 3. Giving the whole bar back says the buyers were a one-day crowd.',
    rule: 'Judge every breakout by its second and third day, not its first. A close back inside the base within 3 days = failed pivot — exit, don’t hope.',
  },
  {
    key: 'gap', glyph: 'gap', tone: 'info', signal: 'context',
    title: 'Gap open', tagline: 'Hold or fill decides',
    what: 'The session after a gap up: does the day build on the open (close above it), or bleed back into the gap (close below the open)?',
    why: 'A gap is an auction verdict printed before the bell. Holding above the open all day is demand confirming the reprice; fading below the open is the gap being sold into.',
    rule: 'Gap-and-hold above the open = tradeable strength. Gap-and-fade below the open = distribution — and for EPs, a close below the gap-day low kills the trade.',
  },
  {
    key: 'weekly', glyph: 'weekly', tone: 'info', signal: 'context',
    title: 'The weekly wrap', tagline: 'Five dailies, one verdict',
    what: 'Every weekly candle is five dailies compressed — Friday’s close decides where the week actually settled.',
    why: 'A strong Mon–Wed means nothing if Friday closes the week low: the weekly prints a topping tail. Weekly wicks are late-week selling.',
    rule: 'Judge weekly candles on Friday only. An outside / reversal week after a long advance is a daily-timeframe exit cue.',
  },
]

// Gap taxonomy — the same gap-up bar means opposite things depending on WHERE
// in the move it prints. Rendered as a 3-row ladder under the Candle Tells
// cards (components/CandleTells.jsx); mirrors RAIL_TOUCH_LADDER's shape. The
// `gap` tell reads hold-vs-fill on one gap; this reads which gap you're looking
// at — the context that decides whether a hold is an entry or an exit cue.
export const GAP_TAXONOMY = [
  {
    key: 'breakaway', tone: 'good', label: 'Breakaway gap',
    where: 'Off a base / at the pivot',
    verdict: 'Buy — the move is starting',
    note: 'A gap out of a proper base on heavy volume is the breakout in one bar — demand so urgent it skipped the pivot. Highest-odds gap; stop under the gap-day low.',
  },
  {
    key: 'runaway', tone: 'info', label: 'Runaway / continuation gap',
    where: 'Mid-trend, already extended a leg',
    verdict: 'Hold / add — trend confirming',
    note: 'A gap partway up an established advance — a measuring gap that says the trend has more to go. Add only if it holds its open; it marks roughly the middle of the move, not the end.',
  },
  {
    key: 'exhaustion', tone: 'bad', label: 'Exhaustion gap',
    where: 'After a long, extended run',
    verdict: 'Sell into it — the move is ending',
    note: 'A gap late in a climactic run, often the widest bar of all — the last buyers paying up. It looks identical to a breakaway; the difference is you’re 40%+ into the move, not at its start. Trim, don’t chase.',
  },
]

// Candles at the rails — the interaction layer between the two frameworks
// above: the rail says WHERE to look, the candle says WHEN to act. Rendered as
// its own panel (components/CandlesAtRails.jsx) between Candle Tells and the
// catalyst ladder. Two sides: how a pullback buy at a rising rail actually
// prints (approach → turn bar → trigger), and how selling around the rail
// actually prints (extension → shakeout wick → exit body). `glyph` keys
// reference the scene specs in the component; `side` groups the cards.
export const RAIL_CANDLES = [
  // ── BUY SIDE — anatomy of the pullback buy ────────────────────────────
  {
    key: 'approach', side: 'buy', glyph: 'approach', tone: 'info', signal: 'context',
    title: 'The approach', tagline: 'Shrinking bodies, dying volume',
    what: 'Price drifts down into the rising 10/20 on small red bodies, each range tighter than the last, volume fading to the driest of the move.',
    why: 'That’s profit-taking, not urgent selling — the auction running out of sellers exactly where the rail is rising to meet price.',
    rule: 'Stalk, don’t buy. An orderly approach earns the alert; wide red bars accelerating into the rail is a falling knife — stand aside.',
  },
  {
    key: 'turn', side: 'buy', glyph: 'turn', tone: 'good', signal: 'confirm',
    title: 'The turn bar', tagline: 'The rail holds — and a candle proves it',
    what: 'The bar that tags the rail intraday and refuses it: lower wick into the line, close in the upper half — or an undercut that closes back above the rail the same day.',
    why: 'The tag is where dip-buyers met the last sellers and won; the close location is the verdict. A bar that closes on its low at the rail proved nothing.',
    rule: 'No turn bar, no trade. The rail alone is never the signal — the candle that rejects it is.',
  },
  {
    key: 'trigger', side: 'buy', glyph: 'trigger', tone: 'good', signal: 'confirm',
    title: 'The trigger', tagline: 'Buy the proof, stop under the tag',
    what: 'Entry is the push through the turn bar’s high — ideally a green bar on re-expanding volume that closes back above the 10-day.',
    why: 'Breaking the turn-bar high confirms the low is in with the rail behind it — and the structure that just proved itself defines the risk.',
    rule: 'Buy the turn-bar high; stop under the turn-bar low, just below the rail. If the trigger never prints, there was no trade — that’s the system working.',
  },
  // ── SELL SIDE — selling around the rail ───────────────────────────────
  {
    key: 'stretch', side: 'sell', glyph: 'stretch', tone: 'warn', signal: 'caution',
    title: 'Stretched above the rail', tagline: 'Sell the reach, not the snap-back',
    what: 'After a long leg: wide green bars going near-vertical, price 20%+ above the 10-day — the gap between candle and rail at its widest of the run.',
    why: 'Distance from the rail is the temperature gauge. Climax buying stretches the band right before it snaps back — and that reach is where partials fill at great prices.',
    rule: 'Sell partials into extension, never into the pullback. If you’re selling at the rail, you’re selling the panic — sell the reach instead.',
  },
  {
    key: 'shakeout', side: 'sell', glyph: 'shakeout', tone: 'info', signal: 'confirm',
    title: 'The wick below', tagline: 'A tail through the rail is not a break',
    what: 'An intraday flush through the rail that closes back above it — long lower tail, often on the heaviest volume in days.',
    why: 'Stops ran, weak hands left, and the close says buyers took it back: the undercut & reclaim printing at the exact line everyone watches.',
    rule: 'Judged at 4:00 PM only. Wick below + close above = hold, often add. Selling the intraday flush is donating the shakeout.',
  },
  {
    key: 'exitbody', side: 'sell', glyph: 'exitbody', tone: 'bad', signal: 'caution',
    title: 'The exit body', tagline: 'A real close below ends it',
    what: 'A full body closing decisively below the trail rail — wide red bar, close near the low, volume above every recent up-day.',
    why: 'That isn’t a wick that got bought — it’s supply still in control at the print. The candle and the rail agree: the swing is over.',
    rule: 'Body below the rail at the close = exit, no negotiating. Widening the trail doesn’t rescue it — hoping for the reclaim is how a plan turns Random.',
  },
]

// The verdict ladder — how to read the close on any rail touch. The 4:00 PM
// decision table for the panel above: same candle location, three different
// verdicts depending on body vs wick and volume.
export const RAIL_TOUCH_LADDER = [
  {
    key: 'hold', tone: 'good', label: 'Wick below, close above',
    verdict: 'Shakeout — hold / add',
    note: 'The flush was bought back before the bell. That’s strength using the rail, not losing it.',
  },
  {
    key: 'watch', tone: 'warn', label: 'Small body just below, quiet volume',
    verdict: 'Warning — no adds, judge tomorrow',
    note: 'A marginal close is a question, not a verdict. Any follow-through lower confirms the break; a fast reclaim voids it.',
  },
  {
    key: 'exit', tone: 'bad', label: 'Wide body below on heavy volume',
    verdict: 'Broken — exit now',
    note: 'Size stayed in control into the close. The reclaim you’re hoping for is the exit liquidity someone else is selling into.',
  },
]

// ── Bases & Pivots ──────────────────────────────────────────────────────────
// The structure framework (components/BasesAndPivots.jsx): what a valid base
// looks like (VCP / flag / cup-with-handle), the quantified quality gate, base
// counting, and pivot quality. Every panel above reads the *moment*; this one
// defines the *structure* the moment triggers out of.

export const BASE_PATTERNS = [
  {
    key: 'vcp', glyph: 'vcp', tone: 'good', signal: 'confirm',
    title: 'VCP — the contraction', tagline: 'Each pullback shallower than the last',
    what: 'Two to four contractions, each retracement roughly half the prior one (25% → 12% → 6%), volume drying at every successive low — price coiling into the pivot.',
    why: 'Each contraction is supply changing hands at higher lows: sellers exhaust in sequence. By the final tight coil the float that wanted out is out — the smallest demand moves it.',
    rule: 'Count the contractions and demand the sequence tightens — each leg about half the prior, the final one in single digits on the driest volume of the base. Loose, widening swings are not a VCP, whatever the shape.',
  },
  {
    key: 'htf', glyph: 'htf', tone: 'info', signal: 'confirm',
    title: 'Flag / high-tight flag', tagline: 'A vertical pole, a quiet flag',
    what: 'A sharp advance in days-to-weeks (the pole), then 3–15 sessions drifting sideways-to-down on collapsing volume, holding the upper third of the pole. The rare 100%-pole version is the high-tight flag.',
    why: 'The pole proves demand extreme enough to trap everyone underinvested; the shallow flag proves holders won’t sell even after a huge run. Rest without retracement is the strongest statement a chart makes.',
    rule: 'The flag must hold the upper third of the pole on drying volume. A “flag” that gives back half its pole is a correction with better marketing — pass.',
  },
  {
    key: 'cup', glyph: 'cup', tone: 'purple', signal: 'confirm',
    title: 'Cup with handle', tagline: 'The rounded turn, then the final shake',
    what: 'A rounded multi-week base — decline, patient rounding low, recovery to near the old high — then a small handle drifting DOWN on quiet volume in the upper half, just before the pivot.',
    why: 'The cup rebuilds ownership from weak hands to strong ones slowly; the handle is the last shakeout — the left-side buyers finally selling flat, right before the break they waited months for.',
    rule: 'The handle must form in the upper half of the cup and drift down on quiet volume. A handle that wedges upward, or forms below the midpoint, is the failure-prone fake.',
  },
]

// The quality gate — is the base even valid? Quantified thresholds in the same
// spirit as VOLUME_METRICS: working conventions from the lineage, to be
// validated against the trade log.
export const BASE_QUALITY = [
  {
    key: 'depth', label: 'Depth', value: '≤ 25–30%', tone: 'good',
    note: 'High-to-low of the base in a normal tape — shallower is stronger. 40%+ is a broken chart rebuilding, not a base; that’s Stage-1 work, not a buy setup.',
  },
  {
    key: 'length', label: 'Length', value: '≥ 3 weeks', tone: 'info',
    note: 'Flags/VCPs need 3+ weeks (a days-long pause is only tradeable as a flag WITH a pole); cups typically 7 weeks to months. Bases need time — time is what transfers the float.',
  },
  {
    key: 'apex', label: 'The apex', value: 'tightest + driest', tone: 'warn',
    note: 'The final days before the pivot should be the tightest ranges AND the driest volume of the entire base — the dry-up metric from the Volume panel, applied at the exact spot it matters.',
  },
  {
    key: 'trend', label: 'Prior trend', value: '≥ 30% advance', tone: 'purple',
    note: 'A base needs something to base ON: a meaningful prior advance, price above the 150/200 stage lines. No qualifying uptrend = nothing coiling, just sideways noise.',
  },
]

// Base count — how far along the story is. Early bases get bought; late bases
// get passed. Same three-row ladder format as the other verdict tables.
export const BASE_COUNT_LADDER = [
  {
    key: 'early', tone: 'good', label: 'Base 1–2 off a fresh Stage-2 turn',
    verdict: 'Early — buy them',
    note: 'The story is obvious to nobody yet; institutions are still building. The best odds of the entire cycle live here.',
  },
  {
    key: 'third', tone: 'warn', label: 'Base 3',
    verdict: 'Late — smaller, stricter',
    note: 'The story is known and the easy holders are in. Still tradeable — but tighten every quality criterion and cut the size.',
  },
  {
    key: 'late', tone: 'bad', label: 'Base 4+ · or wide-and-loose late base',
    verdict: 'Obvious to everyone — pass',
    note: 'Late-stage bases fail as a rule: climax risk now exceeds continuation odds. Let someone else own the top tick.',
  },
]

// ── Trade Lifecycle ─────────────────────────────────────────────────────────
// The management framework (components/TradeLifecycle.jsx): entry day to
// resolution as a day-by-day protocol, plus the progressive-exposure ladder.
// side: 'early' = the first days decide; 'campaign' = adds, earnings, gaps.

export const LIFECYCLE = [
  {
    key: 'entry', side: 'early', glyph: 'entry', tone: 'info', signal: 'context',
    title: 'Day 0 — the entry print', tagline: 'Set it, then leave it alone',
    what: 'Position on at the pivot, stop under the breakout-day low / handle low, size = planned risk ÷ stop distance. The trail rail (10/20/50) is written into the plan before the fill.',
    why: 'The day-0 candle is still printing — judging a breakout intrahour is how good entries get sold to the first wiggle. Everything today was decided before the order went in.',
    rule: 'Set the stop, write the rail, walk away. No adds, no “already up 2%” partials, no stop-widening on day 0.',
  },
  {
    key: 'partial', side: 'early', glyph: 'partial', tone: 'good', signal: 'confirm',
    title: 'Day 1–3 — sell strength, then breakeven', tagline: 'Bank R, free-roll the rest',
    what: 'Real breakouts pay almost immediately — follow-through within 1–3 days. Sell ⅓–½ into that strength; after the partial (or ~2–3R), the stop moves to breakeven.',
    why: 'Partials into demand convert paper edge into banked R while the runner stays on. The breakeven stop makes the remainder a free roll — but only after the market has PROVEN the move.',
    rule: 'Strength in the first 3 days → take the partial, then breakeven. Moving to BE before any follow-through is choking the trade inside normal noise — earn it first.',
  },
  {
    key: 'timestop', side: 'early', glyph: 'timestop', tone: 'warn', signal: 'caution',
    title: 'Day 3–5 — the time stop', tagline: 'Wrong on schedule is still wrong',
    what: 'No follow-through by day 3–5: the breakout sits, or drifts back toward the pivot on quiet volume, while other setups are moving.',
    why: 'The big ones tend to work nearly immediately. Dead money isn’t neutral — it’s open risk plus opportunity cost, and stale breakouts are the ones that get undercut.',
    rule: 'No progress by day 3–5 = cut it (or cut half), even above the stop. The price stop is for being wrong on direction; the time stop is for being wrong on schedule.',
  },
  {
    key: 'add', side: 'campaign', glyph: 'add', tone: 'good', signal: 'confirm',
    title: 'Adding — winners only, at structure', tagline: 'Average up, never sideways',
    what: 'Adds happen at the NEXT structural event: the first orderly pullback to the rising 10/20 (the turn bar from Candles × Rails), or the next flag/base pivot.',
    why: 'Adding at structure keeps the blended cost defensible with a logical stop behind it. Adding on feelings converts a winner into a full-size position bought at the top of its range.',
    rule: 'Add only to winners, only at rails or pivots — and re-run the math: new size × new stop distance still ≤ planned risk. Never add to a loser; that’s the squeeze rule wearing long clothes.',
  },
  {
    key: 'earnings', side: 'campaign', glyph: 'earnings', tone: 'warn', signal: 'caution',
    title: 'The earnings gate', tagline: 'The gap your stop can’t catch',
    what: 'A known date where the stock can reprice 10–30% overnight — the one scheduled event the daily-close discipline cannot manage.',
    why: 'Overnight gaps skip the stop entirely. Full size into a print isn’t a trade with defined risk — it’s a coin flip holding your month’s R.',
    rule: 'No new entries within ~5 days of earnings. Holding through requires all three: planned in advance, partials already banked, and a cushion bigger than a bad gap. Otherwise: flat before the print.',
  },
  {
    key: 'gap', side: 'campaign', glyph: 'gap', tone: 'bad', signal: 'caution',
    title: 'The gap against you', tagline: 'The one intraday exception',
    what: 'The stock opens well below the stop — it never filled, and the plan is already broken at the bell with the loss bigger than designed.',
    why: 'The close-only iron law assumes continuous prices; a gap breaks the assumption. Waiting for 4:00 PM on a position that opened through its stop is rationalizing, not discipline.',
    rule: 'Gap through the stop = exit at the open or the first failed bounce, no negotiating for a reclaim. The loss already happened — the only choice left is whether it compounds.',
  },
]

// Progressive exposure — the ladder that sizes the whole book off your own
// recent results. Your last 5–10 trades are the regime gauge that never lags.
export const EXPOSURE_LADDER = [
  {
    key: 'pilot', tone: 'warn', label: 'Coming off stops / a fresh regime',
    verdict: 'Pilot size — ¼ to ½ risk',
    note: 'Probe, don’t press. Pilots buy information; full size buys conviction you haven’t earned back yet.',
  },
  {
    key: 'press', tone: 'good', label: 'Pilots working — recent trades green',
    verdict: 'Normal risk — press what works',
    note: 'Scale to plan risk and add at structure. The ladder climbs on results, never on forecasts.',
  },
  {
    key: 'cut', tone: 'bad', label: 'Last 5–10 breakouts mostly failing',
    verdict: 'Half size, then half again',
    note: 'Your own fills are the most honest market read you own — obey them before the indices explain why.',
  },
]

// ── Short Side ──────────────────────────────────────────────────────────────
// The short-side framework panel (components/ShortSide.jsx): the lineage's one
// A+ short — the parabolic short — plus the backside re-short, taught as the
// MIRROR of the long frameworks above. Structure mirrors; risk does not:
// losses are unbounded, squeezes are violent, so the discipline rules are
// stricter than their long-side counterparts, not symmetrical.

// The mirror map — every long-side concept on this page, flipped. This is the
// connective tissue back to the MA Rails / Candles × Rails panels.
export const SHORT_MIRROR = [
  { long: 'Rails stacked 10 > 20 > 50, fanning up', short: 'Rails inverted 10 < 20 < 50, fanning down' },
  { long: 'Stage 2 — above a rising 30-week', short: 'Stage 4 — below a falling 30-week' },
  { long: 'Pullback to a rising rail = add zone', short: 'Rally into a declining rail = short zone' },
  { long: 'Undercut & reclaim = shakeout, hold', short: 'Overthrow & fail = bull trap, short signal' },
  { long: 'Daily close below the rail = exit long', short: 'Daily close above the declining rail = cover' },
  { long: 'Buy the turn-bar high, stop under the tag', short: 'Short the signal-bar low, stop over the high' },
]

// The playbook cards. side: 'setup' = finding/entering the parabolic short;
// 'manage' = covers, the backside, and the squeeze rule. `glyph` keys
// reference the scene specs in components/ShortSide.jsx.
export const SHORT_SIDE = [
  // ── THE SETUP — the parabolic short, in order ─────────────────────────
  {
    key: 'frontside', side: 'setup', glyph: 'frontside', tone: 'warn', signal: 'caution',
    title: 'The front side', tagline: 'Never step in front of it',
    what: 'Day 1–3 of a vertical move: stacked green bars, each close near its high, volume building — the stock is going up in a straight line.',
    why: 'Strength this violent runs further than any short thesis survives. “Too high” is not a signal — front-side shorts are how accounts die in a day.',
    rule: 'No shorts while the closes keep printing near the highs. The front side is for stalking, never for entering — wait for the tape to crack first.',
  },
  {
    key: 'exhaust', side: 'setup', glyph: 'exhaust', tone: 'warn', signal: 'confirm',
    title: 'The exhaustion tell', tagline: 'The crowd arrives last',
    what: 'Day 3–5+: a huge gap up that fades, a monster upper wick on the run’s heaviest volume, or the first decisive red close (the first red day).',
    why: 'Peak volume at peak price is the last buyers piling in while early money sells to them — the same climax tell from the Candles panel, read from the other side.',
    rule: 'The exhaustion bar is the signal, not the entry. Mark its low and its high — the low is the trigger, the high is the stop. Then wait.',
  },
  {
    key: 'strigger', side: 'setup', glyph: 'strigger', tone: 'bad', signal: 'confirm',
    title: 'The trigger', tagline: 'Short the crack, stop over the high',
    what: 'Entry is the break of the signal bar’s low — or the failed bounce that puts in a lower high under it. Stop goes above the recent high, always.',
    why: 'The broken low proves supply finally won a session. Until it breaks, every “top” is a guess — after it breaks, the trapped late buyers become fuel for the fade.',
    rule: 'Short the signal-bar low, hard stop above the high, half the size of your longs. If the low never breaks, there was no trade — same as the long side.',
  },
  // ── MANAGING IT — covers, the backside, the squeeze ───────────────────
  {
    key: 'cover', side: 'manage', glyph: 'cover', tone: 'good', signal: 'confirm',
    title: 'Cover into panic', tagline: 'The fade is faster than the rise',
    what: 'Wide red flushes on spiking volume — covers get filled into the panic, a third at a time, with the declining 10/20-day as the magnet.',
    why: 'Shorts are paid in days, not weeks: parabolic fades give back most of the move fast, then chop. The flush you’re watching is your fill, not your victory lap.',
    rule: 'Cover ⅓ into each flush — never into quiet drift. A short that stops making lower lows in 2–3 days is done; take it off, don’t marry it.',
  },
  {
    key: 'backside', side: 'manage', glyph: 'backside', tone: 'info', signal: 'confirm',
    title: 'The backside', tagline: 'Pops into declining rails',
    what: 'After the crack: lower highs forming under the now-declining 10/20 — every bounce into the falling rail that rejects is a re-short zone.',
    why: 'This is the mirror of the pullback buy. The declining rail is where trapped longs sell hope and late shorts re-load — the same crowd, opposite door.',
    rule: 'Re-short the rejection at the declining rail, stop over the last lower high. The trade dies the day price closes back above the declining 20.',
  },
  {
    key: 'squeeze', side: 'manage', glyph: 'squeeze', tone: 'bad', signal: 'caution',
    title: 'The squeeze rule', tagline: 'Reclaimed highs = you’re the fuel',
    what: 'The short goes green-side-up: price reclaims the signal-bar high — or your stop — on expanding volume, and every tick higher forces more shorts to buy.',
    why: 'A reclaimed high is the long side’s undercut & reclaim happening to you. Averaging up into it is the one mistake this page exists to prevent — losses on shorts have no floor.',
    rule: 'Stop hits = flat, instantly, no averaging, no “it has to come back.” Never hold a squeezing short overnight — gap risk on the short side is unbounded.',
  },
]

// Where in the arc is it? The one-glance verdict table for the panel — the
// same three-row format as the rail-touch ladder.
export const SHORT_ARC_LADDER = [
  {
    key: 'front', tone: 'warn', label: 'Day 1–3 vertical, closes near highs',
    verdict: 'Front side — no short',
    note: 'Strength is the signal to wait, not to fade. Stalk it onto the watchlist and let the crowd finish buying.',
  },
  {
    key: 'signal', tone: 'good', label: 'Day 3–5+, climax volume, first crack',
    verdict: 'Signal — stalk the trigger',
    note: 'Exhaustion bar printed: mark its low (trigger) and high (stop). The entry is the break, never the prediction.',
  },
  {
    key: 'squeezed', tone: 'bad', label: 'Reclaims the highs after entry',
    verdict: 'Squeezed — cover now',
    note: 'No averaging up, no overnight holds. The trade is wrong; the only question is how small the loss stays.',
  },
]
