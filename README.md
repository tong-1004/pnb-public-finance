# PNB 公共財政透明試點

這是「人民核彈」制度願景的第一階段可運行示範，採用合成採購與無價值 `TEST` 單位；不涉及真實公款或政府資料。

詳細操作與限制請見 [試點說明](pnb/README.md)。

```powershell
node --test pnb/test.mjs
node pnb/server.mjs
```

接著在本機開啟 <http://127.0.0.1:8788/>。公開樣本可用 `node pnb/cli.mjs verify pnb/sample-ledger.json` 獨立核對。
