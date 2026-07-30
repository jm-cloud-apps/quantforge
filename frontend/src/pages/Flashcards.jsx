import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DECKS, buildAllCards, shuffle, loadMastered, saveMastered } from '../utils/flashcards'

// Flashcards — spaced retrieval over everything on the Rules page.
//
// The frameworks only become usable if you can recall them at 3:59 PM without
// scrolling a reference page, so this is a retrieval drill, not a second copy
// of the content: every card is derived from utils/tradingRules.js (see
// utils/flashcards.js), which means editing a rule updates the study material.
//
// Grading is deliberately two-button (Again / Got it). "Got it" marks the card
// mastered and drops it from the round; "Again" re-queues it at the back, so a
// round ends only when every card has been answered correctly once.

const TONE = {
  cyan:    { text: 'text-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', bar: 'bg-cyan' },
  accent:  { text: 'text-accent', chip: 'bg-accent/10 text-accent border-accent/30', bar: 'bg-accent' },
  warning: { text: 'text-warning', chip: 'bg-warning/10 text-warning border-warning/30', bar: 'bg-warning' },
  purple:  { text: 'text-purple', chip: 'bg-purple/10 text-purple border-purple/30', bar: 'bg-purple' },
  danger:  { text: 'text-danger', chip: 'bg-danger/10 text-danger border-danger/30', bar: 'bg-danger' },
  neutral: { text: 'text-surface-300', chip: 'bg-surface-800/60 text-surface-400 border-surface-700', bar: 'bg-surface-500' },
}
const deckTone = id => TONE[(DECKS.find(d => d.id === id) || {}).tone] || TONE.neutral
const deckLabel = id => (DECKS.find(d => d.id === id) || {}).label || id

