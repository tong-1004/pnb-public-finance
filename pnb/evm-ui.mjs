import { prepareSepoliaTransfer, sendSepoliaTransfer } from "./evm.mjs";

const $ = (id) => document.getElementById(id);
let prepared = null;
let busy = false;
const provider = window.ethereum;
function status(message) { $("status").textContent = message; }
function clearPreview() { prepared = null; $("details").replaceChildren(); $("send").disabled = true; }
function setBusy(value) { busy = value; $("connect").disabled = value; $("preview").disabled = value; $("send").disabled = value || !prepared; }
function showWallet(account) { $("wallet").textContent = account ? `目前錢包：${account}` : "尚未連接"; }

$("connect").addEventListener("click", async () => {
  if (busy) return;
  clearPreview();
  if (!provider?.request) { status("此瀏覽器沒有 EIP-1193 錢包。請使用有錢包擴充功能的瀏覽器。"); return; }
  setBusy(true);
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    showWallet(accounts?.[0]);
    status("已連接。請在錢包選擇 Sepolia 測試網。" );
  } catch (error) { status(`連接失敗：${error.message}`); }
  finally { setBusy(false); }
});

for (const id of ["recipient", "amount"]) $(id).addEventListener("input", clearPreview);
provider?.on?.("accountsChanged", (accounts) => { clearPreview(); showWallet(accounts?.[0]); status("錢包帳戶已變更，請重新預覽。" ); });
provider?.on?.("chainChanged", () => { clearPreview(); status("錢包網路已變更，請重新預覽。" ); });

$("preview").addEventListener("click", async () => {
  if (busy) return;
  clearPreview(); setBusy(true);
  try {
    const tx = await prepareSepoliaTransfer(provider, $("recipient").value.trim(), $("amount").value.trim());
    const details = $("details");
    for (const line of ["網路：Sepolia（11155111）", "資產：測試 ETH", `付款者：${tx.from}`, `收款者：${tx.to}`, `金額：${$("amount").value.trim()} 測試 ETH`, "網路費用：由錢包估算並顯示；此頁不會自動送出"]) {
      const p = document.createElement("p"); p.textContent = line; details.append(p);
    }
    prepared = tx; showWallet(tx.from); status("請核對收款地址、金額及錢包顯示的網路費用。" );
  } catch (error) { status(`無法預覽：${error.message}`); }
  finally { setBusy(false); }
});

$("send").addEventListener("click", async () => {
  if (busy || !prepared) return;
  const tx = prepared; clearPreview(); setBusy(true);
  try {
    const hash = await sendSepoliaTransfer(provider, tx);
    status(`錢包已提交交易 ${hash}。請自行在 Sepolia 區塊瀏覽器核對確認與結果；提交不代表交易成功。`);
  } catch (error) { status(`未送出或錢包拒絕：${error.message}`); }
  finally { setBusy(false); }
});
