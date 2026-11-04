export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

// Danh sách model fallback — thử lần lượt khi gặp 402/404/429/5xx
// Cập nhật danh sách tại: https://ollama.com/library
const MODEL_FALLBACKS = [
  'gemma3:4b',
  'gemma3:12b',
  'gemma3:27b',
  'gpt-oss:120b',
  'qwen3-coder:480b',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-Model-Used, X-Models-Tried');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ error: 'OLLAMA_API_KEY chưa được cấu hình' });
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyStr = Buffer.concat(chunks).toString();

    let clientBody;
    try { clientBody = JSON.parse(bodyStr); }
    catch { return res.status(400).json({ error: 'Body không phải JSON' }); }

    const preferred = clientBody.model;
    const tried = [];
    const modelsToTry = preferred
      ? [preferred, ...MODEL_FALLBACKS.filter(m => m !== preferred)]
      : MODEL_FALLBACKS;

    let lastError = null;
    let ollamaRes = null;
    let usedModel = null;

    for (const model of modelsToTry) {
      tried.push(model);
      console.log(`[proxy] Trying model: ${model}`);
      const body = JSON.stringify({ ...clientBody, model });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);

      try {
        const r = await fetch('https://ollama.com/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (r.ok) {
          ollamaRes = r;
          usedModel = model;
          console.log(`[proxy] ✅ Model ${model} OK`);
          break;
        }

        const errText = await r.text().catch(() => '');
        console.log(`[proxy] ❌ Model ${model} → ${r.status}: ${errText.slice(0, 120)}`);
        lastError = { status: r.status, text: errText.slice(0, 300), model };

        if (r.status === 401 || r.status === 403) {
          return res.status(r.status).json({
            error: `Auth failed (model ${model})`,
            detail: errText.slice(0, 200),
            triedModels: tried,
          });
        }
      } catch (fetchErr) {
        clearTimeout(timeout);
        console.log(`[proxy] ⚠️ Model ${model} fetch error: ${fetchErr.message}`);
        lastError = { status: 0, text: fetchErr.message, model };
      }
    }

    if (!ollamaRes) {
      return res.status(402).json({
        error: 'Tất cả model đều không khả dụng',
        triedModels: tried,
        lastError: lastError,
        hint: 'Có thể hết credit Ollama free tier. Chuyển sang Groq (miễn phí).',
      });
    }

    res.setHeader('X-Model-Used', usedModel);
    res.setHeader('X-Models-Tried', tried.join(','));
    res.status(200);
    const contentType = ollamaRes.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);

    if (ollamaRes.body) {
      const reader = ollamaRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error('Proxy error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
}