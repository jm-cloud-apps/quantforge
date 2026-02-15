import { useState, useEffect, useRef } from 'react'
import {
  connectBroker,
  disconnectBroker,
  getBrokerStatus,
  getAccountSummary,
  getPositions,
  getOrders,
  placeOrder,
  cancelOrder,
} from '../api/botTrader'

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors'

export default function BotTrader() {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [config, setConfig] = useState({
    host: '127.0.0.1',
    port: 7497,
    client_id: 1,
    is_paper: true,
  })

  const [account, setAccount] = useState(null)
  const [positions, setPositions] = useState([])
  const [orders, setOrders] = useState([])
  const [error, setError] = useState(null)

  const [orderForm, setOrderForm] = useState({
    symbol: '',
    action: 'BUY',
    quantity: '',
    order_type: 'MKT',
    limit_price: '',
    stop_price: '',
  })
  const [showConfirm, setShowConfirm] = useState(false)
  const [orderError, setOrderError] = useState(null)
  const [orderSuccess, setOrderSuccess] = useState(null)
  const [showLiveWarning, setShowLiveWarning] = useState(false)

  const pollRef = useRef(null)

  useEffect(() => {
    checkStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => {
    if (connected) {
      fetchData()
      pollRef.current = setInterval(fetchData, 3000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
      setAccount(null)
      setPositions([])
      setOrders([])
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [connected])

  async function checkStatus() {
    try {
      const status = await getBrokerStatus()
      setConnected(status.connected)
      if (status.connected && status.is_paper !== null) {
        setConfig(prev => ({ ...prev, is_paper: status.is_paper }))
      }
    } catch { setConnected(false) }
  }

  async function fetchData() {
    try {
      const [acc, pos, ord] = await Promise.all([getAccountSummary(), getPositions(), getOrders()])
      setAccount(acc)
      setPositions(pos.positions || [])
      setOrders(ord.orders || [])
    } catch (err) { console.error('Poll error:', err) }
  }

  async function handleConnect() {
    setError(null)
    setConnecting(true)
    try {
      const res = await connectBroker(config)
      setConnected(true)
      setAccount(res.account)
    } catch (err) { setError(err.message) }
    setConnecting(false)
  }

  async function handleDisconnect() {
    try { await disconnectBroker() } catch {}
    setConnected(false)
  }

  function handlePaperToggle(isPaper) {
    if (!isPaper) { setShowLiveWarning(true) }
    else { setConfig({ ...config, is_paper: true, port: 7497 }) }
  }

  async function handlePlaceOrder() {
    setOrderError(null)
    setOrderSuccess(null)
    try {
      const res = await placeOrder({
        symbol: orderForm.symbol.toUpperCase().trim(),
        action: orderForm.action,
        quantity: parseInt(orderForm.quantity),
        order_type: orderForm.order_type,
        limit_price: orderForm.limit_price ? parseFloat(orderForm.limit_price) : null,
        stop_price: orderForm.stop_price ? parseFloat(orderForm.stop_price) : null,
      })
      setOrderSuccess(`Order placed: ${res.action} ${res.quantity} ${res.symbol} (${res.order_type})`)
      setShowConfirm(false)
      setOrderForm({ ...orderForm, symbol: '', quantity: '', limit_price: '', stop_price: '' })
      fetchData()
    } catch (err) {
      setOrderError(err.message)
      setShowConfirm(false)
    }
  }

  async function handleCancelOrder(orderId) {
    try { await cancelOrder(orderId); fetchData() }
    catch (err) { setError(err.message) }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Bot Trader</h1>
        <p className="text-surface-400 text-[13px] mt-1">
          Connect to Interactive Brokers and manage orders. US stocks only (IBKR Canada).
        </p>
      </div>

      {/* Paper/Live Banner */}
      {connected && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
          config.is_paper ? 'bg-cyan/10 border border-cyan/20 text-cyan' : 'bg-danger/10 border border-danger/20 text-danger'
        }`}>
          {config.is_paper
            ? 'PAPER TRADING \u2014 No real money at risk. Orders are simulated.'
            : 'LIVE TRADING \u2014 Real money. All orders execute on your live account. US stocks only.'}
        </div>
      )}

      {/* Connection Panel */}
      <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-surface-100">Connection</h2>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-accent' : connecting ? 'bg-warning animate-pulse' : 'bg-danger'}`} />
              <span className="text-xs text-surface-400">{connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}</span>
            </div>
          </div>
          {connected ? (
            <button onClick={handleDisconnect} className="px-4 py-2 rounded-full bg-danger/10 border border-danger/20 text-danger text-sm font-semibold hover:bg-danger/20 transition-all">Disconnect</button>
          ) : (
            <button onClick={handleConnect} disabled={connecting} className="px-4 py-2 rounded-full bg-accent hover:brightness-110 text-white text-sm font-semibold disabled:opacity-40 transition-all">
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>

        {!connected && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Host</label>
              <input type="text" value={config.host} onChange={(e) => setConfig({ ...config, host: e.target.value })} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Port</label>
              <input type="number" value={config.port} onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 7497 })} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Client ID</label>
              <input type="number" value={config.client_id} onChange={(e) => setConfig({ ...config, client_id: parseInt(e.target.value) || 1 })} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Mode</label>
              <div className="flex rounded-lg overflow-hidden border border-surface-600/40">
                <button onClick={() => handlePaperToggle(true)} className={`flex-1 py-2.5 text-sm font-medium transition-all ${config.is_paper ? 'bg-cyan/15 text-cyan' : 'bg-surface-800 text-surface-400 hover:text-surface-200'}`}>Paper</button>
                <button onClick={() => handlePaperToggle(false)} className={`flex-1 py-2.5 text-sm font-medium transition-all ${!config.is_paper ? 'bg-danger/15 text-danger' : 'bg-surface-800 text-surface-400 hover:text-surface-200'}`}>Live</button>
              </div>
            </div>
          </div>
        )}

        {error && <div className="mt-3 rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">{error}</div>}
        {!connected && <p className="mt-3 text-xs text-surface-500">Requires TWS or IB Gateway running locally. Paper: port 7497 (TWS) / 4002 (Gateway). Live: port 7496 / 4001.</p>}
      </div>

      {/* Account Summary */}
      {connected && account && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Net Liquidation', key: 'NetLiquidation' },
            { label: 'Total Cash', key: 'TotalCashValue' },
            { label: 'Buying Power', key: 'BuyingPower' },
            { label: 'Available Funds', key: 'AvailableFunds' },
          ].map(({ label, key }) => (
            <div key={key} className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4">
              <p className="text-[11px] text-surface-500 uppercase tracking-wider">{label}</p>
              <p className="text-xl font-bold text-surface-100 mt-1">
                {account[key] != null ? `$${Number(account[key]).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '--'}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Main Content */}
      {connected && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: Positions & Orders */}
          <div className="lg:col-span-3 space-y-6">
            {/* Positions Table */}
            <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700/30">
                <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Positions ({positions.length})</h3>
              </div>
              {positions.length === 0 ? (
                <div className="p-8 text-center text-surface-500 text-sm">No open positions</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-surface-500 text-[11px] uppercase tracking-wider">
                        <th className="text-left px-4 py-2.5">Symbol</th>
                        <th className="text-right px-4 py-2.5">Qty</th>
                        <th className="text-right px-4 py-2.5">Avg Cost</th>
                        <th className="text-right px-4 py-2.5">Market Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p, i) => (
                        <tr key={i} className="border-t border-surface-700/20 hover:bg-surface-800/40">
                          <td className="px-4 py-2.5 font-mono font-medium text-surface-100">{p.symbol}</td>
                          <td className={`px-4 py-2.5 text-right font-mono ${p.quantity > 0 ? 'text-accent' : 'text-danger'}`}>{p.quantity}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-surface-300">${p.avg_cost?.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-surface-300">${p.market_value?.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Orders Table */}
            <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700/30">
                <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Open Orders ({orders.length})</h3>
              </div>
              {orders.length === 0 ? (
                <div className="p-8 text-center text-surface-500 text-sm">No open orders</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-surface-500 text-[11px] uppercase tracking-wider">
                        <th className="text-left px-4 py-2.5">ID</th>
                        <th className="text-left px-4 py-2.5">Symbol</th>
                        <th className="text-left px-4 py-2.5">Side</th>
                        <th className="text-right px-4 py-2.5">Qty</th>
                        <th className="text-left px-4 py-2.5">Type</th>
                        <th className="text-left px-4 py-2.5">Status</th>
                        <th className="text-right px-4 py-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={i} className="border-t border-surface-700/20 hover:bg-surface-800/40">
                          <td className="px-4 py-2.5 font-mono text-surface-400">{o.order_id}</td>
                          <td className="px-4 py-2.5 font-mono font-medium text-surface-100">{o.symbol}</td>
                          <td className={`px-4 py-2.5 font-semibold ${o.action === 'BUY' ? 'text-accent' : 'text-danger'}`}>{o.action}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-surface-300">{o.quantity}</td>
                          <td className="px-4 py-2.5 text-surface-400">{o.order_type}{o.limit_price ? ` @ $${o.limit_price}` : ''}</td>
                          <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-700/60 text-surface-300">{o.status}</span></td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => handleCancelOrder(o.order_id)} className="text-danger/70 hover:text-danger text-xs font-medium">Cancel</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right: Order Form */}
          <div className="lg:col-span-2">
            <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 p-5 space-y-4 sticky top-20">
              <h3 className="text-base font-semibold text-surface-100">Place Order</h3>
              <p className="text-[11px] text-surface-500">IBKR Canada: Only US-listed stocks supported for automated orders (IIROC 3200A).</p>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Symbol</label>
                <input type="text" value={orderForm.symbol} onChange={(e) => setOrderForm({ ...orderForm, symbol: e.target.value.toUpperCase() })} placeholder="e.g. AAPL" className={`${INPUT_STYLE} font-mono`} />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Side</label>
                <div className="flex rounded-lg overflow-hidden border border-surface-600/40">
                  <button onClick={() => setOrderForm({ ...orderForm, action: 'BUY' })} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${orderForm.action === 'BUY' ? 'bg-accent/15 text-accent' : 'bg-surface-800 text-surface-400'}`}>BUY</button>
                  <button onClick={() => setOrderForm({ ...orderForm, action: 'SELL' })} className={`flex-1 py-2.5 text-sm font-semibold transition-all ${orderForm.action === 'SELL' ? 'bg-danger/15 text-danger' : 'bg-surface-800 text-surface-400'}`}>SELL</button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Quantity</label>
                <input type="number" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} placeholder="0" min="1" className={INPUT_STYLE} />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Order Type</label>
                <div className="flex rounded-lg overflow-hidden border border-surface-600/40">
                  {['MKT', 'LMT', 'STP'].map((t) => (
                    <button key={t} onClick={() => setOrderForm({ ...orderForm, order_type: t })} className={`flex-1 py-2.5 text-xs font-medium transition-all ${orderForm.order_type === t ? 'bg-accent/15 text-accent' : 'bg-surface-800 text-surface-400'}`}>
                      {t === 'MKT' ? 'Market' : t === 'LMT' ? 'Limit' : 'Stop'}
                    </button>
                  ))}
                </div>
              </div>

              {orderForm.order_type === 'LMT' && (
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1.5">Limit Price</label>
                  <input type="number" value={orderForm.limit_price} onChange={(e) => setOrderForm({ ...orderForm, limit_price: e.target.value })} placeholder="0.00" step="0.01" className={INPUT_STYLE} />
                </div>
              )}
              {orderForm.order_type === 'STP' && (
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1.5">Stop Price</label>
                  <input type="number" value={orderForm.stop_price} onChange={(e) => setOrderForm({ ...orderForm, stop_price: e.target.value })} placeholder="0.00" step="0.01" className={INPUT_STYLE} />
                </div>
              )}

              {orderError && <div className="rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-danger text-xs">{orderError}</div>}
              {orderSuccess && <div className="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-accent text-xs">{orderSuccess}</div>}

              <button
                onClick={() => setShowConfirm(true)}
                disabled={!orderForm.symbol || !orderForm.quantity}
                className={`w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 ${
                  orderForm.action === 'BUY' ? 'bg-accent hover:brightness-110 text-white' : 'bg-danger hover:brightness-110 text-white'
                }`}
              >
                {orderForm.action === 'BUY' ? 'Buy' : 'Sell'} {orderForm.symbol || '...'} {orderForm.quantity ? `x ${orderForm.quantity}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnected state */}
      {!connected && !connecting && (
        <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 border-dashed p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-surface-800/80 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-surface-300 text-[15px] font-medium">Connect to Interactive Brokers</p>
          <p className="text-surface-500 text-[13px] mt-1 max-w-md mx-auto">
            Make sure TWS or IB Gateway is running on your machine, then click Connect above to start trading.
          </p>
        </div>
      )}

      {/* Order Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-surface-900 border border-surface-700/50 p-6 space-y-4">
            <h3 className="text-lg font-semibold text-surface-100">Confirm Order</h3>
            <div className="rounded-xl bg-surface-800/60 p-4 space-y-2 font-mono text-sm">
              <div className="flex justify-between"><span className="text-surface-400">Symbol</span><span className="text-surface-100 font-semibold">{orderForm.symbol}</span></div>
              <div className="flex justify-between"><span className="text-surface-400">Side</span><span className={orderForm.action === 'BUY' ? 'text-accent font-semibold' : 'text-danger font-semibold'}>{orderForm.action}</span></div>
              <div className="flex justify-between"><span className="text-surface-400">Quantity</span><span className="text-surface-100">{orderForm.quantity}</span></div>
              <div className="flex justify-between"><span className="text-surface-400">Type</span><span className="text-surface-100">{orderForm.order_type}{orderForm.order_type === 'LMT' && orderForm.limit_price ? ` @ $${orderForm.limit_price}` : ''}{orderForm.order_type === 'STP' && orderForm.stop_price ? ` @ $${orderForm.stop_price}` : ''}</span></div>
              <div className="flex justify-between"><span className="text-surface-400">Account</span><span className={config.is_paper ? 'text-cyan' : 'text-danger'}>{config.is_paper ? 'Paper' : 'LIVE'}</span></div>
            </div>
            {!config.is_paper && <div className="rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-danger text-xs font-medium">This will execute on your LIVE account with real money.</div>}
            <div className="flex gap-3">
              <button onClick={handlePlaceOrder} className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${orderForm.action === 'BUY' ? 'bg-accent hover:brightness-110 text-white' : 'bg-danger hover:brightness-110 text-white'}`}>Confirm {orderForm.action}</button>
              <button onClick={() => setShowConfirm(false)} className="flex-1 py-2.5 rounded-full bg-surface-800 text-surface-300 text-sm font-semibold hover:bg-surface-700">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Live Mode Warning */}
      {showLiveWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-surface-900 border border-danger/30 p-6 space-y-4">
            <h3 className="text-lg font-semibold text-danger">Switch to Live Trading?</h3>
            <p className="text-surface-300 text-sm">Live mode connects to your real IBKR account. All orders will execute with real money.</p>
            <div className="flex gap-3">
              <button onClick={() => { setConfig({ ...config, is_paper: false, port: 7496 }); setShowLiveWarning(false) }} className="flex-1 py-2.5 rounded-full bg-danger hover:brightness-110 text-white text-sm font-semibold">I Understand, Use Live</button>
              <button onClick={() => setShowLiveWarning(false)} className="flex-1 py-2.5 rounded-full bg-surface-800 text-surface-300 text-sm font-semibold hover:bg-surface-700">Stay on Paper</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
