import { readFileSync, writeFileSync } from "node:fs";
import { makeDemo } from "./demo.mjs";
import { verifyLedger } from "./ledger.mjs";

const [command, file] = process.argv.slice(2);
if (command === "demo") {
  const bundle = makeDemo();
  const output = JSON.stringify(bundle, null, 2) + "\n";
  if (file) {
    writeFileSync(file, output, { flag: "wx" });
    console.log(`已建立合成資料：${file}`);
    console.log(`角色註冊表 SHA-256：${verifyLedger(bundle).trustRoot}`);
  } else {
    process.stdout.write(output);
  }
} else if (command === "verify" && file) {
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  const result = verifyLedger(bundle);
  const expectedRoot = process.argv[4];
  if (expectedRoot && result.trustRoot !== expectedRoot) throw new Error("角色註冊表與獨立保存的信任根不符");
  console.log(JSON.stringify({ valid: true, eventCount: result.eventCount, head: result.head, trustRoot: result.trustRoot, projects: result.projects.length }, null, 2));
} else {
  console.error("用法：node pnb/cli.mjs demo [輸出.json] | node pnb/cli.mjs verify 輸入.json [預期信任根]");
  process.exitCode = 2;
}
