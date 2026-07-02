import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// React.StrictMode intentionally double-invokes effects in development. Here
// that made every data-fetching card on the Dashboard fire its API request
// twice on mount (~14 calls → ~28), doubling load on the expensive screener
// scans — and, on a cold cache, kicking off two concurrent full scans. Because
// this app is used via the dev server as its normal mode, StrictMode is left
// off to halve that request volume. It has no effect on production builds; to
// get the dev-time checks back, wrap <App/> in <React.StrictMode>.
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