export default function Flashcards() {
  const allCards = useMemo(() => buildAllCards(), [])

  const [selected, setSelected] = useState(() => new Set(DECKS.map(d => d.id)))
  const [mastered, setMastered] = useState(loadMastered)
  const [hideMastered, setHideMastered] = useState(false)
  const [queue, setQueue] = useState([])
  const [roundTotal, setRoundTotal] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [roundStats, setRoundStats] = useState({ done: 0, again: 0 })

  const pool = useMemo(() => {
    let cards = allCards.filter(c => selected.has(c.deck))
    if (hideMastered) cards = cards.filter(c => !mastered.has(c.id))
    return cards
  }, [allCards, selected, hideMastered, mastered])

  // The pool changes identity on every grade (mastered feeds into it), so the
  // round must NOT key off it — otherwise marking a card "Got it" reshuffles and
  // restarts the whole round. Read the live pool through a ref and rebuild the
  // round only when the *selection* actually changes.
  const poolRef = useRef(pool)
  poolRef.current = pool

  const startRound = useCallback(() => {
    const ids = shuffle(poolRef.current.map(c => c.id))
    setQueue(ids)
    setRoundTotal(ids.length)
    setFlipped(false)
    setRoundStats({ done: 0, again: 0 })
  }, [])

  const selectionKey = useMemo(
    () => `${[...selected].sort().join(',')}|${hideMastered}`,
    [selected, hideMastered],
  )

  useEffect(() => { startRound() }, [selectionKey, startRound])

  useEffect(() => { saveMastered(mastered) }, [mastered])

  const byId = useMemo(() => Object.fromEntries(allCards.map(c => [c.id, c])), [allCards])
  const current = queue.length ? byId[queue[0]] : null

  const grade = useCallback((got) => {
    if (!queue.length) return
    const [head, ...rest] = queue
    if (got) {
      setMastered(prev => new Set(prev).add(head))
      setQueue(rest)
      setRoundStats(s => ({ ...s, done: s.done + 1 }))
    } else {
      setMastered(prev => {
        if (!prev.has(head)) return prev
        const next = new Set(prev); next.delete(head); return next
      })
      setQueue([...rest, head])           // back of the line — round isn't done
      setRoundStats(s => ({ ...s, again: s.again + 1 }))
    }
    setFlipped(false)
  }, [queue])

  // Keyboard: space/enter flips, 1 = again, 2 = got it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea, select')) return
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped(f => !f) }
      else if (flipped && (e.key === '1')) { e.preventDefault(); grade(false) }
      else if (flipped && (e.key === '2')) { e.preventDefault(); grade(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, grade])

  const toggleDeck = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next.size ? next : prev          // never allow an empty selection
  })

  const masteredInPool = allCards.filter(c => selected.has(c.deck) && mastered.has(c.id)).length
  const selectedTotal = allCards.filter(c => selected.has(c.deck)).length
  const pct = selectedTotal ? Math.round((masteredInPool / selectedTotal) * 100) : 0

  return (
    // Study column — constrained and centered so the card reads as an object on
    // a page rather than a full-bleed panel.
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[22px] text-surface-50 tracking-tight">Flashcards</h1>
          <p className="text-surface-400 text-[12px] mt-0.5">
            Active recall over every framework on the{' '}
            <Link to="/rules" className="text-cyan hover:underline underline-offset-2">Rules</Link>{' '}
            page — {allCards.length} cards, generated from the same content so they never drift.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input type="checkbox" checked={hideMastered} onChange={e => setHideMastered(e.target.checked)} className="accent-cyan" />
            Hide mastered
          </label>
          <button
            onClick={startRound}
            className="text-[12px] text-surface-300 hover:text-surface-100 px-3 py-1.5 rounded-lg border border-surface-700 hover:border-surface-600 bg-surface-900/60 transition-colors"
          >
            Shuffle
          </button>
          <button
            onClick={() => { setMastered(new Set()); setHideMastered(false) }}
            className="text-[12px] text-surface-400 hover:text-danger px-3 py-1.5 rounded-lg border border-surface-700 hover:border-danger/40 bg-surface-900/60 transition-colors"
            title="Clear mastered progress for every deck"
          >
            Reset progress
          </button>
        </div>
      </div>

      {/* Deck picker */}
      <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">Decks</span>
          <button onClick={() => setSelected(new Set(DECKS.map(d => d.id)))} className="text-[11px] text-surface-500 hover:text-surface-200 underline-offset-2 hover:underline">All</button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {DECKS.map(d => {
            const tone = TONE[d.tone] || TONE.neutral
            const on = selected.has(d.id)
            const total = allCards.filter(c => c.deck === d.id).length
            const known = allCards.filter(c => c.deck === d.id && mastered.has(c.id)).length
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDeck(d.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                  on ? `${tone.chip}` : 'bg-surface-900/60 text-surface-500 border-surface-700 hover:text-surface-300'
                }`}
                title={`${known} of ${total} mastered`}
              >
                {d.label}
                <span className="ml-1.5 font-mono text-[10px] opacity-70">{known}/{total}</span>
              </button>
            )
          })}
        </div>

        {/* Mastery progress across the selected decks */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-surface-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan to-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] font-mono text-surface-400 tabular-nums shrink-0">
            {masteredInPool}/{selectedTotal} mastered · {pct}%
          </span>
        </div>
      </div>

      {/* The card — a centered, fixed-size study surface rather than a page-wide
          panel. Both faces are absolutely stacked and the container rotates in
          3D, so the flip reads as one object turning over. Long answers scroll
          inside the face instead of resizing the card. */}
      {current ? (
        <div className="max-w-3xl mx-auto w-full">
          {/* One fixed-size surface that swaps its contents. A CSS 3D flip was
              tried first and silently resolved to an identity transform, which
              would have left the prompt facing the user while the app believed
              it was showing the answer — a wrong answer is worse than no
              animation, so this swaps explicitly instead. */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Flashcard — activate to flip"
            aria-pressed={flipped}
            onClick={() => setFlipped(f => !f)}
            /* No local key handler: the window-level Space/Enter listener
               already flips, and a second one here would double-toggle. */
            className={`w-full h-[400px] sm:h-[440px] cursor-pointer select-none rounded-2xl border flex flex-col transition-colors ${
              flipped
                ? 'border-surface-600 bg-surface-900'
                : 'border-surface-700/50 bg-surface-900/80 hover:border-surface-600'
            }`}
          >
            <div className="px-5 py-3 flex items-center gap-2 flex-wrap shrink-0 border-b border-surface-700/40">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${deckTone(current.deck).chip}`}>
                {deckLabel(current.deck)}
              </span>
              <span className="text-[10.5px] text-surface-500">{current.kicker}</span>
              <span className="flex-1" />
              <span className="text-[9px] font-bold tracking-widest text-surface-500 uppercase">
                {flipped ? 'Answer' : 'Prompt'}
              </span>
            </div>

            {flipped ? (
              /* my-auto on the inner block centres short answers in the card
                 while long ones still scroll from the top. */
              <div key="back" className="flex-1 min-h-0 overflow-y-auto px-6 sm:px-10 py-5 animate-fade-in flex flex-col">
                <div className="my-auto w-full">
                <p className={`text-[17px] sm:text-[19px] font-semibold leading-snug text-center ${deckTone(current.deck).text}`}>
                  {current.answer}
                </p>
                {current.tagline && (
                  <p className="mt-1 text-[12px] text-surface-500 italic text-center">{current.tagline}</p>
                )}

                {current.bullets?.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {current.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] text-surface-300 leading-snug">
                        <span className={`mt-[6px] w-1 h-1 rounded-full shrink-0 ${deckTone(current.deck).bar}`} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {current.detail && (
                  <p className="mt-4 text-[12.5px] text-surface-400 leading-snug">{current.detail}</p>
                )}

                {current.rule && (
                  <div className="mt-4 rounded-lg border border-surface-700/50 bg-surface-950/50 px-3 py-2">
                    <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">The rule</div>
                    <p className="text-[12.5px] text-surface-200 leading-snug">{current.rule}</p>
                  </div>
                )}
                </div>
              </div>
            ) : (
              <>
                <div key="front" className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-7 sm:px-12 animate-fade-in">
                  <p className="text-[19px] sm:text-[23px] text-surface-100 font-display leading-snug text-center">
                    {current.front}
                  </p>
                </div>
                <div className="px-5 py-3 text-center shrink-0">
                  <span className="text-[11px] text-surface-500">
                    Click or press <kbd className="font-mono text-surface-400">Space</kbd> to reveal
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Controls below the card, Quizlet-style: position counter, then the
              grade buttons — which only appear once the answer is showing. */}
          <div className="mt-4 flex items-center justify-center gap-3">
            <span className="text-[12px] font-mono text-surface-500 tabular-nums">
              {Math.min(roundTotal - queue.length + 1, roundTotal)} / {roundTotal}
            </span>
            {roundStats.again > 0 && (
              <span className="text-[11px] text-surface-600">· {roundStats.again} repeat{roundStats.again === 1 ? '' : 's'}</span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-center gap-3">
            {flipped ? (
              <>
                <button
                  onClick={() => grade(false)}
                  className="px-6 py-2.5 rounded-xl text-[13px] font-semibold border bg-danger/10 text-danger border-danger/30 hover:bg-danger/20 transition-colors"
                >
                  Again <span className="font-mono opacity-60 ml-1">1</span>
                </button>
                <button
                  onClick={() => grade(true)}
                  className="px-6 py-2.5 rounded-xl text-[13px] font-semibold border bg-accent/10 text-accent border-accent/30 hover:bg-accent/20 transition-colors"
                >
                  Got it <span className="font-mono opacity-60 ml-1">2</span>
                </button>
              </>
            ) : (
              <span className="text-[11px] text-surface-600 h-[42px] flex items-center">
                Answer first — then grade yourself honestly.
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Round complete */
        <div className="rounded-2xl bg-surface-900/80 border border-accent/30 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">
            {selectedTotal === 0 ? 'No cards in this selection' : 'Round complete'}
          </p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            {selectedTotal === 0
              ? 'Every card in the selected decks is mastered — untick “Hide mastered” or pick another deck.'
              : `You cleared ${roundStats.done} card${roundStats.done === 1 ? '' : 's'}${roundStats.again ? ` with ${roundStats.again} repeat${roundStats.again === 1 ? '' : 's'}` : ' clean'}.`}
          </p>
          <button
            onClick={startRound}
            className="mt-4 px-4 py-2 rounded-lg text-[12.5px] font-semibold border bg-cyan/10 text-cyan border-cyan/30 hover:bg-cyan/15 transition-colors"
          >
            Start another round
          </button>
        </div>
      )}

      <p className="text-[10.5px] text-surface-500 px-1">
        Cards are generated from <span className="font-mono text-surface-400">utils/tradingRules.js</span> — the same
        content the Rules page renders, so editing a framework updates the deck. Progress is stored locally per card.
      </p>
    </div>
  )
}
