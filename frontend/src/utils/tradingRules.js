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
  { category: 'RISK', text: 'Size it twice, take the smaller: risk ÷ stop distance, and the position you could survive a −15% overnight gap in. The stop only exists while the market is open.' },
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
  { category: 'ENTRY', text: 'The trigger is a printed price — the opening-range high or the prior day’s high. The stop is the low it broke from, never a percentage.' },
  { category: 'ENTRY', text: 'Chase limit: more than ⅓ of the stop distance above the trigger and the R is gone. Missed is cheaper than chased.' },
  { category: 'ENTRY', text: 'The risk budget belongs to the idea, not the attempt — two tries at a level is half a unit each. Third attempt and the name is off the list.' },
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

// ── EP Setup ────────────────────────────────────────────────────────────────
// The Catalyst Hierarchy above ranks the WHY. This block answers the two
// questions that actually decide whether a given episodic pivot is worth risk:
// what the chart looked like the day BEFORE the gap, and whether the numbers
// behind the headline re-rate the company or just beat a lowered bar.
// Rendered by components/EPSetup.jsx. Thresholds mirror backend/ep_scorer.py
// and backend/scanners/ep9m.py so the page and the scanners grade one thing.
//
// side: 'want' = the pre-gap chart you're hunting; 'avoid' = the ones that
// look identical at 9:31 and pay nothing.
export const EP_PRIOR_CHART = [
  {
    key: 'forgotten', glyph: 'forgotten', side: 'want', tone: 'good', signal: 'confirm',
    title: 'The forgotten base',
    tagline: 'Dead for months, then gaps clean out of the range',
    what: '3–12 months of sideways drift in a narrow band, ranges compressing, volume dull — no spikes, no story, no crowd. The gap opens above every bar of that range.',
    why: 'Nobody owns it and nobody is waiting to sell it. A range that long means the impatient money left; the gap has to buy from holders who now have no reason to let go. This is the textbook EP and the highest-paying version of it.',
    rule: 'Boring is the feature. If the chart looked interesting last week, it is not this setup.',
  },
  {
    key: 'bottoming', glyph: 'bottoming', side: 'want', tone: 'good', signal: 'confirm',
    title: 'Beaten down, stopped going down',
    tagline: 'Down 50–80%, then flat — the gap crosses the 200 in one bar',
    what: 'A long decline that has gone quiet: the last 2–4 months refuse to make new lows even on bad tape. Price sits at or under a flattening 200-day. The gap opens well above it.',
    why: 'Sellers are exhausted — everyone who wanted out is out, which is why the lows stopped printing. The news does not just move price, it changes the classification: a left-for-dead name becomes ownable, and the funds that screen on trend have to buy it from a standing start.',
    rule: 'Require the flat part. Still making lower lows into the print is a falling knife with a headline attached.',
  },
  {
    key: 'bluesky', glyph: 'bluesky', side: 'want', tone: 'good', signal: 'confirm',
    title: 'Blue-sky gap',
    tagline: 'Tight base under the highs → gap into white space',
    what: 'A quiet multi-week coil just under the 52-week (or all-time) high, then the gap opens above it. Nothing but empty chart above the day-1 candle.',
    why: 'Zero overhead supply: not one holder in the last year is underwater, so no rally meets a seller getting back to breakeven. Fewer of these than forgotten bases, but they trend the cleanest once they go.',
    rule: 'Blue sky beats a big gap. A +12% gap into white space outruns a +35% gap into old wreckage.',
  },
  {
    key: 'trend', glyph: 'trend', side: 'want', tone: 'info', signal: 'context',
    title: 'Shallow pullback in an uptrend',
    tagline: 'Already working, news extends it — a B, not an A',
    what: 'Above a rising 50/200, pulled back into the 20/50 rail for a couple of weeks into the print, then gaps and continues.',
    why: 'A real setup, but the re-rating is partly done — the market already believed the story, so the gap continues a trend instead of starting one. Expect a normal swing, not a multi-month leg.',
    rule: 'Trade it as a continuation: normal size, rail stop, take the partial into strength. Do not price it like a fresh EP.',
  },
  {
    key: 'supply', glyph: 'supply', side: 'avoid', tone: 'warn', signal: 'caution',
    title: 'Gap into overhead supply',
    tagline: 'The open lands inside somebody else’s disaster',
    what: 'Look left: the gap opens into a heavy-volume shelf where the stock broke down in the last 6–12 months. Day 1 often prints a fat upper wick and closes mid-range.',
    why: 'Every bagholder from that shelf just got their exit. Their selling is mechanical and price-insensitive — it does not care about your catalyst — and it caps the move exactly where the chart says it should.',
    rule: 'Skip it, or wait for the stock to build a new base above the shelf and take the breakout from there instead.',
  },
  {
    key: 'knife', glyph: 'knife', side: 'avoid', tone: 'bad', signal: 'caution',
    title: 'No base — still making lows',
    tagline: 'Gaps up out of a live downtrend',
    what: 'Lower lows right into the print, no flat stretch anywhere, then a gap that opens into a declining 200-day and closes red.',
    why: 'A downtrend is supply that has not finished working. Every bounce is somebody’s exit, and the gap hands that queue its best fill in months. “Beaten down” only becomes bullish once the stock has stopped going down.',
    rule: 'Require 2–4 months without a new low before the gap. A falling knife with a headline attached is still a falling knife.',
  },
  {
    key: 'novol', glyph: 'novol', side: 'avoid', tone: 'warn', signal: 'caution',
    title: 'The gap nobody showed up for',
    tagline: 'Right chart, right story, 1.4× volume',
    what: 'A perfectly good base gaps +8% on barely above-average volume, drifts for two sessions and closes the gap.',
    why: 'The gap is a price; volume is the evidence somebody acted on it. Without 3×+ turnover no fund built a position — so there is no ongoing bid to carry the move, and the range simply reclaims it.',
    rule: 'Volume is the confirmation, not a bonus. Under 3× average the episode is unproven — pass, or wait for a base to form above the gap.',
  },
  {
    key: 'extended', glyph: 'extended', side: 'avoid', tone: 'bad', signal: 'caution',
    title: 'Extended before the news',
    tagline: 'Up 40% into the print — the beat was already bought',
    what: 'Weeks of advance straight into the catalyst, stretched well above the 10/20, then a gap up that gets sold and closes red or near the lows.',
    why: 'The information leaked into price ahead of you. There is no surprise left to pay for, and everyone with a 40% gain now has a reason to ring the register on the one day there is liquidity to do it in.',
    rule: 'The prior 20-day move ≤ ±10% test comes first. Fail it and the numbers do not matter — this is a gap to fade, not to buy.',
  },
]

