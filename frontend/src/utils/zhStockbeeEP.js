// ZH Stockbee on EPs — content module for pages/ZHStockbeeEP.jsx.
//
// Source: a 54-page Stockbee Q&A in which ZH answers member questions about
// trading Episodic Pivots, moderated by EG (easyguru). It is one trader's
// method, stated in one voice, and that is exactly why it lives on its own page
// rather than being folded into the Rules page: Rules is the house framework
// distilled from many sources and speaks in the app's voice, whereas this is
// attributable to a person and should stay legible AS theirs — including the
// places where it contradicts what Rules teaches (see STOP_DIVERGENCE).
//
// Content lives here and the page stays presentation-only, matching the
// convention `utils/tradingRules.js` set. Distilled and reorganised rather than
// reproduced: the Q&A answered every question separately and repetitively, so
// the same rule is scattered across a dozen answers.
//
// Tone keys match components/framework/tones.js (good / info / warn / bad /
// purple) so the shared primitives render this without a second tone map.

export const SOURCE = {
  title: 'Questions from Stockbee',
  subtitle: 'A member Q&A with ZH on trading Episodic Pivots, moderated by EG (easyguru)',
  pages: 54,
  note: 'Distilled into rules and grouped by decision. ZH answered every question individually, so the same idea recurs across many answers — this collects each one in the place you would actually need it.',
}

// ── The plan on one card ────────────────────────────────────────────────────
// ZH's own written trade plan, which is the spine everything else hangs off.
export const TRADE_PLAN = [
  { key: 'filter', tone: 'info', label: 'Market filter',
    value: '10 & 20 EMA sloping up, price above both',
    note: 'Checked on QQQ, IWM and BTC. No filter, no trade.' },
  { key: 'risk', tone: 'warn', label: 'Risk per trade', value: '0.5% flat',
    note: 'Started at 0.25%. Size is whatever that risk buys between entry and stop.' },
  { key: 'identify', tone: 'good', label: 'Identify',
    value: 'Fundamentally game-changing news',
    note: 'Plus the main theme, plus earnings — the three places the money is.' },
  { key: 'evaluate', tone: 'good', label: 'Evaluate by',
    value: 'Chart · Price action · Catalyst',
    note: 'Chart clean, price going up on volume, catalyst genuinely game-changing.' },
  { key: 'entry', tone: 'good', label: 'Entry',
    value: 'Opening range high',
    note: '1-minute ORH on earnings, 5-minute ORH on everything else.' },
  { key: 'stop', tone: 'bad', label: 'Stop', value: 'Low of the day',
    note: 'Always. It does not move — not tighter, not to breakeven.' },
  { key: 'exit', tone: 'purple', label: 'Exits',
    value: 'Sell some into strength, trail some into weakness',
    note: 'The schedule depends on which kind of EP it is. See the trim ladder.' },
]

// ── The formula ─────────────────────────────────────────────────────────────
// ZH's modification of EG's MAGNA53 / CAP10x10 attributes, with the dollar
// volume term added. The answer that "proved to be worth millions" was EG's:
// the more of these attributes present, the bigger the move.
export const FORMULA = [
  { key: 'neglect', label: 'Neglect',
    note: 'Nobody owns it, covers it, or has watched it move. Low relative strength, a laggard sector rating, low fund count, index removal — all count as neglect.' },
  { key: 'surprise', label: 'Surprise',
    note: 'Fundamentally game-changing news the market had not priced. If the stock already made a big multi-month move into the gap, it is not a surprise any more.' },
  { key: 'float', label: 'Low float',
    note: 'Real demand meeting few shares is what makes a move violent instead of orderly.' },
  { key: 'cap', label: 'Low cap',
    note: 'Small enough that one quarter re-rates the company — but under about $40M market cap these stop swinging well unless the theme is huge. Beginners should skip that end entirely.' },
  { key: 'dv', label: '$100M dollar volume',
    note: 'The liquidity that lets institutions build and lets you leave. Without it the other four terms do not get to matter.' },
]

export const FORMULA_NOTE =
  'You rarely get all five. The point is confluence: stack as many as the trade will give you, because magnitude tracks how many are present. Three of five is a different, smaller setup — not 60% of this one.'

