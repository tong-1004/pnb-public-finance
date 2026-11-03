import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { appendSigned, sha256, verifyLedger } from "./ledger.mjs";

function fixture() {
  const actors = {}, keys = {};
  for (const [id, role] of Object.entries({ issuer: "budget", payer: "contractor", payee: "contractor" })) {
    const pair = generateKeyPairSync("ed25519");
    actors[id] = { role, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }) };
    keys[id] = pair.privateKey;
  }
  let bundle = { schema: "pnb-pilot-v1", currency: "TEST", actors, events: [] };
  return {
    get bundle() { return bundle; },
    add(actor, type, payload) { bundle = appendSigned(bundle, actor, keys[actor], type, payload); return verifyLedger(bundle); },
    keys,
  };
}

test("TEST issuance and signed transfer conserve balances and reject replay or overspend", () => {
  const f = fixture();
  const issuance = { issuance_id: "issue-1", to: "payer", amount: 100, authorization_sha256: sha256("test issue") };
  assert.throws(() => f.add("payer", "test_credit_issued", issuance), /role/i);
  assert.equal(f.add("issuer", "test_credit_issued", issuance).testBalances.payer, 100);
  assert.throws(() => f.add("issuer", "test_credit_issued", issuance), /Duplicate/i);
  assert.throws(() => f.add("issuer", "test_credit_issued", { ...issuance, issuance_id: "issue-2", amount: 1_000_000 }), /cap/i);
  const transfer = { transfer_id: "tx-1", to: "payee", amount: 30, contract_sha256: sha256("contract"), nonce: 1 };
  assert.throws(() => f.add("payer", "test_transfer", { ...transfer, amount: 101 }), /balance/i);
  assert.throws(() => f.add("payer", "test_transfer", { ...transfer, nonce: 2 }), /nonce/i);
  const summary = f.add("payer", "test_transfer", transfer);
  assert.equal(summary.testBalances.payer, 70);
  assert.equal(summary.testBalances.payee, 30);
  assert.throws(() => f.add("payer", "test_transfer", transfer), /Duplicate/i);
  assert.throws(() => f.add("payer", "test_transfer", { ...transfer, transfer_id: "tx-2" }), /nonce/i);
  const altered = structuredClone(f.bundle);
  altered.events.at(-1).payload.amount = 31;
  assert.throws(() => verifyLedger(altered), /signature/i);
});

test("TEST escrow requires the recipient's preimage and bilateral cancellation", () => {
  const f = fixture();
  f.add("issuer", "test_credit_issued", { issuance_id: "issue-1", to: "payer", amount: 100, authorization_sha256: sha256("test issue") });
  const opening = {
    escrow_id: "escrow-1", to: "payee", amount: 40, contract_sha256: sha256("contract"),
    secret_sha256: sha256("release-secret"), nonce: 1,
  };
  assert.equal(f.add("payer", "test_escrow_opened", opening).testBalances.payer, 60);
  assert.throws(() => f.add("payer", "test_escrow_claimed", { escrow_id: "escrow-1", secret: "release-secret" }), /cannot be claimed/i);
  assert.throws(() => f.add("payee", "test_escrow_claimed", { escrow_id: "escrow-1", secret: "wrong" }), /condition/i);
  assert.throws(() => f.add("payee", "test_escrow_cancel_accepted", { escrow_id: "escrow-1" }), /cannot be accepted/i);
  assert.equal(f.add("payee", "test_escrow_claimed", { escrow_id: "escrow-1", secret: "release-secret" }).testBalances.payee, 40);
  assert.throws(() => f.add("payer", "test_escrow_cancel_requested", { escrow_id: "escrow-1" }), /cannot be requested/i);
  f.add("payer", "test_escrow_opened", { ...opening, escrow_id: "escrow-2", nonce: 2, amount: 20 });
  assert.throws(() => f.add("payee", "test_escrow_cancel_requested", { escrow_id: "escrow-2" }), /cannot be requested/i);
  f.add("payer", "test_escrow_cancel_requested", { escrow_id: "escrow-2" });
  const cancelled = f.add("payee", "test_escrow_cancel_accepted", { escrow_id: "escrow-2" });
  assert.equal(cancelled.testBalances.payer, 60);
  assert.equal(cancelled.testEscrows.find((e) => e.id === "escrow-2").status, "cancelled");
  assert.throws(() => f.add("payee", "test_escrow_claimed", { escrow_id: "escrow-2", secret: "release-secret" }), /cannot be claimed/i);
});
