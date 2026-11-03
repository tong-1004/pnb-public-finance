import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyLedger } from "./ledger.mjs";

const port = Number(process.env.PNB_PORT ?? 8788);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PNB_PORT");
const html = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)));
const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("./sample-ledger.json", import.meta.url)), "utf8"));
const summary = verifyLedger(bundle);

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
    res.end();
    return;
  }
  let body, type;
  if (path === "/") {
    body = html;
    type = "text/html; charset=utf-8";
  } else if (path === "/api/ledger") {
    body = Buffer.from(JSON.stringify(bundle));
    type = "application/json; charset=utf-8";
  } else if (path === "/api/summary") {
    body = Buffer.from(JSON.stringify({ valid: true, ...summary }));
    type = "application/json; charset=utf-8";
  } else {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'",
  });
  res.end(req.method === "HEAD" ? undefined : body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PNB 合成資料試點：http://127.0.0.1:${port}/`);
});
