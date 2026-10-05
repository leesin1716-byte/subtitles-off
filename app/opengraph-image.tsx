// 공유 미리보기 이미지(1200x630): 자막 띠 모티프와 한 줄 소개를 그린다
import { ImageResponse } from "next/og";

export const alt = "Subtitles Off: keep a language alive through the things you already love";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f7f3ec", color: "#1d1b18", padding: 72 }}>
        <div style={{ display: "flex", fontSize: 30, color: "#5f5a52" }}>Qloo taste data · four-week plan</div>
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 128, fontWeight: 700, marginTop: 48, letterSpacing: -3 }}>
          Subtitles
          <div style={{ display: "flex", position: "relative", marginLeft: 32, fontStyle: "italic" }}>
            Off
            <div style={{ position: "absolute", left: -8, right: -8, top: 70, height: 16, background: "#f3c93f", transform: "rotate(-4deg)" }} />
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 44, marginTop: 28, maxWidth: 980 }}>Keep a language alive through the things you already love.</div>
        <div style={{ display: "flex", marginTop: "auto", background: "#1d1b18", color: "#f3c93f", fontSize: 30, padding: "14px 24px", alignSelf: "flex-start" }}>
          [ subtitles: off ]
        </div>
      </div>
    ),
    size,
  );
}
