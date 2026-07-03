/**
 * Renders a ticker symbol as a link that opens the symbol's chart on
 * TradingView in a new tab.
 *
 * Use this anywhere a ticker appears (Sector Scan tiles, Breakout cards,
 * snapshot tables) so clicking any ticker jumps straight to its TradingView
 * chart. It delegates to `TradingViewLink` — kept as its own named component
 * because many pages import `TickerLink` directly.
 *
 * (Previously this opened the in-app Stock Analysis view at
 * `/news?tickers=SYM`; tickers now go to TradingView everywhere.)
 */
export { default } from './TradingViewLink'
