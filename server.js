require("dotenv").config();
const express = require("express");
const path = require("path");
const { AssemblyAI } = require("assemblyai");
const OpenAI = require("openai");

const aai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();

// 简单的内存缓存
const translationCache = new Map();

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
    
    // 输入验证
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: "无效的输入文本" });
    }
    
    const trimmedText = text.trim();
    if (trimmedText === '') {
      return res.status(400).json({ error: "输入文本不能为空" });
    }

    // 检查缓存
    if (translationCache.has(trimmedText)) {
      return res.json({ translation: translationCache.get(trimmedText) });
    }
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "你是一个专业的翻译助手。请将用户输入的英文文本翻译成中文，保持原文的语气和风格。只返回翻译结果，不要添加任何解释或额外内容。"
        },
        {
          role: "user",
          content: trimmedText
        }
      ],
      temperature: 0.3
    });
    
    const translation = completion.choices[0].message.content.trim();
    
    // 存入缓存
    translationCache.set(trimmedText, translation);
    
    res.json({ translation });
  } catch (error) {
    console.error("翻译错误:", error);
    
    // 更详细的错误处理
    if (error.response) {
      return res.status(error.response.status).json({ 
        error: "翻译服务出错",
        details: error.response.data
      });
    }
    
    res.status(500).json({ 
      error: "翻译服务暂时不可用",
      details: error.message
    });
  }
});

// 定期清理缓存（每小时）
setInterval(() => {
  translationCache.clear();
}, 3600000);

app.set("port", 8000);
const server = app.listen(app.get("port"), () => {
  console.log(
    `Server is running on port http://localhost:${server.address().port}`,
  );
});
