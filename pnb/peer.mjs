import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { appendSigned, verifyLedger } from "./ledger.mjs";
import { demoEvents } from "./demo.mjs";

const ROOT = /^[a-f0-9]{64}$/;
const ZERO = "0".repeat(64);
const MAX_LEDGER_BYTES = 10 * 1024 * 1024;
const html = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)));
const evmHtml = readFileSync(fileURLToPath(new URL("./evm.html", import.meta.url)));
const evmUi = readFileSync(fileURLToPath(new URL("./evm-ui.mjs", import.meta.url)));
const evmHelper = readFileSync(fileURLToPath(new URL("./evm.mjs", import.meta.url)));

function fail(message) { throw new Error(message); }
function ledgerPath(dir) { return join(dir, "ledger.json"); }
function pinPath(dir) { return join(dir, "trust-root.txt"); }
function anchorPath(dir) { return join(dir, "anchor.json"); }

function writeNew(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "wx", mode });
}

function replaceAtomically(path, content) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

function locked(dir, task) {
  const path = join(dir, ".write-lock");
  try { mkdirSync(path); } catch { fail("Another writer holds this replica lock"); }
  try { return task(); } finally { rmdirSync(path); }
}

export function readPinnedRoot(dir) {
  const root = readFileSync(pinPath(dir), "utf8").trim();
  if (!ROOT.test(root)) fail("Invalid pinned trust root");
  return root;
}

export function readVerified(dir) {
  const bundle = JSON.parse(readFileSync(ledgerPath(dir), "utf8"));
  const summary = verifyLedger(bundle);
  if (summary.trustRoot !== readPinnedRoot(dir)) fail("Actor registry differs from pinned trust root");
  return { bundle, summary };
}

export function keygen(privatePath, publicPath) {
  if (existsSync(privatePath) || existsSync(publicPath)) fail("Key output already exists");
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  writeNew(privatePath, privateKey, 0o600);
  writeNew(publicPath, publicKey, 0o644);
  return publicKey;
}

export function initPublisher(dir, actors) {
  if (existsSync(dir)) fail("Replica directory already exists");
  const bundle = { schema: "pnb-pilot-v1", currency: "TEST", actors, events: [] };
  const summary = verifyLedger(bundle);
  mkdirSync(dir, { recursive: true });
  writeNew(pinPath(dir), summary.trustRoot + "\n", 0o644);
  writeNew(ledgerPath(dir), JSON.stringify(bundle, null, 2) + "\n", 0o600);
  return summary;
}

export function bootstrapSynthetic(publisherDir, keyDir) {
  const publisherPath = resolve(publisherDir);
  const keyPath = resolve(keyDir);
  if (publisherPath === keyPath || keyPath.startsWith(publisherPath + sep)) fail("Key directory must be outside publisher directory");
  if (existsSync(publisherPath) || existsSync(keyPath)) fail("Publisher or key directory already exists");
  const roles = {
    budget_office: "budget", procurement_office: "procurement", site_inspector_a: "inspector",
    site_inspector_b: "inspector", finance_office: "finance", builder: "contractor", independent_auditor: "auditor",
  };
  const actors = {};
  for (const [id, role] of Object.entries(roles)) {
    actors[id] = { role, publicKey: keygen(join(keyPath, `${id}.private.pem`), join(keyPath, `${id}.public.pem`)) };
  }
  return initPublisher(publisherPath, actors);
}

export function populateSynthetic(publisherDir, keyDir) {
  const events = demoEvents();
  let { bundle, summary } = readVerified(publisherDir);
  if (bundle.events.length > events.length) fail("Publisher has more events than synthetic demonstration");
  for (let i = 0; i < bundle.events.length; i++) {
    const expected = events[i];
    const actual = bundle.events[i];
    if (actual.actor !== expected.actor || actual.type !== expected.type || JSON.stringify(actual.payload) !== JSON.stringify(expected.payload)) fail(`Publisher differs from synthetic demonstration at event ${i}`);
  }
  for (const event of events.slice(bundle.events.length)) {
    summary = appendToPublisher(publisherDir, event.actor, join(keyDir, `${event.actor}.private.pem`), event.type, event.payload);
  }
  return summary;
}

export function initMirror(dir, trustRoot, eventCount, head) {
  if (!ROOT.test(trustRoot)) fail("A 64-character trust root is required");
  if (!Number.isSafeInteger(eventCount) || eventCount < 0 || !ROOT.test(head) || (eventCount === 0 && head !== ZERO)) fail("A valid independent checkpoint is required");
  if (existsSync(dir)) fail("Replica directory already exists");
  mkdirSync(dir, { recursive: true });
  writeNew(pinPath(dir), trustRoot + "\n", 0o644);
  writeNew(anchorPath(dir), JSON.stringify({ trustRoot, eventCount, head }) + "\n", 0o644);
}

