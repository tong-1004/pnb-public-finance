import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sha256 } from "./ledger.mjs";
import { appendToPublisher } from "./peer.mjs";

const app = fileURLToPath(new URL("./app.mjs", import.meta.url));

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}

function launch(args, marker) {
  const child = spawn(process.execPath, [app, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  return new Promise((ok, fail) => {
    const timeout = setTimeout(() => { child.kill(); fail(new Error(`Node startup timed out: ${output}`)); }, 8000);
    const onOutput = (data) => {
      output += data.toString();
      if (output.includes(marker)) { clearTimeout(timeout); ok(child); }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("error", (error) => { clearTimeout(timeout); fail(error); });
    child.once("exit", (code) => { clearTimeout(timeout); if (!output.includes(marker)) fail(new Error(`Node exited ${code}: ${output}`)); });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((ok) => { child.once("exit", ok); child.kill(); });
}

async function summary(url) {
  const response = await fetch(new URL("api/summary", url));
  assert.equal(response.status, 200);
  return response.json();
}

test("separate publisher and mirror processes survive an offline restart", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "pnb-process-test-"));
  const publisherHome = join(root, "publisher-home");
  const mirrorHome = join(root, "mirror-home");
  const port = await freePort();
  const mirrorPort = await freePort();
  const publisherUrl = `http://127.0.0.1:${port}/`;
  const mirrorUrl = `http://127.0.0.1:${mirrorPort}/`;
  let publisher;
  let mirror;
  try {
    publisher = await launch(["--home", publisherHome, "--port", String(port)], "發布介面：");
    const anchor = await (await fetch(new URL("api/checkpoint", publisherUrl))).json();
    mirror = await launch([
      "--home", mirrorHome, "--mirror", publisherUrl,
      anchor.trustRoot, String(anchor.eventCount), anchor.head,
      "--port", String(mirrorPort), "--poll-seconds", "2",
    ], "鏡像介面：");
    const initial = await summary(publisherUrl);
    assert.equal(initial.eventCount, 8);
    assert.equal((await summary(mirrorUrl)).head, initial.head);
    await stop(publisher);
    publisher = null;
    assert.equal((await summary(mirrorUrl)).head, initial.head);
    publisher = await launch(["--home", publisherHome, "--port", String(port)], "發布介面：");
    assert.equal((await summary(publisherUrl)).head, initial.head);
    const issueId = "TEST-ISSUE-OFFLINE-RECOVERY";
    const latest = appendToPublisher(join(publisherHome, "publisher"), "budget_office", join(publisherHome, "keys", "budget_office.private.pem"), "test_credit_issued", {
      issuance_id: issueId, to: "budget_office", amount: 25, authorization_sha256: sha256(`SYNTHETIC ISSUE ${issueId}`),
    });
    assert.equal(latest.eventCount, 9);
    const deadline = Date.now() + 12000;
    let mirrored;
    while (Date.now() < deadline) {
      mirrored = await summary(mirrorUrl);
      if (mirrored.head === latest.head) break;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    assert.equal(mirrored.head, latest.head);
    assert.equal(mirrored.eventCount, latest.eventCount);
  } finally {
    await stop(publisher);
    await stop(mirror);
    const resolved = resolve(root);
    if (!resolved.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe test cleanup path");
    rmSync(resolved, { recursive: true, force: true });
  }
});
