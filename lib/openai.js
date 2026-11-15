/**
 * OpenAI-compatible Chat Completions client (used in service worker).
 */

function atNormalizeBaseUrl(baseUrl) {
  let url = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Base URL 未配置");
  // Accept both https://host and https://host/v1
  return url;
}

function atChatCompletionsUrl(baseUrl) {
  const base = atNormalizeBaseUrl(baseUrl);
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/**
 * @param {{ apiKey: string, baseUrl: string, model: string, messages: Array, temperature?: number, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
async function atChatCompletion(opts) {
  const { apiKey, baseUrl, model, messages } = opts;
  if (!apiKey) throw new Error("请先在插件设置中填写 API Key");
  if (!model) throw new Error("请先在插件设置中填写模型名称");

  const endpoint = atChatCompletionsUrl(baseUrl);
  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: false,
    // DeepSeek V4 may enable thinking by default; disable for fast translate/summary.
    thinking: { type: "disabled" },
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`API 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  const message = data?.choices?.[0]?.message || {};
  const content = message.content || message.reasoning_content || "";
  if (content == null || String(content).trim() === "") {
    throw new Error("API 未返回有效内容");
  }
  return String(content).trim();
}