// The quantified pre-gap gate — the chart half, checked the night before or on
// the gap-day open. Numbers here mirror ep_scorer.score_consolidation and the
// ep9m compression / not-late filters.
export const EP_CHART_GATE = [
  { key: 'prior20', tone: 'good', label: 'Prior 20-day move', value: '≤ ±10%',
    note: 'The coiled-spring test the EP scorer scores. Over ±30% there is no base — the news is chasing price that already moved.' },
  { key: 'baselen', tone: 'good', label: 'Base length', value: '2–12 months',
    note: 'Long enough that holders got bored and left. Under ~6 weeks is a pause, not a base — nobody has forgotten it yet.' },
  { key: 'compress', tone: 'info', label: 'Range compression', value: 'last 5d ≤ 0.7× last 20d',
    note: 'The $9M scanner’s literal filter: the bar must emerge from compression, not extend an already-wide stretch of chart.' },
  { key: 'open', tone: 'info', label: 'Where it opens', value: 'above the base high',
    note: 'The open must clear every bar of the range, and ideally the 200-day. A gap that opens inside the range is a good day, not an episode.' },
  { key: 'supply', tone: 'warn', label: 'Overhead supply', value: 'none for 6–12 months',
    note: 'Look left before you look at the news. A heavy-volume shelf overhead is trapped sellers who exit at breakeven — into your entry.' },
  { key: 'quiet', tone: 'good', label: 'Volume before the gap', value: 'no 3× days',
    note: 'The gap should be the first crowd event. Two volume spikes already this month means the story leaked and you are the late money.' },
  { key: 'ma200', tone: 'info', label: 'Distance from 200-day', value: '−25% to +10%',
    note: 'The best EPs cross the 200 in a single bar — ignored to owned. Already 30% above it and the re-rating happened without you.' },
  { key: 'notlate', tone: 'bad', label: 'Not already moving', value: 'close 3d ago < today’s low',
    note: 'Day 3 of a move is not day 1. If the expansion started before today, you are buying someone else’s entry.' },
]

// The gap-day gate — mirrors ep_scorer's scoring bands so the panel and the
// $9M / EP scanners speak the same language.
export const EP_GAP_GATE = [
  { key: 'gap', tone: 'good', label: 'Gap size', value: '+10% to +40%',
    note: 'Under 5% is not an episode. Over 50% is a reversion candidate — big enough to re-rate, small enough to still travel.' },
  { key: 'vol', tone: 'good', label: 'Volume surge', value: '≥ 3× (5–10× best)',
    note: 'Ownership actually changing hands. Under 1.5× the gap is a quote, not a transfer.' },
  { key: 'dv', tone: 'info', label: 'Dollar volume', value: '≥ $5M ($20M+ better)',
    note: 'What you can exit into on a bad day. Position size is capped by this number, not by conviction.' },
  { key: 'float', tone: 'info', label: 'Float', value: '< 200M (< 50M explosive)',
    note: 'Small float turns real demand into violent price. Above ~1B shares the same news barely registers.' },
  { key: 'mcap', tone: 'info', label: 'Market cap', value: '$100M – $10B',
    note: 'Big enough to be fundable, small enough that one quarter can re-rate the whole company.' },
  { key: 'dcr', tone: 'good', label: 'Close of day 1', value: 'upper 30% of range',
    note: 'Daily closing range ≥ 0.70. A gap that fades to the lows on the year’s biggest volume is distribution — the story got sold to you.' },
]

// The numbers, ranked by how much they actually move a forward multiple.
// Order matters: guidance > growth shape > EPS > margins > corroboration.
export const EP_NUMBERS = [
  {
    key: 'guidance', rank: 1, tone: 'good', label: 'Forward guidance',
    weight: 'The one that re-rates',
    want: 'Next-quarter and/or FY guide raised above consensus — best when it is the second consecutive raise.',
    avoid: 'Beat with guidance merely maintained (a one-day pop), and beat-with-a-cut (a gap to fade, not to buy).',
    why: 'Price is the forward number times a multiple. A beat re-prices the past; only guidance re-prices the future, which is the only thing anyone is paying for.',
  },
  {
    key: 'revaccel', rank: 2, tone: 'good', label: 'Revenue acceleration (YoY)',
    weight: 'The shape institutions chase',
    want: 'This quarter’s YoY revenue growth above each of the last two — e.g. +14% → +27% → +52%.',
    avoid: 'High but decelerating growth (+60% → +45% → +32%) — the multiple compresses even while the headline looks huge.',
    why: 'Acceleration is what forces analysts to re-model, and re-modelling is what produces months of buying rather than one morning of it.',
  },
  {
    key: 'revlevel', rank: 3, tone: 'good', label: 'Revenue growth (YoY)',
    weight: 'The level under the shape',
    want: '≥ 25–30% YoY; the EPs that run hardest print 40–100%+. Revenue must beat too, not just EPS.',
    avoid: 'Sub-10% growth. A beat on a 6% grower is a rounding error dressed as news.',
    why: 'Revenue is the number that cannot be engineered. Compare against the year-ago quarter, never the previous one — QoQ is seasonality, YoY is demand.',
  },
  {
    key: 'eps', rank: 4, tone: 'info', label: 'EPS surprise & YoY',
    weight: 'Table stakes, not the thesis',
    want: 'Surprise ≥ 20% vs consensus and EPS up ≥ 25% YoY. Best of all: the first profitable quarter — loss-to-profit re-rates a company in a way no beat can.',
    avoid: 'A 1–5% penny beat (noise — most companies beat), and an EPS beat sitting on a revenue miss.',
    why: 'EPS beats on flat revenue are cost cuts, buybacks or a tax rate. That is accounting, not demand, and it does not repeat next quarter.',
  },
  {
    key: 'margin', rank: 5, tone: 'info', label: 'Margin expansion',
    weight: 'Proof it is real demand',
    want: 'Gross margin up ~200bps+ YoY, opex growing slower than revenue — operating leverage showing up.',
    avoid: 'Revenue up while gross margin falls — growth bought with discounting, which stops the moment the promo does.',
    why: 'Expanding margins on accelerating revenue is the combination that turns a good quarter into a multi-quarter narrative.',
  },
  {
    key: 'confirm', rank: 6, tone: 'info', label: 'Morning-after corroboration',
    weight: 'Did anyone with capital agree?',
    want: 'Several analyst price-target hikes or an upgrade, the heaviest volume in a year, and the theme’s peers bid alongside it.',
    avoid: 'One small-shop upgrade and no volume — an opinion, not a re-rating.',
    why: 'A gap is one morning’s opinion. Estimate revisions across the street are what fund the next three months of buying.',
  },
]

