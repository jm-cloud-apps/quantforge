/**
 * Renders a ticker symbol as a link that opens the symbol's chart on
 * TradingView in a new tab. Use this where a chart is the natural next
 * step (e.g. earnings names) rather than the in-app Stock Analysis view
 * that `TickerLink` opens.
 */
export default function TradingViewLink({ symbol, className = '', children, onClick, ...rest }) {
  if (!symbol) return null
  const sym = String(symbol).toUpperCase()
  const handleClick = (e) => {
    // Ticker often sits inside a clickable row/card (toggle, select, expand).
    // Clicking the ticker should ONLY open its chart, not fire the parent's
    // handler, so stop the event from bubbling.
    e.stopPropagation()
    onClick?.(e)
  }
  return (
    <a
      href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={`cursor-pointer hover:text-accent transition-colors ${className}`}
      title={`Open ${sym} on TradingView`}
      {...rest}
    >
      {children ?? sym}
    </a>
  )
}
