# 🩺 ToolWizHub — DNS & Cert Health

Check any **public** domain's DNS records, **TLS certificate** expiry & chain, and common
misconfigurations. A ToolWizHub tool for **dns.toolwizhub.com**.

```
hunch.in
✓ Certificate valid for 111 more days   (Amazon · expires Oct 3 2026 · chain trusted)
  DNS: A / AAAA / CNAME / TXT / CAA / NS / MX
```

## Why this one has a backend

The other ToolWizHub tools are pure static — this one can't be. A browser **cannot**:
- read a TLS certificate (`fetch()` hides the peer cert; there's no raw-socket API) → **cert expiry is impossible client-side**
- read cross-origin response headers (blocked by CORS)

So the checks run server-side in real Node (`tls.connect`, `node:dns`). Cloudflare Workers
can't do it either — their socket API doesn't expose the peer certificate — which is why the
API runs on **AWS Lambda**, not Workers.

## Architecture

```
api/                  AWS Lambda (Node 20) + API Gateway HTTP API — deployed via AWS SAM
  src/handler.js      event → POST /check
  src/lib/
    ssrf.js           resolve + reject private/loopback/link-local/metadata IPs (run first!)
    dns.js            node:dns → A/AAAA/CNAME/TXT/CAA/NS/MX
    cert.js           tls.connect → expiry, issuer, SANs, chain
    check.js          orchestrate: validate → SSRF → parallel checks w/ timeouts
  template.yaml       SAM stack
  tests/              offline unit tests (validation + SSRF classification)
site/                 static dashboard → Cloudflare Pages (brand-consistent, dark theme)
  index.html, css/, js/{main,ui/render}, assets/ (ToolWizHub WebP), config.js
```

## Run locally

```bash
# API (terminal 1)
cd api && npm run dev            # → http://localhost:3000/check
npm test                         # offline unit tests

# Frontend (terminal 2)
cd site && python3 -m http.server 8080
# open http://localhost:8080  (config.js auto-targets localhost:3000)
```

Deep-link / auto-run: `http://localhost:8080/?d=example.com`.

## Deploy

- **API** → AWS Lambda + HTTP API via SAM:
  ```bash
  cd api && sam build && sam deploy --guided \
    --parameter-overrides AllowOrigin=https://dns.toolwizhub.com
  ```
  Then map `api-dns.toolwizhub.com` to the HTTP API (ACM cert in AWS; add the CNAME in
  Cloudflare as **DNS-only / grey cloud**), and set `config.js` `API_BASE` to it.
- **Frontend** → Cloudflare Pages, custom domain `dns.toolwizhub.com`.

## Security (public endpoint)

- **SSRF guard** runs before any socket/fetch — refuses private/internal/metadata targets.
- Hard **timeouts** on every DNS/TLS call; **CORS** restricted to the site origin in prod.
- Rate-limit at the API Gateway in front of the function.

## Roadmap

1. ✅ **MVP** — SSRF + DNS + cert + dashboard *(this)*
2. HTTP headers, HSTS, redirects, CDN detection
3. Misconfig rules (dangling CNAME, missing CAA, DNSSEC) + result caching
4. Shareable report URLs, history
