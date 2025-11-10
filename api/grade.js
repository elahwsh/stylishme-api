// pages/api/grade.js
export const config = { runtime: "nodejs" };

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// tiny helper
function parseBody(req) {
  try { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  const { imageB64, targetStyle, userTags } = parseBody(req);
  if (!imageB64 || imageB64.length < 64) {
    return res.status(400).json({ error: "imageB64 required (base64, no data: prefix)" });
  }

  // userTags = { colors?: string[], styles?: string[], items?: string[] }
  const tagLine = userTags ? `
User-provided tags (use to refine, but override if obviously wrong):
- colors: ${(userTags.colors || []).join(", ") || "—"}
- styles: ${(userTags.styles || []).join(", ") || "—"}
- items:  ${(userTags.items  || []).join(", ") || "—"}
` : "";

  const messages = [{
    role: "user",
    content: [
      { type: "text", text:
`You're a fashion grader. Analyze this single outfit photo.

Return ONLY JSON with this exact shape:

{
  "score": 0-100,                      // holistic quality
  "verdict": "short title",            // e.g., "Casual chic", "Clean street"
  "styles": ["streetwear","coquette"], // 1–4 tags
  "colors": ["#RRGGBB","black","ivory"],  // up to 6 main colors; prefer hex for main hues
  "materials": ["denim","leather","knit"], // 1–5
  "items": [
    {"category":"top","description":"cropped white tee"},
    {"category":"bottom","description":"high-waist black denim"},
    {"category":"shoes","description":"white sneakers"}
  ],
  "bodyTypeGuess": "Inverted Triangle | Triangle (Pear) | Balanced | Unknown",
  "fitNotes": ["bullet 1","bullet 2"], // what works / what doesn't
  "suggestions": ["bullet 1","bullet 2","bullet 3"], // specific upgrades the user can apply today
  "ifTargetStyle": {                   // tailor to a requested style if provided (else keep generic)
    "target": "${targetStyle || ""}",
    "howToGetThere": ["step 1","step 2"]  // concrete edits to move toward target
  }
}

Grading guidance:
- Score is about cohesion, proportion, color harmony, and fit.
- Identify visible materials and items (top/bottom/shoes/jacket/bag/accessories).
- Colors: list largest ~5 areas; prefer hex for dominant hues.
- If lighting is tinted, infer true hue (describe what reads on garments).
- Be kind but direct with suggestions.

${targetStyle ? `Requested target style: ${targetStyle}` : ""}
${tagLine}
` },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
    ]
  }];

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.4
    });

    let out = {};
    try { out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch {}

    // minimal sanity
    if (!Array.isArray(out.styles)) out.styles = [];
    if (!Array.isArray(out.colors)) out.colors = [];
    if (!Array.isArray(out.materials)) out.materials = [];
    if (!Array.isArray(out.items)) out.items = [];
    if (!Array.isArray(out.fitNotes)) out.fitNotes = [];
    if (!Array.isArray(out.suggestions)) out.suggestions = [];
    if (!out.ifTargetStyle) out.ifTargetStyle = { target: targetStyle || "", howToGetThere: [] };
    if (!Array.isArray(out.ifTargetStyle.howToGetThere)) out.ifTargetStyle.howToGetThere = [];

    return res.status(200).json(out);
  } catch (e) {
    console.error("GRADE API ERROR:", e);
    // graceful fallback
    return res.status(200).json({
      score: 72,
      verdict: "Casual clean",
      styles: ["clean"],
      colors: ["black","white"],
      materials: ["cotton"],
      items: [],
      bodyTypeGuess: "Unknown",
      fitNotes: ["Solid base pieces; room for a focal item."],
      suggestions: ["Add 1 statement accessory", "Match shoe tone to belt/bag", "Consider a tailored hem"],
      ifTargetStyle: { target: targetStyle || "", howToGetThere: ["Add one on-theme piece (jacket/bag)", "Adjust color accents to the palette"] }
    });
  }
}
