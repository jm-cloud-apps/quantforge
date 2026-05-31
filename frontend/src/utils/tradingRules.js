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
