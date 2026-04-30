# News Analysis Page — Implementation Plan

## Context

The user wants a new "News Analysis" page where they can input space-separated stock tickers (e.g. `TSLA BMNR META`) and get summarized news for each stock using the FMP (Financial Modeling Prep) API. The free tier allows 250 API calls/day.

---

## Backend: Single Endpoint

**File**: `backend/main.py`

### New endpoint: `GET /api/news?tickers=TSLA,META&limit=20`

- Reads `FMP_API_KEY` from env (loaded via `load_dotenv()`)
- Calls FMP: `https://financialmodelingprep.com/api/v3/stock_news?tickers={tickers}&limit={limit}&apikey={key}`
- Uses `httpx` (add to requirements.txt) for the HTTP call — lightweight, async-capable, already standard in FastAPI projects
- Returns the FMP response as-is (array of articles), or raises HTTPException on failure / missing API key
- No persistent storage needed — this is a live query

```
Response shape (from FMP):
[
  {
    "symbol": "TSLA",
    "publishedDate": "2026-02-14 14:30:00",
    "title": "Tesla Stock Rises...",
    "text": "Summary snippet...",
    "image": "https://...",
    "url": "https://...",
    "site": "Benzinga"
  },
  ...
]
```

### Env changes

**File**: `backend/.env.example` — add `FMP_API_KEY=your_fmp_api_key_here`
**File**: `backend/.env` — user adds their own key

### Dependencies

**File**: `backend/requirements.txt` — add `httpx>=0.27.0`

---

## Frontend: API Module

**New file**: `frontend/src/api/news.js`

```js
export async function fetchNews(tickers, limit = 20)
  // GET /api/news?tickers=TSLA,META&limit=20
  // Returns array of article objects
```

Follows existing pattern from `journal.js` — check `res.ok`, throw with `err.detail`.

---

## Frontend: News Analysis Page

**New file**: `frontend/src/pages/NewsAnalysis.jsx`

### Layout

```
┌─────────────────────────────────────────────────────┐
│  News Analysis                                      │
│  Search for news on any stock ticker.               │
│                                                     │
│  ┌─────────────────────────────────┐  ┌──────────┐  │
│  │ TSLA BMNR META                  │  │ Search   │  │
│  └─────────────────────────────────┘  └──────────┘  │
│                                                     │
│  ┌─ TSLA (3 articles) ─────────────────────────┐    │
│  │  ┌──────────────────────────────────────┐    │    │
│  │  │ 🖼 │ Title                    Source  │    │    │
│  │  │    │ Summary text...          2h ago  │    │    │
│  │  └──────────────────────────────────────┘    │    │
│  │  ┌──────────────────────────────────────┐    │    │
│  │  │ 🖼 │ Title                    Source  │    │    │
│  │  │    │ Summary text...          5h ago  │    │    │
│  │  └──────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ META (2 articles) ─────────────────────────┐    │
│  │  ...                                         │    │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Behavior

1. **Input**: Text field for space-separated tickers + Search button
2. **On submit**: Call `fetchNews(tickers)`, group results by `symbol`
3. **Display**: Articles grouped by ticker, each showing:
   - Thumbnail image (if available, from `image` field)
   - Title (clickable link to original article via `url`)
   - Summary text snippet (`text` field)
   - Source name (`site`) + relative time ("2h ago", "1d ago")
4. **States**: Empty (initial prompt), loading spinner, error, results
5. **Styling**: Matches existing app patterns — `surface-900/80` cards, `surface-700/50` borders, `accent` for interactive elements

### State

- `query` — raw input string
- `articles` — array from API
- `loading` — boolean
- `error` — string or null

---

## Routing & Navigation

**File**: `frontend/src/App.jsx`
- Import `NewsAnalysis` from `'./pages/NewsAnalysis'`
- Add route: `<Route path="news" element={<NewsAnalysis />} />`

**File**: `frontend/src/components/Layout.jsx`
- Add `{ path: '/news', label: 'News Analysis' }` to `navItems` (after Trading Analysis, before Backtesting)

---

## Implementation Order

1. `backend/requirements.txt` — add `httpx`
2. `backend/.env.example` — add `FMP_API_KEY`
3. `backend/main.py` — add `/api/news` endpoint
4. `frontend/src/api/news.js` — create API module
5. `frontend/src/pages/NewsAnalysis.jsx` — create page component
6. `frontend/src/App.jsx` — add route
7. `frontend/src/components/Layout.jsx` — add nav item

## Files Summary

| Action | File |
|--------|------|
| New | `frontend/src/pages/NewsAnalysis.jsx` |
| New | `frontend/src/api/news.js` |
| Edit | `backend/main.py` — add 1 endpoint (~25 lines) |
| Edit | `backend/requirements.txt` — add `httpx` |
| Edit | `backend/.env.example` — add `FMP_API_KEY` |
| Edit | `frontend/src/App.jsx` — add import + route |
| Edit | `frontend/src/components/Layout.jsx` — add nav item |

## Verification

1. Add `FMP_API_KEY` to `backend/.env`
2. `pip install httpx` in backend venv
3. `npm run dev` — app loads, "News Analysis" appears in nav
4. Enter `TSLA META` → click Search → articles appear grouped by ticker
5. Each article title links to original source
6. Missing API key shows clear error message
