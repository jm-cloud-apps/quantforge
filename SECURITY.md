# Security

QuantForge is a **single-user, local-first** trading platform. It is designed to
run on the trader's own machine, bound to `localhost`, with no multi-tenant
access. That shapes the whole threat model below: the goal is to keep the app
honest and safe *for the person running it*, not to defend an internet-facing
service.

## Threat model

**In scope**
- Untrusted *bytes* reaching the filesystem — uploaded trade files and
  screenshots, and filenames used to serve files back.
- Accidental leakage of secrets (API keys, broker credentials) into git or logs.
- Accidental exposure of the API beyond the local machine.
- Irreversible/broker actions (order placement) happening without an explicit,
  informed confirmation.

**Out of scope (by design)**
- Multi-user auth / RBAC — there is one user, the machine owner.
- Network-level attackers — the server binds to `127.0.0.1` and is not meant to
  be exposed publicly. If you tunnel or reverse-proxy it, *you* own that
  exposure (see "If you expose it" below).
- CSRF on state-changing endpoints — mitigated in practice by the localhost
  bind + a locked CORS allow-list, not by tokens.

## Controls in place

| Area | Control | Where |
|------|---------|-------|
| **CORS** | Allow-list is exactly `http://localhost:5173` / `http://127.0.0.1:5173` — no wildcard origin | `backend/main.py` (`CORSMiddleware`) |
| **Network exposure** | Uvicorn binds `127.0.0.1` by default (`start.sh` / launch config never pass `--host 0.0.0.0`) | `start.sh` |
| **Path traversal** | Served screenshot paths are resolved and contained to their directory; absolute paths, `..`, and symlink escapes are rejected | `_safe_within()` in `backend/main.py` |
| **Upload size** | Uploads (trade workbooks, playbook screenshots) are capped at 25 MB → clean `413` instead of an unbounded in-memory read | `_enforce_upload_limit()` in `backend/main.py` |
| **Upload type** | Trade uploads are restricted to `.csv` / `.xlsx` / `.xls`; a missing filename is rejected with `400` | `/api/trading-analysis/upload` |
| **Stored filenames** | Uploaded screenshots are renamed to a server-generated `{entry_id}{ext}` — the client filename never becomes a write path | `/api/playbook/entries` |
| **Secrets** | All keys live in `backend/.env` (git-ignored); `.env.example` ships placeholders only; no secret is committed | `.gitignore`, `backend/.env.example` |
| **Broker safety** | Order placement is gated behind an explicit confirmation modal and a Paper/Live toggle; live mode carries an extra warning. US-only symbols (IIROC 3200A) | `broker/`, `pages/BotTrader.jsx` |
| **AI keys** | The Anthropic / Massive / Finnhub keys are read from env at call time and never returned to the client; only "set / missing" status is logged | `backend/main.py` |

## Secrets handling

- **Never commit `backend/.env`** (or a root `.env`). Both are covered by
  `.gitignore`. `backend/.env.example` is the only env file that should ever be
  tracked, and it must contain placeholders only.
- Keys used: `MASSIVE_API_KEY`, `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, and the
  `IB_*` broker settings. Rotate any key that has ever been pasted into a chat,
  screenshot, or shared log.
- Startup logs only whether each key is **set** or **missing** — never the value.

## If you expose it beyond localhost

The app has **no authentication**. If you put it behind a tunnel, VPN, or
reverse proxy so another device can reach it, you are responsible for the auth
layer. At minimum:

1. Terminate TLS and require auth at the proxy (basic auth, OAuth proxy, or an
   allow-listed VPN).
2. Do **not** bind uvicorn to `0.0.0.0` on an untrusted network.
3. Treat the Bot Trader (real order execution) as the highest-value target —
   consider leaving `ib_insync` uninstalled on any exposed instance, which makes
   the broker endpoints disappear entirely.

## Reporting

This is a personal project with no formal disclosure process. If you find an
issue, open an issue or note it in `CLAUDE.md` for the next change.
