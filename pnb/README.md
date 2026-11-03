# 人民核彈（PNB）：公共財政透明試點

這是從作者的 `PNB.txt` 落地的第一個**可運行、無價值合成資料試點**。示範一項民生採購從預算到付款的公開追蹤：預算授權 → 招標 → 決標／契約 → 兩個不同簽章者驗收 → 付款紀錄 → 薪資批次承諾 → 獨立稽核待查事項。每個事件都有 Ed25519 簽章、前筆雜湊與本筆雜湊；下載 JSON 後可用另一個程序重播核驗。

願景輸入檔的 SHA-256：`503f84480308215719f2223ff110cfae9d25f9179bac33b62cd4747f57cde1d4`。該原檔未加入倉庫；此試點是依其公共財政段落建立的可測實驗，並非把文中的所有制度設想宣稱已實現。

## 立即運行

在倉庫根目錄執行：

```powershell
node --test pnb/test.mjs
node pnb/server.mjs
```

開啟 <http://127.0.0.1:8788/>。頁面提供公開事件 JSON 下載。可在另一個終端產生並驗證自己的合成資料：

```powershell
node pnb/cli.mjs verify pnb/sample-ledger.json
node pnb/cli.mjs demo pnb-demo.json
node pnb/cli.mjs verify pnb-demo.json
```

## 多節點可運行版本

需要 Node.js 20 以上。以下命令在倉庫根目錄執行；資料與私鑰放在不同目錄，`.gitignore` 排除示範資料目錄與 `*.private.pem`。不要把私鑰複製到公開倉庫。

```powershell
node --test pnb/test.mjs pnb/peer.test.mjs
node pnb/node.mjs bootstrap node-data node-keys
node pnb/node.mjs populate-demo node-data node-keys
node pnb/node.mjs inspect node-data
node pnb/node.mjs serve node-data 8791
```

`bootstrap` 建立七個不同的 Ed25519 角色金鑰與空白發布帳本；`populate-demo` 用這些金鑰逐筆追加八個合成事件，可重跑而不重複事件。`serve` 持續從磁碟讀取並核驗帳本，提供只讀頁面、`/api/ledger`、`/api/summary` 與 `/api/checkpoint`。用另一個終端開啟 <http://127.0.0.1:8791/>。

在另一個終端建立鏡像節點。下列取檢查點方式只供本機示範；實際部署應從獨立渠道取得並保存信任根、事件數和鏈頭，避免首次同步時被替換。

```powershell
$checkpoint = node pnb/node.mjs inspect node-data | ConvertFrom-Json
node pnb/node.mjs mirror mirror-data $checkpoint.trustRoot $checkpoint.eventCount $checkpoint.head
node pnb/node.mjs sync mirror-data http://127.0.0.1:8791/
node pnb/node.mjs inspect mirror-data
node pnb/node.mjs serve mirror-data 8792
```

鏡像頁面在 <http://127.0.0.1:8792/>。它只接受同一信任根、包含已固定檢查點且完整延伸本地鏈的資料；回退、分叉、壞簽章與替換角色表會被拒絕。其他鏡像也能從此鏡像同步。若需持續同步，可執行 `node pnb/node.mjs follow mirror-data 10 http://127.0.0.1:8791/`；也可提供多個節點 URL，依序核對。

追加一筆新的合成稽核事件後，再同步鏡像：

```powershell
node pnb/node.mjs append node-data independent_auditor node-keys/independent_auditor.private.pem audit_finding_opened pnb/examples/second-audit-finding.json
node pnb/node.mjs sync mirror-data http://127.0.0.1:8791/
```

`keygen` 和 `init` 命令也允許不同持有人分別生成金鑰，再用公開金鑰組成 `actors.json`；正式部署時各角色應自行保管私鑰。公開帳本內只有公鑰與簽章，沒有私鑰。單一發布者仍可拒絕新事件；多鏡像保留已見歷史，但本版本沒有分散式共識、抗女巫攻擊、法定身分認證或自動支付。若獨立鏡像從未見過某段歷史，必須靠獨立取得的檢查點防範發布者提供另一條有效簽章分叉。

## TEST 交易與條件式鎖定

`node pnb/app.mjs` 可一個命令建立並啟動本機 TEST 發布節點；以 `--home` 指定資料目錄、`--port` 指定埠。重啟會沿用既有資料。其資料和示範私鑰預設放在 `pnb-workspace/`；勿把該目錄上傳。鏡像可用同一入口：

```powershell
$checkpoint = node pnb/node.mjs inspect pnb-workspace/publisher | ConvertFrom-Json
node pnb/app.mjs --home pnb-workspace/mirror-home --mirror http://127.0.0.1:8800/ $checkpoint.trustRoot $checkpoint.eventCount $checkpoint.head --port 8801
```

鏡像每 10 秒檢查並接受完整延伸。上述從發布端讀檢查點僅為本機示範；部署在不同機器時，應獨立比對並保存。

在另一個終端，輸入合約檔與整數 TEST 金額即可建立**模擬**轉帳。付款者私鑰本機簽章，接收者餘額由所有節點重播得出；同一簽章不能當成新事件重放。

```powershell
node pnb/node.mjs test-credit pnb-workspace/publisher budget_office pnb-workspace/keys/budget_office.private.pem budget_office 1000
node pnb/node.mjs test-pay pnb-workspace/publisher budget_office pnb-workspace/keys/budget_office.private.pem builder 125 pnb/examples/test-contract.txt
```

