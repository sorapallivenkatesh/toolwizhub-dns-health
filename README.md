# 🩺 ToolWizHub — DNS & Cert Health

Check any **public** domain's DNS records, **TLS certificate** expiry & chain, and
**domain registration** status. A ToolWizHub tool for **dns-health.toolwizhub.com**.

```
hunch.in                                                    SERVER IP 99.86.30.29
✓ Certificate     valid 111 more days   (Amazon · expires Oct 3 2026 · chain trusted)
✓ Registration    1950 days left         (Key-Systems GmbH · expires Oct 16 2031)
  Records         A · AAAA · CNAME · MX · NS · SOA · TXT · CAA
```

## Why this one has a backend

The other ToolWizHub tools are pure static — this one can't be. A browser **cannot**:
- read a TLS certificate (`fetch()` hides the peer cert; there's no raw-socket API) → **cert expiry is impossible client-side**
- read cross-origin response headers (blocked by CORS)

So the checks run server-side in real Node (`tls.connect`, `node:dns`). Cloudflare Workers
can't do it either — their socket API doesn't expose the peer certificate — which is why the
API runs on **AWS Lambda**, not Workers.

## How it works (request flow)

The frontend is a dumb form: it POSTs a domain and renders the JSON it gets back. All the
real work (TLS handshake, DNS, RDAP) happens server-side. The only thing that differs between
local and production is **which API URL the frontend calls** — chosen by `site/config.js`
from `location.hostname`. The server code is identical in both.

**Local (dev):**
```
Browser  http://localhost:8080            (python http.server serving site/)
   │  click Check → main.js: fetch POST → http://localhost:3000/check  {domain}
   │  (8080 → 3000 is cross-origin → browser sends a CORS preflight first)
   ▼
node api/src/dev.js  (one Node process on :3000)
   │  wraps the HTTP request into an API-Gateway-shaped event → handler.handler()
   │  → runCheck(): validate → SSRF guard → [DNS ∥ cert ∥ RDAP] w/ timeouts → findings
   │  returns JSON (CORS "*" because ALLOW_ORIGIN env is unset in dev)
   ▼
Browser renders cards.  Logs print to the terminal.
```

**Hosted (production):**
```
Browser  https://dns-health.toolwizhub.com     (static site on Cloudflare Pages)
   │  config.js sees hostname ≠ localhost → API_BASE = https://api.dns-health.toolwizhub.com
   │  click Check → fetch POST → https://api.dns-health.toolwizhub.com/check  {domain}
   │  (cross-origin → CORS preflight; API allows only the site origin)
   ▼
API Gateway (HTTP API)  →  invokes AWS Lambda  →  handler.handler()
   │  same runCheck() logic, identical code
   │  returns JSON (CORS restricted via ALLOW_ORIGIN env)
   ▼
Browser renders cards.  Logs go to CloudWatch (filter by reqId).
```

| | Local | Hosted |
|---|---|---|
| API runtime | `node dev.js` on `:3000` | API Gateway + Lambda (serverless) |
| `API_BASE` | `http://localhost:3000` | `https://api.dns-health.toolwizhub.com` |
| Who selects it | `config.js` via `location.hostname` | same file, other branch |
| CORS | `*` (env unset) | restricted to `dns-health.toolwizhub.com` |
| Logs | terminal stdout | CloudWatch |
| TLS | plain http | ACM cert (API GW) + Cloudflare cert (Pages) |

## What it checks

- **DNS records** — A, AAAA, CNAME, MX, NS, **SOA**, TXT, CAA (via 1.1.1.1 / 8.8.8.8)
- **TLS certificate** — days to expiry, issuer, subject, SANs, chain trust
- **Domain registration** — expiry, registrar, created date, status flags (via **RDAP**)
- **Findings** — rolled into an overall Healthy / Warnings / Issues status

## Architecture

```
api/                  AWS Lambda (Node 20) + API Gateway HTTP API — deployed via AWS SAM
  src/handler.js      event → POST /check  (CORS + per-request logging)
  src/dev.js          local HTTP runner for the handler (no SAM needed)
  src/lib/
    ssrf.js           resolve + reject private/loopback/link-local/metadata IPs (run first!)
    dns.js            node:dns → A/AAAA/CNAME/MX/NS/SOA/TXT/CAA
    cert.js           tls.connect → expiry, issuer, SANs, chain
    domain.js         RDAP → registration expiry, registrar, status
    check.js          orchestrate: validate → SSRF → parallel checks w/ timeouts → findings
    timeout.js        promise deadline helper
    log.js            structured JSON logger (LOG_LEVEL, per-request reqId)
  template.yaml       SAM stack (Lambda + HTTP API + CORS + LOG_LEVEL)
  tests/              offline unit tests (validation + SSRF classification)
site/                 static dashboard → Cloudflare Pages (glassmorphism / gradient theme)
  index.html
  css/styles.css
  js/main.js          POST a domain → render report
  js/ui/render.js     result header, 3-card grid (cert / registration / primary records),
                      full DNS record set (SOA + TXT + CAA)
  assets/             ToolWizHub WebP brand
  config.js           API base URL (localhost:3000 in dev, api.dns-health.toolwizhub.com in prod)
```

## Logging

The API emits one structured JSON line per event (CloudWatch-friendly), each tagged with a
`reqId` so a request can be traced end-to-end: `request → check started → resolved →
dns/cert/registration check ok|failed (+ms) → check complete (status, ms) → response`.
Level via `LOG_LEVEL` env (`debug|info|warn|error`, default `info`).

## Run locally

```bash
# API (terminal 1)
cd api && npm run dev            # → http://localhost:3000/check
npm test                         # offline unit tests
LOG_LEVEL=debug npm run dev      # verbose per-check logs

# Frontend (terminal 2)
cd site && python3 -m http.server 8080
# open http://localhost:8080  (config.js auto-targets localhost:3000)
```

Deep-link / auto-run: `http://localhost:8080/?d=example.com`.

## Deploy

> Full step-by-step (AWS account setup, SAM, Cloudflare Pages, custom domain, troubleshooting):
> see **[DEPLOY.md](DEPLOY.md)**. Quick version below.

- **API** → AWS Lambda + HTTP API via SAM:
  ```bash
  cd api && sam build && sam deploy --guided \
    --parameter-overrides AllowOrigin=https://dns-health.toolwizhub.com
  ```
  Then map `api.dns-health.toolwizhub.com` to the HTTP API (ACM cert in AWS; add the CNAME in
  Cloudflare as **DNS-only / grey cloud**), and set `config.js` `API_BASE` to it.
- **Frontend** → Cloudflare Pages, custom domain `dns-health.toolwizhub.com`.

## Security (public endpoint)

- **SSRF guard** runs before any socket/fetch — refuses private/internal/metadata targets.
- Hard **timeouts** on every DNS / TLS / RDAP call; **CORS** restricted to the site origin in prod.
- Rate-limit at the API Gateway in front of the function.

## Roadmap

1. ✅ **MVP** — SSRF + DNS (incl. SOA) + TLS cert + domain registration (RDAP) + dashboard
2. HTTP headers, HSTS, redirects, CDN detection
3. Misconfig rules (dangling CNAME, missing CAA, DNSSEC) + result caching
4. Shareable report URLs, history
