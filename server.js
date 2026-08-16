const express = require('express');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// .env file load karne ke liye (agar ho toh)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
} catch (e) { /* ignore */ }

const app = express();
const PORT = process.env.PORT || 4000;

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT || 'You are a friendly and helpful AI assistant. Always respond in English. Keep answers short (max 3-4 lines) and clear.';

app.use(express.json());

// Cache off - hamesha naya version dikhe
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ai: !!genAI,
    model: MODEL,
    time: new Date().toISOString()
  });
});

// Streaming chat endpoint (Server-Sent Events)
app.post('/api/chat', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'GEMINI_API_KEY set nahi hai. .env file mein API key daalo.' });
  }
  const { message, history, systemPrompt } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const chat = model.startChat({
      history: (history || []).slice(-10).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }))
    });

    const prompt = (systemPrompt || SYSTEM_PROMPT) + '\n\nUser: ' + message;
    const result = await chat.sendMessageStream(prompt);

    let full = '';
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        full += text;
        sendEvent({ type: 'chunk', text });
      }
    }
    sendEvent({ type: 'done', text: full });
    res.end();
  } catch (err) {
    sendEvent({ type: 'error', error: err.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`AI Chat App chal rahi hai: http://localhost:${PORT}`);
  if (!genAI) {
    console.log('WARNING: GEMINI_API_KEY set nahi hai! .env file mein API key daalo.');
  }
});