// ── Catalyst families ───────────────────────────────────────────────────────
// EG's taxonomy. This classifies the catalyst; it is what decides the exit
// posture further down the page.
export const CATALYST_FAMILIES = [
  {
    key: 'cats', tone: 'good', name: 'CATS', tagline: 'Identifiable',
    blurb: 'Something verifiable happened to the business. You can name it, date it, and check whether it repeats.',
    examples: ['Earnings', 'New product', 'New management', 'Government policy change', 'New CEO', 'New CFO',
      'Partnership with a large company', 'Investment from a large company', 'Regulatory', 'CEO buys shares',
      'Legal rulings'],
    exit: 'Earnings with a raised guide gets the longest leash. Every other CAT is a day-3 trim.',
  },
  {
    key: 'dogs', tone: 'warn', name: 'DOGS', tagline: 'Storytelling',
    blurb: 'The re-rating is narrative. Nothing in the financials changed — what changed is what the market is willing to imagine.',
    examples: ['Stories', 'Fugazi sales', 'Themes — AI, EV, biotech, crypto treasury'],
    exit: 'Faster. No estimate revisions are coming to fund a second leg, so the crowd on the news is the exit.',
  },
  {
    key: 'lava', tone: 'purple', name: 'Liquid Lava', tagline: '9M volume is itself the catalyst',
    blurb: 'No headline required. Sustained multi-million-share turnover in a name that normally has none is the event — somebody large is building, whatever the reason.',
    examples: ['9M volume by itself', 'The everyday 9M breakout', 'Sizeable, stable float'],
    exit: 'Tight risk and real size are the appeal. Trail it — there is no catalyst to date the move from.',
  },
]

// ── Themes ──────────────────────────────────────────────────────────────────
// The largest single idea in the Q&A and the one most easily lost, because it
// is scattered across a dozen answers rather than stated once: locating where
// the money is going is described as the trader's number-one job, and the
// theme is what decides magnitude once a catalyst has already qualified.
export const THEME_DOCTRINE = [
  {
    key: 'job', tone: 'purple', title: 'The #1 job is locating where the money is going',
    body: 'Stated repeatedly and treated as the job description rather than a technique. Everything else — the scans, the chart criteria, the trim schedule — is machinery for acting on that once you have found it.',
  },
  {
    key: 'main', tone: 'good', title: 'Every speculative cycle has ONE main explosive theme',
    body: 'When BTC and IWM are trending up there is a single theme carrying the 5- and 10-baggers, and it rotates cycle to cycle: crypto treasuries most recently, quantum the autumn before, AI story stocks in early 2024. Identifying which one is live is what moves an account, and it is also the exception that overrides the day-1 trim rule.',
  },
  {
    key: 'season', tone: 'info', title: 'Every earnings season has a theme too',
    body: 'Not only speculative cycles. One season it is triple-digit revenue growth with neglect; another it is reaffirmed full-year guidance after a correction. Finding the season\'s theme and exploiting it is described as your job, not a bonus.',
  },
  {
    key: 'second', tone: 'bad', title: 'Missing the first is fine. Missing the second is a process error',
    body: 'ZH missed the EP that started the crypto-treasury theme and then did not miss a single one after it. The first instance of a theme is genuinely unknowable; every one after it is a review failure, and the same mistake should not happen twice.',
  },
  {
    key: 'late', tone: 'warn', title: 'You do not need to be early to the theme',
    body: 'Explicitly: you do not have to identify a theme before it becomes common knowledge. Daily review is enough — the second, third and fourth names in an established theme are the tradeable ones.',
  },
  {
    key: 'fade', tone: 'info', title: 'Themes fade, and the "why" does not matter',
    body: 'Let the stocks tell you the theme is out of favour: they stop holding the trend, fades and breakdowns start appearing. Some names in a theme fail while others run — that is normal and not a signal by itself.',
  },
]

export const THEME_SOURCES = [
  { key: '9m', tone: 'good', label: 'The 9M review', value: 'Daily',
    note: 'What is moving, and why. The single most-repeated habit in the document.' },
  { key: 'gappers', tone: 'good', label: 'The EP gappers scan', value: 'Daily',
    note: 'A stock gapping on game-changing news often turns its whole sector into a theme — watchlist the theme, not just the ticker.' },
  { key: 'notes', tone: 'info', label: 'A written themes list', value: 'Kept current',
    note: 'A notes section holding the live themes. Anything gapping that belongs to one goes on the watchlist on that basis alone.' },
  { key: 'megacap', tone: 'purple', label: 'What mega-caps say and spend on', value: 'Ongoing',
    note: 'Market-leading companies deploying capital into a sector tell you where the money is going before the small caps gap. Those sectors go on watch.' },
  { key: 'losers', tone: 'info', label: 'Failed high-volume gaps', value: 'Reviewed too',
    note: 'Where money went and did NOT stick is information about the theme, not just about the stock.' },
  { key: 'weekend', tone: 'warn', label: 'Weekend gainers review', value: 'Weekly',
    note: 'Largest gainers and their setups. Flags are a good indicator of where money might go in the days ahead even if you do not trade them.' },
]

