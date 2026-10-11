// 가짜 키를 넣어 빌드한 뒤 브라우저 번들(.next/static)에 키·Qloo 호출 흔적이 없는지 검사하는 스크립트
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SENTINEL_QLOO = "sentinel-qloo-key-must-not-ship-7f3a";
const SENTINEL_GATEWAY = "sentinel-gateway-key-must-not-ship-91c2";
const SENTINEL_ANTHROPIC = "sentinel-anthropic-key-must-not-ship-4d8e";

if (!process.argv.includes("--no-build")) {
  execSync("npx next build", {
    stdio: "inherit",
    env: { ...process.env, QLOO_API_KEY: SENTINEL_QLOO, AI_GATEWAY_API_KEY: SENTINEL_GATEWAY, ANTHROPIC_API_KEY: SENTINEL_ANTHROPIC },
  });
}

const root = join(process.cwd(), ".next", "static");
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const needles = [SENTINEL_QLOO, SENTINEL_GATEWAY, SENTINEL_ANTHROPIC, "X-Api-Key", "hackathon.api.qloo.com", "QLOO_API_KEY", "ANTHROPIC_API_KEY", "api.anthropic.com"];
const files = walk(root).filter((p) => /\.(js|css|html|json|txt|map)$/.test(p));
const hits = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const n of needles) if (text.includes(n)) hits.push(`${n} in ${f}`);
}
if (hits.length) {
  console.error("Client bundle leak:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`OK: scanned ${files.length} client files, no key or Qloo endpoint found.`);
