import { put, get } from "@vercel/blob";
import { readFileSync } from "fs";

const env = readFileSync("/home/z/my-project/.env.local", "utf8");
process.env.BLOB_READ_WRITE_TOKEN = env.match(/BLOB_READ_WRITE_TOKEN="([^"]+)"/)[1];

const path = "test/etag-probe.txt";

// create
await put(path, "v1", { access: "private", addRandomSuffix: false });
console.log("created v1");

// read etag
const res = await get(path, { access: "private" });
const etag = res.headers?.get("etag");
await new Response(res.stream).text(); // drain
console.log("etag from get:", JSON.stringify(etag));

// attempt overwrite with ifMatch
try {
  await put(path, "v2", { access: "private", addRandomSuffix: false, ifMatch: etag });
  console.log("put with ifMatch OK");
} catch (e) {
  console.log("put with ifMatch FAILED:", e.name, "|", e.message?.slice(0, 300));
}

// attempt overwrite with ifMatch + allowOverwrite
try {
  await put(path, "v3", { access: "private", addRandomSuffix: false, allowOverwrite: true, ifMatch: etag });
  console.log("put with ifMatch+allowOverwrite OK");
} catch (e) {
  console.log("put with ifMatch+allowOverwrite FAILED:", e.name, "|", e.message?.slice(0, 300));
}

// verify final content
const res2 = await get(path, { access: "private" });
console.log("final content:", await new Response(res2.stream).text());
