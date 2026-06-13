/* lib/cert.js — the reason this tool needs a backend.
   Open a TLS connection and read the leaf certificate the server presents:
   expiry, issuer, SANs, and whether the chain validates. */

import tls from "node:tls";

export function getCert(hostname, port = 443) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(value);
    };

    // rejectUnauthorized:false so we still read expired/self-signed certs and
    // report chain status ourselves rather than aborting the handshake.
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: 8000 },
      () => {
        const c = socket.getPeerCertificate(true);
        if (!c || !c.valid_to) return finish({ error: "No certificate presented" });

        const validTo = new Date(c.valid_to);
        const validFrom = new Date(c.valid_from);
        finish({
          daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000),
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          issuer: c.issuer?.O || c.issuer?.CN || null,
          subject: c.subject?.CN || null,
          sans: (c.subjectaltname || "")
            .split(",")
            .map((s) => s.replace(/^DNS:/i, "").trim())
            .filter(Boolean),
          chainOk: socket.authorized,
          chainError: socket.authorizationError ? String(socket.authorizationError) : null,
        });
      }
    );
    socket.on("error", (e) => finish({ error: e.message }));
    socket.on("timeout", () => finish({ error: "Connection timed out" }));
  });
}
