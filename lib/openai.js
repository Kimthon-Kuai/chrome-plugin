/**
 * OpenAI-compatible Chat Completions client (used in service worker).
 */

function atNormalizeBaseUrl(baseUrl) {
  let url = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Base URL 未配置");
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
 * @returns {Promise<{ content: string, usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } }>}
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

  const usage = data?.usage || {};
  return {
    content: String(content).trim(),
    usage: {
      prompt_tokens: Number(usage.prompt_tokens) || 0,
      completion_tokens: Number(usage.completion_tokens) || 0,
      total_tokens:
        Number(usage.total_tokens) ||
        (Number(usage.prompt_tokens) || 0) +
          (Number(usage.completion_tokens) || 0),
    },
  };
}
