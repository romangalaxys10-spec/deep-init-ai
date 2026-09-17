import { put, get } from "@vercel/blob";
import { readFileSync } from "fs";

const env = readFileSync("/home/z/my-project/.env.local", "utf8");
process.env.BLOB_READ_WRITE_TOKEN = env.match(/BLOB_READ_WRITE_TOKEN="([^"]+)"/)[1];

const path = "test/propagation.txt";
await put(path, "v1", { access: "private", addRandomSuffix: false, allowOverwrite: true });
const r1 = await get(path, { access: "private" });
console.log("after v1 put, read:", await new Response(r1.stream).text());

await put(path, "v2", { access: "private", addRandomSuffix: false, allowOverwrite: true });
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  const r = await get(path, { access: "private" });
  const text = await new Response(r.stream).text();
  if (text === "v2") {
    console.log(`v2 visible after ${Date.now() - t0}ms (attempt ${i + 1})`);
    process.exit(0);
  }
  await new Promise((res) => setTimeout(res, 200));
}
console.log("v2 NOT visible after 6s");
