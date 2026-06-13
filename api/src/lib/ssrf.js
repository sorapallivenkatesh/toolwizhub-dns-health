/* lib/ssrf.js — the safety gate. Because we connect to user-supplied hosts,
   resolve them first and REFUSE any private/loopback/link-local/metadata target.
   Run this before any socket or fetch. */

import dns from "node:dns/promises";

export function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → unsafe
  const [a, b, c] = p;
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 2) return true;  // TEST-NET-1
  if (a >= 224) return true;                         // multicast / reserved
  return false;
}

export function isPrivateIPv6(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::1" || s === "::") return true;        // loopback / unspecified
  if (s.startsWith("fe80")) return true;             // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique-local fc00::/7
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateIP(ip) {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Resolve a hostname and assert every address is public. Returns the addresses. */
export async function assertPublicHost(hostname) {
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw withCode(`Could not resolve ${hostname}`, "ENOTFOUND");
  }
  if (!addrs.length) throw withCode(`Could not resolve ${hostname}`, "ENOTFOUND");

  const blocked = addrs.find((a) => isPrivateIP(a.address));
  if (blocked) {
    throw withCode(`Refusing to probe a non-public address (${blocked.address})`, "EBLOCKED");
  }
  return addrs.map((a) => a.address);
}

function withCode(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}
