import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { appendSigned, sha256, verifyLedger } from "./ledger.mjs";
import { makeDemo } from "./demo.mjs";

const proof = (x) => sha256("test:" + x);
function fixture() {
  const roles = {
    budget: "budget", procurement: "procurement", inspectorA: "inspector",
    inspectorB: "inspector", finance: "finance", builder: "contractor", auditor: "auditor",
  };
  const actors = {}, keys = {};
  for (const [id, role] of Object.entries(roles)) {
    const pair = generateKeyPairSync("ed25519");
    actors[id] = { role, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }) };
    keys[id] = pair.privateKey;
  }
  let bundle = { schema: "pnb-pilot-v1", currency: "TEST", actors, events: [] };
  const add = (actor, type, payload) => { bundle = appendSigned(bundle, actor, keys[actor], type, payload); };
  const ocid = "ocds-pnb-test-1";
  const budget = { ocid, title: "Synthetic bridge", amount: 100, authorization_sha256: proof("budget") };
  const tender = { ocid, notice_sha256: proof("tender") };
  const award = {
    ocid, contractor: "builder", amount: 90, contract_sha256: proof("contract"),
    milestones: [{ id: "work", title: "Inspect work", amount: 90 }],
  };
  const attestation = { ocid, milestone: "work", evidence_sha256: proof("site report") };
  const payment = {
    ocid, milestone: "work", amount: 90, payee: "builder",
    transaction_id: "TEST-001", receipt_sha256: proof("receipt"),
  };
  return { get bundle() { return bundle; }, add, keys, ocid, budget, tender, award, attestation, payment };
}

test("synthetic public workflow replays with budget, inspection, payment and private wage aggregate", () => {
  const demo = makeDemo();
  const summary = verifyLedger(demo);
  assert.equal(summary.eventCount, 8);
  assert.equal(summary.projects[0].budget, 100000);
  assert.equal(summary.projects[0].paid, 30000);
  assert.equal(summary.projects[0].milestones[0].inspectionCount, 2);
  assert.equal(summary.projects[0].milestones[0].wageBatch.worker_count, 3);
  assert.equal(summary.findings.length, 1);
  assert.doesNotMatch(JSON.stringify(demo), /worker_name|worker_address|worker_wallet/i);
  assert.ok(!JSON.stringify(demo).includes("PRIVATE KEY"));
});

test("tampering with payment or chain breaks independent verification", () => {
  const tampered = structuredClone(makeDemo());
  tampered.events[5].payload.amount = 99999;
  assert.throws(() => verifyLedger(tampered), /signature|hash/i);
  const reordered = structuredClone(makeDemo());
  [reordered.events[3], reordered.events[4]] = [reordered.events[4], reordered.events[3]];
  assert.throws(() => verifyLedger(reordered), /chain/i);
});

test("registry replacement changes the external trust root and one key cannot count as two actors", () => {
  const original = makeDemo();
  const pinnedRoot = verifyLedger(original).trustRoot;
  const substituted = structuredClone(original);
  substituted.actors.site_inspector_b.publicKey = substituted.actors.site_inspector_a.publicKey;
  assert.throws(() => verifyLedger(substituted), /share one public key/i);
  const differentDemo = makeDemo();
  assert.notEqual(verifyLedger(differentDemo).trustRoot, pinnedRoot);
});

test("role separation, budget ceiling and independent inspections are enforced", () => {
  const f = fixture();
  assert.throws(() => f.add("finance", "budget_authorized", f.budget), /role/i);
  f.add("budget", "budget_authorized", f.budget);
  f.add("procurement", "tender_published", f.tender);
  assert.throws(() => f.add("procurement", "contract_awarded", { ...f.award, amount: 110, milestones: [{ id: "work", title: "Inspect work", amount: 110 }] }), /budget/i);
  f.add("procurement", "contract_awarded", f.award);
  assert.throws(() => f.add("finance", "payment_recorded", f.payment), /inspections/i);
  f.add("inspectorA", "milestone_attested", f.attestation);
  assert.throws(() => f.add("inspectorA", "milestone_attested", f.attestation), /Duplicate/i);
  assert.throws(() => f.add("finance", "payment_recorded", f.payment), /inspections/i);
  f.add("inspectorB", "milestone_attested", f.attestation);
  f.add("finance", "payment_recorded", f.payment);
  assert.throws(() => f.add("finance", "payment_recorded", f.payment), /paid/i);
  assert.equal(verifyLedger(f.bundle).projects[0].paid, 90);
});

test("contractor cannot claim wages before a recorded payment", () => {
  const f = fixture();
  f.add("budget", "budget_authorized", f.budget);
  f.add("procurement", "tender_published", f.tender);
  f.add("procurement", "contract_awarded", f.award);
  assert.throws(() => f.add("builder", "wage_batch_committed", {
    ocid: f.ocid, milestone: "work", worker_count: 1, total: 10,
    proof_sha256: proof("wages"),
  }), /cannot be recorded/i);
});
