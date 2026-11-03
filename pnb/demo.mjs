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

export function makeDemo() {
  const actors = {};
  const keys = {};
  for (const [id, role] of Object.entries(actorRoles)) {
    const pair = generateKeyPairSync("ed25519");
    actors[id] = { role, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }) };
    keys[id] = pair.privateKey;
  }
  let bundle = { schema: "pnb-pilot-v1", currency: "TEST", actors, events: [] };
  const ocid = "ocds-pnb-demo-001";
  const add = (actor, type, payload) => { bundle = appendSigned(bundle, actor, keys[actor], type, payload); };
  const proof = (label) => sha256("SYNTHETIC DEMO ONLY: " + label);

  add("budget_office", "budget_authorized", {
    ocid, title: "示範：社區飲水設施修繕", amount: 100000,
    authorization_sha256: proof("budget authorization"),
  });
  add("procurement_office", "tender_published", {
    ocid, notice_sha256: proof("public tender notice"),
  });
  add("procurement_office", "contract_awarded", {
    ocid, contractor: "builder", amount: 80000,
    contract_sha256: proof("signed contract"),
    milestones: [
      { id: "inspection", title: "現場檢查與材料確認", amount: 30000 },
      { id: "repair", title: "修繕與功能驗收", amount: 50000 },
    ],
  });
  add("site_inspector_a", "milestone_attested", {
    ocid, milestone: "inspection", evidence_sha256: proof("inspector A site report"),
  });
  add("site_inspector_b", "milestone_attested", {
    ocid, milestone: "inspection", evidence_sha256: proof("inspector B site report"),
  });
  add("finance_office", "payment_recorded", {
    ocid, milestone: "inspection", amount: 30000, payee: "builder",
    transaction_id: "DEMO-PAY-001", receipt_sha256: proof("payment receipt"),
  });
  add("builder", "wage_batch_committed", {
    ocid, milestone: "inspection", worker_count: 3, total: 18000,
    proof_sha256: proof("private wage evidence commitment"),
  });
  add("independent_auditor", "audit_finding_opened", {
    ocid, finding_id: "DEMO-FINDING-001",
    summary: "示範待查：現場材料證明需由獨立稽核者比對原件。",
    evidence_sha256: proof("auditor note"),
  });
  verifyLedger(bundle);
  return bundle;
}
