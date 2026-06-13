/* handler.js — AWS Lambda entry (API Gateway HTTP API v2).
   Thin adapter: parse the event, route POST /check, return JSON with CORS. */

import { randomUUID } from "node:crypto";
import { runCheck } from "./lib/check.js";
import { log } from "./lib/log.js";

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

const CORS = {
  "access-control-allow-origin": ALLOW_ORIGIN,
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
};

export const handler = async (event = {}) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const path = event.requestContext?.http?.path || event.rawPath || "/";
  const reqId = event.requestContext?.requestId || randomUUID();
  const ip = event.requestContext?.http?.sourceIp || null;
  const logger = log.child({ reqId });
  const start = Date.now();

  if (method === "OPTIONS") {
    logger.debug("preflight", { path });
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (!path.endsWith("/check")) {
    logger.warn("route not found", { method, path });
    return resp(404, { error: "Not found" });
  }

  try {
    const domain = method === "POST" ? parseBody(event).domain : event.queryStringParameters?.domain;
    if (!domain) {
      logger.warn("missing domain", { ip });
      return resp(400, { error: "Provide a domain" });
    }
    logger.info("request", { method, ip });

    const report = await runCheck(domain, logger);
    logger.info("response", { status: 200, ms: Date.now() - start });
    return resp(200, report);
  } catch (e) {
    const status = { EBLOCKED: 422, ENOTFOUND: 404, EINVALID: 400 }[e.code] || 500;
    logger[status >= 500 ? "error" : "warn"]("request failed", {
      status, code: e.code || null, err: e.message, ms: Date.now() - start,
    });
    return resp(status, { error: e.message });
  }
};

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
  try { return JSON.parse(raw); } catch { return {}; }
}

function resp(statusCode, obj) {
  return { statusCode, headers: CORS, body: JSON.stringify(obj) };
}
