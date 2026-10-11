// 금지 엔드포인트 문자열과 키 노출을 저장소 전체에서 막는 가드 테스트
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", ".git", "coverage", ".vercel"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p).replaceAll("\\", "/");
const files = walk(ROOT).filter((p) => /\.(ts|tsx|js|mjs|json|md)$/.test(p) && !p.endsWith("package-lock.json"));

describe("repository guards", () => {
  it("never references the forbidden Qloo routes", () => {
    // Built from parts so this file itself does not contain the strings.
    const forbidden = ["/re" + "cs", "/recommen" + "dations"];
    const offenders = files.filter((p) => forbidden.some((f) => readFileSync(p, "utf8").includes(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("reads QLOO_API_KEY only in server-side modules", () => {
    const readers = files
      .filter((p) => /\.(ts|tsx)$/.test(p) && !rel(p).startsWith("tests/"))
      .filter((p) => readFileSync(p, "utf8").includes("QLOO_API_KEY"))
      .map(rel);
    expect(readers.sort()).toEqual(["lib/config.ts", "lib/qloo/server.ts"]);
    expect(readFileSync(join(ROOT, "lib/qloo/server.ts"), "utf8")).toContain('import "server-only"');
  });

  it("reads ANTHROPIC_API_KEY only in server-side modules", () => {
    const readers = files
      .filter((p) => /\.(ts|tsx)$/.test(p) && !rel(p).startsWith("tests/"))
      .filter((p) => readFileSync(p, "utf8").includes("ANTHROPIC_API_KEY"))
      .map(rel);
    expect(readers.sort()).toEqual(["lib/config.ts", "lib/llm.ts"]);
    expect(readFileSync(join(ROOT, "lib/llm.ts"), "utf8")).toContain('import "server-only"');
  });

  it("keeps client components away from the Qloo client and secrets", () => {
    const clientFiles = files.filter((p) => /\.tsx?$/.test(p) && readFileSync(p, "utf8").trimStart().startsWith('"use client"'));
    for (const p of clientFiles) {
      const text = readFileSync(p, "utf8");
      expect(text, rel(p)).not.toMatch(/lib\/qloo\/(server|http)|lib\/llm|claude-agent|@anthropic-ai|process\.env\.(QLOO|AI_GATEWAY|ANTHROPIC)/);
    }
  });
});
