/* Offline unit tests for the pure bits (no network). Run: npm test */

import assert from "node:assert";
import { normalizeHostname } from "../src/lib/validate.js";
import { isPrivateIP } from "../src/lib/ssrf.js";

/* normalizeHostname */
assert.equal(normalizeHostname("Example.com"), "example.com");
assert.equal(normalizeHostname("  ACME.io  "), "acme.io");
assert.equal(normalizeHostname("https://dash.acme.io/path?x=1"), "dash.acme.io");
assert.equal(normalizeHostname("dash.acme.io:443"), "dash.acme.io");
assert.equal(normalizeHostname("assets.acme.io."), "assets.acme.io");
assert.throws(() => normalizeHostname("not a domain"), /valid domain/);
assert.throws(() => normalizeHostname(""), /Enter a domain/);
assert.throws(() => normalizeHostname("localhost"), /valid domain/); // no TLD

/* SSRF classification — private must be blocked */
for (const ip of [
  "10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1",
  "172.16.0.1", "172.31.255.255", "100.64.0.1", "0.0.0.0",
  "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1",
]) {
  assert.ok(isPrivateIP(ip), `${ip} should be PRIVATE`);
}

/* public must pass */
for (const ip of ["1.1.1.1", "8.8.8.8", "104.21.3.234", "2606:4700:4700::1111"]) {
  assert.ok(!isPrivateIP(ip), `${ip} should be PUBLIC`);
}

console.log("✓ all unit tests passed");
