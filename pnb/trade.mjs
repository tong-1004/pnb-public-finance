import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "./ledger.mjs";
import { appendToPublisher, readVerified } from "./peer.mjs";

const SAFE_ACTOR = /^[A-Za-z0-9_-]{1,100}$/;
function positiveTestAmount(raw) {
  if (!/^[1-9]\d*$/.test(raw)) throw new Error("TEST 金額必須是正整數");
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount)) throw new Error("TEST 金額過大");
  return amount;
}

export async function runTestTrade(home, ask, report = console.log) {
  const publisher = join(home, "publisher");
  const keyDir = join(home, "keys");
  const { bundle, summary } = readVerified(publisher);
  report("PNB 無價值 TEST 操作；本程式不轉移鏈上或銀行資產。");
  const action = (await ask("操作（credit 發行／pay 轉帳）：")).trim();
  if (!["credit", "pay"].includes(action)) throw new Error("只支援 credit 或 pay");
  const actor = (await ask("簽章者代號：")).trim();
  if (!SAFE_ACTOR.test(actor) || !Object.hasOwn(bundle.actors, actor)) throw new Error("未知或不安全的簽章者代號");
  if (action === "credit" && bundle.actors[actor].role !== "budget") throw new Error("只有預算角色可發行 TEST 額度");
  const to = (await ask("收款者代號：")).trim();
  if (!SAFE_ACTOR.test(to) || !Object.hasOwn(bundle.actors, to)) throw new Error("未知或不安全的收款者代號");
  if (action === "pay" && actor === to) throw new Error("不能轉給自己");
  const amount = positiveTestAmount((await ask("TEST 金額（正整數）：")).trim());
  let contract_sha256;
  if (action === "pay") {
    const contractPath = (await ask("合約檔路徑（可留空，明示無合約）：")).trim();
    if (contractPath) {
      const fullPath = resolve(contractPath);
      if (statSync(fullPath).size > 1_000_000) throw new Error("合約檔不得超過 1 MB");
      contract_sha256 = sha256(readFileSync(fullPath));
    } else {
      contract_sha256 = sha256("NO CONTRACT: TEST TRANSFER");
    }
    if ((summary.testBalances[actor] ?? 0) < amount) throw new Error("TEST 餘額不足");
  } else if (summary.testIssuedTotal + amount > 1_000_000) {
    throw new Error("超過 TEST 發行上限");
  }
  report(`預覽：${action === "pay" ? "轉帳" : "發行"} ${actor} → ${to}，${amount} TEST；目前簽章者餘額 ${summary.testBalances[actor] ?? 0} TEST；合約 SHA-256 ${contract_sha256 ?? "不適用"}。`);
  if ((await ask("確認請輸入 YES：")).trim() !== "YES") { report("已取消，帳本未變更。"); return null; }
  const key = join(keyDir, `${actor}.private.pem`);
  const id = randomUUID();
  const type = action === "pay" ? "test_transfer" : "test_credit_issued";
  const payload = action === "pay"
    ? { transfer_id: `TEST-TRANSFER-${id}`, to, amount, contract_sha256, nonce: (summary.testNonces[actor] ?? 0) + 1 }
    : { issuance_id: `TEST-ISSUE-${id}`, to, amount, authorization_sha256: sha256(`SYNTHETIC ISSUE TEST-ISSUE-${id}`) };
  const result = appendToPublisher(publisher, actor, key, type, payload);
  report(`已記錄：事件 ${result.eventCount} 筆；鏈頭 ${result.head}；${to} 餘額 ${result.testBalances[to] ?? 0} TEST。`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--home");
  const home = resolve(at >= 0 ? args[at + 1] : process.env.PNB_HOME ?? "pnb-workspace");
  const io = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const answers = io[Symbol.asyncIterator]();
  const ask = async (question) => {
    process.stdout.write(question);
    const { value, done } = await answers.next();
    if (done) throw new Error("輸入已結束");
    return value;
  };
  try { await runTestTrade(home, ask); }
  catch (error) { console.error(`PNB TEST 操作失敗：${error.message}`); process.exitCode = 1; }
  finally { io.close(); }
}