// ── Selection ───────────────────────────────────────────────────────────────
export const SELECTION_GATE = [
  { key: 'gap', tone: 'good', label: 'Gap', value: '10%+',
    note: 'Below that it is a good day, not an episode.' },
  { key: 'pmvol', tone: 'good', label: 'Pre-market volume', value: '1M+ shares',
    note: 'Rule of thumb: a stock trades roughly 10× its pre-market volume on the day. 1M pre-market projects to 9M+ on the day.' },
  { key: 'dv', tone: 'good', label: 'Dollar volume', value: '$100M on the day',
    note: 'The best non-earnings EPs show $20–25M in dollar volume pre-market alone.' },
  { key: 'growth', tone: 'good', label: 'If earnings', value: 'mid/high double or triple-digit growth',
    note: 'EPS and revenue growth plus a significant beat. Small names often have no analyst coverage — then you trust the numbers and the volume.' },
  { key: 'quiet', tone: 'info', label: 'Prior 3–6 months', value: 'has NOT rallied',
    note: 'If the stock already made a big multi-month move into the gap-up, how much of a surprise can this really be?' },
  { key: 'above', tone: 'good', label: 'Where it opens', value: 'above every moving average',
    note: 'Gapping above all the MAs and above resistance, out of a base. No overhead supply to sell into your entry.' },
  { key: 'base', tone: 'info', label: 'The base', value: 'cup, flat-top / Darvas, high tight flag',
    note: 'You want to be buying the right side of a cup. Should be a clean break on the WEEKLY chart, not only the daily.' },
  { key: 'firstday', tone: 'warn', label: 'Volume at the open', value: 'ADV in the first 15–30 min',
    note: 'Many of the best ones trade their entire average daily volume inside the first half hour.' },
]

export const SELECTION_NOTES = [
  {
    key: 'earnvol', tone: 'purple', title: 'Low pre-market volume on an earnings EP is an EDGE',
    body: 'Counter-intuitive and worth internalising: on earnings EPs, thin pre-market trade is good news. Institutions accumulate during the session, not in pre- and post-market. Several of ZH\'s best earnings trades had almost no pre-market volume — the volume arrived at the open. Story EPs are the opposite and will usually show 1M shares or $25M pre-market.',
  },
  {
    key: 'pmpattern', tone: 'good', title: 'The pre-market chart is a tell, not a level',
    body: 'ZH does not set levels off pre-market, but notes that essentially every EP that worked had made a bullish pre-market pattern — a flag or a cup. Present about 90% of the time; when volume is very thin it simply does not form.',
  },
  {
    key: 'redhammer', tone: 'bad', title: 'The pre-market red hammer',
    body: 'An ugly red bar down on heavier volume than any green bar in the pre-market session. That is evidence of a big seller, and those do not end well. Avoid.',
  },
  {
    key: 'personality', tone: 'warn', title: 'Stocks have personalities',
    body: 'Some names have a history of treating gap buyers badly and will do it again — they mean-revert to the moving averages and fade on earnings regardless of how good the print was. A poor gapping history is a reason to pass even when the numbers are excellent.',
  },
  {
    key: 'chart', tone: 'bad', title: 'You cannot beat a bad chart',
    body: 'Repeated throughout: no base or range, downward-sloping MAs, resistance to the left — the news has to be enormous to overcome it, and usually is not. Incredible earnings can occasionally overcome a poor chart. Plan on it and you will lose.',
  },
  {
    key: 'shortlist', tone: 'info', title: 'Seven on the list, one or two taken',
    body: 'A typical morning starts with 7–10 watchlisted names and eliminates most of them because something is not perfect. On most days only one or two meet every criterion. Going through every single earnings report in the calendar — 50 to 70 of them — is how you make sure you did not miss.',
  },
]

// Where the candidates actually come from. Concrete enough to be rebuilt as
// screens — several already exist in QuantForge, which the page cross-links.
export const WHERE_TO_LOOK = [
  { key: 'cal', tone: 'good', label: 'Earnings calendar', value: 'Every single name',
    note: 'Sorted by revenue growth, then read through — 50 to 70 reports on a heavy night. "How else am I supposed to make sure I don\'t miss?" One day of doing this produced three EPs and a 15–17% account move.' },
  { key: 'pm', tone: 'good', label: 'Pre-market momentum', value: 'Big dollar volume + perfect chart',
    note: 'The non-earnings half. Best story EPs show 1M+ shares or $20–25M dollar volume before the bell.' },
  { key: 'gappers', tone: 'info', label: 'Gappers scan at the open', value: 'Gap > 7% · DV > $12M',
    note: 'The safety net for anything the pre-market scans missed — typically names with no pre-market volume at all.' },
  { key: 'sugar', tone: 'purple', label: '"Sugar Babies"', value: '7%+ ADR · 8.9M+ avg volume',
    note: 'His own screen of high-range liquid names, reviewed for how they are behaving. Best used from tight areas WITH a catalyst; described as a secondary focus rather than the main hunt.' },
  { key: 'squawk', tone: 'info', label: 'Squawk + newsfeed', value: 'Live, 9:00–9:30',
    note: 'News breaking in the half hour before the open can be the best EPs of all — institutions have no time to accumulate pre-market and must do it during the session.' },
  { key: 'keywords', tone: 'warn', label: 'Newsfeed keyword searches', value: 'An underused edge',
    note: 'Suggested starting terms: tariffs, crypto treasury, preliminary, revenue, new CEO, sales order. ZH notes he has done less with this than he would like.' },
]

