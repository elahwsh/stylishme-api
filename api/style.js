 // pages/api/skin.js
export const config = { runtime: "nodejs" };

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseBody(req) {
  try { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  const { imageB64 } = parseBody(req);
  if (!imageB64 || imageB64.length < 64) {
    return res.status(400).json({ error: "imageB64 required (base64, no data: prefix)" });
  }

  try {
    const messages = [{
      role: "user",
      content: [
        { type: "text", text:
`Look at the FACE only. Decide:
- temperature: "warm" | "cool" | "neutral"
- season: "spring" | "summer" | "autumn" | "winter"
- colorHex: representative skin hex (#RRGGBB) from cheeks/forehead (avoid lips/makeup).

Return ONLY JSON exactly like:
{"temperature":"cool","season":"winter","colorHex":"#E0B6A3"}` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
      ]
    }];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2
    });

    let out = {};
    try { out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch {}

    // Minimal normalization (no overrides):
    const temperature = String(out.temperature || "neutral").toLowerCase();       // warm|cool|neutral
    let season = String(out.season || "autumn").toLowerCase();                    // spring|summer|autumn|winter
    if (season === "fall") season = "autumn";
    const colorHex = /^#?[0-9A-Fa-f]{6}$/.test(out.colorHex || "")
      ? (out.colorHex.startsWith("#") ? out.colorHex : `#${out.colorHex}`)
      : "#D9BFA5";

    return res.status(200).json({ temperature, season, colorHex });
  } catch (e) {
    console.error("SKIN API ERROR:", e);
    // If the AI call fails, still respond so the app doesn't crash
    return res.status(200).json({ temperature: "neutral", season: "autumn", colorHex: "#D9BFA5" });
  }
}
