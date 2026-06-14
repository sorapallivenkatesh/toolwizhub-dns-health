/* ui/render.js — build the report DOM to match the dashboard design.
   Untrusted values (DNS records, cert fields from arbitrary domains) go in via
   textContent, never innerHTML. Only static SVG markup uses innerHTML. */

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function txt(tag, cls, text) {
  const n = el(tag, cls);
  n.textContent = text;
  return n;
}

/* ── line icons (static SVG) ──────────────────────── */
const ICON = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>`,
  dns: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`,
};

export function renderLoading(domain) {
  const s = el("div", "state");
  const label = el("div");
  label.append("Checking ", txt("strong", null, domain), " …");
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
  frag.append(head(r), cardsRow(r), fullDnsCard(r.dns));
  return frag;
}

/* ── result header: globe + domain + status · server IP ──────────── */
function head(r) {
  const h = el("div", "result-head");

  const id = el("div", "result-head__id");
  id.append(el("span", "icon-box icon-box--lg", ICON.globe));
  const idText = el("div");
  idText.append(txt("div", "result-head__domain", r.domain));
  const status = r.summary?.status || "ok";
  const pill = txt("span", `pill pill--${status}`, status === "ok" ? "Healthy" : status === "warn" ? "Warnings" : "Issues");
  idText.append(pill);
  id.append(idText);

  const serverIp = r.dns?.A?.[0] || r.addresses?.[0] || "—";
  const server = el("div", "result-head__server");
  server.append(txt("span", "result-head__label", "SERVER IP"), txt("span", "result-head__ip", serverIp));

  h.append(id, server);
  return h;
}

/* ── the three-card row ───────────────────────────── */
function cardsRow(r) {
  const grid = el("div", "cards-grid");
  grid.append(certCard(r.cert), registrationCard(r.registration), primaryRecordsCard(r.dns));
  return grid;
}

function certCard(cert) {
  const card = el("div", "card");
  card.append(cardHead(ICON.shield, "TLS Certificate", cert && !cert.error ? daysBadge(cert.daysLeft, 14) : null));
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

function registrationCard(reg) {
  const card = el("div", "card");
  const badge = reg && !reg.error && reg.daysLeft != null ? daysBadge(reg.daysLeft, 30) : null;
  card.append(cardHead(ICON.doc, "Domain Registration", badge));
  const body = el("div", "card__body");
  if (!reg || reg.error) {
    body.append(kv("Status", reg?.error || "No data"));
  } else {
    if (reg.registeredDomain) body.append(kv("Registered", reg.registeredDomain));
    body.append(kv("Expires", reg.expiresOn ? `${fmtDate(reg.expiresOn)} (${reg.daysLeft} days)` : "Unknown"));
    if (reg.registrar) body.append(kv("Registrar", reg.registrar));
    if (reg.created) body.append(kv("Created", fmtDate(reg.created)));
    if (reg.status?.length) {
      const row = el("div", "kv kv--stack");
      row.append(txt("span", "kv__k", "Status"));
      const chips = el("div", "chips");
      for (const s of reg.status) chips.append(txt("span", "chip", s.replace(/\s+/g, "").toUpperCase()));
      row.append(chips);
      body.append(row);
    }
  }
  card.append(body);
  return card;
}

/* ── primary records: A / AAAA / CNAME / MX / NS ──── */
const PRIMARY = [
  ["A", "Record A"],
  ["AAAA", "Record AAAA"],
  ["CNAME", "CNAME"],
  ["MX", "Mail (MX)"],
  ["NS", "Name Servers"],
];

function primaryRecordsCard(dns) {
  const card = el("div", "card");
  card.append(cardHead(ICON.server, "Primary Records"));
  const body = el("div", "card__body");

  if (!dns || dns.error) {
    body.append(kv("Status", dns?.error || "No data"));
    card.append(body);
    return card;
  }

  let any = false;
  for (const [type, label] of PRIMARY) {
    const values = dns[type];
    if (!Array.isArray(values) || !values.length) continue;
    any = true;
    body.append(recSection(label, values, type === "NS" ? 4 : 6));
  }
  if (!any) body.append(el("div", "dns-empty", "No primary records found"));

  card.append(body);
  return card;
}

function recSection(label, values, cap) {
  const sec = el("div", "rec-section");
  const headRow = el("div", "rec-section__head");
  headRow.append(txt("span", "rec-section__label", label));
  headRow.append(txt("span", "rec-section__count", `${values.length} ${values.length === 1 ? "entry" : "entries"}`));
  sec.append(headRow);

  const box = el("div", "rec-box");
  const shown = values.slice(0, cap);
  for (const v of shown) box.append(txt("div", "rec-box__line", v));
  if (values.length > cap) box.append(txt("div", "rec-more", `+ ${values.length - cap} others`));
  sec.append(box);
  return sec;
}

/* ── full DNS record set: TXT + CAA ───────────────── */
function fullDnsCard(dns) {
  const card = el("div", "card");
  card.append(cardHead(ICON.dns, "Full DNS Record Set"));
  const body = el("div", "card__body");

  if (!dns || dns.error) {
    body.append(kv("Status", dns?.error || "No data"));
    card.append(body);
    return card;
  }

  let any = false;
  const txtRecs = dns.TXT || [];
  if (txtRecs.length) {
    any = true;
    const sec = dnsSection("TXT Records");
    for (const v of txtRecs) sec.append(txt("div", "dns-entry", v));
    body.append(sec);
  }

  const caaRecs = dns.CAA || [];
  if (caaRecs.length) {
    any = true;
    const sec = dnsSection("CAA Records");
    const grid = el("div", "caa-grid");
    for (const v of caaRecs) {
      const rowEl = el("div", "caa-row");
      rowEl.append(txt("span", "caa-row__val", v), txt("span", "caa-row__tag", "issue"));
      grid.append(rowEl);
    }
    sec.append(grid);
    body.append(sec);
  }

  if (!any) body.append(el("div", "dns-empty", "No TXT or CAA records found"));
  card.append(body);
  return card;
}

function dnsSection(title) {
  const sec = el("div", "dns-section");
  const head = el("div", "dns-section__title");
  head.append(el("span", "dns-section__dot"), txt("span", null, title));
  sec.append(head);
  return sec;
}

/* ── shared bits ──────────────────────────────────── */
function cardHead(icon, title, right) {
  const h = el("div", "card__head");
  const left = el("div", "card__head-left");
  left.append(el("span", "icon-box", icon), txt("span", "card__title", title));
  h.append(left);
  if (right) h.append(right);
  return h;
}

function daysBadge(daysLeft, warnAt) {
  const lvl = daysLeft < 0 ? "fail" : daysLeft < warnAt ? "warn" : "ok";
  return txt("span", `pill pill--${lvl}`, daysLeft < 0 ? "Expired" : `${daysLeft}d left`);
}

function kv(k, v) {
  const row = el("div", "kv");
  row.append(txt("span", "kv__k", k), txt("span", "kv__v", v));
  return row;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
