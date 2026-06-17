import { useState, useMemo, useEffect } from 'react';
import { YEARLY_STRONGEST } from '../data/yearlyStrongest';
import TickerLink from '../components/TickerLink';

// "Yearly Strongest" — a study list of the dominant market theme of each year
// (2019 → present) and the most obvious stock ascendants behind it. Content is
// curated reference data (see ../data/yearlyStrongest.js), not live quotes.

const YEARS = YEARLY_STRONGEST.map((y) => y.year);

// Color the gain pill: explicit "+NNN%" moves get green; qualitative labels
// (Leader / Core / Strong …) get a neutral accent so they don't masquerade
// as precise returns.
function gainStyle(gain) {
  if (typeof gain === 'string' && gain.trim().startsWith('+')) {
    return 'bg-success/10 text-success border-success/20';
  }
  return 'bg-accent/10 text-accent border-accent/20';
}

// A card is flagged as the year's #1 S&P 500 stock when its reason says so —
// avoids duplicating a boolean across every data entry.
const isTopPerformer = (reason) => /best s&p 500 performer/i.test(reason || '');

export default function YearlyStrongest() {
  const [activeYear, setActiveYear] = useState(YEARS[0]);

  const entry = useMemo(
    () => YEARLY_STRONGEST.find((y) => y.year === activeYear) ?? YEARLY_STRONGEST[0],
    [activeYear]
  );

  // ←/→ arrow keys step through years (newest is first in the list).
  useEffect(() => {
    const handler = (e) => {
      if (e.target.matches?.('input, textarea, select')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const idx = YEARS.indexOf(activeYear);
      const next = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
      if (next >= 0 && next < YEARS.length) {
        e.preventDefault();
        setActiveYear(YEARS[next]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeYear]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-[28px] text-surface-50 tracking-tight mb-1">
          Yearly Strongest
        </h1>
        <p className="text-surface-400 text-sm max-w-2xl">
          The dominant market theme of each year and the most studyable stock
          ascendants behind it — what led, and the news / reason why. Curated
          reference for pattern study, not live quotes.{' '}
          <span className="text-surface-500">Use ← / → to step through years.</span>
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Year rail */}
        <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible lg:w-56 flex-shrink-0 pb-2 lg:pb-0">
          {YEARLY_STRONGEST.map((y) => {
            const active = y.year === activeYear;
            return (
              <button
                key={y.year}
                onClick={() => setActiveYear(y.year)}
                className={`text-left rounded-xl border px-4 py-3 transition-all flex-shrink-0 min-w-[150px] lg:min-w-0 lg:w-full ${
                  active
                    ? 'bg-accent/10 border-accent/30'
                    : 'bg-surface-900/60 border-surface-700/40 hover:border-surface-600 hover:bg-surface-800/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-display font-bold text-lg ${active ? 'text-accent' : 'text-surface-100'}`}>
                    {y.year}
                  </span>
                  {y.partial && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-surface-500 bg-surface-800 border border-surface-700/60 rounded px-1.5 py-0.5">
                      YTD
                    </span>
                  )}
                </div>
                <div className={`text-xs mt-0.5 leading-snug ${active ? 'text-surface-300' : 'text-surface-500'}`}>
                  {y.theme}
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Theme hero */}
          <div className="rounded-2xl bg-gradient-to-br from-surface-900/80 to-surface-900/40 border border-surface-700/50 p-6">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <span className="font-display font-bold text-2xl text-surface-50">{entry.year}</span>
              {entry.partial && (
                <span className="text-[11px] font-medium uppercase tracking-wider text-surface-400 bg-surface-800 border border-surface-700/60 rounded px-2 py-0.5">
                  Year to date
                </span>
              )}
              {entry.verified && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success bg-success/10 border border-success/20 rounded px-2 py-0.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Market-verified returns
                </span>
              )}
            </div>
            <h2 className="font-display font-bold text-xl text-accent mb-1">{entry.theme}</h2>
            {entry.tagline && (
              <p className="text-surface-400 text-sm font-medium mb-3">{entry.tagline}</p>
            )}
            <p className="text-surface-300 text-sm leading-relaxed max-w-3xl">{entry.summary}</p>
          </div>

          {/* Stock list */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-surface-200 font-semibold text-sm uppercase tracking-wider">
                Strongest Ascendants
              </h3>
              <span className="text-xs text-surface-500">{entry.stocks.length} names</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {entry.stocks.map((s, i) => {
                const top = isTopPerformer(s.reason);
                return (
                <div
                  key={s.ticker}
                  className={`group flex flex-col rounded-xl border p-4 transition-colors ${
                    top
                      ? 'bg-amber-400/[0.06] border-amber-400/30 hover:border-amber-400/50'
                      : 'bg-surface-900/60 border-surface-700/40 hover:border-accent/30 hover:bg-surface-900/80'
                  }`}
                >
                  {/* Card header: rank · ticker + name · gain */}
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className={`flex-shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center ${
                      top ? 'bg-amber-400/10 border-amber-400/30' : 'bg-surface-800 border-surface-700/50'
                    }`}>
                      {top ? (
                        <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M5 16L3 7l5.5 4L12 5l3.5 6L21 7l-2 9H5zm0 2h14v2H5v-2z" />
                        </svg>
                      ) : (
                        <span className="font-mono text-xs font-semibold text-surface-400">{i + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <TickerLink
                        symbol={s.ticker}
                        className={`font-mono font-bold text-base text-surface-50 ${top ? 'group-hover:text-amber-300' : 'group-hover:text-accent'}`}
                      />
                      <div className="text-surface-400 text-xs truncate">{s.name}</div>
                    </div>
                    {s.gain && (
                      <span className={`flex-shrink-0 text-xs font-semibold font-mono rounded-md border px-2 py-0.5 ${gainStyle(s.gain)}`}>
                        {s.gain}
                      </span>
                    )}
                  </div>

                  {top && (
                    <span className="self-start mb-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5">
                      #1 S&P 500 that year
                    </span>
                  )}

                  <p className="text-surface-300 text-sm leading-relaxed">{s.reason}</p>
                </div>
                );
              })}
            </div>
          </div>

          {/* Footnote */}
          <p className="text-xs text-surface-600 leading-relaxed border-t border-surface-800/60 pt-4">
            Gains are approximate full-year (or year-to-date) moves rounded for
            study; qualitative labels (Leader / Core / Strong) mark thematic
            leaders where a single precise number would mislead. Verify exact
            figures before acting. Edit{' '}
            <span className="font-mono text-surface-500">src/data/yearlyStrongest.js</span>{' '}
            to update.
          </p>
        </div>
      </div>
    </div>
  );
}
