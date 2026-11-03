import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { assertAnchor, bootstrapSynthetic, initMirror, populateSynthetic, readPinnedRoot, readVerified, startPeerServer, syncFromPeer } from "./peer.mjs";

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const position = args.indexOf(flag);
  return position < 0 ? fallback : args[position + 1];
};
const home = resolve(get("--home", process.env.PNB_HOME ?? "pnb-workspace"));
const port = Number(get("--port", "8800"));
const host = get("--host", "127.0.0.1");
const mirrorAt = args.indexOf("--mirror");

try {
  if (mirrorAt >= 0) {
    const [peer, trustRoot, count, head] = args.slice(mirrorAt + 1, mirrorAt + 5);
    if (!peer || !trustRoot || count === undefined || !head) throw new Error("--mirror requires peer URL, trust root, event count and head");
    const mirrorDir = join(home, "mirror");
    if (!existsSync(mirrorDir)) initMirror(mirrorDir, trustRoot, Number(count), head);
    if (readPinnedRoot(mirrorDir) !== trustRoot) throw new Error("Existing mirror has a different trust root");
    const first = await syncFromPeer(mirrorDir, peer);
    assertAnchor(readVerified(mirrorDir).bundle, { trustRoot, eventCount: Number(count), head });
    console.log(`鏡像已同步：${first.eventCount} 筆，鏈頭 ${first.head}`);
    let busy = false;
    let lastHead = first.head;
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const latest = await syncFromPeer(mirrorDir, peer);
        if (latest.head !== lastHead) {
          lastHead = latest.head;
          console.log(`鏡像鏈頭：${latest.eventCount} 筆，${latest.head}`);
        }
      } catch (error) { console.error(`鏡像同步遭拒：${error.message}`); }
      finally { busy = false; }
    }, 10000);
    const server = startPeerServer(mirrorDir, { port, host });
    server.on("listening", () => console.log(`鏡像介面：http://${host}:${server.address().port}/`));
  } else {
    const publisherDir = join(home, "publisher");
    const keyDir = join(home, "keys");
    if (!existsSync(publisherDir)) {
      const initial = bootstrapSynthetic(publisherDir, keyDir);
      console.log(`已建立 TEST 資料與金鑰；信任根：${initial.trustRoot}`);
      populateSynthetic(publisherDir, keyDir);
    }
    const current = readVerified(publisherDir).summary;
    console.log(`發布節點：${current.eventCount} 筆，鏈頭 ${current.head}`);
    const server = startPeerServer(publisherDir, { port, host });
    server.on("listening", () => console.log(`發布介面：http://${host}:${server.address().port}/`));
  }
} catch (error) {
  console.error(`PNB 啟動失敗：${error.message}`);
  process.exitCode = 1;
}
