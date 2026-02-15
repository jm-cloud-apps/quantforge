"""Interactive Brokers connection wrapper using ib_insync."""

from ib_insync import IB, Stock, MarketOrder, LimitOrder, StopOrder
from dataclasses import dataclass
from typing import Optional


@dataclass
class ConnectionConfig:
    host: str = "127.0.0.1"
    port: int = 7497
    client_id: int = 1
    is_paper: bool = True
    timeout: int = 10


# Port mapping
PAPER_PORTS = {7497, 4002}
LIVE_PORTS = {7496, 4001}


class IBConnection:
    """Manages connection to TWS / IB Gateway."""

    def __init__(self):
        self.ib = IB()
        self.config: Optional[ConnectionConfig] = None

    @property
    def connected(self) -> bool:
        return self.ib.isConnected()

    def _resolve_port(self, config: ConnectionConfig) -> int:
        if config.is_paper:
            return config.port if config.port in PAPER_PORTS else 7497
        else:
            return config.port if config.port in LIVE_PORTS else 7496

    async def connect(self, config: ConnectionConfig) -> dict:
        if self.connected:
            await self.disconnect()
        self.config = config
        port = self._resolve_port(config)
        await self.ib.connectAsync(
            host=config.host,
            port=port,
            clientId=config.client_id,
            timeout=config.timeout,
        )
        return self.get_account_summary()

    async def disconnect(self):
        if self.connected:
            self.ib.disconnect()
        self.config = None

    def get_account_summary(self) -> dict:
        summary = {}
        tags_wanted = {
            'NetLiquidation', 'TotalCashValue', 'BuyingPower',
            'GrossPositionValue', 'MaintMarginReq', 'AvailableFunds',
        }
        for av in self.ib.accountSummary():
            if av.tag in tags_wanted:
                try:
                    summary[av.tag] = float(av.value)
                except (ValueError, TypeError):
                    summary[av.tag] = av.value

        accounts = self.ib.managedAccounts()
        summary['account_id'] = accounts[0] if accounts else ''
        summary['is_paper'] = self.config.is_paper if self.config else True
        return summary

    def get_positions(self) -> list:
        result = []
        for pos in self.ib.positions():
            result.append({
                'symbol': pos.contract.symbol,
                'exchange': pos.contract.primaryExchange or pos.contract.exchange,
                'quantity': float(pos.position),
                'avg_cost': round(float(pos.avgCost), 2),
                'market_value': round(float(pos.position) * float(pos.avgCost), 2),
                'sec_type': pos.contract.secType,
            })
        return result

    def get_open_orders(self) -> list:
        result = []
        for trade in self.ib.openTrades():
            o = trade.order
            s = trade.orderStatus
            result.append({
                'order_id': o.orderId,
                'symbol': trade.contract.symbol,
                'action': o.action,
                'quantity': float(o.totalQuantity),
                'order_type': o.orderType,
                'limit_price': float(o.lmtPrice) if o.lmtPrice else None,
                'stop_price': float(o.auxPrice) if o.auxPrice else None,
                'status': s.status,
                'filled': float(s.filled),
                'remaining': float(s.remaining),
                'avg_fill_price': float(s.avgFillPrice) if s.avgFillPrice else None,
            })
        return result

    async def place_order(self, symbol: str, action: str, quantity: int,
                          order_type: str, limit_price: float = 0,
                          stop_price: float = 0) -> dict:
        contract = Stock(symbol, 'SMART', 'USD')
        qualified = await self.ib.qualifyContractsAsync(contract)
        if not qualified:
            raise ValueError(f"Could not qualify contract for {symbol}")

        # Enforce US-only (IIROC 3200A restriction for IBKR Canada)
        exchange = contract.primaryExchange or ''
        canadian_exchanges = {'TSE', 'VENTURE', 'TSX', 'TSXV', 'OMEGA', 'PURE', 'CDE'}
        if exchange.upper() in canadian_exchanges:
            raise ValueError(
                f"{symbol} trades on {exchange} (Canadian exchange). "
                "IBKR Canada does not permit API-based order submission for Canadian-listed securities (IIROC Rule 3200A). "
                "Only US-listed stocks are supported."
            )

        if order_type == 'MKT':
            order = MarketOrder(action, quantity)
        elif order_type == 'LMT':
            order = LimitOrder(action, quantity, limit_price)
        elif order_type == 'STP':
            order = StopOrder(action, quantity, stop_price)
        else:
            raise ValueError(f"Unsupported order type: {order_type}")

        trade = self.ib.placeOrder(contract, order)
        return {
            'order_id': trade.order.orderId,
            'symbol': symbol,
            'action': action,
            'quantity': quantity,
            'order_type': order_type,
            'status': trade.orderStatus.status,
        }

    async def cancel_order(self, order_id: int) -> dict:
        for trade in self.ib.openTrades():
            if trade.order.orderId == order_id:
                self.ib.cancelOrder(trade.order)
                return {'order_id': order_id, 'status': 'cancel_requested'}
        raise ValueError(f"Order {order_id} not found in open orders")