export const DELAYED_REACTION = {
  title: 'The ones that fail your criteria: delayed reaction',
  body: 'Stocks with great catalysts that do NOT meet the gap-up chart criteria frequently set up later for a delayed-reaction entry. ZH keeps an entire database of them but treats it as a separate setup with its own entries on the daily, not a variation of this one — he will take one if it falls in his lap and otherwise stays focused. The reason it is worth knowing: it is what makes screenshotting failed gappers pay off twice.',
}

// ── Entry ───────────────────────────────────────────────────────────────────
export const ENTRY_RULES = [
  { key: 'orh1', tone: 'good', label: '1-minute ORH', value: 'Earnings EPs',
    note: 'Binary reaction, best risk/reward, and the fastest to get away from your entry — which is easier on a newer trader\'s psychology.' },
  { key: 'orh5', tone: 'good', label: '5-minute ORH', value: 'Everything else',
    note: 'The default for stories, themes and non-earnings catalysts.' },
  { key: 'green2', tone: 'warn', label: 'Two green 5-min bars', value: 'Huge gappers (+100%)',
    note: 'These often tick above the ORH and immediately wick down, so the bar that takes out the range closes red. Waiting for the second bar to confirm green avoids that cut and raised ZH\'s win rate.' },
  { key: 'buystop', tone: 'purple', label: 'Buy-stop at pre-market high', value: 'High conviction only',
    note: 'Used on liquid, stable, higher-float names where the open will be fast and the ORH unreachable. An exception earned through study — not a beginner\'s tool.' },
  { key: 'miss', tone: 'info', label: 'If you miss the ORH', value: 'Pass',
    note: 'No retracement, no trade. Then go find out why you missed it — the miss is a process question.' },
  { key: 'reenter', tone: 'info', label: 'Re-entry after a stop-out', value: 'Take out the day\'s high',
    note: 'Wants a higher low on a higher time frame above the open price, then a break of the highs. Done at half size on at least one documented occasion, and it worked.' },
]

export const ENTRY_LAW =
  'Generally, ORH or not: the stock should be going up as you are buying it. The entry exists to make the stock tell you it wants to go higher.';

// ── Stop ────────────────────────────────────────────────────────────────────
export const STOP_RULES = [
  { key: 'lod', tone: 'bad', label: 'The stop', value: 'Low of the day, always',
    note: 'For a swing trader the LOD is the best structural stop, and this matters more for an EP trader than anyone.' },
  { key: 'never', tone: 'bad', label: 'Moving it', value: 'Never — under 1% of the time',
    note: 'Not tighter, not to breakeven, not on day 2. "Accept the risk and let the trade unfold."' },
  { key: 'intraday', tone: 'warn', label: 'Intraday stops', value: 'Abandoned',
    note: 'Tried and dropped: with an intraday stop you wake up on day 2, the stock returns to your entry, stops you out below a level that is not the LOD, and then goes up 50%.' },
  { key: 'oversized', tone: 'warn', label: 'If the risk feels too big', value: 'The position is too big',
    note: '"If you have issues with this my guess is you\'re over-sizing." The stop is not the problem.' },
]

export const STOP_DIVERGENCE = {
  title: 'Where this contradicts the Rules page — on purpose',
  body: 'QuantForge\'s Exits ticket moves the stop entry-low → breakeven → rail once the first partial is banked. ZH does the opposite and is emphatic about it: EPs routinely slide back toward the entry, intraday and over the following sessions, without ever taking out the gap-day low, and then go. A stop pulled to breakeven turns the family\'s normal behaviour into a loss. Both rules are defensible — the ticket is written for continuation trades, where a return to entry usually means failure. Know which one you are trading before you decide whose stop rule applies.',
  ref: { to: '/rules#exits', label: 'The Exits ticket' },
}

