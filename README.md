# PNB 公共財政透明試點

這是「人民核彈」制度願景的第一階段可運行示範，採用合成採購與無價值 `TEST` 單位；不涉及真實公款或政府資料。

詳細操作與限制請見 [試點說明](pnb/README.md)。
[分階段交付與驗收計畫](PLAN.md)列出下一步及尚未完成的項目。

## Windows 可攜版與 Sepolia 測試網

從[公開測試版](https://github.com/tong-1004/pnb-public-finance/releases/tag/v0.3.2-test)下載 Windows ZIP 與 `SHA256SUMS.txt`，核對雜湊後解壓並執行 `Start-PNB.cmd`。也可從公開原始碼執行 `powershell -ExecutionPolicy Bypass -File packaging/build-windows.ps1` 自行建包；腳本會下載官方 Node.js 執行環境並核對 SHA-256。啟動器會用隨附的 Node.js 啟動一個本機節點，資料預設存於使用者的 `%LOCALAPPDATA%\PNB-Pilot`，不會寫進解壓目錄。啟動後開啟 <http://127.0.0.1:8800/>；需要自備瀏覽器錢包時可到 <http://127.0.0.1:8800/evm> 預覽並由錢包確認 **Sepolia 測試 ETH** 轉帳。每筆限 1 測試 ETH。錢包、測試 ETH 與網路費用需自行準備；此頁沒有合約託管，也不能處理主網有價資產。

原始碼可用 `node --test pnb/test.mjs pnb/peer.test.mjs pnb/settlement.test.mjs pnb/evm.test.mjs` 驗證。目前只有模擬錢包測試，尚未完成實際 Sepolia 鏈上交易驗收。

## 一個命令啟動本機 TEST 節點

需要 Node.js 20 以上，在倉庫根目錄執行：

```powershell
node pnb/app.mjs
```

首次啟動會在忽略版本控制的 `pnb-workspace/` 產生合成資料與示範金鑰，並開啟 <http://127.0.0.1:8800/>；重啟會沿用原帳本。這是一個程序啟動**一個節點**。若要分散保管，其他參與者需在各自電腦執行同一程式的鏡像模式，並由獨立渠道取得檢查點。

TEST 交易可用已登記角色金鑰操作。例如在另一個終端執行：

```powershell
node pnb/node.mjs test-credit pnb-workspace/publisher budget_office pnb-workspace/keys/budget_office.private.pem budget_office 1000
node pnb/node.mjs test-pay pnb-workspace/publisher budget_office pnb-workspace/keys/budget_office.private.pem builder 125 pnb/examples/test-contract.txt
```

`test-credit` 是有 1,000,000 TEST 硬上限的合成額度發行；`test-pay` 是簽章後的帳內 TEST 轉移。兩者都不會轉移真實資產。

Windows 可攜版可另外執行 `Start-TEST-Trade.cmd`。它會詢問發行／轉帳、簽章者、收款者、金額與可選的合約檔，顯示預覽，只有輸入 `YES` 才使用本機 TEST 私鑰簽章。先以 `credit` 發行合成額度，再用 `pay` 轉帳。原始碼版可執行 `node pnb/trade.mjs`。此入口只操作本機 TEST 帳本。

## 多節點示範

Node.js 20 以上，在倉庫根目錄執行：

```powershell
node --test pnb/test.mjs pnb/peer.test.mjs
node pnb/node.mjs bootstrap node-data node-keys
node pnb/node.mjs populate-demo node-data node-keys
node pnb/node.mjs inspect node-data
node pnb/node.mjs serve node-data 8791
```

在另一個終端，以 `inspect` 輸出的檢查點建立獨立鏡像，然後同步。正式使用時，檢查點須從發布節點以外的可信渠道取得：

```powershell
$checkpoint = node pnb/node.mjs inspect node-data | ConvertFrom-Json
node pnb/node.mjs mirror mirror-data $checkpoint.trustRoot $checkpoint.eventCount $checkpoint.head
node pnb/node.mjs sync mirror-data http://127.0.0.1:8791/
node pnb/node.mjs serve mirror-data 8792
```

這是具備獨立副本、簽章驗證與分叉偵測的試點，尚無共識協議、法定身分認證或真正的抗審查網路。

## 固定樣本快速檢視

```powershell
node --test pnb/test.mjs
node pnb/server.mjs
```

接著在本機開啟 <http://127.0.0.1:8788/>。公開樣本可用 `node pnb/cli.mjs verify pnb/sample-ledger.json` 獨立核對。
