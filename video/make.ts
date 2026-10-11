// 데모 영상 제작기: 로컬 앱(실 Qloo + 실 Claude)을 Playwright 로 조작하며 CDP 로 화면을 잡고, Kokoro 내레이션과 ffmpeg 로 mp4·자막·스틸을 만든다
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import type { KokoroTTS } from "kokoro-js";

const HERE = import.meta.dirname;
const APP = join(HERE, "..");
const OUT = join(HERE, "out");
const AUDIO = join(OUT, "audio");
const FRAMES = join(OUT, "frames");
const NAME = "subtitles-off-demo";
const PORT = 3931;
const BASE = `http://localhost:${PORT}`;
const MAX_SECONDS = 175; // Devpost asks for under three minutes; keep a margin
const VOICE = "af_heart";
const PAD_MS = 350;

/** Narration, voiced before recording so the recorder knows how long each line runs. */
const LINES = {
  intro:
    "Mina is fifteen. She grew up in the US with Minecraft, Olivia Rodrigo and Stranger Things, and her grandmother in Seoul speaks almost no English. Subtitles Off turns the things she already loves into four weeks of Korean shows and music.",
  tools:
    "First, the app finds her favorites in Qloo and pins the music to Korean genre tags. Then Claude takes over with three tools: discover, widen, and compose plan. It asks Qloo for TV, film and music at once.",
  validator:
    "Claude can only pick entity IDs that Qloo returned in this run. A validator rejects anything else, and code, not the model, sets the order of the weeks.",
  plan:
    "This plan was chosen by the agent. Every pick says why it is here, from Qloo's explainability. Week one is easy listening. By week four, she watches with the subtitles off.",
  trace: "The trace shows every Qloo call, and every Claude step with its tokens and time.",
  compare:
    "Now the same Claude gets the same question without Qloo. Both lists are scored against her favorites, side by side.",
  outro:
    "If Claude declines, fails, or its key runs out, the rule-based planner finishes the plan from the same Qloo results, and the page says so. Subtitles Off. Built on Qloo.",
} as const;
type LineKey = keyof typeof LINES;

type Frame = { file: string; at: number };
type Cue = { key: LineKey; at: number; ms: number };

async function loadTts(): Promise<KokoroTTS> {
  const { KokoroTTS } = await import("kokoro-js");
  return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
}

