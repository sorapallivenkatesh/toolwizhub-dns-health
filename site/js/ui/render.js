/* ui/render.js — build the report DOM. Untrusted values (DNS records, cert
   fields from arbitrary domains) go in via textContent, never innerHTML. */

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

export function renderLoading(domain) {
  const s = el("div", "state");
  const label = el("div");
  label.append("Checking ", strong(domain), " …");
  s.append(el("div", "spinner"), label);
  return s;
}

export function renderError(message) {
  const s = el("div", "state state--error");
  s.textContent = `⚠ ${message}`;
  return s;
}

export function renderReport(r) {
  const frag = document.createDocumentFragment();
  frag.append(head(r), certCard(r.cert), registrationCard(r.registration), dnsCard(r.dns), findingsCard(r.findings));
  return frag;
}

/* ── pieces ───────────────────────────────────────── */
function head(r) {
  const h = el("div", "result-head");
  const domain = el("div", "result-head__domain");
  domain.textContent = r.domain;
  const status = r.summary?.status || "ok";
  const pill = el("span", `pill pill--${status}`);
  pill.textContent = status === "ok" ? "Healthy" : status === "warn" ? "Warnings" : "Issues";
  const meta = el("div", "result-head__meta");
  meta.textContent = Array.isArray(r.addresses) ? r.addresses.join(", ") : "";
  h.append(domain, pill, meta);
  return h;
}

function certCard(cert) {
  const card = el("div", "card");
  card.append(cardHead("TLS Certificate", cert && !cert.error ? certBadge(cert) : null));
  const body = el("div", "card__body");
  if (!cert || cert.error) {
    body.append(kv("Status", cert?.error || "No data"));
  } else {
    body.append(
      kv("Expires", `${fmtDate(cert.validTo)} (${cert.daysLeft} days)`),
      kv("Issuer", cert.issuer || "—"),
      kv("Subject", cert.subject || "—"),
      kv("Valid from", fmtDate(cert.validFrom)),
      kv("SANs", `${cert.sans?.length || 0} names`),
      kv("Chain", cert.chainOk ? "Trusted ✓" : `Not trusted${cert.chainError ? ` — ${cert.chainError}` : ""}`)
    );
  }
  card.append(body);
  return card;
}

function certBadge(cert) {
  const lvl = cert.daysLeft < 0 ? "fail" : cert.daysLeft < 14 ? "warn" : "ok";
  const p = el("span", `pill pill--${lvl}`);
  p.textContent = cert.daysLeft < 0 ? "Expired" : `${cert.daysLeft}d left`;
  return p;
}

function registrationCard(reg) {
  const card = el("div", "card");
  const showBadge = reg && !reg.error && reg.daysLeft != null;
  card.append(cardHead("Domain Registration", showBadge ? regBadge(reg) : null));
  const body = el("div", "card__body");
  if (!reg || reg.error) {
    body.append(kv("Status", reg?.error || "No data"));
  } else {
    if (reg.registeredDomain) body.append(kv("Registered", reg.registeredDomain));
    body.append(kv("Expires", reg.expiresOn ? `${fmtDate(reg.expiresOn)} (${reg.daysLeft} days)` : "Unknown"));
    if (reg.registrar) body.append(kv("Registrar", reg.registrar));
    if (reg.created) body.append(kv("Created", fmtDate(reg.created)));
    if (reg.status?.length) body.append(kv("Status", reg.status.join(", ")));
  }
  card.append(body);
  return card;
}

function regBadge(reg) {
  const lvl = reg.daysLeft < 0 ? "fail" : reg.daysLeft < 30 ? "warn" : "ok";
  const p = el("span", `pill pill--${lvl}`);
  p.textContent = reg.daysLeft < 0 ? "Expired" : `${reg.daysLeft}d left`;
  return p;
}

function dnsCard(dns) {
  const card = el("div", "card");
  card.append(cardHead("DNS Records"));
  const body = el("div", "card__body");
  if (!dns || dns.error) {
    body.append(kv("Status", dns?.error || "No data"));
  } else {
    const types = Object.keys(dns).filter((t) => Array.isArray(dns[t]) && dns[t].length);
    if (!types.length) {
      body.append(el("div", "dns-empty", "No records found"));
    } else {
      for (const t of types) {
        const row = el("div", "dns-type");
        const label = el("span", "dns-type__label");
        label.textContent = t;
        const vals = el("span", "dns-type__vals");
        for (const v of dns[t]) {
          const dv = el("div");
          dv.textContent = v;
          vals.append(dv);
        }
        row.append(label, vals);
        body.append(row);
      }
    }
  }
  card.append(body);
  return card;
}

function findingsCard(findings) {
  const card = el("div", "card");
  card.append(cardHead("Findings"));
  const body = el("div", "card__body");
  if (!findings?.length) {
    body.append(el("div", "dns-empty", "No findings"));
  } else {
    for (const f of findings) {
      const row = el("div", `finding finding--${f.level}`);
      const icon = el("span", "finding__icon");
      icon.textContent = f.level === "ok" ? "✓" : f.level === "warn" ? "!" : "✕";
      const msg = el("span");
      msg.textContent = f.message;
      row.append(icon, msg);
      body.append(row);
    }
  }
  card.append(body);
  return card;
}

/* ── helpers ──────────────────────────────────────── */
function cardHead(title, right) {
  const h = el("div", "card__head");
  const t = el("span");
  t.textContent = title;
  h.append(t);
  if (right) h.append(right);
  return h;
}

function kv(k, v) {
  const row = el("div", "kv");
  const kk = el("span", "kv__k");
  kk.textContent = k;
  const vv = el("span", "kv__v");
  vv.textContent = v;
  row.append(kk, vv);
  return row;
}

function strong(text) {
  const s = el("strong");
  s.textContent = text;
  return s;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
