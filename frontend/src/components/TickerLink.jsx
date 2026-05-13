import { Link } from 'react-router-dom'

/**
 * Renders a ticker symbol as a clickable link that opens Stock Analysis
 * (`/news?tickers=SYM`) with the ticker pre-filled and auto-searched.
 *
 * Use this anywhere a ticker appears (Sector Scan tiles, Breakout cards,
 * snapshot tables) so the whole app feels cross-linked.
 */
export default function TickerLink({ symbol, className = '', children, ...rest }) {
  if (!symbol) return null
  const sym = String(symbol).toUpperCase()
  return (
    <Link
      to={`/news?tickers=${encodeURIComponent(sym)}`}
      className={`hover:text-accent transition-colors ${className}`}
      title={`Analyze ${sym} on Stock Analysis`}
      {...rest}
    >
      {children ?? sym}
    </Link>
  )
}