async function synthesize(tts: KokoroTTS): Promise<Record<LineKey, number>> {
  const out = {} as Record<LineKey, number>;
  for (const key of Object.keys(LINES) as LineKey[]) {
    const audio = await tts.generate(LINES[key], { voice: VOICE, speed: 1.05 });
    await audio.save(join(AUDIO, `${key}.wav`));
    out[key] = Math.round((audio.audio.length / audio.sampling_rate) * 1000);
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return out;
}

/** `next start` with live Qloo (from .env.local) and Claude; usage goes to out/claude-usage.jsonl. */
async function startApp(): Promise<ChildProcess> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY: this cut records the live Claude planner.");
  if (!existsSync(join(APP, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` first.");
  const env = { ...process.env, QLOO_MODE: "live", CLAUDE_USAGE_LOG: join(OUT, "claude-usage.jsonl"), LLM_MODE: "" };
  const child = spawn(process.execPath, [join(APP, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => process.stdout.write(`  [app] ${String(d).replace(/sk-ant[\w-]+/g, "[key]")}`));
  child.stderr!.on("data", (d) => process.stdout.write(`  [app] ${String(d).replace(/sk-ant[\w-]+/g, "[key]")}`));
  for (let i = 0; i < 120; i++) {
    if (await fetch(BASE).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("The app did not start.");
}

/** Plays the scene and records frames; returns when each narration line started (ms since recording began). */
async function record(page: Page, durations: Record<LineKey, number>, start: number): Promise<{ cues: Cue[]; stills: Record<string, number> }> {
  const cues: Cue[] = [];
  const stills: Record<string, number> = {};
  const now = () => Date.now() - start;
  const say = (key: LineKey) => {
    cues.push({ key, at: now(), ms: durations[key] });
    return page.waitForTimeout(durations[key] + PAD_MS);
  };
  const smoothTo = async (locator: ReturnType<Page["locator"]>, block: "start" | "center" = "start") => {
    await locator.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await page.waitForTimeout(900);
  };

  await page.goto(BASE);
  await page.waitForTimeout(800);
  await say("intro");

  await page.getByRole("button", { name: /Mina, 15/ }).click();
  const heading = page.getByRole("heading", { name: /Four weeks of Korean/ });
  await say("tools");
  await say("validator");
  await heading.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const selectedBy = await page.getByText(/(Agent|Rule)-selected from/).first().textContent();
  console.log(`  plan: ${selectedBy?.trim()}`);
  if (!/Agent-selected/.test(selectedBy ?? "")) throw new Error("The plan was not agent-selected; not using this take.");

  await smoothTo(heading);
  stills["1-plan"] = now() + 400;
  await say("plan");
  await smoothTo(page.getByText(/^Week 3$/).first());
  await page.waitForTimeout(1500);
  stills["2-weeks"] = now() - 200;

  const made = page.getByText(/How this plan was made/);
  await made.click();
  await smoothTo(made);
  await page.waitForTimeout(400);
  stills["3-trace"] = now() + 1200;
  await say("trace");
  await made.click(); // close it again so the compare panel sits right under the plan

  const compare = page.getByRole("button", { name: "Compare with a generic AI list" });
  await smoothTo(compare, "center");
  await compare.click();
  await page.getByText("This plan (Qloo-grounded)").waitFor({ timeout: 40_000 });
  await smoothTo(page.getByText("This plan (Qloo-grounded)").first(), "center");
  stills["4-compare"] = now() + 600;
  await say("compare");
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(800);
  await say("outro");
  await page.waitForTimeout(800);
  return { cues, stills };
}

/** An ffconcat list that holds each frame until the next one. */
function frameList(frames: Frame[], end: number): string {
  const out = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const to = i + 1 < frames.length ? frames[i + 1].at : end;
    out.push(`file '${f.file.replace(/\\/g, "/")}'`, `duration ${(Math.max(to - f.at, 1) / 1000).toFixed(4)}`);
  });
  out.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
  return `${out.join("\n")}\n`;
}

const srtTime = (ms: number) =>
  `${new Date(ms).toISOString().slice(11, 19)},${String(ms % 1000).padStart(3, "0")}`;

/** Splits a narration line into subtitle chunks of about 12 words, timed by word share. */
function srt(cues: Cue[]): string {
  const blocks: string[] = [];
  for (const c of cues) {
    const sentences = LINES[c.key].match(/[^.!?]+[.!?]+/g) ?? [LINES[c.key]];
    const words = LINES[c.key].split(/\s+/).length;
    let t = c.at;
    for (const s of sentences.map((x) => x.trim())) {
      const ms = Math.round((c.ms * s.split(/\s+/).length) / words);
      blocks.push(`${blocks.length + 1}\n${srtTime(t)} --> ${srtTime(t + ms)}\n${s}\n`);
      t += ms;
    }
  }
  return blocks.join("\n");
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(AUDIO, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });

  console.log("1/4 voicing the narration with Kokoro-82M");
  const durations = await synthesize(await loadTts());

  console.log("2/4 starting the app (live Qloo, live Claude)");
  const app = await startApp();
  // Posters are Qloo-hosted artwork; the video shows a plain tile instead of storing copies of them.
  const tile = join(OUT, "tile.png");
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0xece5d8:s=56x80", "-frames:v", "1", tile], { stdio: "ignore" });
  const tilePng = readFileSync(tile);
  const browser = await chromium.launch();
  try {
    console.log("3/4 recording");
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    await context.route("**/*", (route) => {
      const req = route.request();
      if (req.resourceType() === "image" && !req.url().startsWith(BASE)) return route.fulfill({ status: 200, contentType: "image/png", body: tilePng });
      return route.continue();
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const frames: Frame[] = [];
    cdp.on("Page.screencastFrame", (f) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      const file = join(FRAMES, `${String(frames.length).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      frames.push({ file, at: f.metadata.timestamp ? f.metadata.timestamp * 1000 : Date.now() });
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080 });
    const start = Date.now();
    const { cues, stills } = await record(page, durations, start);
    const end = Date.now();
    await cdp.send("Page.stopScreencast");
    await context.close();

    console.log("4/4 mixing and encoding");
    const rel = frames.map((f) => ({ ...f, at: f.at - start })).filter((f) => f.at >= -1000);
    rel[0] = { ...rel[0], at: 0 };
    const list = join(OUT, "frames.txt");
    writeFileSync(list, frameList(rel, end - start));
    writeFileSync(join(OUT, `${NAME}.srt`), srt(cues));
    writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ cues, stills, frames: frames.length, ms: end - start }, null, 2));
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", list];
    for (const c of cues) args.push("-i", join(AUDIO, `${c.key}.wav`));
    const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${c.at}:all=1[a${i}]`).join(";");
    const mix =
      `[0:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf7f3ec,format=yuv420p[vout];${delays};` +
      `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    const mp4 = join(OUT, `${NAME}.mp4`);
    args.push("-filter_complex", mix, "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4);
    execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    for (const [name, at] of Object.entries(stills)) {
      execFileSync("ffmpeg", ["-y", "-ss", String(Math.max(0, at) / 1000), "-i", mp4, "-frames:v", "1", join(OUT, `still-${name}.png`)], { stdio: "ignore" });
    }
    rmSync(FRAMES, { recursive: true, force: true });
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim());
    console.log(`Video: ${mp4} (${seconds.toFixed(1)} s)`);
    if (seconds >= MAX_SECONDS) {
      console.error(`Too long: ${seconds.toFixed(1)} s (limit ${MAX_SECONDS} s).`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    app.kill();
  }
}

await main();
