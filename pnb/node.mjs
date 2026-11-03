import { readFileSync } from "node:fs";
import { appendToPublisher, bootstrapSynthetic, initMirror, initPublisher, keygen, populateSynthetic, readVerified, startPeerServer, syncFromPeer } from "./peer.mjs";

const [command, ...args] = process.argv.slice(2);
const usage = `用法：
  node pnb/node.mjs keygen 私鑰.pem 公鑰.pem
  node pnb/node.mjs init 發布目錄 actors.json
  node pnb/node.mjs bootstrap 發布目錄 私鑰目錄
  node pnb/node.mjs populate-demo 發布目錄 私鑰目錄
  node pnb/node.mjs mirror 鏡像目錄 已獨立取得的信任根 事件數 鏈頭
  node pnb/node.mjs append 發布目錄 actor 私鑰.pem 事件類型 payload.json
  node pnb/node.mjs sync 鏡像目錄 http://節點:埠/
  node pnb/node.mjs follow 鏡像目錄 輪詢秒數 http://節點一/ [http://節點二/ ...]
  node pnb/node.mjs inspect 節點目錄
  node pnb/node.mjs serve 節點目錄 [埠] [綁定位置]`;

try {
  if (command === "keygen" && args.length === 2) {
    keygen(args[0], args[1]);
    console.log(`公鑰已建立：${args[1]}；私鑰只保存在指定的本機路徑`);
  } else if (command === "init" && args.length === 2) {
    const summary = initPublisher(args[0], JSON.parse(readFileSync(args[1], "utf8")));
    console.log(`發布節點已建立；信任根：${summary.trustRoot}`);
  } else if (command === "bootstrap" && args.length === 2) {
    const summary = bootstrapSynthetic(args[0], args[1]);
    console.log(`合成發布節點已建立；信任根：${summary.trustRoot}；私鑰目錄：${args[1]}`);
  } else if (command === "populate-demo" && args.length === 2) {
    const summary = populateSynthetic(args[0], args[1]);
    console.log(`合成流程已建立；${summary.eventCount} 筆事件，鏈頭 ${summary.head}`);
  } else if (command === "mirror" && args.length === 4) {
    initMirror(args[0], args[1], Number(args[2]), args[3]);
    console.log(`鏡像節點已固定檢查點：${args[2]} 筆，鏈頭 ${args[3]}`);
  } else if (command === "append" && args.length === 5) {
    const summary = appendToPublisher(args[0], args[1], args[2], args[3], JSON.parse(readFileSync(args[4], "utf8")));
    console.log(JSON.stringify({ eventCount: summary.eventCount, head: summary.head, trustRoot: summary.trustRoot }));
  } else if (command === "sync" && args.length === 2) {
    const summary = await syncFromPeer(args[0], args[1]);
    console.log(JSON.stringify({ eventCount: summary.eventCount, head: summary.head, trustRoot: summary.trustRoot }));
  } else if (command === "follow" && args.length >= 3) {
    const seconds = Number(args[1]);
    if (!Number.isSafeInteger(seconds) || seconds < 2 || seconds > 3600) throw new Error("Polling interval must be 2–3600 seconds");
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const peer of args.slice(2)) {
          try {
            const summary = await syncFromPeer(args[0], peer);
            console.log(`${peer} · ${summary.eventCount} events · ${summary.head}`);
          } catch (error) { console.error(`${peer} · rejected: ${error.message}`); }
        }
      } finally { busy = false; }
    };
    await poll();
    setInterval(poll, seconds * 1000);
  } else if (command === "inspect" && args.length === 1) {
    const { summary } = readVerified(args[0]);
    console.log(JSON.stringify({ valid: true, eventCount: summary.eventCount, head: summary.head, trustRoot: summary.trustRoot }, null, 2));
  } else if (command === "serve" && args.length >= 1 && args.length <= 3) {
    const port = args[1] === undefined ? 8788 : Number(args[1]);
    const host = args[2] ?? "127.0.0.1";
    const server = startPeerServer(args[0], { port, host });
    server.on("listening", () => console.log(`PNB 節點：http://${host}:${server.address().port}/`));
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`PNB 錯誤：${error.message}`);
  process.exitCode = 1;
}
