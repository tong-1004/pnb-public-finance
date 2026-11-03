import { createHash, sign, verify } from "node:crypto";

const ZERO = "0".repeat(64);
const SHA256 = /^[a-f0-9]{64}$/;
const ROLES = {
  budget_authorized: "budget",
  tender_published: "procurement",
  contract_awarded: "procurement",
  milestone_attested: "inspector",
  payment_recorded: "finance",
  wage_batch_committed: "contractor",
  audit_finding_opened: "auditor",
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function keys(value, required, label) {
  object(value, label);
  if (Object.keys(value).sort().join("|") !== [...required].sort().join("|")) {
    fail(`${label} fields do not match schema`);
  }
}

function string(value, label, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} is invalid`);
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a SHA-256 digest`);
}

function project(state, ocid) {
  string(ocid, "ocid", 100);
  const found = state.projects[ocid];
  if (!found) fail("Unknown contracting process");
  return found;
}

function apply(state, event, actors) {
  const { type, actor, payload } = event;
  if (!Object.hasOwn(ROLES, type)) fail("Unknown event type");
  if (actors[actor]?.role !== ROLES[type]) fail("Actor lacks required role");
  object(payload, "payload");
  if (type === "budget_authorized") {
    keys(payload, ["ocid", "title", "amount", "authorization_sha256"], type);
    string(payload.ocid, "ocid", 100);
    string(payload.title, "title");
    integer(payload.amount, "budget amount");
    digest(payload.authorization_sha256, "authorization_sha256");
    if (state.projects[payload.ocid]) fail("Duplicate contracting process");
    state.projects[payload.ocid] = {
      ocid: payload.ocid, title: payload.title, budget: payload.amount,
      tender: null, contract: null, paid: 0,
      milestones: Object.create(null), wageBatches: Object.create(null),
    };
  } else if (type === "tender_published") {
    keys(payload, ["ocid", "notice_sha256"], type);
    const p = project(state, payload.ocid);
    digest(payload.notice_sha256, "notice_sha256");
    if (p.tender) fail("Tender already published");
    p.tender = payload.notice_sha256;
  } else if (type === "contract_awarded") {
    keys(payload, ["ocid", "contractor", "amount", "contract_sha256", "milestones"], type);
    const p = project(state, payload.ocid);
    if (!p.tender || p.contract) fail("Tender missing or contract already awarded");
    string(payload.contractor, "contractor", 100);
    if (actors[payload.contractor]?.role !== "contractor") fail("Contractor is not registered");
    integer(payload.amount, "contract amount");
    digest(payload.contract_sha256, "contract_sha256");
    if (payload.amount > p.budget) fail("Contract exceeds authorized budget");
    if (!Array.isArray(payload.milestones) || payload.milestones.length < 1 || payload.milestones.length > 30) fail("Invalid milestones");
    let total = 0;
    for (const m of payload.milestones) {
      keys(m, ["id", "title", "amount"], "milestone");
      string(m.id, "milestone id", 60);
      string(m.title, "milestone title");
      integer(m.amount, "milestone amount");
      if (p.milestones[m.id]) fail("Duplicate milestone");
      total += m.amount;
      if (!Number.isSafeInteger(total)) fail("Milestone sum overflow");
      p.milestones[m.id] = { id: m.id, title: m.title, amount: m.amount, attestations: {}, paid: false };
    }
    if (total !== payload.amount) fail("Milestones do not sum to contract amount");
    p.contract = { contractor: payload.contractor, amount: payload.amount, sha256: payload.contract_sha256 };
  } else if (type === "milestone_attested") {
    keys(payload, ["ocid", "milestone", "evidence_sha256"], type);
    const p = project(state, payload.ocid);
    const m = p.milestones[payload.milestone];
    if (!p.contract || !m || m.paid) fail("Milestone cannot be attested");
    digest(payload.evidence_sha256, "evidence_sha256");
    if (m.attestations[actor]) fail("Duplicate inspection");
    m.attestations[actor] = payload.evidence_sha256;
  } else if (type === "payment_recorded") {
    keys(payload, ["ocid", "milestone", "amount", "payee", "transaction_id", "receipt_sha256"], type);
    const p = project(state, payload.ocid);
    const m = p.milestones[payload.milestone];
    if (!p.contract || !m || m.paid) fail("Milestone cannot be paid");
    if (Object.keys(m.attestations).length < 2) fail("Two independent inspections required");
    integer(payload.amount, "payment amount");
    if (payload.amount !== m.amount || payload.payee !== p.contract.contractor) fail("Payment differs from contract");
    string(payload.transaction_id, "transaction_id", 100);
    digest(payload.receipt_sha256, "receipt_sha256");
    if (state.transactionIds.has(payload.transaction_id)) fail("Duplicate transaction_id");
    state.transactionIds.add(payload.transaction_id);
    m.paid = true;
    p.paid += payload.amount;
    if (p.paid > p.contract.amount || p.paid > p.budget) fail("Overspend");
  } else if (type === "wage_batch_committed") {
    keys(payload, ["ocid", "milestone", "worker_count", "total", "proof_sha256"], type);
    const p = project(state, payload.ocid);
    const m = p.milestones[payload.milestone];
    if (!p.contract || actor !== p.contract.contractor || !m?.paid || p.wageBatches[payload.milestone]) fail("Wage batch cannot be recorded");
    integer(payload.worker_count, "worker_count");
    integer(payload.total, "wage total");
    if (payload.total > m.amount) fail("Wage batch exceeds paid milestone");
    digest(payload.proof_sha256, "proof_sha256");
    p.wageBatches[payload.milestone] = { worker_count: payload.worker_count, total: payload.total, proof_sha256: payload.proof_sha256 };
  } else if (type === "audit_finding_opened") {
    keys(payload, ["ocid", "finding_id", "summary", "evidence_sha256"], type);
    project(state, payload.ocid);
    string(payload.finding_id, "finding_id", 80);
    string(payload.summary, "summary", 300);
    digest(payload.evidence_sha256, "evidence_sha256");
    if (state.findingIds.has(payload.finding_id)) fail("Duplicate audit finding");
    state.findingIds.add(payload.finding_id);
    state.findings.push({ ...payload, auditor: actor });
  }
}

