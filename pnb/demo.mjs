import { generateKeyPairSync } from "node:crypto";
import { appendSigned, sha256, verifyLedger } from "./ledger.mjs";

const actorRoles = {
  budget_office: "budget",
  procurement_office: "procurement",
  site_inspector_a: "inspector",
  site_inspector_b: "inspector",
  finance_office: "finance",
  builder: "contractor",
  independent_auditor: "auditor",
};

export function demoEvents() {
  const ocid = "ocds-pnb-demo-001";
  const proof = (label) => sha256("SYNTHETIC DEMO ONLY: " + label);
  return [
  { actor: "budget_office", type: "budget_authorized", payload: {
    ocid, title: "示範：社區飲水設施修繕", amount: 100000,
    authorization_sha256: proof("budget authorization"),
  } },
  { actor: "procurement_office", type: "tender_published", payload: {
    ocid, notice_sha256: proof("public tender notice"),
  } },
  { actor: "procurement_office", type: "contract_awarded", payload: {
    ocid, contractor: "builder", amount: 80000,
    contract_sha256: proof("signed contract"),
    milestones: [
      { id: "inspection", title: "現場檢查與材料確認", amount: 30000 },
      { id: "repair", title: "修繕與功能驗收", amount: 50000 },
    ],
  } },
  { actor: "site_inspector_a", type: "milestone_attested", payload: {
    ocid, milestone: "inspection", evidence_sha256: proof("inspector A site report"),
  } },
  { actor: "site_inspector_b", type: "milestone_attested", payload: {
    ocid, milestone: "inspection", evidence_sha256: proof("inspector B site report"),
  } },
  { actor: "finance_office", type: "payment_recorded", payload: {
    ocid, milestone: "inspection", amount: 30000, payee: "builder",
    transaction_id: "DEMO-PAY-001", receipt_sha256: proof("payment receipt"),
  } },
  { actor: "builder", type: "wage_batch_committed", payload: {
    ocid, milestone: "inspection", worker_count: 3, total: 18000,
    proof_sha256: proof("private wage evidence commitment"),
  } },
  { actor: "independent_auditor", type: "audit_finding_opened", payload: {
    ocid, finding_id: "DEMO-FINDING-001",
    summary: "示範待查：現場材料證明需由獨立稽核者比對原件。",
    evidence_sha256: proof("auditor note"),
  } },
  ];
}

export function makeDemo() {
  const actors = {};
  const keys = {};
  for (const [id, role] of Object.entries(actorRoles)) {
    const pair = generateKeyPairSync("ed25519");
    actors[id] = { role, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }) };
    keys[id] = pair.privateKey;
  }
  let bundle = { schema: "pnb-pilot-v1", currency: "TEST", actors, events: [] };
  for (const { actor, type, payload } of demoEvents()) bundle = appendSigned(bundle, actor, keys[actor], type, payload);
  verifyLedger(bundle);
  return bundle;
}
