// Chart math behind the Rules-page MA Rails visuals (MARailsVisuals.jsx).
//
// The price line in every panel is a hand-tuned anchor curve, but the
// 10/20/50 lines are *computed* EMAs/SMA over that tape — lag, stacking and
// crossovers are real, so the pictures can't drift out of sync with the
// rules they illustrate. Everything is deterministic (seeded noise) and
// built once at module load; components just render the precomputed paths.

// ---------------------------------------------------------------- tape math
// mulberry32 / buildTape / ema are the generic deterministic-tape primitives;
// volumeCharts.js reuses them so both panels share one price engine.

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// anchors: [bar, price, wobble] waypoints. Price is cosine-eased between
// anchors with seeded noise scaled by the local wobble, so segments can be
// calm (bases) or ragged (momentum legs).
export function buildTape(anchors, seed) {
  const rnd = mulberry32(seed)
  const out = []
  for (let i = 0; i < anchors.length - 1; i++) {
    const [b0, p0, w0] = anchors[i]
    const [b1, p1, w1] = anchors[i + 1]
    for (let b = b0; b < b1; b++) {
      const t = (b - b0) / (b1 - b0)
      const eased = 0.5 - Math.cos(Math.PI * t) / 2
      const wob = w0 + (w1 - w0) * t
      out.push(p0 + (p1 - p0) * eased + (rnd() * 2 - 1) * wob)
    }
  }
  out.push(anchors[anchors.length - 1][1])
  return out
}

export function ema(arr, n) {
  const k = 2 / (n + 1)
  const out = [arr[0]]
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k))
  return out
}

function sma(arr, n) {
  const out = []
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]
    if (i >= n) sum -= arr[i - n]
    out.push(sum / Math.min(i + 1, n))
  }
  return out
}

// ------------------------------------------------------------ panel builder

const RAIL_DEFS = {
  ema10: tape => ema(tape, 10),
  ema20: tape => ema(tape, 20),
  sma50: tape => sma(tape, 50),
}

