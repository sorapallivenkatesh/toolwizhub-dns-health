/* lib/check.js — orchestrate a full check for one domain.
   validate → SSRF guard → run checks in parallel with timeouts → build report. */

import { normalizeHostname } from "./validate.js";
import { assertPublicHost } from "./ssrf.js";
import { lookupRecords } from "./dns.js";
import { getCert } from "./cert.js";
import { getDomainRegistration } from "./domain.js";
import { withTimeout } from "./timeout.js";
import { log as defaultLog } from "./log.js";

/** Wrap a promise so it always resolves with {status, value|reason, ms}. */
function track(promise) {
  const start = Date.now();
  return promise.then(
    (value) => ({ status: "fulfilled", value, ms: Date.now() - start }),
    (reason) => ({ status: "rejected", reason, ms: Date.now() - start })
  );
}

export async function runCheck(rawDomain, logger = defaultLog) {
  const t0 = Date.now();
  const domain = normalizeHostname(rawDomain); // throws EINVALID
  logger.info("check started", { domain });

  let addresses;
  try {
    addresses = await assertPublicHost(domain); // throws ENOTFOUND / EBLOCKED
  } catch (e) {
    logger.warn("resolve/ssrf blocked", { domain, code: e.code, err: e.message });
    throw e;
  }
  logger.debug("resolved", { domain, addresses });

  const [dnsR, certR, regR] = await Promise.all([
    track(withTimeout(lookupRecords(domain), 8000, "DNS lookup")),
    track(withTimeout(getCert(domain), 10000, "Certificate check")),
    track(withTimeout(getDomainRegistration(domain), 9000, "Domain registration")),
  ]);

  logCheck(logger, "dns", domain, dnsR);
  logCheck(logger, "cert", domain, certR);
  logCheck(logger, "registration", domain, regR);

  const dns = dnsR.status === "fulfilled" ? dnsR.value : { error: dnsR.reason?.message };
  const cert = certR.status === "fulfilled" ? certR.value : { error: certR.reason?.message };
  const registration = regR.status === "fulfilled" ? regR.value : { error: regR.reason?.message };

  const findings = buildFindings({ cert, registration });
  const summary = summarize(findings);
  logger.info("check complete", {
    domain,
    status: summary.status,
    warn: summary.warn,
    fail: summary.fail,
    certDaysLeft: cert?.daysLeft ?? null,
    domainDaysLeft: registration?.daysLeft ?? null,
    ms: Date.now() - t0,
  });

  return { domain, addresses, checkedAt: new Date().toISOString(), summary, cert, registration, dns, findings };
}

function logCheck(logger, name, domain, result) {
  if (result.status === "rejected") {
    logger.warn(`${name} check failed`, { domain, ms: result.ms, err: result.reason?.message });
  } else {
    logger.debug(`${name} check ok`, { domain, ms: result.ms });
  }
}

function buildFindings({ cert, registration }) {
  const f = [];

  // TLS certificate
  if (cert?.error) {
    f.push({ level: "fail", message: `Certificate check failed: ${cert.error}` });
  } else if (cert) {
    if (cert.daysLeft < 0) {
      f.push({ level: "fail", message: `Certificate EXPIRED ${Math.abs(cert.daysLeft)} days ago` });
    } else if (cert.daysLeft < 14) {
      f.push({ level: "warn", message: `Certificate expires in ${cert.daysLeft} days` });
    } else {
      f.push({ level: "ok", message: `Certificate valid for ${cert.daysLeft} more days` });
    }
    if (!cert.chainOk) {
      f.push({ level: "warn", message: `Certificate chain not trusted${cert.chainError ? ` (${cert.chainError})` : ""}` });
    }
  }

  // Domain registration (RDAP). No finding when RDAP data is unavailable.
  if (registration && !registration.error && registration.daysLeft != null) {
    if (registration.daysLeft < 0) {
      f.push({ level: "fail", message: `Domain registration EXPIRED ${Math.abs(registration.daysLeft)} days ago` });
    } else if (registration.daysLeft < 30) {
      f.push({ level: "warn", message: `Domain registration expires in ${registration.daysLeft} days` });
    } else {
      f.push({ level: "ok", message: `Domain registered for ${registration.daysLeft} more days` });
    }
  }

  return f;
}

function summarize(findings) {
  const count = (lvl) => findings.filter((f) => f.level === lvl).length;
  const fail = count("fail");
  const warn = count("warn");
  return { status: fail ? "fail" : warn ? "warn" : "ok", fail, warn, ok: count("ok") };
}
