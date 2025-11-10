export const config = { runtime: "nodejs" };
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// helper to parse request JSON safely
function parseBody(req) {
  try { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const body = parseBody(req);

    const {
      bodyType, ratio, // optional local hints
      skinTemp, skinSeason, stylePref, occasion,
      suggestions = [],
      imageB64 // <-- NEW: base64 JPEG/PNG string WITHOUT the data: prefix
    } = body;

    // ---------- (1) Optional: GPT Vision body analysis ----------
    let gptBody = null;
    if (imageB64 && imageB64.length > 64) {
      const messages = [{
        role: "user",
        content: [
          { type: "text", text:
`You are a fashion body-shape analyst.
Classify the person’s body type based on shoulder width vs hip width ONLY (no face/identity).
Use one of: "Inverted Triangle", "Triangle (Pear)", "Balanced".
Also provide an estimated shoulderToHipRatio as a number with 2 decimals (shoulderWidth / hipWidth).
If unsure, say "Balanced".
Return ONLY JSON like:
{"bodyType":"Balanced","shoulderToHipRatio":1.03,"notes":"short one-line rationale"}` },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
        ]
      }];

      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      try {
        const j = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
        if (j && j.bodyType) {
          gptBody = {
            bodyType: j.bodyType, // e.g., "Inverted Triangle"
            ratio: typeof j.shoulderToHipRatio === "number" ? j.shoulderToHipRatio : null,
            notes: j.notes || null
          };
        }
      } catch {}
    }

    // ---------- (2) Caption + suggestions refinement ----------
    const prompt = `
You are a fashion stylist AI.
Given:
- Body type: ${gptBody?.bodyType || bodyType || "Unknown"}
- Shoulder/hip ratio: ${gptBody?.ratio ?? ratio ?? "?"}
- Skin: ${skinTemp || "Neutral"} ${skinSeason ? `(${skinSeason})` : ""}
- Preferred style: ${stylePref || "Surprise"}
- Occasion: ${occasion || "Casual"}
- Base suggestions: ${Array.isArray(suggestions) ? suggestions.join(", ") : "none"}

Return ONLY JSON: {"caption":"...","suggestions":["...","...","..."]}
`;

    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7
    });

    let out = {};
    try { out = JSON.parse(chat.choices?.[0]?.message?.content || "{}"); } catch {}
    if (!Array.isArray(out.suggestions)) out.suggestions = [];
    if (typeof out.caption !== "string") out.caption = "";

    // ---------- (3) Merge + return ----------
    return res.status(200).json({
      caption: out.caption,
      suggestions: out.suggestions,
      gptBody // <-- send back if present: { bodyType, ratio, notes }
    });

  } catch (err) {
    console.error("STYLE API ERROR:", err);
    // Graceful fallback
    return res.status(200).json({
      caption: "Classic look, optimized locally ✨",
      suggestions: [
        "Balance shoulders and hips with tailored silhouettes",
        "Pick colors aligned with undertone",
        "Keep 1–2 accessories as the focal point"
      ],
      gptBody: null
    });
  }
}
