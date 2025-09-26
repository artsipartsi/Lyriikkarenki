// api/chat.js
// Alkuun pelkkä placeholder: palauttaa 501, kunnes lisäät OpenAI-koodin.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  return res.status(501).json({ error: "Not implemented yet" });
}