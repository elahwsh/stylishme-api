// pages/api/skin.js
export const config = { runtime: "nodejs" };

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -- tiny helpers --
function parseBody(req) {
  try { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return {}; }
}
const CANON_TEMP = { warm: "warm", cool: "cool", neutral: "neutral" };
const CANON_SEASON = { spring: "spring", summer: "summer", autumn: "autumn", fall: "autumn", winter: "winter" };

function normTemp(s) {
  if (!s) return "neutral";
  const k = s.toString().trim().toLowerCase();
  return CANON_TEMP[k] ?? (
    k.includes("warm") ? "warm" :
    k.includes("cool") ? "cool" : "neutral"
  );
}
function normSeason(s) {
  if (!s) return "autumn";
  const k = s.toString().trim().toLowerCase();
  return CANON_SEASON[k] ?? (
    k.includes("spring") ? "spring" :
    k.includes("summer") ? "summer" :
    k.includes("winter") ? "winter" : "autumn"
  );
}
function normHex(hex, fallback = "#D9BFA5") {
  if (typeof hex !== "string") return fallback;
  const s = hex.trim().toUpperCase();
  return /^#?[0-9A-F]{6}$/.test(s) ? (s.startsWith("#") ? s : `#${s}`) : fallback;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  try {
    const { imageB64 } = parseBody(req);
    if (!imageB64 || imageB64.length < 64) {
      return res.status(400).json({ error: "imageB64 (base64-encoded image) is required" });
    }

    // Prompt: undertone + season; ask for JSON only
    const messages = [{
      role: "user",
      content: [
        {
          type: "text",
          text:
`You are a color analyst. From the FACE in this photo, determine:
1) skin undertone (one of: warm, cool, neutral)
2) seasonal palette (one of: spring, summer, autumn, winter)
3) a representative skin color hex (average of cheek/forehead skin in even light; avoid lips, blush, bronzer).
Be robust to lighting (mention if light is very warm/cool internally; but still decide).

Return ONLY JSON as:
{"temperature":"warm|cool|neutral","season":"spring|summer|autumn|winter","colorHex":"#RRGGBB"}`,
        },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
      ]
    }];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2
    });

    let j = {};
    try { j = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch {}

    const temperature = normTemp(j.temperature);
    const season = normSeason(j.season);
    const colorHex = normHex(j.colorHex);

    // Minimal, app-friendly payload
    return res.status(200).json({ temperature, season, colorHex });
  } catch (err) {
    console.error("SKIN API ERROR:", err);
    // Graceful fallback so the app still shows something
    return res.status(200).json({
      temperature: "neutral",
      season: "autumn",
      colorHex: "#D9BFA5"
    });
  }
}
