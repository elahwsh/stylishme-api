
// api/style.js
export const config = { runtime: "nodejs" };

import OpenAI from "openai";
// Optional: quick GET debug (remove later)
async function canary(req, res) {
  const hasKey = !!process.env.OPENAI_API_KEY;
  return res.status(200).json({ ok: true, hasKey });
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return canary(req, res);
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // This shows up in Vercel logs if the env var isn't present in Production
      console.error("Missing OPENAI_API_KEY in environment");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const client = new OpenAI({ apiKey });

    // Body may arrive as string (depending on client) or as parsed JSON
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const {
      bodyType = "Unknown",
      ratio = "",
      skinTemp = "Neutral",
      skinSeason = "Unknown",
      stylePref = "Surprise",
      occasion = "Casual",
      suggestions = [],
    } = body;

    const prompt = `
You are a fashion stylist AI.
Given:
- Body type: ${bodyType}
- Shoulder/hip ratio: ${ratio}
- Skin tone: ${skinTemp}, season: ${skinSeason}
- Preferred style: ${stylePref}
- Occasion: ${occasion}
- Base suggestions: ${Array.isArray(suggestions) ? suggestions.join(", ") : "none"}

Return ONLY JSON like:
{"caption":"...","suggestions":["...","...","..."]}
No prose, no markdown.
`;

    // Chat Completions (simple & reliable)
    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const text = chat?.choices?.[0]?.message?.content || "{}";
    let out;
    try {
      out = JSON.parse(text);
    } catch (e) {
      console.error("JSON parse error from model:", text);
      out = { caption: null, suggestions: [] };
    }

    // Ensure shape
    if (!Array.isArray(out.suggestions)) out.suggestions = [];
    if (typeof out.caption !== "string") out.caption = null;

    return res.status(200).json(out);
  } catch (err) {
    // Full error in logs, concise error to client
    console.error("STYLE API ERROR:", err);
    return res.status(500).json({ error: err.message ?? "Server error" });
  }


}
