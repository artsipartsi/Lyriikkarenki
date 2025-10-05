// api/chat.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const { prompt, temperature = 0.7 } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server missing OPENAI_API_KEY" });

    const payload = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Analysoi annettu teksti ja tee hyvin lyhyitä ehdotuksia. Älä selitä mitään. Älä käytä otsikoita. Älä käytä rivin alussa numeroita tai ranskalaisia viivoja. Palauta 1–4 ehdotusta, ilman esipuhetta." },
        { role: "user", content: prompt }
      ],
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0.7))
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).send(errText);
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ content });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