// ── Trim & trail ────────────────────────────────────────────────────────────
export const TRIM_LADDER = [
  {
    key: 'day1', tone: 'info', day: 'Day 1', when: 'The gap session itself',
    action: 'Sell nothing',
    trigger: '4+ halts or a vertical spike → trim 50–80% max',
    note: 'Day 1 is for getting the position, not reducing it. That trim is defensive rather than profit-taking — repeated halts plus a vertical print is a forewarning. The exception: if it is halting AND it is the market\'s main explosive theme, do not trim.',
  },
  {
    key: 'day2', tone: 'good', day: 'Day 2', when: 'First follow-through day',
    action: 'Sell 50%, trail the rest with the 10 EMA',
    trigger: 'Stories · themes · biotech · explosive moves over +100%',
    note: 'Follow-through means taking out the day-1 high, not merely closing green. This is the fast-decaying half of the family: the narrative has now been told, so the follow-through day holds the thickest crowd and the best fill you will get.',
  },
  {
    key: 'day3', tone: 'good', day: 'Day 3', when: 'Two full sessions of proof',
    action: 'Sell 50%, trail with the 10 EMA or 20 MA',
    trigger: 'Earnings with NO guidance · other CATs (regulatory, new product, CEO buys)',
    note: 'A beat re-prices the last quarter and nothing else, so the buying it funds is measured in days. Take what the news paid for and let the remainder prove it wants more.',
  },
  {
    key: 'day5', tone: 'purple', day: 'Day 5+', when: 'The one worth waiting on',
    action: 'Trim ~4% a day down to 70% or 50%, trail the rest',
    trigger: 'Earnings with a big raised guide',
    note: 'The only variant given room to build a second leg. Guidance moves the forward model and estimate revisions take weeks, so bleed it down slowly and let the rail end the trade.',
  },
]

export const TRIM_LADDER_FOOTNOTE =
  'The ladder assumes a trending market. ZH\'s own note for the non-trending case: "Why are you even trading?"'

export const TRAIL_RAIL = [
  { key: 'small', tone: 'good', label: 'Small caps', value: '10 EMA',
    note: 'Fast and volatile — a 20-day rail sits far enough below price that giving it up costs most of the move.' },
  { key: 'midlarge', tone: 'info', label: 'Mid & large caps', value: '20 MA',
    note: 'Slower, wider moves that shake out on the 10 and keep going. The extra room lets a real trend survive its own noise.' },
  { key: 'history', tone: 'purple', label: 'What it has surfed before', value: 'Beats both defaults',
    note: 'Stocks keep their habits around the rails. Look at what this name has actually trended on; the cap-based default is only a starting guess.' },
  { key: 'hourly', tone: 'warn', label: 'Moves of +300% and up', value: 'The hourly, not the daily',
    note: 'The most expensive mistake in this section. On a five-bagger the daily 10 EMA sits tens of percent below price — a daily trail hands the whole move back. Use the 60-minute, or the 30/65-minute.' },
]

export const VARIANTS = [
  {
    key: 'earnings', tone: 'good', name: 'Earnings', tagline: 'The patient one',
    posture: 'Sell ~10% into the first follow-through, then wait for it to start surfing the 10 EMA before selling more.',
    cap: 'Never exit more than 50% of an earnings EP.',
    why: 'The variant with an actual forward model behind it — funds accumulate over weeks, so the moves are durational rather than explosive. "I know the moves they will make over time."',
  },
  {
    key: 'story', tone: 'info', name: 'Story', tagline: 'Priced on a narrative',
    posture: 'Take some off in 2–3 days, scaled to market cap, float and how strong the catalyst really is.',
    cap: 'Faster than earnings, slower than a microcap.',
    why: 'A story re-rates the imagination, not the model. No estimate revisions are coming to fund the next leg.',
  },
  {
    key: 'microcap', tone: 'warn', name: 'Microcap', tagline: 'The round-trip risk',
    posture: 'Must sell into strength. Trail what is left on the HOURLY 10 EMA.',
    cap: 'A daily trail on a several-hundred-percent move gives all of it back.',
    why: 'The lesson that produced the whole variant scheme: ZH round-tripped a great deal of profit before accepting he could not hold something up 500% on a daily rail, even a 20% remainder of the original position.',
  },
  {
    key: 'biotech', tone: 'bad', name: 'Biotech', tagline: 'Perfect or pass',
    posture: 'Sell into strength on the first follow-through day and keep a runner.',
    cap: 'The default is to stay away unless it is perfect.',
    why: 'Binary news on a company that is usually one asset. The gap prices the entire re-rating in a single bar.',
  },
  {
    key: 'ipo', tone: 'purple', name: 'IPO', tagline: 'Read the cup',
    posture: 'Judge it on the pattern — many make the right side of a cup and stop dead at the old high.',
    cap: 'Work out how much the market actually likes it before assuming a second leg.',
    why: 'No multi-year chart, so the usual neglect and overhead-supply tests do not apply. The shape built since listing replaces them.',
  },
  {
    key: 'liqtrap', tone: 'info', name: 'Liquidity trap', tagline: 'A three-day structure',
    posture: 'Big day 1, then a tight day trading under 1 ATR, then follow-through. Exit day 3 into strength.',
    cap: 'The exit is the structure, not a rail.',
    why: 'Described as a structural tendency of the market rather than a catalyst class: the tight day is supply being absorbed and the follow-through is the release.',
  },
]

