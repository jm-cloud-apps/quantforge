// Chart math behind the Rules-page Volume Patterns panel (VolumeVisuals.jsx).
//
// Same philosophy as maRailsCharts.js: the price line is a hand-tuned anchor
// curve, but the volume bars are *derived* from it — each bar's height scales
// with that day's price move, then named events (breakout surge, base dry-up,
// climax) apply explicit multipliers. So the volume story can't contradict
// the price story: a big up-day is a tall bar because the move was big.
// Everything is deterministic and built once at module load.

import { mulberry32, buildTape, ema, RAIL_COLORS } from './maRailsCharts'

// Volume tones. Up/down days are the accent/danger pair (a direction
// encoding, reinforced by bar height + the card text, never color alone);
// quiet bars sit muted so the surges read as surges.
export const VOL_COLORS = {
  price: RAIL_COLORS.price,
  ma: RAIL_COLORS.ema20,
  up: '#10B981', // accent
  upSoft: 'rgba(16,185,129,0.35)',
  down: '#EF4444', // danger
  downSoft: 'rgba(239,68,68,0.32)',
  muted: '#475569', // surface-500
  avg: '#64748B', // surface-400
  hi: '#06B6D4', // cyan — annotation accent
}

// --------------------------------------------------------------- volume model

// Derive a volume series from the tape: base level + magnitude of the daily
// move, seeded jitter, then per-event multipliers. `up` flags green/red days.
function deriveVolume(tape, warmup, seed, events) {
  const rnd = mulberry32(seed + 977)
  const vol = []
  const up = []
  for (let i = warmup; i <= tape.length - 1; i++) {
    const ret = tape[i] - (tape[i - 1] ?? tape[i])
    up.push(ret >= -0.03)
    const mag = Math.min(Math.abs(ret), 3) / 3
    vol.push(0.3 + 0.72 * mag + rnd() * 0.14)
  }
  for (const ev of events || []) {
    for (let bar = ev.from; bar <= ev.to; bar++) {
      const k = bar - warmup
      if (k >= 0 && k < vol.length) vol[k] *= ev.mult
    }
  }
  return { vol, up }
}

// ------------------------------------------------------------------- HERO
// Same lifecycle as the MA-rails hero, read through volume: quiet dry-up base
// → breakout surge → advance → light-volume pullback → next-leg surge →
// climactic blow-off. Event copy lives in tradingRules.js (VOLUME_PHASES);
// keys here must match.

const HERO_W = 720
const HERO_H = 300
const H_L = 10
const H_R = 30
const PRICE_TOP = 18
const PRICE_BOT = 158
const VOL_TOP = 196
const VOL_BASE = 288

const heroAnchors = [
  [0, 26, 0.5],
  [42, 25, 0.5], // visible start — base drift
  [58, 24.5, 0.4],
  [64, 24.6, 0.16], // tightest, driest part of the base
  [66, 28.6, 0.12], // breakout thrust — low wobble so the pivot day reads green
  [72, 31, 0.6],
  [80, 35, 0.7],
  [84, 33.5, 0.4], // shallow pullback
  [90, 33, 0.32], // dries up on the rail
  [97, 42, 0.4],
  [99, 45, 0.5], // next-leg thrust
  [104, 47, 0.8],
  [107, 51, 0.4],
  [109, 53, 0.4], // climax push
  [111, 50, 0.6],
  [116, 42, 0.7], // rollover
]

const HERO_WARMUP = 42

const heroEvents = [
  { from: 58, to: 65, mult: 0.42 }, // base dry-up
  { from: 66, to: 68, mult: 2.9 }, // breakout surge
  { from: 85, to: 91, mult: 0.5 }, // pullback dry-up
  { from: 97, to: 99, mult: 2.2 }, // next-leg surge
  { from: 108, to: 110, mult: 3.4 }, // climax spike
]

function buildHero() {
  const tape = buildTape(heroAnchors, 71)
  const maFull = ema(tape, 10)
  const last = tape.length - 1
  const { vol, up } = deriveVolume(tape, HERO_WARMUP, 71, heroEvents)

  let lo = Infinity
  let hi = -Infinity
  for (let i = HERO_WARMUP; i <= last; i++) {
    lo = Math.min(lo, tape[i], maFull[i])
    hi = Math.max(hi, tape[i], maFull[i])
  }
  const maxVol = Math.max(...vol)
  const avg = vol.reduce((a, b) => a + b, 0) / vol.length

  const x = bar => H_L + ((bar - HERO_WARMUP) / (last - HERO_WARMUP)) * (HERO_W - H_L - H_R)
  const py = p => PRICE_TOP + ((hi - p) / (hi - lo)) * (PRICE_BOT - PRICE_TOP)
  const vh = v => (v / maxVol) * (VOL_BASE - VOL_TOP)

  let priceD = ''
  let maD = ''
  for (let i = HERO_WARMUP; i <= last; i++) {
    priceD += `${i === HERO_WARMUP ? 'M' : 'L'}${x(i).toFixed(1)} ${py(tape[i]).toFixed(1)}`
    maD += `${i === HERO_WARMUP ? 'M' : 'L'}${x(i).toFixed(1)} ${py(maFull[i]).toFixed(1)}`
  }

  const n = last - HERO_WARMUP + 1
  const slot = (HERO_W - H_L - H_R) / n
  const bw = Math.max(slot * 0.62, 2)
  const bars = vol.map((v, k) => {
    const bar = HERO_WARMUP + k
    const h = vh(v)
    return { x: x(bar), y: VOL_BASE - h, h, w: bw, up: up[k], strong: v > avg * 1.4 }
  })

  // Event annotations: bracket the bars in range, anchored to the tallest.
  const anno = heroEvents.map((ev, i) => {
    let cx = 0
    let count = 0
    let topY = VOL_BASE
    for (let bar = ev.from; bar <= ev.to; bar++) {
      const k = bar - HERO_WARMUP
      if (k < 0 || k >= vol.length) continue
      cx += x(bar)
      count++
      topY = Math.min(topY, VOL_BASE - vh(vol[k]))
    }
    return { x: cx / Math.max(count, 1), x0: x(ev.from), x1: x(ev.to), topY, priceY: py(tape[ev.from]) }
  })

  return {
    w: HERO_W,
    h: HERO_H,
    priceD,
    maD,
    bars,
    avgY: VOL_BASE - vh(avg),
    volBase: VOL_BASE,
    volTop: VOL_TOP,
    maEnd: { x: x(last), y: py(maFull[last]) },
    anno,
  }
}

