// Setups Board client.
//
// The board is aggregated + cached server-side at /api/setups/board, which reuses
// each Find-Setups scanner's own warm cache (see backend/setups_board.py for the
// normalization + confluence logic). That endpoint owns a market-aware cache keyed
// on the breadth trading day, so the board is "dependent on the other scans": it
// holds no data of its own and invalidates when they roll to a new day. force=true
// rebuilds it and forces every underlying scan.
export async function getSetupsBoard({ force = false } = {}) {
  const res = await fetch(`/api/setups/board${force ? '?force=1' : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load setups board')
  }
  return res.json()
}