export const TRIM_PRINCIPLE = [
  { key: 'why', tone: 'good', label: 'What selling into strength buys',
    note: 'Asymmetric leverage, a risk-free position, buying power, reduced margin, locked-in gains. Always know which of those you are selling for.' },
  { key: 'trail', tone: 'purple', label: 'Where the money actually comes from',
    note: 'On earnings EPs with a reason to keep going, most of the profit comes from the TRAIL, not the trim — which is why the size of the first partial matters less than it feels like. Trail roughly 50% to maximise returns.' },
  { key: 'add', tone: 'bad', label: 'Adding to winners',
    note: 'Rarely to never. It adds complexity and lowers the expected value of the trade. The one exception is a stock printing a second EP.' },
  { key: 'daily', tone: 'info', label: 'Which chart you manage on',
    note: 'The daily. Obsessing over the intraday chart shook ZH out of good trades repeatedly — reserve judgement until the close, when the candle holds all its information.' },
]

// The intraday structure underneath the daily trail — an observation from
// hundreds of trades, and the reason a day-1 extension is not a reason to sell.
export const HOURLY_RAIL = {
  title: 'Most EPs test the hourly 10 EMA before they go higher',
  body: 'Nearly all of them find support or bounce on the 60-minute 10 EMA before the next leg. If a stock gets extended from it on day 1, that rail has to be tested — through price or through time — before the EP goes higher. This is why a name going sideways for days is not failing, and why "it came back to my entry" is usually the setup working rather than breaking.',
}

// Identifying tops — deliberately separate from the trim ladder, because the
// ladder is a schedule and this is a judgement call reserved for the explosive
// variants. On earnings EPs the answer stays "trail the rail".
export const TOPPING_TELLS = [
  { key: 'earnings', tone: 'good', label: 'On earnings EPs', value: 'Do not try',
    note: 'Trail into weakness with the 10 EMA or 20 SMA and let the rail end it. No fade-point hunting.' },
  { key: 'resist', tone: 'info', label: 'On explosive EPs', value: 'A resistance area on the chart',
    note: 'Find the level first. Fibonacci works here too — drawn from the most recent high to the most recent low.' },
  { key: 'cup', tone: 'purple', label: 'IPOs', value: 'The top of the cup',
    note: 'Many simply make the right side of the cup and stop at the old high.' },
  { key: 'legs', tone: 'warn', label: 'Third legs', value: 'Late-cycle',
    note: 'ZH topped most of the quantum names on their third legs, with the scans full of lottery tickets — a cycle-level tell, not a stock-level one.' },
  { key: 'volume', tone: 'good', label: 'Volume not going away', value: 'Stay',
    note: 'Volume is described as the only leading indicator. While it keeps coming, the trail decides the exit, not your price target.' },
  { key: 'halts', tone: 'bad', label: 'Multiple halts + vertical spike', value: 'Exit 50–80%',
    note: 'The day-1 exhaustion tell. Overridden only when the name IS the main explosive theme.' },
]

// What the book actually looks like — the shape a 0.5%-risk EP book takes.
export const PORTFOLIO_SHAPE = [
  { key: 'count', tone: 'info', label: 'Positions at once', value: '7 – 12, up to 24',
    note: 'Twenty-four runners at the end of a hot cycle, more typically 10–12, seven at the time of writing. Position count falls as selectivity rises.' },
  { key: 'cull', tone: 'warn', label: 'End of a cycle', value: 'Cut to 1–3',
    note: 'Described as a sixth sense that creeps in and wipes all but a few — an admittedly discretionary call, not a rule.' },
  { key: 'cap', tone: 'good', label: 'Market cap', value: 'Mostly under $10B',
    note: 'Small and mid caps make the largest-magnitude moves; many of the best have been well under $1B. Mega caps influence the indexes and are watched, not traded.' },
  { key: 'freq', tone: 'purple', label: 'Trades per year', value: '~350 – 500',
    note: 'Roughly one to two a day across a full year — and on most days only one or two names clear every criterion.' },
]