`test-credit` 由預算角色發行，整條帳本累計上限 1,000,000 TEST。這是示範權限而非無主貨幣。`test-pay` 的合約檔只取 SHA-256 放進交易，不能證明雙方理解或履行文字；不提供合約檔時使用明確的「無合約」承諾。

亦可執行 `node pnb/trade.mjs` 使用本機互動入口，或在 Windows 可攜版執行 `Start-TEST-Trade.cmd`。輸入 `credit` 發行合成額度後，再輸入 `pay` 轉帳；介面會顯示合約雜湊並要求 `YES` 確認。這只使用本機 TEST 私鑰，不會發送 Ethereum 交易。

條件式鎖定需先在本機準備密語檔，付款者輸入合約檔與金額；收款者得知密語後以自己的私鑰領取。領取事件會公開密語，請**只用無價值的示範密語**。密語錯誤或未授權者無法領取；取消需付款者提出、收款者另行簽署同意。這是雜湊鎖定示範，不會判定真實工程或商品是否履約。

```powershell
Set-Content -LiteralPath pnb-workspace/demo.secret -Value 'demo-release-phrase' -Encoding utf8
node pnb/node.mjs test-lock pnb-workspace/publisher budget_office pnb-workspace/keys/budget_office.private.pem builder 200 pnb/examples/test-contract.txt pnb-workspace/demo.secret
# 從前一命令的輸出複製 escrow_id，再由收款者執行：
$escrowId = '貼上 escrow_id'
node pnb/node.mjs test-claim pnb-workspace/publisher builder pnb-workspace/keys/builder.private.pem $escrowId pnb-workspace/demo.secret
```

目前 TEST 金額只代表帳本內部狀態。另有 `/evm` 頁面可透過 EIP-1193 錢包預覽並發送 Sepolia 原生**測試 ETH** 轉帳；它與 TEST 帳本無連動，也不是合約託管。網頁只接受 Sepolia 鏈 ID、非零收款地址、每筆最多 1 測試 ETH；送出前由錢包再次確認。自動測試只使用模擬錢包，尚未完成真實 Sepolia 交易驗收。沒有 Ethereum 主網資產、法幣兌換或銀行清算。這些要依 [交付計畫](../PLAN.md)分段驗收，不能把頁面上的「付款紀錄」視為真實入帳。

網頁使用已存放的 `sample-ledger.json`，啟動前會先驗證；下載檔應與它一致。`demo` 輸出的角色註冊表 SHA-256 應由不同保管者另行保存；獨立核驗時將它作為 `verify` 的第三個參數，才能發現整份角色註冊表被替換。第二次產生資料會得到新密鑰與新信任根；示範私鑰只留在當次程序記憶體，退出後即不能再新增事件。

## 公開資料與邊界

- `currency: TEST` 是無價值的本機帳本測試單位；本機帳本沒有銀行或公款介接，也不會自動付款。Sepolia 錢包頁只轉移測試幣，與本機帳本分離。
- `authorization_sha256`、`contract_sha256`、`receipt_sha256` 等是文件承諾。示範值來自合成文字，**不是**真實文件；核驗者仍需取得文件原件並核對雜湊。
- 薪資只公開人數、合計與證明文件承諾，不放工人姓名、地址、錢包或個人薪資。這也**不證明**個別工人已工作或已收款。實際稽核需依法取得必要資料、現場訪查與申訴。
- 不同簽章金鑰只能證明由不同登記金鑰簽署；目前沒有法定身分、職權、利益衝突或機構獨立性認證。
- 單一本機服務可以下線、隱藏或從頭重寫它控制的資料。本試點不是區塊鏈、共識網路，也未實現「掌權者無法單方面取消」；那需要法定公開義務、多個獨立保管者與可供社會保存的定期檢查點。

## 從試點走向制度

1. **資料與授權**：由合法資料主管機關確認應公開欄位、保密範圍、訂正責任和申訴入口；取得真實資料發布權限。
2. **標準對接**：把流程 ID 和預算、招標、決標、契約、履約、付款欄位映射到 [Open Contracting Data Standard](https://standard.open-contracting.org/latest/en/primer/how/)；本試點的 JSON 尚非完整 OCDS 格式。
3. **獨立保管**：讓審計機構、媒體／公民團體等獨立保管公開快照及信任根，定期比對；明定金鑰輪替、違規撤銷與錯誤更正程序。
4. **實體核查**：採購文件、銀行付款、現場工程與工人薪資由不同渠道比對；留下更正、異議、稽核和追責紀錄。數位簽章不能替代實地查核。
5. **擴充治理**：先在自願共同體模擬成員加入／退出與共同成本，再研究跨社會法律衝突、基本權利與共同防衛監督；不以本試點假裝完成憲政改革。
6. **AI 與共同資產**：先釐清資料權利、收益來源、民主授權和可停止性，再設計任何代幣或自動資源分配；不以發幣當作財富創造。

個人證明的長期方案可參考 [W3C Verifiable Credentials Data Model 2.0 的隱私章節](https://www.w3.org/TR/vc-data-model/#privacy-considerations)，尤其是最小揭露與再識別風險。本試點尚未實作可驗證憑證或零知識證明。