// Non-earnings catalysts get the same test: is the NUMBER big enough to change
// the forward model? Pairs with CATALYST_HIERARCHY, which ranks the type.
export const EP_NON_EARNINGS = [
  { key: 'contract', tone: 'good', label: 'Contract / award',
    test: 'Counterparty named + dollar value ≥ ~20% of trailing annual revenue, multi-year.',
    note: 'A "$40M award" at a company doing $2B is a press release. The same number at a $60M-revenue company is a new company.' },
  { key: 'fda', tone: 'good', label: 'FDA / trial result',
    test: 'Approval or Phase-3 success on the asset that IS the company — and check the label breadth, not just the yes.',
    note: 'A narrow label on a crowded indication gaps and dies. Price the addressable market, not the headline word "approved".' },
  { key: 'strategic', tone: 'good', label: 'Strategic investment / partnership',
    test: 'A bellwether takes a stake or names them a partner — validation the market cannot argue with.',
    note: 'Tier-1 in the Catalyst Hierarchy: it re-rates the name and puts a halo bid under the whole group.' },
  { key: 'policy', tone: 'info', label: 'Government policy',
    test: 'Tariff, subsidy, mandate or approval that changes the economics of an entire industry.',
    note: 'The whole group gaps together — so trade the best chart in the group, not the loudest ticker.' },
  { key: 'ma', tone: 'bad', label: 'Being acquired (cash)',
    test: 'None — the chart is now a bond that matures at the deal price.',
    note: 'Not an EP. Upside is capped by the offer, and the only remaining risk is the deal breaking.' },
  { key: 'upgrade', tone: 'bad', label: 'Analyst upgrade alone',
    test: 'No new facts about the business — just a new opinion about them.',
    note: 'Fine as corroboration on top of numbers, worthless as the catalyst itself.' },
]

// Same morning, six different calls — the ladder ties the two halves together:
// the last row fails on the chart even though the numbers are perfect.
export const EP_NUMBERS_LADDER = [
  { key: 'apl', tone: 'good', label: 'Rev +52% YoY (accel) · FY guide raised', verdict: 'FULL SIZE',
    note: 'Growth accelerating, forward numbers moved up, base intact. This is the version worth the full risk unit.' },
  { key: 'solid', tone: 'good', label: 'Rev +30% YoY · beat · guide maintained', verdict: 'HALF SIZE',
    note: 'Real quarter, unmoved forward model. Tradeable, but expect a swing rather than a re-rating.' },
  { key: 'costcut', tone: 'warn', label: 'EPS beat 40% · revenue −2% YoY', verdict: 'SKIP',
    note: 'Cost cuts, buyback or tax rate. Nothing here repeats next quarter, and the gap usually gives it all back.' },
  { key: 'cut', tone: 'bad', label: 'Beat · next-quarter guide cut', verdict: 'FADE',
    note: 'The market trades the guide, not the beat. This is gap-fill territory — the short side’s setup, not yours.' },
  { key: 'inline', tone: 'warn', label: 'In-line print · 3 PT hikes · +18%', verdict: 'WATCH',
    note: 'Opinions moved, numbers did not. Let it build a base above the gap and take the breakout if it holds.' },
  { key: 'priced', tone: 'bad', label: 'Beat + raise · stock +45% into the print', verdict: 'PASS',
    note: 'Perfect numbers, failed chart. The prior-20-day test disqualified it before the release ever came out.' },
]

// The instant-no list — cheap to check, and each one has cost real money.
export const EP_DISQUALIFIERS = [
  'The gap is a capital raise — ATM, registered direct or secondary. The "news" is dilution.',
  'Post-reverse-split chart, or a sub-$3 name gapping on a promotional PR.',
  'Under $5M/day dollar volume — you cannot exit the size you want to enter.',
  'Gap under +5%: that is a good day, not an episode.',
  'Opens inside the prior range instead of clearing the base high.',
  'The second gap on the same story — the surprise is spent.',
  'Cash acquisition target: upside capped at the deal price.',
  'You are holding into the print rather than reacting to it. That is a coin flip, not an EP.',
]

