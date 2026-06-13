/* lib/validate.js — turn arbitrary user input into a clean hostname (or throw).
   Accepts "example.com", "https://example.com/path", "example.com:443", IDN. */

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}$/;

export function normalizeHostname(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw badInput("Enter a domain, e.g. example.com");
  }
  let s = input.trim().toLowerCase();

  // If it looks like a URL (has scheme, path, or port), let URL extract the host.
  if (s.includes("/") || s.includes(":")) {
    try {
      s = new URL(s.includes("://") ? s : `https://${s}`).hostname;
    } catch {
      /* fall through to validation */
    }
  }
  s = s.replace(/\.$/, "").replace(/:\d+$/, ""); // trailing dot / leftover port

  if (!HOSTNAME_RE.test(s)) {
    throw badInput("Enter a valid domain, e.g. example.com");
  }
  return s;
}

function badInput(message) {
  const e = new Error(message);
  e.code = "EINVALID";
  return e;
}
