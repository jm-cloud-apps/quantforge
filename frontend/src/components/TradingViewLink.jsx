/**
 * Renders a ticker symbol as a link that opens the symbol's chart on
 * TradingView in a new tab. Use this where a chart is the natural next
 * step (e.g. earnings names) rather than the in-app Stock Analysis view
 * that `TickerLink` opens.
 */
export default function TradingViewLink({ symbol, className = '', children, ...rest }) {
  if (!symbol) return null
  const sym = String(symbol).toUpperCase()
  return (
    <a
      href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`hover:text-accent transition-colors ${className}`}
      title={`Open ${sym} on TradingView`}
      {...rest}
    >
      {children ?? sym}
    </a>
  )
}