// ── HTF Setup ───────────────────────────────────────────────────────────────
// The mirror of the EP block above, for the continuation family. EP_PRIOR_CHART
// asks what the chart looked like the day before the gap; this asks what it
// looked like before the POLE — the months of chart that decide whether a flag
// is the second leg of a young trend or the last gasp of an old one.
//
// The distinction the panel exists to draw: a pole is evidence about this week.
// The chart behind it is evidence about the next three months, and it is the
// only half that is knowable in advance. Rendered by components/HTFSetup.jsx;
// Bases & Pivots defines the base itself, Entries takes the trigger — this one
// decides whether the name deserved to be on the list at all.
//
// side: 'want' = the pre-pole chart you're hunting; 'avoid' = the ones whose
// flag looks identical and pays nothing.
export const HTF_PRIOR_CHART = [
  {
    key: 'stage2', glyph: 'stage2', side: 'want', tone: 'good', signal: 'confirm',
    title: 'Fresh Stage-2 turn', tagline: 'Quarters of nothing, then the first thrust',
    what: 'Six months to years of flat, ignored chart under a flattening 30-week line, then the first decisive thrust up through it on the heaviest volume in a year. The pole is the turn itself; the flag that follows is base 1.',
    why: 'This is the beginning of the story rather than the middle of it. Nobody screens for a name that has not moved, so the institutions building the position are early and slow — and their buying is what funds the next several bases. The odds of the entire cycle are concentrated here.',
    rule: 'Hunt the first flag after the Stage-1 → 2 turn. It pays more than the third one in the same name, and it is the version you are allowed to size fully.',
  },
  {
    key: 'epole', glyph: 'epole', side: 'want', tone: 'good', signal: 'confirm',
    title: 'The pole is a catalyst gap', tagline: 'An EP that has not finished',
    what: 'The advance is not a drift — it is an episodic pivot: one gap on a real catalyst that re-rated the company, then 3–15 sessions holding tight above the gap on drying volume.',
    why: 'Most poles are a mystery: price moved and nobody can tell you why, so nobody can tell you whether it continues. A catalyst pole comes with a reason, an estimate-revision cycle behind it, and a floor — the gap itself — that everyone can see.',
    rule: 'The strongest HTFs are EPs in their second act. If you missed the gap, this flag is the trade — the same setup the “base above the gap” entry takes.',
  },
  {
    key: 'rslead', glyph: 'rslead', side: 'want', tone: 'good', signal: 'confirm',
    title: 'Already the leader', tagline: 'Outperforming before the pole, not because of it',
    what: 'The name was beating the index for months before this move — it appears in at least two of the 6M / 3M / 1M leader lists, and it held up on the days the market did not.',
    why: 'Relative strength that predates the pole means sponsorship, not beta. The pole is then confirmation of something already true, which is a far better prior than a single week of price telling you a story for the first time.',
    rule: 'Check RS before the pole, not after — every pole looks strong on the day it prints. The Prep page’s confluence flag is exactly this test, run for you.',
  },
  {
    key: 'railrun', glyph: 'railrun', side: 'want', tone: 'info', signal: 'context',
    title: 'Orderly leader, mid-trend', tagline: 'Base 2 of a working trend — a B, not an A',
    what: 'Already above a rising 10/20/50, one prior base behind it, pullbacks staying shallow and getting bought at the rails, then another pole and another flag.',
    why: 'A genuine setup, and a later one: the market has already agreed with you, so the re-rating is partly spent. Expect a normal swing rather than the leg that pays for the quarter.',
    rule: 'Trade it as a continuation — normal size, rail stop, take the partial into strength. Do not price base 2 like base 1.',
  },
  {
    key: 'nobase', glyph: 'nobase', side: 'avoid', tone: 'bad', signal: 'caution',
    title: 'The pole is the whole chart', tagline: 'Dead flat, then vertical, from nowhere',
    what: 'Months of near-zero volume at the lows — an ignored, illiquid, often low-float name — and then a violent multi-day rip on volume that dwarfs anything in its history.',
    why: 'There is no institutional base behind it because there are no institutions in it. What looks like a flag is a distribution pattern: the promoters and the fast money need somebody to sell to, and a tidy consolidation is how they find them.',
    rule: 'No prior base, no trade. This is the raw material of the Parabolic Short, not of an HTF — and it is the single most expensive lookalike on this page.',
  },
  {
    key: 'late', glyph: 'late', side: 'avoid', tone: 'bad', signal: 'caution',
    title: 'The late-stage pole', tagline: 'Base 4+, and the legs keep getting steeper',
    what: 'Months of advance already banked, each leg steeper than the last, the newest pole the widest bar of the entire run on the heaviest volume of the entire run.',
    why: 'By base 4 the story is on every screen and in every newsletter — there is no marginal buyer left to convert. Accelerating slope into climax volume is exhaustion wearing the costume of strength.',
    rule: 'Count the bases before you admire the pole. Late-stage flags fail as a rule; let someone else own the last one.',
  },
  {
    key: 'laggard', glyph: 'laggard', side: 'avoid', tone: 'warn', signal: 'caution',
    title: 'The laggard’s pole', tagline: 'The group ran; this one finally moved',
    what: 'The theme is three months old and this name sat it out. Now it prints its own pole — and it is still nowhere near the highs its peers made weeks ago.',
    why: 'That is beta arriving late, not leadership. Money rotating into the laggards is the last phase of a group move: it is the crowd buying what is left after the leaders got expensive.',
    rule: 'Trade the leader’s second base over the laggard’s first pole, every time. If the group is what moved, the group’s best chart is the trade.',
  },
  {
    key: 'supply', glyph: 'supply', side: 'avoid', tone: 'warn', signal: 'caution',
    title: 'Pole into overhead supply', tagline: 'The advance stops under somebody else’s exit',
    what: 'Look left: the pole runs straight into a heavy-volume shelf where the stock broke down 6–12 months ago, and stalls there on a wide bar with an upper wick.',
    why: 'Trapped holders from that shelf get their money back exactly where your flag is forming. Their selling is mechanical and indifferent to your setup, and it caps the move precisely where the chart says it will.',
    rule: 'A flag under old wreckage is not a flag, it is a queue. Wait for the stock to base above the shelf and take that breakout instead.',
  },
]

// The pre-pole gate — the weekend-checkable half, in the same spirit as
// EP_CHART_GATE. Numbers mirror the scanners that already compute them:
// breadth/stage analysis for the stage line, scanners/rs_leaders for the RS
// windows and the 20-day liquidity floor.
export const HTF_SETUP_GATE = [
  { key: 'stage', tone: 'good', label: 'Stage', value: 'above a rising 30-week',
    note: 'Weinstein Stage 2, the gate the Stage Analysis page computes. Below a falling 30-week there is no HTF, whatever the pole looks like.' },
  { key: 'basecount', tone: 'good', label: 'Base count', value: '1–2 off the turn',
    note: 'Base 3 is tradeable smaller and stricter; base 4+ is a pass. The full ladder lives in Bases & Pivots — bring the count with you before you look at the flag.' },
  { key: 'prior', tone: 'info', label: 'Prior advance', value: '≥ 30% before the base',
    note: 'A base needs something to base ON. Without a qualifying advance behind it, a tight range is not a coil — it is just a quiet chart.' },
  { key: 'rs', tone: 'good', label: 'Relative strength', value: '≥ 2 of 6M / 3M / 1M',
    note: 'The Prep page’s confluence flag: a leader in more than one window, not a name that happens to top a single lookback. Measured before the pole.' },
  { key: 'adr', tone: 'info', label: 'ADR', value: '> 5%',
    note: 'Volatility is the raw material — a 2% ADR name cannot produce a pole worth flagging, and its flag is indistinguishable from noise.' },
  { key: 'liq', tone: 'warn', label: 'Liquidity', value: '20-day avg ≥ $5M',
    note: 'The 20-day average, never today’s. A name that pumped this morning clears a single-day bar while being untradable for the rest of the month.' },
  { key: 'group', tone: 'info', label: 'The group', value: 'peers confirming',
    note: 'One stock moving is a story; the group moving is a theme. Sector Scan tells you which it is — and a theme gives the flag a reason to resolve up.' },
  { key: 'pole', tone: 'good', label: 'And then the pole', value: '+30%+ on record volume',
    note: 'Days-to-weeks, mostly green closes near the highs, the heaviest volume of the year. A slow, overlapping drift is not a pole — see Bases & Pivots for what the flag must then do.' },
]

