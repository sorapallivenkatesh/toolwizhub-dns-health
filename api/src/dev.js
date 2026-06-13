/* dev.js — run the Lambda handler locally over plain HTTP (no SAM needed).
   `npm run dev` → POST http://localhost:3000/check  { "domain": "example.com" } */

import http from "node:http";
import { handler } from "./handler.js";

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = new URL(req.url, "http://localhost");

  const event = {
    requestContext: { http: { method: req.method, path: url.pathname } },
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: chunks.length ? Buffer.concat(chunks).toString() : null,
    isBase64Encoded: false,
  };

  const out = await handler(event);
  res.writeHead(out.statusCode, out.headers);
  res.end(out.body);
});

server.listen(PORT, () => console.log(`dns-health API (dev) → http://localhost:${PORT}/check`));