// ── Risk & size ─────────────────────────────────────────────────────────────
export const RISK_RULES = [
  { key: 'start', tone: 'good', label: 'Starting risk', value: '0.2 – 0.3%',
    note: 'Great returns are still available here. Going from 0.25% to 0.3–0.35% produced substantially more money — there is no need to rush past it.' },
  { key: 'now', tone: 'info', label: 'ZH today', value: '0.5% flat',
    note: 'Usually closer to 0.6% with slippage. It took months of full-time study before he wanted to risk 0.5%.' },
  { key: 'onepct', tone: 'bad', label: 'The 1% rule', value: 'Called a fallacy',
    note: 'Even KQ risks 0.3–0.5% on most trades. Most traders would do better at the lower number until consistently profitable.' },
  { key: 'size', tone: 'info', label: 'Typical position', value: '10 – 15%',
    note: 'Size is derived: risk ÷ (ORH entry − LOD stop). Simple mental math at the open.' },
  { key: 'max', tone: 'warn', label: 'Maximum overnight', value: '25 – 30%',
    note: 'A guideline rather than a rule, and one he notes he is working on breaking less often.' },
  { key: 'order', tone: 'purple', label: 'The sequence', value: 'Consistency → then size',
    note: 'If sizing up produces drawdowns, you are not ready to size up. "Trading is a unique job where you can give yourself a pay raise very quickly when you don\'t even deserve it."' },
]

// ── Market filter ───────────────────────────────────────────────────────────
export const MARKET_FILTER = [
  { key: 'up', tone: 'good', regime: 'QQQ / IWM / BTC above a rising 10 & 20 EMA',
    action: 'Full playbook',
    note: 'A multitude of catalysts work. This is when stories and themes follow through and when you should be willing to use margin.' },
  { key: 'chop', tone: 'warn', regime: 'Choppy or sideways — below the 10 and 20',
    action: 'Earnings EPs only',
    note: 'The setup still does fine, but ORH stops working well on stories and there is little follow-through. IWM and BTC are the speculation gauge: when they are choppy there is no speculative money in the market.' },
  { key: 'down', tone: 'bad', regime: 'Downtrend',
    action: 'Do not fight it',
    note: 'A great-looking EP will simply not follow through because the market is bad. ZH has traded against the trend before and will not again — he would rather express the downtrend directly through inverse instruments than work 100× as hard.' },
]

export const MARKET_FILTER_NOTE =
  'The specific filter is borrowed from KQ: QQQ 10 above 20 and trending up, originally SMAs and now EMAs. The point is not the exact rule — "you don\'t have to use this, but you need to use some kind of market filter". Stockbee has the Market Monitor; Zanger has his oscillator. Something has to tell you when to be in cash or take less size.'

// ── Process ─────────────────────────────────────────────────────────────────
export const DRAWDOWN_PROTOCOL = [
  'Take a step back',
  'Review the market filter',
  'Review the trend',
  'Review what is working and what is not',
  'Review themes and market shifts',
  'Re-focus and re-organise',
  'Control risk — risk less',
  'Scale down the number of trades',
  'Review setup quality',
  'Get small wins, gain confidence back',
]

export const DRAWDOWN_NOTES = [
  {
    key: 'threshold', tone: 'warn', title: 'The trigger is 2–3%, not 10%',
    body: 'Equity drawdown should not get past 4–5%; the largest in over a year was 6%. At 2–3% down and stopping out, something is wrong — tighten immediately and find one A+ winner, even if it takes a week.',
  },
  {
    key: 'instinct', tone: 'bad', title: 'The instinct is exactly backwards',
    body: 'Nobody likes drawdown and the natural response is to trade more and size up to get out of it quickly. You need the opposite. Things are not going well for a reason, and you should do nothing until you can name the reason.',
  },
  {
    key: 'how', tone: 'good', title: 'Come out of it on good trading, not one big trade',
    body: 'Over-risking your way out can work, but it does not solve the problem — and most traders who do it go straight back into drawdown.',
  },
  {
    key: 'equity', tone: 'info', title: 'Equity drawdown, not open P&L',
    body: 'A 10–12% swing in account value while trailing runners is normal and not what any of this refers to. Stocks test their moving averages; that is the cost of the returns.',
  },
]

export const MISSED_VS_PASSED = {
  title: 'Missing and passing are not the same thing',
  body: 'Passing on an EP is an edge — it raises your win rate. Missing one is a process error and it is your fault. ZH rates a miss as worse than a loss, because a stop-out is priced risk while a miss is an unbounded opportunity gone. The remedy is to note every EP you passed on that then worked, and figure out why it worked.',
  quantforge: 'This is the Missed Book\'s exact design: entries carry a verdict, and only "missed" ones accrue cost — a logged pass is a process win and never sums into the loss total.',
  ref: { to: '/missed', label: 'Missed Book' },
}