// Same flag, six different charts behind it. The last two rows are the ones
// that cost money, because on the day you look at them the flag is textbook.
export const HTF_SETUP_LADDER = [
  { key: 'turn', tone: 'good', label: 'Stage-2 turn · base 1 · RS leader · record volume', verdict: 'FULL SIZE',
    note: 'The whole cycle’s odds in one chart. This is the version worth the full risk unit and the patience to hold it through the first shakeout.' },
  { key: 'ep', tone: 'good', label: 'Pole is a catalyst gap · first flag above it', verdict: 'FULL SIZE',
    note: 'The EP’s second act: a reason for the move, a visible floor, and estimate revisions still running. The strongest continuation there is.' },
  { key: 'base2', tone: 'info', label: 'Base 2 · orderly leader · good volume', verdict: 'NORMAL',
    note: 'A working trend taking its second rest. Standard swing, standard size, standard rail — just do not expect the leg that pays for the quarter.' },
  { key: 'base3', tone: 'warn', label: 'Base 3 · still leading, story now obvious', verdict: 'HALF SIZE',
    note: 'Everyone owns the thesis by now. Tighten every criterion and cut the size — late bases fail more often and fail faster.' },
  { key: 'lag', tone: 'warn', label: 'Group ran first · this one finally moved', verdict: 'PASS',
    note: 'Rotation into laggards is the end of a group move, not the start of one. If the theme is real, the leader’s next base is the trade.' },
  { key: 'nobase', tone: 'bad', label: 'No base behind it · low float · pole is the chart', verdict: 'NO — WRONG SIDE',
    note: 'Not a weak long, a different setup entirely. When this one cracks it belongs to the Parabolic Short panel; buying its flag is standing in front of that.' },
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

// ── Exit: trend death vs shakeout ───────────────────────────────────────────
// The long-horizon counterpart to RAIL_TOUCH_LADDER above. That ladder reads
// ONE rail on ONE day; this framework answers the position-level question —
// "is this trend over, or is this the shakeout I'm supposed to sit through?"
//
// The framing is deliberately probabilistic. In a live stage-2 trend, pullbacks
// to a rising rail resolve upward far more often than not — that base rate is
// exactly why trailing a rail works, and it's why a single MA break is weak
// evidence on its own. What raises P(the trend is dead) is *conditionally
// independent* tells stacking: volume says who acted, slope says whether the
// engine still runs, RS says whether sponsorship already left, and the reclaim
// window says whether the sellers were weak hands or size. Each answers a
// different question, so agreement between them is real information rather
// than the same fact counted three times.
//
// `weight` is the tell's discriminating power (how much it moves the estimate),
// not its certainty. Rendered by components/ExitTrendDeath.jsx.
export const TREND_DEATH_TELLS = [
  {
    key: 'volume', weight: 'high',
    title: 'Volume on the break', tagline: 'Who actually acted',
    holds: 'Price wicks or drifts below the rail on average-or-lighter volume — nobody is rushing for the exit.',
    dies: 'The close below prints on volume greater than any up-day of the entire advance. Supply is now bigger than demand ever was.',
    why: 'Volume is the one input that can’t be faked by price: it measures participation, not opinion. A break nobody sold into is a break that gets bought back.',
  },
  {
    key: 'cascade', weight: 'high',
    title: 'Rail cascade & speed', tagline: 'How many trampolines broke',
    holds: 'Loses the 10 and the 20 catches it within a bar or two — the next rail down still does its job.',
    dies: 'Slices 10 → 20 → 50 in three bars or fewer with no bounce at any of them.',
    why: 'In a live trend each rail is a separate bid from a separate timeframe of buyer. Losing three in a row isn’t three signals — it’s one signal that every cohort defending those levels is gone.',
  },
  {
    key: 'reclaim', weight: 'high',
    title: 'The reclaim window', tagline: 'The tiebreaker',
    holds: 'Back above the lost rail within roughly 1–3 sessions — the undercut & reclaim.',
    dies: 'Never reclaims; each bounce into the underside of the rail gets sold. Former support is now resistance.',
    why: 'The highest-value tell when the others disagree. A shakeout reclaims fast because the sellers were weak hands; when size is distributing, the rally back into the line is the exit liquidity they need.',
  },
  {
    key: 'extension', weight: 'med',
    title: 'Extension when it breaks', tagline: 'Where the break happens',
    holds: 'The break comes from a normal pullback near a rising 50 — a move that had already digested its gains.',
    dies: 'The break comes after a climax run, from the widest stretch above the 50 of the whole advance.',
    why: 'Distance from the mean sets the prior. The identical break is a top when it follows exhaustion and noise when the trend was never stretched — same bar, opposite meaning.',
  },
  {
    key: 'slope', weight: 'med',
    title: 'Slope of the broken rail', tagline: 'Is the engine still running',
    holds: 'The rail it lost is still rising — it climbs back into price and catches it.',
    dies: 'The 20 / 50 has flattened or rolled over. A falling rail doesn’t catch price, it follows it down.',
    why: 'Slope is the trend’s engine. Crossing a rising average is a pause; sitting under a falling one means nothing is pulling price back up.',
  },
  {
    key: 'rs', weight: 'med',
    title: 'Relative strength', tagline: 'Did sponsorship leave first',
    holds: 'The RS line is still at or near its highs — the name is still where money wants to be.',
    dies: 'RS rolled over *before* the price break. The break is confirmation, not news.',
    why: 'RS deteriorates ahead of price because institutions exit gradually. An RS top that precedes the price top is the earliest structural warning you get.',
  },
  {
    key: 'structure', weight: 'confirm',
    title: 'Structure after the break', tagline: 'The slowest, surest tell',
    holds: 'One lower high, then it takes out the prior high — the uptrend definition survived.',
    dies: 'Two consecutive lower highs and lower lows. The uptrend is broken, not bent.',
    why: 'The most certain and the most expensive: by the time it prints you’ve given back a lot. Use it to confirm you were right to leave, never to decide whether to.',
  },
]

// The multi-rail escalation ladder — the position-level action at each stage of
// a breakdown. Deliberately TIERED rather than binary: the cost of exiting a
// good trend early (forfeiting the fat tail that pays for everything) is not
// symmetric with the cost of holding a dead one, so the response scales with
// the evidence. Rows match the VerdictLadder shape.
export const RAIL_CASCADE_LADDER = [
  {
    key: 'pullback', tone: 'good',
    label: 'Lost the 10 · 20 holding · 50 rising',
    verdict: 'Hold — normal pullback',
    note: 'The next rail caught it and the engine is still climbing. In a leader this is an add zone, not a warning.',
  },
  {
    key: 'trim', tone: 'warn',
    label: 'Lost 10 + 20 · volume expanding',
    verdict: 'Trim — shorten the leash',
    note: 'Two rails gone on real supply. Cut back to a core and let the 50 be the decider. No adds here.',
  },
  {
    key: 'exit', tone: 'bad',
    label: '10 → 20 → 50 in ≤3 bars · no reclaim',
    verdict: 'Exit the core — structure is gone',
    note: 'Every level that was a bid broke in sequence. This is the trend-death signature, not a dip — and the reclaim you’re waiting for is the rally someone else is selling into.',
  },
  {
    key: 'late', tone: 'bad',
    label: 'Below the 50 · testing the 100 / 200',
    verdict: 'Already late — stage 4',
    note: 'The swing thesis died back at the 50. What happens down here is stage analysis, not trade management — and never a place to average down.',
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

// ── Same pole, two outcomes ─────────────────────────────────────────────────
// The most common confusion on this page: the parabolic short is NOT the
// inverse of the HTF. They begin identically — a huge, fast advance — and the
// pole itself carries no directional information. What separates them is how it
// RESOLVES, and volume is the cleanest tell (dry-up = rest, climax = exhaustion,
// the same pair the Volume panel teaches).
export const POLE_FORK = [
  {
    key: 'flag', tone: 'good',
    label: 'It stops and goes quiet',
    outcome: 'HTF — buy the flag break',
    what: 'Drifts sideways-to-down for 3–15 sessions, holding the upper third of the pole.',
    volume: 'Collapses — the dry-up',
    means: 'Holders refuse to sell even after a huge run. Rest without retracement is the strongest statement a chart makes.',
    action: 'Buy the break of the flag high; stop under the flag low.',
  },
  {
    key: 'climax', tone: 'bad',
    label: 'It keeps going vertical',
    outcome: 'Parabolic — short the crack',
    what: 'Up 3–5+ days in a row, stretching 20%+ above the 10-day, never pausing to build a flag.',
    volume: 'Expands into a climax',
    means: 'The last buyers are paying up while early money sells into them — the rubber band at full stretch.',
    action: 'Never short the front side. Wait for the crack — first red day / loss of the day’s low — and stop above the high.',
  },
]

// The four setups as one map. Two axes: are you trading WITH the move
// (continuation) or against its exhaustion, and which side. It's the fastest way
// to see that HTF's mirror is the bear flag — not the parabolic short, whose
// real mirror is the long-side reversal.
export const SETUP_MATRIX = [
  {
    key: 'cont-long', axis: 'Continuation', side: 'Long', tone: 'good',
    name: 'HTF / flag', to: '/rules#bases',
    note: 'Pole up → tight flag holding the upper third → buy the break.',
  },
  {
    key: 'cont-short', axis: 'Continuation', side: 'Short', tone: 'bad',
    name: 'Breakdown Short', to: '/breakdown-short',
    note: 'Pole down → rally into a declining rail → short the failure. The true mirror of the HTF.',
  },
  {
    key: 'exh-long', axis: 'Exhaustion fade', side: 'Long', tone: 'good',
    name: 'Reversal Setup', to: '/reversal-setup',
    note: 'Fresh low that closes near the high — fading selling exhaustion.',
  },
  {
    key: 'exh-short', axis: 'Exhaustion fade', side: 'Short', tone: 'bad',
    name: 'Parabolic Short', to: '/parabolic-short',
    note: 'Climax run, then the crack — fading buying exhaustion. Mirrors the Reversal, not the HTF.',
  },
]

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

// ── Entries ─────────────────────────────────────────────────────────────────
// The trigger framework (components/Entries.jsx). Every panel above decides
// WHETHER a name is worth trading — the rails qualify it, Bases & Pivots gives
// it structure, the EP panel prices the catalyst. This one decides WHERE the
// order goes and where the trade is wrong, for the only two setup families in
// the sanctioned taxonomy: HTF (continuation) and EP (re-rating). The card keys
// deliberately mirror the setup lists in components/TradePlanGate.jsx and
// pages/Playbook.jsx, so what you read here is what you tag — otherwise the
// per-setup analytics in Trading Analysis are measuring a different vocabulary
// than the one you traded.
//
// The through-line: the trigger is always a HORIZONTAL price taken off a bar
// that already printed — an opening-range high or a prior day's high — and the
// stop is always the structural low that price came from. Nothing here is drawn
// by hand or decided at 9:31.

// EP entries. You are reacting to a gap, so the opening range is what defines
// the risk: the shorter the range, the tighter the stop and the more noise it
// sits inside. Ordered by how much the open has to settle before you act.
export const ENTRY_EP_TRIGGERS = [
  {
    key: 'orb1', glyph: 'orb1', tone: 'good', signal: 'confirm',
    title: '1-minute ORB', tagline: 'Tightest risk, most shakeouts',
    trigger: 'High of the 9:30–9:31 bar',
    stop: 'Low of that bar (or LOD)',
    what: 'Let the first one-minute bar print, then buy the break of its high. Stop is that bar’s low — often a fraction of a percent away.',
    why: 'The opening minute is where the overnight imbalance clears. Taking out its high says the buyers who were holding out for a better fill gave up, and it prices the risk in cents rather than percent — which is the only reason a +20% gapper is sizeable at all.',
    rule: 'Reserve it for clean opens: one decisive bar, huge volume, no two-sided fight. Losing the 1-min low is not the end of the idea — you are allowed one re-entry on the 5-min range.',
  },
  {
    key: 'orb5', glyph: 'orb5', tone: 'good', signal: 'confirm',
    title: '5-minute ORB', tagline: 'The default EP entry',
    trigger: 'High of the first 5-min bar',
    stop: 'Low of that bar',
    what: 'Buy the break of the first five-minute bar’s high, stop under its low. Most EPs get taken here.',
    why: 'Five minutes is long enough for the opening auction to finish clearing and short enough that risk is still a slice of the day’s range. The bar is the market’s own first honest opinion of where the gap is fairly priced.',
    rule: 'Default to this one and deviate deliberately: down to the 1-min when the 5-min range is too wide to size around, out to the 60-min when the open is a two-sided mess.',
  },
  {
    key: 'orb60', glyph: 'orb60', tone: 'info', signal: 'context',
    title: '60-minute ORB', tagline: 'For the opens that are a war',
    trigger: 'High of the first hour',
    stop: 'Low of the first hour',
    what: 'Wide, whipsawing first bars running both sides. Wait out the full hour, then trade the break of the hour’s high with the stop under the hour’s low.',
    why: 'A violent open means neither side has cleared yet, so the short ranges are noise generators that get broken in both directions. The hour is the first range on that chart with anything behind it.',
    rule: 'High-ADR, heavily-shorted, headline gaps only. The wider stop means smaller size — that arithmetic is not optional. If the hour’s range is wider than about one ADR, there is no entry today.',
  },
  {
    key: 'basegap', glyph: 'basegap', tone: 'info', signal: 'confirm',
    title: 'Base above the gap', tagline: 'The entry for the one you missed',
    trigger: 'Day-1 high, after the shelf holds',
    stop: 'Low of the shelf',
    what: 'Day 1 went without you. The stock then spends 3–15 sessions holding tight above the gap on drying volume, and breaks the day-1 high on expanding volume.',
    why: 'Holding the gap for weeks proves the re-rating stuck: nobody who bought day 1 is underwater, and none of them are selling. The EP has turned itself into an HTF, and the flag gives you back a definable stop.',
    rule: 'This is the only legitimate late entry to an EP. Buying on day 2 because you missed day 1 is not — that is the same trade with the stop four times wider and the surprise already spent.',
  },
]

// HTF entries — the five continuation variants in the Playbook taxonomy. The
// structure differs; the trigger barely does. Every one of them is bought at a
// horizontal price off the last printed bar, with the stop at the low that
// price came from. Ordered best-odds first.
export const ENTRY_HTF_TRIGGERS = [
  {
    key: 'longbase', glyph: 'longbase', tone: 'good', signal: 'confirm',
    title: 'Long Base Break', tagline: 'Weeks of flat, one pivot',
    trigger: 'The base high (pivot)',
    stop: 'Last contraction low / breakout-day low',
    what: 'A multi-week to multi-month base whose range contracts into the right edge; the trigger is the break of the base high on volume expansion.',
    why: 'The longest base holds the least supply — every impatient holder has been bored out of the position. The pivot is the single price where whatever is left gets absorbed in public, which is why the move out of it is clean.',
    rule: 'Stop under the last contraction low or the breakout-day low, whichever is tighter and still structural. If that stop sits more than ~1 ADR away, the base has not tightened enough yet — leave it on the watchlist.',
  },
  {
    key: 'downflag', glyph: 'downflag', tone: 'good', signal: 'confirm',
    title: 'Down Flat Flag', tagline: 'The textbook bull flag',
    trigger: 'Prior day’s high',
    stop: 'Low of day / flag low',
    what: 'A pole, then 3–15 sessions drifting sideways-to-down on collapsing volume while holding the upper third of the pole and riding the 10/20.',
    why: 'A flag that drifts down on drying volume is holders refusing to sell into weakness. Because each session prints a lower high, the trigger falls with it — the longer it drifts, the tighter your risk gets for the same trade.',
    rule: 'Buy the break of the prior day’s high; stop at the low of day, or under the flag low when that is tighter than your max. Give back half the pole and this is not a flag — it is a correction with better marketing.',
  },
  {
    key: 'symflag', glyph: 'symflag', tone: 'info', signal: 'confirm',
    title: 'Symmetrical Flag', tagline: 'Both sides converge into the apex',
    trigger: 'High of the apex bar',
    stop: 'Low of the coil',
    what: 'The consolidation coils: lower highs and higher lows squeezing together, volume drying at every touch, until the range goes quiet at the apex.',
    why: 'Symmetry means neither side has committed — which is why the resolution is violent, and why risk at the apex is the smallest it will ever be on this chart.',
    rule: 'Take it at the apex or not at all. Two-thirds of the way through the coil the stop is twice as wide for the identical trade, and the range is still doing its job.',
  },
  {
    key: 'channel', glyph: 'channel', tone: 'info', signal: 'confirm',
    title: 'Channel', tagline: 'A flag that took three weeks',
    trigger: 'Prior day’s high at the channel top',
    stop: 'Last channel low',
    what: 'The consolidation is a clean parallel channel, usually sloping gently down, running weeks rather than days — orderly lower highs and lower lows on fading volume.',
    why: 'Time in a channel does the work a flag does in days: it transfers the float and lets the rails climb back under price. The orderliness is the whole tell — a channel that goes ragged is a downtrend that has not admitted it yet.',
    rule: 'The trigger is still a horizontal price — the prior day’s high as it clears the channel’s upper edge, never the drawn line itself. Out if it gives back more than half the pole.',
  },
  {
    key: 'upflag', glyph: 'upflag', tone: 'warn', signal: 'caution',
    title: 'Up Flat Flag', tagline: 'The one that fakes you out',
    trigger: 'Flag high — volume expansion required',
    stop: 'Flag low (tight, and it will get hit)',
    what: 'The consolidation drifts UP into the highs: a rising wedge of higher highs and higher lows on thin volume, with no shakeout anywhere in it.',
    why: 'An upward drift means nobody was ever forced out, so the supply a flag is supposed to clear is still sitting overhead. The break gets bought by everyone watching the same wedge, and then there is no one left to pay up.',
    rule: 'Demand volume expansion on the trigger bar — same rule as the handle that wedges upward in Bases & Pivots. Otherwise half size, or skip it and wait for a flush-and-reclaim to build a real low.',
  },
]

// The shared mechanics — the numbers that apply to every card above. These are
// the three values the Trade Plan gate asks for (entry, stop, size), stated as
// rules rather than blanks.
export const ENTRY_MECHANICS = [
  { key: 'where', tone: 'good', label: 'The trigger', value: 'OR high or prior-day high',
    note: 'Two triggers on the entire page, both horizontal prices off a bar that already printed. Never a hand-drawn trendline, never “when it looks strong”.' },
  { key: 'stop', tone: 'good', label: 'The stop', value: 'the low it broke from',
    note: 'Opening-range low, low of day, or flag low. Structural, not a percentage — a round-number stop is a level the chart has no reason to respect.' },
  { key: 'width', tone: 'warn', label: 'Stop distance', value: '≤ ~1 ADR',
    note: 'Wider than the stock’s own daily range means you are on the wrong timeframe. Drop to a shorter opening range; never widen the risk to fit the trade.' },
  { key: 'size', tone: 'info', label: 'Size', value: 'risk ÷ stop, then capped',
    note: '0.25–1% of the account, computed before the bell — then held under the position cap below, which binds on every tight-stop entry. Conviction decides which trades you take, never how many shares.' },
  { key: 'chase', tone: 'bad', label: 'Chase limit', value: '≤ ⅓ of the stop above the trigger',
    note: 'Past that the R is already gone — the same move now pays a third less. Missed is cheaper than chased, every time.' },
  { key: 'vol', tone: 'good', label: 'Volume on the trigger bar', value: 'expanding',
    note: 'The break has to be someone acting. Average volume through a pivot is a quote, not a transfer — half size, or wait for the retest.' },
  { key: 'clock', tone: 'info', label: 'When', value: 'after the range prints',
    note: 'Never pre-market, never at 9:30:00. “Let the open settle” and “buy the opening-range break” are the same rule — the range is how you let it settle.' },
  { key: 'rr', tone: 'info', label: 'Minimum R:R', value: '≥ 2R',
    note: 'Measured to the first logical target — measured move or prior high — the same number the Trade Plan gate computes. Under 2R the setup can be right and still not worth the slot.' },
]

// Same setup, six different mornings. The point of the table: the entry decision
// is almost never "is this a good setup" — it is "is the trigger still where the
// plan said it was".
export const ENTRY_LADDER = [
  { key: 'clean', tone: 'good', label: 'Opens in range · breaks the OR high on 3× volume', verdict: 'TAKE IT',
    note: 'The planned trade. Trigger, stop and size were written last night; the market only filled in the timestamp.' },
  { key: 'gapthru', tone: 'good', label: 'Gaps above the trigger · stop still ≤ 1 ADR', verdict: 'TAKE IT',
    note: 'A gap through your level is not a chase while the structural stop is still where the plan put it. Recompute the share count, then go.' },
  { key: 'gapfar', tone: 'warn', label: 'Gaps far above · stop now 2× planned', verdict: 'HALF SIZE OR WAIT',
    note: 'Same trade, twice the risk per share. Halve the size, or wait for the 5/60-min range to hand you a tighter low. Never full size on a doubled stop.' },
  { key: 'thin', tone: 'warn', label: 'Breaks the trigger on 0.8× volume', verdict: 'PROBE OR PASS',
    note: 'The level broke and nobody acted. Pilot size at most — the volume-less break is the one that gets undercut two sessions later.' },
  { key: 'reclaim', tone: 'good', label: 'Breaks, fails, reclaims the level same day', verdict: 'RECLAIM IS THE ENTRY',
    note: 'Undercut & reclaim. The stop is now the failure low, which is tighter than the one you planned — the shakeout did you a favour.' },
  { key: 'gone', tone: 'bad', label: 'Already +8% past the trigger when you look', verdict: 'NO TRADE',
    note: 'The entry is gone and every stop from here is invented. Inventing a stop mid-move is exactly how a planned trade gets logged as Random.' },
]

// ── Entries · the second sizing constraint ──────────────────────────────────
// "Size = risk ÷ stop distance" is correct, and on an opening-range stop it is
// also dangerous: the tighter the stop, the larger the position the formula
// asks for. That arithmetic assumes the stop works — and a stop is a
// continuous-price instrument that stops existing at 4:00 PM. What you own
// overnight is the position, not the risk number.
//
// So every entry gets sized twice and takes the smaller: once assuming the stop
// holds, once assuming a gap skips it entirely. The scenarios below are priced
// by components/Entries.jsx through riskMath.positionSize() — the same function
// the Trade Plan gate sizes with — so the worked example cannot drift from what
// the app actually tells you at the ticket.

// Defaults match trade_plans_router._DEFAULT_CONFIG so the worked example shows
// the numbers the gate would show you.
export const ENTRY_SIZE_ASSUMPTIONS = { account: 25000, riskPct: 0.5, gapPct: 15, capPct: 25 }

// One $42 stock, one entry, four stops — the entire point in four rows.
export const ENTRY_SIZE_SCENARIOS = [
  { key: 'orb1', label: '1-min ORB', entry: 42.10, stop: 41.85,
    note: 'The tightest stop on the page, and the largest position the formula will ever hand you.' },
  { key: 'orb5', label: '5-min ORB', entry: 42.10, stop: 41.40,
    note: 'The default EP entry — still nearly a third of the account on a 0.5% risk unit.' },
  { key: 'orb60', label: '60-min ORB', entry: 42.10, stop: 40.60,
    note: 'Wider range, smaller position. The trade-off working exactly as designed.' },
  { key: 'flag', label: 'HTF flag · prior-day high', entry: 42.10, stop: 40.00,
    note: 'A daily-bar stop sizes itself sanely with no cap needed at all.' },
]

export const ENTRY_SIZE_CAPS = [
  { key: 'single', tone: 'warn', label: 'Single position', value: `≤ 25% of equity`,
    note: 'A starting convention rather than a constant — but any number here beats the formula’s answer, which is “as much as the stop allows”.' },
  { key: 'gap', tone: 'bad', label: 'The gap test', value: 'position × 15% ≤ 3R',
    note: 'Size it a second time assuming the stop never fires. Whatever the risk formula allows and this allows, you take the smaller of the two.' },
  { key: 'hot', tone: 'warn', label: 'Day-1 EP / low float', value: 'half the cap',
    note: 'The names that can gap 15% against you are the ones you just watched gap 25% for you. Overnight volatility is symmetric; your position is not.' },
  { key: 'lev', tone: 'bad', label: 'Leveraged ETFs', value: 'count 3× the notional',
    note: 'TQQQ / SOXL / FNGU at 10% of the account is 30% of the exposure. The cap applies to what you own, not to what the ticker costs.' },
  { key: 'gross', tone: 'info', label: 'Gross exposure', value: '3–5 positions',
    note: 'Your own rule, and the cap does not replace it: per-position discipline still has to add up to a book you can hold through a −3% index day.' },
  { key: 'cost', tone: 'good', label: 'What the cap costs', value: 'nothing at the stop',
    note: 'Cutting size never widens the stop — it lowers the dollar risk too. The cap costs upside on the trades that work, and only that.' },
]

// ── Entries · re-entry ──────────────────────────────────────────────────────
// The rule the panel exists to prevent breaking: sizing every attempt as a
// fresh full unit turns one wrong idea into a −3R day while every individual
// stop was honoured. The budget belongs to the idea.
export const ENTRY_REENTRY = [
  { key: 'tighter', tone: 'good', label: 'Stopped on the 1-min · 5-min range intact', verdict: 'ONE RE-ENTRY',
    note: 'The idea was right and the range was too tight for the noise. The 5-min trigger carries a wider stop, so the size drops on its own — take the rest of the idea’s budget, not a fresh unit.' },
  { key: 'reclaim', tone: 'good', label: 'Flushed the low, reclaimed it the same day', verdict: 'BEST RE-ENTRY THERE IS',
    note: 'Undercut & reclaim. The shakeout built a lower, better-defended low than the one you planned around — this is a new trigger, not a retry.' },
  { key: 'chase', tone: 'warn', label: 'Stopped, then it runs back through your entry', verdict: 'ONLY AT A NEW TRIGGER',
    note: 'Buying back at a worse price with no new level is the revenge form of a re-entry. Wait for the next printed high to break; if there is not one, there is no trade.' },
  { key: 'tomorrow', tone: 'info', label: 'Stopped yesterday · structure intact today', verdict: 'NEW DAY, NEW PLAN',
    note: 'A fresh budget, but only if the flag low or base low is still there. Write the plan again — a re-entry taken off yesterday’s plan reconciles as unplanned in the Discipline scorecard, because that is what it is.' },
  { key: 'third', tone: 'bad', label: 'Third attempt at the same level', verdict: 'OFF THE LIST',
    note: 'Two stops at one level is the market pricing your idea, not noise. It comes back when it has a new base, a new pole or a new catalyst — never merely a new hour.' },
]

// The instant-no list — each of these is an execution error rather than a bad
// read, which is what makes them the cheapest ones to eliminate.
export const ENTRY_DISQUALIFIERS = [
  'No written trigger price before the bell. Deciding the level while the bar prints is reacting to a candle, not executing a plan.',
  'Entering pre-market or on the 9:30 print — there is no range yet, so there is no stop yet.',
  'A stop set at a percentage or a round number instead of the low the move came from.',
  'Widening the stop after entry so the position survives. That is a new trade, with worse odds and no plan behind it.',
  'Buying in front of the trigger to “get a better price”. The level has not proven anything yet — that is a guess wearing a plan’s clothes.',
  'The third attempt at the same pivot inside two weeks: the level is being distributed, not accumulated.',
  'A trigger that fires within ~5 days of earnings — the gap the stop cannot catch (see the earnings gate in Trade Lifecycle).',
  'A stop so wide that the risk-based size is too small to matter. That is a trade taken to be busy.',
]