export const VOLUME_HERO = buildHero()

// ------------------------------------------------------------------ GLYPHS
// One compact volume-bar signature per pattern card. Bars only (the rail
// glyphs are line-based, so these stay visually distinct); a faint price cue
// rides on top where it clarifies. Each spec lists bar magnitudes 0..1,
// per-bar direction, and which bars to highlight.

const GLYPH_W = 220
const GLYPH_H = 76
const G_BASE = 66
const G_TOP = 12
const G_PAD = 8

// mags: 0..1 heights · dir: +1 up / -1 down · hi: indices to spotlight ·
// price: optional 0..1 y-cue per bar (1 = high) drawn as a thin line.
function glyph({ mags, dir, hi = [], price }) {
  const n = mags.length
  const slot = (GLYPH_W - G_PAD * 2) / n
  const bw = slot * 0.6
  const bars = mags.map((m, i) => {
    const h = m * (G_BASE - G_TOP)
    return {
      x: G_PAD + slot * i + (slot - bw) / 2,
      y: G_BASE - h,
      w: bw,
      h,
      up: (dir?.[i] ?? 1) >= 0,
      hi: hi.includes(i),
    }
  })
  let priceD = null
  if (price) {
    const py = v => G_TOP + (1 - v) * (G_BASE - G_TOP - 4)
    priceD = price
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(G_PAD + slot * i + slot / 2).toFixed(1)} ${py(v).toFixed(1)}`)
      .join('')
  }
  return { w: GLYPH_W, h: GLYPH_H, base: G_BASE, bars, priceD }
}

export const VOLUME_GLYPHS = {
  // Base dry-up — volume bleeds to nothing as the base tightens.
  dryup: glyph({
    mags: [0.62, 0.5, 0.55, 0.4, 0.34, 0.26, 0.19, 0.14, 0.12],
    dir: [1, -1, 1, -1, 1, -1, -1, 1, -1],
    hi: [6, 7, 8],
    price: [0.55, 0.5, 0.54, 0.5, 0.52, 0.5, 0.51, 0.5, 0.5],
  }),
  // Pocket pivot — a quiet base, then one green up-bar taller than every
  // recent down-bar, still inside the range. The early tell before the pivot.
  pocketpivot: glyph({
    mags: [0.4, 0.46, 0.32, 0.5, 0.34, 0.28, 0.86, 0.34, 0.3],
    dir: [1, -1, 1, -1, -1, -1, 1, 1, -1],
    hi: [6],
    price: [0.5, 0.52, 0.48, 0.53, 0.49, 0.47, 0.62, 0.64, 0.61],
  }),
  // Breakout surge — a wall of volume on the pivot day.
  breakout: glyph({
    mags: [0.24, 0.18, 0.22, 0.16, 0.2, 0.15, 1.0, 0.7, 0.6],
    dir: [1, -1, 1, -1, 1, -1, 1, 1, 1],
    hi: [6],
    price: [0.3, 0.29, 0.31, 0.28, 0.3, 0.29, 0.62, 0.78, 0.86],
  }),
  // Pullback dry-up — light red bars as price rests on the rail.
  pullback: glyph({
    mags: [0.9, 0.62, 0.5, 0.28, 0.2, 0.16, 0.14, 0.34, 0.72],
    dir: [1, 1, -1, -1, -1, -1, -1, 1, 1],
    hi: [4, 5, 6],
    price: [0.5, 0.66, 0.6, 0.52, 0.46, 0.44, 0.45, 0.56, 0.78],
  }),
  // Accumulation — up days tall, down days short.
  accumulation: glyph({
    mags: [0.85, 0.28, 0.78, 0.32, 0.9, 0.24, 0.72, 0.3, 0.88],
    dir: [1, -1, 1, -1, 1, -1, 1, -1, 1],
    hi: [0, 2, 4, 6, 8],
  }),
  // Climax — bars build to a blow-off, then roll over.
  climax: glyph({
    mags: [0.3, 0.4, 0.52, 0.68, 0.85, 1.0, 0.66, 0.44, 0.5],
    dir: [1, 1, 1, 1, 1, 1, -1, -1, -1],
    hi: [5],
    price: [0.4, 0.5, 0.6, 0.72, 0.86, 0.96, 0.8, 0.66, 0.58],
  }),
  // Distribution break — a heavy red bar snaps the trend.
  distribution: glyph({
    mags: [0.5, 0.34, 0.4, 0.3, 0.36, 0.28, 0.95, 0.6, 0.44],
    dir: [1, -1, 1, -1, 1, -1, -1, -1, -1],
    hi: [6],
    price: [0.7, 0.68, 0.7, 0.66, 0.64, 0.6, 0.4, 0.3, 0.26],
  }),
}