export const TRACKING = [
  {
    key: 'all', tone: 'good', title: 'Track every EP, including the ones you did not take',
    body: 'Every EP that fits the criteria, plus the irregular ones — odd chart, unfamiliar catalyst — go on a watchlist. Clean it up at the end of each month and keep only the best.',
  },
  {
    key: 'failed', tone: 'warn', title: 'Screenshot the failures and write down why',
    body: 'Failed gappers get their own section in the journal with a note on why they failed, taken or not. Many later set up as delayed reactions, so the file becomes a database of its own.',
  },
  {
    key: 'book', tone: 'purple', title: 'One book a year, 5★ only',
    body: 'At the end of each year, a printed book of only the picture-perfect EPs. One per year for decades, and eventually a teaching tool for his kids. "Less is more."',
  },
  {
    key: 'recall', tone: 'info', title: 'The point is recall, not record-keeping',
    body: 'Flipping through the archive on weekends is what makes a new EP recognisable: "oh, this is just like that, and here is why." A 5–6 year database exists digitally alongside the printed books.',
  },
]

export const ROUTINE = [
  { key: 'pre', tone: 'info', time: 'Pre-market · ~1 hour', what: 'Scan, build the watchlist, refine to perfect charts',
    note: 'Up at 4–5am, sees what is moving, watches old streams, walks 4–5 miles, back by 8:30. On heavy earnings days, an hour the night before as well.' },
  { key: 'open', tone: 'good', time: 'The open', what: 'Entries, if there are any at all',
    note: 'Execution takes seconds with hotkeys and a trade ladder. Normally done watching by 10–11am.' },
  { key: 'day', tone: 'info', time: 'Midday', what: 'Annotate charts with the news behind every notable mover',
    note: 'Track which themes are hot, what type of catalysts are working, which sectors — whether or not he traded them.' },
  { key: 'post', tone: 'purple', time: 'After hours · ~1 hour', what: 'Scan after-hours movers and earnings',
    note: 'Watches the close from 3pm. Total screen time can compress to about an hour if needed.' },
  { key: 'weekend', tone: 'warn', time: 'Weekends', what: 'Deep dives, review, refinement',
    note: 'Refining is done on weekends only — no daily tinkering unless something is genuinely changing in the market.' },
]

export const DEEP_DIVE_ADVICE = [
  {
    key: 'problem', tone: 'good', title: 'Always start with a problem to solve',
    body: 'Begin from "what is working / what is not working" in your own trading. A dive without a problem behind it produces averages and statistics that do not mean anything and will not change what you do.',
  },
  {
    key: 'patterns', tone: 'purple', title: 'Be a chart-pattern machine',
    body: 'Memorise the patterns. Learn to draw the lines for range breaks. Look at why they move. Being overly technical is the failure mode — the traders worth copying have feel, not indicators.',
  },
  {
    key: 'verify', tone: 'info', title: 'Verify everything yourself',
    body: 'You will not make a living off anyone else\'s conviction. Follow people who have been at it 20–30 years or made serious money — then go prove or disprove what they said. Your competition has the same information; there is no reason to neglect any of it.',
  },
  {
    key: 'one', tone: 'warn', title: 'Master one setup before adding a second',
    body: 'The single biggest beginner mistake is trying to do too much — and it is a mistake plenty of experienced traders make too. Entries, exits, catalyst variations and magnitude are all still ahead of you inside that one setup.',
  },
]

// ── The honest caveats ──────────────────────────────────────────────────────
// The page should not read as a promise. These are ZH's own numbers and
// qualifications, kept together so they are not scattered where they can be
// skipped.
export const CAVEATS = [
  {
    key: 'winrate', title: 'The win rate is 70%, not 90%',
    body: 'Disciplined months reach 90%; relaxed months drop to 40%. The stated average is around 70%, and ZH describes even that as making mistakes and deviating from his own setup.',
  },
  {
    key: 'discretionary', title: 'This is explicitly a discretionary method',
    body: '"Absolutely not" to automating catalyst selection — it would be a detriment to the analytical skill and creativity the setup depends on. Confluence and context are the parts a scanner cannot supply. Screens narrow the field; they do not make the decision.',
  },
  {
    key: 'time', title: 'The conviction came from 12-hour days for a year',
    body: 'The exceptions in this document — buying at the open before the range, sizing to 26–35% of the account, holding through a weak close — are described repeatedly as things earned through study and not to be copied by a newer trader. The rules are the copyable part.',
  },
  {
    key: 'record', title: 'Unverified by design',
    body: 'The Q&A opens by declining to assemble a track record across brokers, and tells members to verify everything independently. Treat what follows as a well-argued method, not as evidence.',
  },
]
