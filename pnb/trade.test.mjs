import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { sha256 } from "./ledger.mjs";
import { bootstrapSynthetic, populateSynthetic, readVerified } from "./peer.mjs";
import { runTestTrade } from "./trade.mjs";

test("interactive TEST preview requires explicit confirmation and preserves contract hash", async () => {
  const home = mkdtempSync(join(tmpdir(), "pnb-trade-test-"));
  try {
    bootstrapSynthetic(join(home, "publisher"), join(home, "keys"));
    populateSynthetic(join(home, "publisher"), join(home, "keys"));
    const ask = (answers) => async () => answers.shift();
    await runTestTrade(home, ask(["credit", "budget_office", "budget_office", "500", "YES"]), () => {});
    const contractPath = join(home, "contract.txt");
    writeFileSync(contractPath, "Synthetic work order\n");
    const before = readVerified(join(home, "publisher")).summary.head;
    const cancelled = await runTestTrade(home, ask(["pay", "budget_office", "builder", "125", contractPath, "NO"]), () => {});
    assert.equal(cancelled, null);
    assert.equal(readVerified(join(home, "publisher")).summary.head, before);
    await runTestTrade(home, ask(["pay", "budget_office", "builder", "125", contractPath, "YES"]), () => {});
    const { bundle, summary } = readVerified(join(home, "publisher"));
    assert.equal(summary.eventCount, 10);
    assert.equal(summary.testBalances.budget_office, 375);
    assert.equal(summary.testBalances.builder, 125);
    assert.equal(bundle.events.at(-1).payload.contract_sha256, sha256(readFileSync(contractPath)));
  } finally {
    const resolved = resolve(home);
    if (!resolved.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup path");
    rmSync(resolved, { recursive: true, force: true });
  }
});