// Builds one panel: tape + requested rails, scaled into a viewBox with only
// the post-warmup window visible. Returns px-space paths plus bar→px scales
// so callers can place event markers with the same geometry.
function buildPanel({ anchors, seed, warmup, rails, w, h, pad }) {
  const { l = 8, r = 8, t = 10, b = 10 } = pad || {}
  const tape = buildTape(anchors, seed)
  const lines = { price: tape }
  for (const key of rails) lines[key] = RAIL_DEFS[key](tape)

  const last = tape.length - 1
  let lo = Infinity
  let hi = -Infinity
  for (const key of Object.keys(lines)) {
    for (let i = warmup; i <= last; i++) {
      const v = lines[key][i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }

  const x = bar => l + ((bar - warmup) / (last - warmup)) * (w - l - r)
  const y = p => t + ((hi - p) / (hi - lo)) * (h - t - b)

  const paths = {}
  for (const key of Object.keys(lines)) {
    let d = ''
    for (let i = warmup; i <= last; i++) {
      d += `${i === warmup ? 'M' : 'L'}${x(i).toFixed(1)} ${y(lines[key][i]).toFixed(1)}`
    }
    paths[key] = d
  }

  return { w, h, tape, lines, warmup, last, x, y, paths }
}

// Closed band between price and a rail over [from, to] — the "riding the
// rail" shading in the glyphs.
function band(panel, railKey, from, to) {
  const { x, y, tape, lines } = panel
  const rail = lines[railKey]
  let d = ''
  for (let i = from; i <= to; i++) d += `${i === from ? 'M' : 'L'}${x(i).toFixed(1)} ${y(tape[i]).toFixed(1)}`
  for (let i = to; i >= from; i--) d += `L${x(i).toFixed(1)} ${y(rail[i]).toFixed(1)}`
  return d + 'Z'
}

// Bar where price comes closest to the rail within [from, to] — used to pin
// "touch of the rail" markers onto real geometry.
function nearestTouch(panel, railKey, from, to) {
  const { tape, lines } = panel
  let best = from
  let bestDist = Infinity
  for (let i = from; i <= to; i++) {
    const d = Math.abs(tape[i] - lines[railKey][i])
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

// First bar at/after `from` closing below the rail — the break-rule marker.
function firstCloseBelow(panel, railKey, from) {
  const { tape, lines, last } = panel
  for (let i = from; i <= last; i++) if (tape[i] < lines[railKey][i]) return i
  return last
}

const pt = (panel, bar, value) => ({ x: panel.x(bar), y: panel.y(value) })

// ------------------------------------------------------------------- colors
// Mirrors tailwind.config.js — SVG strokes can't use Tailwind classes for
// gradients/opacity variants, so the rail tones are pinned here.

export const RAIL_COLORS = {
  price: '#E2E8F0', // surface-50
  ema10: '#10B981', // accent
  ema20: '#06B6D4', // cyan
  sma50: '#8B5CF6', // purple
  danger: '#EF4444',
  muted: '#64748B', // surface-400
}

// ------------------------------------------------------------------ HERO
// One full lifecycle of a momentum leader: base → breakout → surf the 10 →
// first pullback to the 20 → time-correction into the 50 → final leg →
// decisive close below the rail. Phase copy lives in tradingRules.js
// (MA_ANATOMY_PHASES); the keys here must match.

const HERO_W = 720
const HERO_H = 250

const hero = buildPanel({
  seed: 11,
  warmup: 55,
  rails: ['ema10', 'ema20', 'sma50'],
  w: HERO_W,
  h: HERO_H,
  pad: { l: 10, r: 30, t: 30, b: 14 },
  anchors: [
    [0, 31, 0.6],
    [26, 27, 0.8],
    [55, 26, 0.7], // visible start — base
    [76, 26.5, 0.8],
    [79, 27.2, 0.4],
    [81, 32, 0.4], // breakout thrust
    [88, 36, 0.8],
    [94, 41, 0.9],
    [97, 38.6, 0.35], // shallow dip onto the 10
    [104, 50, 0.9],
    [107, 47.2, 0.35], // second dip
    [112, 55, 0.7], // surf top
    [117, 51, 0.5],
    [121, 49.8, 0.35], // first pullback — settles onto the 20
    [130, 66, 0.9], // leg 2
    [140, 61, 0.8],
    [149, 55.8, 0.45], // time correction tags the 50
    [163, 76, 0.8], // leg 3
    [167, 73, 0.5],
    [172, 58, 0.5], // breakdown
  ],
})

const heroSurfDip = nearestTouch(hero, 'ema10', 94, 112)
const heroPb20 = nearestTouch(hero, 'ema20', 114, 126)
const heroTag50 = nearestTouch(hero, 'sma50', 142, 155)
const heroExit = firstCloseBelow(hero, 'ema20', 164)

export const HERO = {
  w: HERO_W,
  h: HERO_H,
  paths: hero.paths,
  // Right-edge label anchors, one per rail
  railEnds: {
    ema10: pt(hero, hero.last, hero.lines.ema10[hero.last]),
    ema20: pt(hero, hero.last, hero.lines.ema20[hero.last]),
    sma50: pt(hero, hero.last, hero.lines.sma50[hero.last]),
  },
  // Numbered phase markers, pinned to computed geometry. Keys match
  // MA_ANATOMY_PHASES in utils/tradingRules.js.
  markers: [
    { key: 'base', ...pt(hero, 66, hero.tape[66]) },
    { key: 'breakout', ...pt(hero, 81, hero.tape[81]) },
    { key: 'surf', ...pt(hero, heroSurfDip, hero.lines.ema10[heroSurfDip]) },
    { key: 'pb20', ...pt(hero, heroPb20, hero.lines.ema20[heroPb20]) },
    { key: 'tag50', ...pt(hero, heroTag50, hero.lines.sma50[heroTag50]) },
    { key: 'exit', ...pt(hero, heroExit, hero.tape[heroExit]) },
  ],
}

// ------------------------------------------------------------------ GLYPHS
// One compact pattern per rail card: hold shading above the rail, the touch
// that matters (add/buy dot) and the break that ends it (exit ✕).

const GLYPH_W = 240
const GLYPH_H = 68

function glyph({ anchors, seed, warmup, railKey, touch, breakFrom }) {
  const panel = buildPanel({
    anchors,
    seed,
    warmup,
    rails: [railKey],
    w: GLYPH_W,
    h: GLYPH_H,
    pad: { l: 6, r: 6, t: 8, b: 8 },
  })
  const exitBar = firstCloseBelow(panel, railKey, breakFrom)
  const touchBar = touch ? nearestTouch(panel, railKey, touch[0], touch[1]) : null
  return {
    w: GLYPH_W,
    h: GLYPH_H,
    pricePath: panel.paths.price,
    railPath: panel.paths[railKey],
    bandPath: band(panel, railKey, panel.warmup, exitBar),
    touch: touchBar != null ? pt(panel, touchBar, panel.lines[railKey][touchBar]) : null,
    exit: pt(panel, exitBar, panel.tape[exitBar]),
  }
}

export const GLYPHS = {
  10: glyph({
    seed: 21,
    warmup: 25,
    railKey: 'ema10',
    touch: [44, 52],
    breakFrom: 59,
    anchors: [
      [0, 20, 0.4],
      [25, 21, 0.4],
      [34, 26, 0.5],
      [38, 25, 0.3], // dip onto the 10
      [46, 31, 0.6],
      [49, 30, 0.25], // dip 2
      [58, 37, 0.6], // top
      [61, 33.5, 0.3],
      [64, 31, 0.25], // first close below → out
    ],
  }),
  20: glyph({
    seed: 22,
    warmup: 45,
    railKey: 'ema20',
    touch: [60, 70],
    breakFrom: 80,
    anchors: [
      [0, 18, 0.4],
      [45, 20, 0.4],
      [58, 28, 0.6],
      [64, 25, 0.3], // orderly pullback → add zone
      [76, 34, 0.6],
      [80, 32, 0.4],
      [84, 27, 0.3], // decisive close below → exit
    ],
  }),
  50: glyph({
    seed: 23,
    warmup: 60,
    railKey: 'sma50',
    touch: [84, 96],
    breakFrom: 108,
    anchors: [
      [0, 16, 0.4],
      [60, 22, 0.5],
      [80, 30, 0.7],
      [90, 25.5, 0.4], // first tag of the 50 — classic buy
      [104, 36, 0.7],
      [110, 32, 0.5],
      [116, 22, 0.4], // heavy break — broken stock
    ],
  }),
}

// -------------------------------------------------------------- MINI PAIR
// The scan filter: stacked-and-fanning rails vs braided chop. Same math,
// two different tapes — the braid is what real MAs do to a trendless tape.

const MINI_W = 300
const MINI_H = 96

function mini({ anchors, seed }) {
  const panel = buildPanel({
    anchors,
    seed,
    warmup: 55,
    rails: ['ema10', 'ema20', 'sma50'],
    w: MINI_W,
    h: MINI_H,
    pad: { l: 6, r: 26, t: 10, b: 10 },
  })
  return {
    w: MINI_W,
    h: MINI_H,
    paths: panel.paths,
    railEnds: {
      ema10: pt(panel, panel.last, panel.lines.ema10[panel.last]),
      ema20: pt(panel, panel.last, panel.lines.ema20[panel.last]),
      sma50: pt(panel, panel.last, panel.lines.sma50[panel.last]),
    },
  }
}

export const MINI_STACKED = mini({
  seed: 31,
  anchors: [
    [0, 20, 0.4],
    [30, 23, 0.5],
    [55, 26, 0.5],
    [70, 31, 0.6],
    [76, 29.5, 0.4],
    [88, 35, 0.6],
    [94, 33.5, 0.4],
    [108, 40, 0.6],
  ],
})

export const MINI_TANGLED = mini({
  seed: 32,
  anchors: [
    [0, 29, 0.8],
    [20, 31, 0.8],
    [40, 27, 0.8],
    [55, 30, 0.7],
    [68, 26.5, 0.7],
    [82, 30.8, 0.7],
    [96, 26.8, 0.7],
    [110, 30.4, 0.7],
    [124, 27, 0.7],
    [138, 30.6, 0.7],
    [152, 27.5, 0.7],
    [160, 29, 0.7],
  ],
})

// De-overlap helper for right-edge rail labels: nudges y positions apart so
// "10 / 20 / 50" never collide even if two rails end close together.
export function spreadLabels(entries, minGap = 12) {
  const sorted = [...entries].sort((a, b) => a.y - b.y)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < minGap) sorted[i].y = sorted[i - 1].y + minGap
  }
  return sorted
}

const RAIL_NUM = { ema10: '10', ema20: '20', sma50: '50' }

// Right-edge "10 / 20 / 50" label positions for whichever rails a panel has.
export function railLabels(railEnds) {
  return spreadLabels(
    Object.entries(railEnds).map(([key, end]) => ({
      key: RAIL_NUM[key],
      color: RAIL_COLORS[key],
      x: end.x,
      y: end.y,
    }))
  )
}

// ------------------------------------------------------------- DRILL SCENES
// Rail Reps (MARailsDrill.jsx): each scene is a situation frozen at the
// decision point — the tape *ends* where the trader has to make the call.
// Scenario copy lives in utils/tradingRules.js (MA_DRILLS); keys match.

const DRILL_W = 340
const DRILL_H = 130

function drillScene({ anchors, seed, warmup, rails }) {
  const panel = buildPanel({
    anchors,
    seed,
    warmup,
    rails,
    w: DRILL_W,
    h: DRILL_H,
    pad: { l: 8, r: 28, t: 14, b: 14 },
  })
  const railEnds = {}
  for (const k of rails) railEnds[k] = pt(panel, panel.last, panel.lines[k][panel.last])
  return {
    w: DRILL_W,
    h: DRILL_H,
    rails,
    paths: panel.paths,
    railEnds,
    marker: pt(panel, panel.last, panel.tape[panel.last]),
  }
}

export const DRILL_CHARTS = {
  // First orderly pullback settling onto a rising 20.
  pb20: drillScene({
    seed: 41,
    warmup: 45,
    rails: ['ema20'],
    anchors: [
      [0, 18, 0.4],
      [45, 20, 0.4],
      [52, 23, 0.5],
      [58, 28, 0.6],
      [62, 26.5, 0.4],
      [66, 25.2, 0.25],
    ],
  }),
  // Fast mover dips to the 10 and closes on it — still above.
  dip10: drillScene({
    seed: 42,
    warmup: 25,
    rails: ['ema10'],
    anchors: [
      [0, 20, 0.4],
      [25, 21, 0.4],
      [33, 26, 0.5],
      [37, 25, 0.3],
      [45, 31, 0.6],
      [48, 29.3, 0.2],
    ],
  }),
  // Five-week sideways correction tags the rising 50 for the first time.
  tag50: drillScene({
    seed: 43,
    warmup: 60,
    rails: ['sma50'],
    anchors: [
      [0, 16, 0.4],
      [60, 22, 0.5],
      [72, 28, 0.6],
      [78, 26.5, 0.4],
      [88, 33, 0.7],
      [100, 29.5, 0.5],
      [108, 28.4, 0.25],
    ],
  }),
  // Same shape, but the last bars close well below the 50.
  break50: drillScene({
    seed: 44,
    warmup: 60,
    rails: ['sma50'],
    anchors: [
      [0, 16, 0.4],
      [60, 22, 0.5],
      [72, 28, 0.6],
      [78, 26.5, 0.4],
      [88, 33, 0.7],
      [100, 28.5, 0.5],
      [104, 27, 0.4],
      [108, 23, 0.25],
    ],
  }),
  // Braided chop with a seductive tap of the 20 right at the end.
  tangled: drillScene({
    seed: 45,
    warmup: 55,
    rails: ['ema10', 'ema20', 'sma50'],
    anchors: [
      [0, 29, 0.8],
      [20, 31, 0.8],
      [40, 27, 0.8],
      [55, 30, 0.7],
      [68, 26.5, 0.7],
      [82, 30.8, 0.7],
      [96, 26.8, 0.7],
      [110, 30.4, 0.7],
      [124, 27, 0.7],
      [136, 30, 0.6],
      [144, 29.0, 0.3],
    ],
  }),
  // Sharp bounce off the lows: price above all three MAs but rails inverted.
  notStacked: drillScene({
    seed: 46,
    warmup: 55,
    rails: ['ema10', 'ema20', 'sma50'],
    anchors: [
      [0, 50, 0.6],
      [30, 36, 0.8],
      [50, 27.5, 0.6],
      [70, 24.5, 0.5],
      [79, 24.8, 0.5],
      [84, 28.5, 0.4],
    ],
  }),
}
