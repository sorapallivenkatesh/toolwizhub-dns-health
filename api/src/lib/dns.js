/* lib/dns.js — fetch the common public DNS records via 1.1.1.1 / 8.8.8.8. */

import { Resolver } from "node:dns/promises";

const TYPES = ["A", "AAAA", "CNAME", "TXT", "CAA", "NS", "MX"];

export async function lookupRecords(hostname) {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);

  const out = {};
  await Promise.all([
    ...TYPES.map(async (type) => {
      try {
        out[type] = normalize(type, await r.resolve(hostname, type));
      } catch {
        out[type] = []; // NODATA / NXDOMAIN for this type → empty
      }
    }),
    // SOA is a single object (present at the zone apex), not an array.
    (async () => {
      try {
        out.SOA = await r.resolveSoa(hostname);
      } catch {
        out.SOA = null;
      }
    })(),
  ]);
  return out;
}

function normalize(type, recs) {
  switch (type) {
    case "TXT":
      return recs.map((parts) => (Array.isArray(parts) ? parts.join("") : parts));
    case "MX":
      return recs.map((m) => `${m.priority} ${m.exchange}`);
    case "CAA":
      return recs.map((c) => c.issue ?? c.issuewild ?? c.iodef ?? JSON.stringify(c));
    default:
      return recs;
  }
}
