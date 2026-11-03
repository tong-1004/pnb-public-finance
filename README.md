# PNB 公共財政透明試點

這是「人民核彈」制度願景的第一階段可運行示範，採用合成採購與無價值 `TEST` 單位；不涉及真實公款或政府資料。

詳細操作與限制請見 [試點說明](pnb/README.md)。

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
