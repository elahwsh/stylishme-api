// pages/api/skin.js
export const config = { runtime: "nodejs" };

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --------- utils ----------
function parseBody(req) {
  try { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return {}; }
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }

// hex -> RGB 0..1
function hexToRGB(hex, fallback = { r:0.85,g:0.75,b:0.65 }) {
  if (typeof hex !== "string") return fallback;
  let s = hex.trim().replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return fallback;
  const n = parseInt(s, 16);
  return { r: ((n>>16)&255)/255, g: ((n>>8)&255)/255, b: (n&255)/255 };
}

// RGB (sRGB) -> XYZ -> LAB
function rgbToLAB({r,g,b}) {
  const inv = c => (c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  const R=inv(r), G=inv(g), B=inv(b);
  const X = 0.4124564*R + 0.3575761*G + 0.1804375*B;
  const Y = 0.2126729*R + 0.7151522*G + 0.0721750*B;
  const Z = 0.0193339*R + 0.1191920*G + 0.9503041*B;
  const xr = X/0.95047, yr = Y/1.00000, zr = Z/1.08883;
  const f  = t => (t > 0.008856 ? Math.cbrt(t) : (7.787*t + 16/116));
  const fx = f(xr), fy = f(yr), fz = f(zr);
  return { L: 116*fy - 16, a: 500*(fx - fy), b: 200*(fy - fz) };
}
function labChroma({a,b}) { return Math.sqrt(a*a + b*b); }

// Season from temp + L (0..1) + chroma (0..1)
function mapSeason(temp, L01, C01) {
  const isLight = L01 > 0.55;
  const isClear = C01 > 0.18;
  switch (temp) {
    case "warm":   return (isLight && isClear) ? "spring" : "autumn";
    case "cool":   return (isLight && isClear) ? "summer" : "winter";
    default:       return isClear ? (isLight ? "summer" : "autumn") : "winter";
  }
}

function canonTemp(s) {
  const k = String(s||"").toLowerCase();
  return k.includes("warm") ? "warm" : k.includes("cool") ? "cool" : "neutral";
}
function canonSeason(s) {
  const k = String(s||"").toLowerCase();
  if (k.includes("spring")) return "spring";
  if (k.includes("summer")) return "summer";
  if (k.includes("winter")) return "winter";
  return "autumn";
}
function canonHex(h) {
  const s = String(h||"").trim();
  if (/^#?[0-9A-Fa-f]{6}$/.test(s)) return s.startsWith("#") ? s : `#${s}`;
  return "#D9BFA5";
}

// --------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  try {
    const { imageB64 } = parseBody(req);
    if (!imageB64 || imageB64.length < 64) {
      return res.status(400).json({ error: "imageB64 required (base64, no data: prefix)" });
    }

    // Ask for undertone + season + numeric cues + lighting bias
    const messages = [{
      role: "user",
      content: [
        { type: "text", text:
`From the FACE ONLY (avoid lips/blush/bronzer), analyze:
- temperature: "warm" | "cool" | "neutral"
- season: "spring" | "summer" | "autumn" | "winter"
- colorHex: average of cheek + mid-forehead in normal skin areas (#RRGGBB)
- lightness: 0..1 (perceived L after white-balance)
- clarity: 0..1 (chroma/contrast of skin vs hair/eyes)
- lightingBias: -1..+1 (negative=cool light, positive=warm light)

If ambient light is very warm/cool, mentally white-balance BEFORE deciding.

Return ONLY JSON like:
{"temperature":"cool","season":"winter","colorHex":"#E0B6A3","lightness":0.62,"clarity":0.28,"lightingBias":0.55}` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
      ]
    }];

    const openai = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    let j = {};
    try { j = JSON.parse(openai.choices?.[0]?.message?.content || "{}"); } catch {}

    // Normalize model output
    let temperature = canonTemp(j.temperature);
    let season      = canonSeason(j.season);
    const colorHex  = canonHex(j.colorHex);
    const Lgpt      = Number.isFinite(j.lightness) ? clamp01(j.lightness) : undefined;
    const Cgpt      = Number.isFinite(j.clarity)   ? clamp01(j.clarity)   : undefined;
    const bias      = Number.isFinite(j.lightingBias) ? Math.max(-1, Math.min(1, j.lightingBias)) : 0;

    // Objective check from returned colorHex (helps when lighting is warm)
    const lab = rgbToLAB(hexToRGB(colorHex));
    const C   = labChroma(lab);           // ~0..>100
    const L01 = lab.L / 100.0;
    const C01 = Math.min(1, C / 100.0);

    // Warm-light false-positive guard:
    // If model says warm but LAB says b* is near/negative (bluish) and bias is warm, flip to cool.
    if (temperature === "warm" && bias > 0.3 && (lab.b < 2) && lab.a < 10) {
      temperature = "cool";
    }
    // If model says neutral but chroma is strong (>0.22), nudge based on LAB sign
    if (temperature === "neutral" && C01 > 0.22) {
      temperature = (lab.b >= 0 ? "warm" : "cool");
    }

    // Recompute season deterministically from temp + (L,C) priority:
    const Lfinal = Lgpt ?? L01;
    const Cfinal = Cgpt ?? C01;
    season = mapSeason(temperature, Lfinal, Cfinal);

    return res.status(200).json({
      temperature,        // "warm" | "cool" | "neutral"
      season,             // "spring" | "summer" | "autumn" | "winter"
      colorHex: colorHex  // "#RRGGBB"
    });

  } catch (err) {
    console.error("SKIN API ERROR:", err);
    // Graceful fallback so the app still works
    return res.status(200).json({
      temperature: "neutral",
      season: "autumn",
      colorHex: "#D9BFA5"
    });
  }
}