export function assertAnchor(bundle, anchor) {
  if (!anchor || !ROOT.test(anchor.trustRoot) || !Number.isSafeInteger(anchor.eventCount) || anchor.eventCount < 0 || !ROOT.test(anchor.head)) fail("Invalid pinned checkpoint");
  if (verifyLedger(bundle).trustRoot !== anchor.trustRoot) fail("Incoming registry differs from pinned checkpoint");
  if (bundle.events.length < anchor.eventCount) fail("Incoming ledger predates pinned checkpoint");
  const anchoredHead = anchor.eventCount === 0 ? ZERO : bundle.events[anchor.eventCount - 1].hash;
  if (anchoredHead !== anchor.head) fail("Incoming ledger conflicts with pinned checkpoint");
}

export function appendToPublisher(dir, actor, privateKeyPath, type, payload) {
  return locked(dir, () => {
    const { bundle } = readVerified(dir);
    if (!Object.hasOwn(bundle.actors, actor)) fail("Actor is not registered");
    const privateKey = readFileSync(privateKeyPath, "utf8");
    let publicKey;
    try { publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }); }
    catch { fail("Invalid private key"); }
    if (publicKey !== bundle.actors[actor].publicKey) fail("Private key does not match registered actor");
    const next = appendSigned(bundle, actor, privateKey, type, payload);
    const summary = verifyLedger(next);
    replaceAtomically(ledgerPath(dir), JSON.stringify(next, null, 2) + "\n");
    return summary;
  });
}

export function compareExtension(current, incoming, trustRoot) {
  const newer = verifyLedger(incoming);
  if (newer.trustRoot !== trustRoot) fail("Incoming registry differs from pinned trust root");
  if (current) {
    const older = verifyLedger(current);
    if (older.trustRoot !== trustRoot) fail("Local registry differs from pinned trust root");
    if (incoming.events.length < current.events.length) fail("Incoming ledger rolls back local history");
    for (let i = 0; i < current.events.length; i++) {
      if (current.events[i].hash !== incoming.events[i].hash) fail(`Fork detected at event ${i}`);
    }
  }
  return newer;
}

async function fetchLedger(baseUrl) {
  const url = new URL("api/ledger", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!["http:", "https:"].includes(url.protocol)) fail("Peer URL must use HTTP or HTTPS");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) fail(`Peer returned HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_LEDGER_BYTES) { await reader.cancel(); fail("Peer ledger exceeds size limit"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function syncFromPeer(dir, baseUrl) {
  const incoming = await fetchLedger(baseUrl);
  return locked(dir, () => {
    const root = readPinnedRoot(dir);
    const current = existsSync(ledgerPath(dir)) ? JSON.parse(readFileSync(ledgerPath(dir), "utf8")) : null;
    const summary = compareExtension(current, incoming, root);
    if (existsSync(anchorPath(dir))) assertAnchor(incoming, JSON.parse(readFileSync(anchorPath(dir), "utf8")));
    if (!current) writeNew(ledgerPath(dir), JSON.stringify(incoming, null, 2) + "\n", 0o600);
    else if (incoming.events.length > current.events.length) replaceAtomically(ledgerPath(dir), JSON.stringify(incoming, null, 2) + "\n");
    return summary;
  });
}

export function startPeerServer(dir, { port = 8788, host = "127.0.0.1" } = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) fail("Invalid port");
  readVerified(dir);
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      res.end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    let body, type;
    try {
      const { bundle, summary } = readVerified(dir);
      if (path === "/") { body = html; type = "text/html; charset=utf-8"; }
      else if (path === "/evm") { body = evmHtml; type = "text/html; charset=utf-8"; }
      else if (path === "/evm-ui.mjs") { body = evmUi; type = "text/javascript; charset=utf-8"; }
      else if (path === "/evm.mjs") { body = evmHelper; type = "text/javascript; charset=utf-8"; }
      else if (path === "/api/ledger") { body = Buffer.from(JSON.stringify(bundle)); type = "application/json; charset=utf-8"; }
      else if (path === "/api/summary") { body = Buffer.from(JSON.stringify({ valid: true, ...summary })); type = "application/json; charset=utf-8"; }
      else if (path === "/api/checkpoint") {
        body = Buffer.from(JSON.stringify({ schema: "pnb-checkpoint-v1", trustRoot: summary.trustRoot, eventCount: summary.eventCount, head: summary.head }));
        type = "application/json; charset=utf-8";
      } else { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(); return; }
    } catch {
      res.writeHead(503, { "Cache-Control": "no-store" }); res.end("Replica verification failed"); return;
    }
    res.writeHead(200, {
      "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  server.listen(port, host);
  return server;
}
