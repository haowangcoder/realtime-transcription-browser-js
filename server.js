require("dotenv").config();
const express = require("express");
const path = require("path");
const { AssemblyAI } = require("assemblyai");
const OpenAI = require("openai");

const aai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(express.static("public"));
app.use(
  "/assemblyai.js",
  express.static(
    path.join(__dirname, "node_modules/assemblyai/dist/assemblyai.umd.js"),
  ),
);
app.use(express.json());

app.get("/token", async (_req, res) => {
  const token = await aai.realtime.createTemporaryToken({ expires_in: 3600 });
  res.json({ token });
});

app.post("/translate", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: "Empty text" });
    }
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Translate the following into chinese and only show me the translated content: ${text}`,
        },
      ],
      temperature: 0.3
    });
    
    res.json({ translation: completion.choices[0].message.content });
  } catch (error) {
    console.error("Translation error:", error);
    res.status(500).json({ error: "Translation failed" });
  }
});

app.set("port", 8000);
const server = app.listen(app.get("port"), () => {
  console.log(
    `Server is running on port http://localhost:${server.address().port}`,
  );
});
