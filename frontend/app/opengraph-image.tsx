import { ImageResponse } from "next/og";

export const alt = "Sport IQ MLB and NFL prediction intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(135deg, #000 0%, #090909 70%, #111907 100%)",
        color: "white",
        display: "flex",
        height: "100%",
        justifyContent: "space-between",
        padding: "70px 78px",
        width: "100%"
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "680px" }}>
        <div style={{ color: "#bef264", display: "flex", fontSize: 23, fontWeight: 800, letterSpacing: "5px" }}>MLB + NFL PREDICTION INTELLIGENCE</div>
        <div style={{ display: "flex", fontSize: 95, fontWeight: 900, letterSpacing: "-6px", lineHeight: 0.9, marginTop: 30 }}>SPORT IQ</div>
        <div style={{ color: "#a3a3a3", display: "flex", fontSize: 28, fontWeight: 700, marginTop: 36 }}>KNOW THE CALL. WATCH IT MOVE.</div>
        <div style={{ color: "#525252", display: "flex", fontSize: 18, marginTop: 25 }}>Locked pregame picks · Live movement · Verified winners</div>
      </div>
      <div style={{ alignItems: "center", display: "flex", height: "360px", justifyContent: "center", position: "relative", width: "360px" }}>
        <div style={{ alignItems: "center", border: "5px solid #bef264", borderRadius: "55px", boxShadow: "0 0 50px rgba(190,242,100,.25)", display: "flex", fontSize: 72, fontWeight: 900, height: "235px", justifyContent: "center", width: "235px" }}>IQ</div>
      </div>
    </div>,
    size
  );
}
