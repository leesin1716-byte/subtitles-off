// 브라우저에서 /api/plan의 NDJSON 응답을 이벤트로 읽고, 끊기거나 깨진 줄이 와도 끝 상태를 반드시 돌려주는 리더

import type { PlanEvent } from "./types";

export type StreamOutcome = "done" | "needs_input" | "error";

/**
 * Reads NDJSON plan events and reports how the stream ended. A dropped connection or a broken
 * line becomes an "incomplete" error event instead of an exception, so the UI never stays
 * stuck on "Building…".
 */
export async function readPlanStream(body: ReadableStream<Uint8Array>, onEvent: (e: PlanEvent) => void): Promise<StreamOutcome> {
  let outcome: StreamOutcome = "error";
  let sawError = false;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line) as PlanEvent;
    onEvent(ev);
    if (ev.type === "plan") outcome = "done";
    else if (ev.type === "needs_input") outcome = "needs_input";
    else if (ev.type === "error") {
      outcome = "error";
      sawError = true;
    }
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    handle(buffer + decoder.decode());
  } catch {
    onEvent({ type: "error", code: "incomplete", message: "The connection dropped before the plan finished. Please try again." });
    return "error";
  } finally {
    reader.releaseLock();
  }
  if (outcome === "error" && !sawError) {
    onEvent({ type: "error", code: "incomplete", message: "The plan stopped before it finished. Please try again." });
  }
  return outcome;
}
