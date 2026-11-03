import assert from "node:assert/strict";
import test from "node:test";
import { parseEthToWei, prepareSepoliaTransfer, sendSepoliaTransfer } from "./evm.mjs";

const from = `0x${"1".repeat(40)}`;
const to = `0x${"2".repeat(40)}`;
const txHash = `0x${"a".repeat(64)}`;
function wallet() {
  const state = { chain: "0xaa36a7", account: from, sent: [] };
  return {
    state,
    async request({ method, params }) {
      if (method === "eth_chainId") return state.chain;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [state.account];
      if (method === "eth_sendTransaction") { state.sent.push(params[0]); return txHash; }
      throw new Error(`Unexpected method ${method}`);
    },
  };
}

test("strict Sepolia amount and address validation", async () => {
  assert.equal(parseEthToWei("0.000000000000000001"), 1n);
  assert.equal(parseEthToWei("1"), 10n ** 18n);
  for (const amount of ["0", "1.000000000000000001", "2", "1e-3", "-1", "0.1abc", "0.0000000000000000001"]) {
    assert.throws(() => parseEthToWei(amount));
  }
  await assert.rejects(prepareSepoliaTransfer(wallet(), `0x${"0".repeat(40)}`, "0.1"));
  await assert.rejects(prepareSepoliaTransfer(wallet(), from, "0.1"));
});

test("wallet signs only a previewed Sepolia transfer with unchanged chain and account", async () => {
  const w = wallet();
  const tx = await prepareSepoliaTransfer(w, to, "0.125");
  assert.deepEqual(tx, { from, to, value: "0x1bc16d674ec8000" });
  w.state.chain = "0x1";
  await assert.rejects(sendSepoliaTransfer(w, tx), /network changed/);
  assert.equal(w.state.sent.length, 0);
  w.state.chain = "0xaa36a7";
  w.state.account = to;
  await assert.rejects(sendSepoliaTransfer(w, tx), /account changed/);
  assert.equal(w.state.sent.length, 0);
  w.state.account = from;
  assert.equal(await sendSepoliaTransfer(w, tx), txHash);
  assert.deepEqual(w.state.sent, [tx]);
  await assert.rejects(sendSepoliaTransfer(w, { from, to, value: "0x2" + "0".repeat(18) }), /Invalid Sepolia/);
});
