/* lib/domain.js — domain *registration* status via RDAP (the JSON successor to
   WHOIS). Distinct from the TLS cert: this is when the domain name itself lapses.

   RDAP is queried on the registered domain (eTLD+1), not subdomains. Rather than
   ship a Public Suffix List, we walk from the most-specific name toward the apex
   and take the first that RDAP actually knows (subdomains return 404). rdap.org
   is an IANA-bootstrap redirector to the authoritative RDAP server. */

const RDAP_BASE = "https://rdap.org/domain/";

export async function getDomainRegistration(hostname) {
  let lastError = "No RDAP data (TLD may not support RDAP)";
  for (const name of registrableCandidates(hostname)) {
    try {
      const res = await fetch(RDAP_BASE + encodeURIComponent(name), {
        headers: { accept: "application/rdap+json" },
        redirect: "follow",
        signal: AbortSignal.timeout(7000),
      });
      if (res.status === 404) continue; // not a registered name → try the apex
      if (!res.ok) { lastError = `RDAP responded ${res.status}`; continue; }
      return parseRdap(name, await res.json());
    } catch (e) {
      lastError = e.name === "TimeoutError" ? "RDAP timed out" : e.message;
    }
  }
  return { error: lastError };
}

/** Host → candidate registered domains, most-specific first, never the bare TLD. */
function registrableCandidates(hostname) {
  const labels = hostname.split(".");
  const out = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

function parseRdap(queried, data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const dateOf = (action) => events.find((e) => e.eventAction === action)?.eventDate || null;

  const expiration = dateOf("expiration");
  const created = dateOf("registration");
  const out = {
    registeredDomain: (data.ldhName || queried).toLowerCase(),
    registrar: registrarName(data),
    status: Array.isArray(data.status) ? data.status : [],
    created: created ? safeIso(created) : null,
    expiresOn: null,
    daysLeft: null,
  };
  if (expiration) {
    out.expiresOn = safeIso(expiration);
    out.daysLeft = Math.floor((new Date(expiration).getTime() - Date.now()) / 86_400_000);
  }
  return out;
}

function registrarName(data) {
  const reg = (data.entities || []).find((e) => (e.roles || []).includes("registrar"));
  if (!reg) return null;
  const vcard = reg.vcardArray?.[1] || [];
  const fn = vcard.find((entry) => entry[0] === "fn");
  return fn?.[3] || reg.handle || null;
}

function safeIso(d) {
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