export function verifyLedger(bundle) {
  keys(bundle, ["schema", "currency", "actors", "events"], "bundle");
  if (bundle.schema !== "pnb-pilot-v1" || bundle.currency !== "TEST") fail("Unsupported pilot schema or currency");
  object(bundle.actors, "actors");
  if (!Array.isArray(bundle.events)) fail("events must be an array");
  for (const [id, actor] of Object.entries(bundle.actors)) {
    string(id, "actor id", 100);
    keys(actor, ["role", "publicKey"], "actor");
    if (!Object.values(ROLES).includes(actor.role)) fail("Unknown actor role");
    string(actor.publicKey, "publicKey", 500);
  }
  const publicKeys = new Set();
  for (const actor of Object.values(bundle.actors)) {
    if (publicKeys.has(actor.publicKey)) fail("Two actors cannot share one public key");
    publicKeys.add(actor.publicKey);
  }
  const state = { projects: Object.create(null), transactionIds: new Set(), findingIds: new Set(), findings: [] };
  let previous = ZERO;
  for (const [index, event] of bundle.events.entries()) {
    keys(event, ["sequence", "previous", "type", "actor", "payload", "signature", "hash"], "event");
    if (event.sequence !== index || event.previous !== previous) fail(`Broken chain at event ${index}`);
    string(event.actor, "event actor", 100);
    if (!bundle.actors[event.actor]) fail("Unregistered actor");
    const unsigned = { sequence: event.sequence, previous: event.previous, type: event.type, actor: event.actor, payload: event.payload };
    let accepted = false;
    try {
      accepted = verify(null, Buffer.from("pnb-pilot-v1\0" + canonical(unsigned)), bundle.actors[event.actor].publicKey, Buffer.from(event.signature, "hex"));
    } catch { /* malformed key or signature */ }
    if (!accepted) fail(`Invalid signature at event ${index}`);
    if (sha256(canonical({ ...unsigned, signature: event.signature })) !== event.hash) fail(`Invalid hash at event ${index}`);
    apply(state, event, bundle.actors);
    previous = event.hash;
  }
  const projects = Object.values(state.projects).map((p) => ({
    ocid: p.ocid, title: p.title, budget: p.budget, tenderPublished: !!p.tender,
    contract: p.contract, paid: p.paid, remaining: p.budget - p.paid,
    milestones: Object.values(p.milestones).map((m) => ({
      id: m.id, title: m.title, amount: m.amount,
      inspectionCount: Object.keys(m.attestations).length, paid: m.paid,
      wageBatch: p.wageBatches[m.id] ?? null,
    })),
  }));
  return {
    eventCount: bundle.events.length, head: previous,
    trustRoot: sha256(canonical({ schema: bundle.schema, currency: bundle.currency, actors: bundle.actors })),
    projects, findings: state.findings,
  };
}

export function appendSigned(bundle, actor, privateKey, type, payload) {
  verifyLedger(bundle);
  if (!bundle.actors[actor]) fail("Unregistered actor");
  const unsigned = {
    sequence: bundle.events.length, previous: bundle.events.at(-1)?.hash ?? ZERO,
    type, actor, payload,
  };
  const signature = sign(null, Buffer.from("pnb-pilot-v1\0" + canonical(unsigned)), privateKey).toString("hex");
  const event = { ...unsigned, signature, hash: sha256(canonical({ ...unsigned, signature })) };
  const next = { ...bundle, events: [...bundle.events, event] };
  verifyLedger(next);
  return next;
}
