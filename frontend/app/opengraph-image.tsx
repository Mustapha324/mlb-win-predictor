import { ImageResponse } from "next/og";

export const alt = "Diamond Dugout MLB prediction intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(135deg, #060914 0%, #0c1120 72%, #08222a 100%)",
        color: "white",
        display: "flex",
        height: "100%",
        justifyContent: "space-between",
        padding: "70px 78px",
        width: "100%"
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "680px" }}>
        <div style={{ color: "#67e8f9", display: "flex", fontSize: 23, fontWeight: 800, letterSpacing: "5px" }}>MLB PREDICTION INTELLIGENCE</div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 83, fontWeight: 900, letterSpacing: "-5px", lineHeight: 0.9, marginTop: 30 }}>
          <span>DIAMOND</span><span>DUGOUT</span>
        </div>
        <div style={{ color: "#94a3b8", display: "flex", fontSize: 28, fontWeight: 700, marginTop: 36 }}>THE EDGE, BEFORE FIRST PITCH.</div>
        <div style={{ color: "#64748b", display: "flex", fontSize: 18, marginTop: 25 }}>47,113 games · Live scores · Transparent probabilities</div>
      </div>
      <div style={{ alignItems: "center", display: "flex", height: "360px", justifyContent: "center", position: "relative", width: "360px" }}>
        <div style={{ border: "5px solid #67e8f9", boxShadow: "0 0 50px rgba(103,232,249,.3)", display: "flex", height: "235px", position: "absolute", transform: "rotate(45deg)", width: "235px" }} />
        <div style={{ background: "#67e8f9", borderRadius: "50%", boxShadow: "0 0 35px rgba(103,232,249,.8)", display: "flex", height: "28px", width: "28px" }} />
      </div>
    </div>,
    size
  );
}
