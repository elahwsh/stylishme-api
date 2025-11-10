import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { bodyType, ratio, skinTemp, skinSeason, stylePref, occasion, suggestions } = req.body;

    const prompt = `
You are a fashion stylist AI. 
The user has:
- Body type: ${bodyType}
- Shoulder/hip ratio: ${ratio}
- Skin tone: ${skinTemp}, season: ${skinSeason}
- Preferred style: ${stylePref}
- Occasion: ${occasion}
Current suggestions: ${suggestions?.join(", ")}

Generate a short caption (max 1 sentence) that fits this look, and 3 fresh outfit suggestions.
Return only JSON:
{"caption": "...", "suggestions": ["...", "...", "..."]}
`;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.output[0].content[0].text);
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
