import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  try {
    const { bodyType, ratio, skinTemp, skinSeason, stylePref, occasion, suggestions } = req.body;

    const prompt = `
    You are a fashion stylist AI.
    Given:
    - Body type: ${bodyType || "unknown"}
    - Shoulder/hip ratio: ${ratio || "?"}
    - Skin tone: ${skinTemp || "?"}, season: ${skinSeason || "?"}
    - Preferred style: ${stylePref || "surprise"}
    - Occasion: ${occasion || "unspecified"}
    - Current suggestions: ${Array.isArray(suggestions) ? suggestions.join(", ") : "none"}

    Write a short caption (max 1 line) and 3 refined outfit suggestions.
    Return pure JSON: {"caption":"...","suggestions":["...","...","..."]}.
    `;

    // Either Responses API (new)…
    // const completion = await client.responses.create({
    //   model: "gpt-4.1-mini",
    //   input: prompt,
    //   response_format: { type: "json_object" }
    // });
    // const json = JSON.parse(completion.output[0].content[0].text);

    // …or Chat Completions (stable & simple):
    const chat = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });
    const json = JSON.parse(chat.choices[0].message.content);

    return res.status(200).json(json);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
