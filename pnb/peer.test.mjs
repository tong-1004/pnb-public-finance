import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { appendSigned, sha256, verifyLedger } from "./ledger.mjs";
import { appendToPublisher, assertAnchor, bootstrapSynthetic, compareExtension, initMirror, initPublisher, keygen, populateSynthetic, readVerified, startPeerServer, syncFromPeer } from "./peer.mjs";

test("two independent replicas sync only signed extensions and detect forks", async () => {
  const root = mkdtempSync(join(tmpdir(), "pnb-peer-test-"));
  const publisher = join(root, "publisher");
  const mirror = join(root, "mirror");
  const budgetPrivate = join(root, "budget.private.pem");
  const procurementPrivate = join(root, "procurement.private.pem");
  let server;
  try {
    const budgetPublic = keygen(budgetPrivate, join(root, "budget.public.pem"));
    const procurementPublic = keygen(procurementPrivate, join(root, "procurement.public.pem"));
    const actors = {
      budget: { role: "budget", publicKey: budgetPublic },
      procurement: { role: "procurement", publicKey: procurementPublic },
    };
    const initial = initPublisher(publisher, actors);
    initMirror(mirror, initial.trustRoot, 0, initial.head);
    server = startPeerServer(publisher, { port: 0 });
    if (!server.listening) await once(server, "listening");
    const peerUrl = `http://127.0.0.1:${server.address().port}/`;
    assert.equal((await syncFromPeer(mirror, peerUrl)).eventCount, 0);
    const budget = { ocid: "ocds-pnb-peer-1", title: "Synthetic water works", amount: 100, authorization_sha256: sha256("synthetic authorization") };
    appendToPublisher(publisher, "budget", budgetPrivate, "budget_authorized", budget);
    assert.equal((await syncFromPeer(mirror, peerUrl)).eventCount, 1);
    const localOne = readVerified(mirror).bundle;
    appendToPublisher(publisher, "procurement", procurementPrivate, "tender_published", { ocid: budget.ocid, notice_sha256: sha256("synthetic tender") });
    const current = await syncFromPeer(mirror, peerUrl);
    assert.equal(current.eventCount, 2);
    assert.equal(readVerified(mirror).summary.head, readVerified(publisher).summary.head);
    assert.equal((await syncFromPeer(mirror, peerUrl)).eventCount, 2);
    assert.throws(() => compareExtension(readVerified(mirror).bundle, localOne, initial.trustRoot), /rolls back/i);
    const fork = appendSigned({ schema: "pnb-pilot-v1", currency: "TEST", actors, events: [] }, "budget", readFileSync(budgetPrivate, "utf8"), "budget_authorized", { ...budget, amount: 101 });
    assert.throws(() => compareExtension(localOne, fork, initial.trustRoot), /fork/i);
    assert.throws(() => assertAnchor(fork, { trustRoot: initial.trustRoot, eventCount: 1, head: localOne.events[0].hash }), /checkpoint/i);
    assert.throws(() => compareExtension(null, fork, "0".repeat(64)), /pinned trust root/i);
    assert.equal((await (await fetch(new URL("api/checkpoint", peerUrl))).json()).head, current.head);
    assert.equal((await fetch(new URL("api/ledger", peerUrl), { method: "POST" })).status, 405);
    assert.ok(!JSON.stringify(readVerified(mirror).bundle).includes("PRIVATE KEY"));
    assert.equal(verifyLedger(readVerified(mirror).bundle).eventCount, 2);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    const safeRoot = realpathSync(root);
    if (!safeRoot.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Unsafe test cleanup path");
    rmSync(safeRoot, { recursive: true, force: true });
  }
});

test("bootstrap creates a resumable eight-event publisher without publishing private keys", () => {
  const root = mkdtempSync(join(tmpdir(), "pnb-bootstrap-test-"));
  try {
    const publisher = join(root, "publisher");
    const keys = join(root, "keys");
    const initial = bootstrapSynthetic(publisher, keys);
    assert.equal(initial.eventCount, 0);
    assert.equal(populateSynthetic(publisher, keys).eventCount, 8);
    assert.equal(populateSynthetic(publisher, keys).eventCount, 8);
    assert.equal(readVerified(publisher).summary.projects[0].paid, 30000);
    assert.ok(!JSON.stringify(readVerified(publisher).bundle).includes("PRIVATE KEY"));
  } finally {
    const safeRoot = realpathSync(root);
    if (!safeRoot.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Unsafe test cleanup path");
    rmSync(safeRoot, { recursive: true, force: true });
  }
});
