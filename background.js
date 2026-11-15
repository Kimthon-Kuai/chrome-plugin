/* global AT_DEFAULTS, atGetSettings, atSaveSettings, atChatCompletion,
          atResolveTargetLang, atTranslateSystemPrompt, atBatchTranslateMessages,
          atParseNumberedTranslations, atSummarizeMessages */

importScripts("lib/storage.js", "lib/openai.js", "lib/prompts.js");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: err?.message || String(err),
      })
    );
  return true; // async
});

async function handleMessage(message) {
  const type = message?.type;
  switch (type) {
    case "PING":
      return { pong: true };
    case "GET_SETTINGS":
      return atGetSettings();
    case "SAVE_SETTINGS":
      return atSaveSettings(message.settings || {});
    case "TRANSLATE_TEXT":
      return translateText(message.text || "", message.direction);
    case "TRANSLATE_BATCH":
      return translateBatch(message.texts || [], message.direction);
    case "SUMMARIZE":
      return summarizePage(message);
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

async function withSettings(directionOverride) {
  const settings = await atGetSettings();
  if (directionOverride) settings.direction = directionOverride;
  return settings;
}

async function translateText(text, directionOverride) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("没有可翻译的文本");
  const settings = await withSettings(directionOverride);
  const target = atResolveTargetLang(settings.direction, trimmed);
  const content = await atChatCompletion({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages: [
      { role: "system", content: atTranslateSystemPrompt(target) },
      { role: "user", content: trimmed },
    ],
    temperature: 0.2,
    maxTokens: 2048,
  });
  return { translation: content, targetLang: target };
}

async function translateBatch(texts, directionOverride) {
  const list = (texts || []).map((t) => String(t ?? ""));
  if (!list.length) return { translations: [] };

  const settings = await withSettings(directionOverride);
  const sample = list.find((t) => t.trim()) || "";
  const target = atResolveTargetLang(settings.direction, sample);

  // Chunk to keep prompts manageable
  const CHUNK = 20;
  const translations = new Array(list.length).fill("");

  for (let start = 0; start < list.length; start += CHUNK) {
    const slice = list.slice(start, start + CHUNK);
    // Skip empty-only slices carefully: still keep indices
    const nonEmptyIdx = [];
    const nonEmptyTexts = [];
    slice.forEach((t, i) => {
      if (t.trim()) {
        nonEmptyIdx.push(i);
        nonEmptyTexts.push(t);
      }
    });
    if (!nonEmptyTexts.length) continue;

    const messages = atBatchTranslateMessages(nonEmptyTexts, target);
    const raw = await atChatCompletion({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      messages,
      temperature: 0.2,
      maxTokens: 4096,
    });
    const parsed = atParseNumberedTranslations(raw, nonEmptyTexts.length);
    parsed.forEach((tr, j) => {
      translations[start + nonEmptyIdx[j]] = tr || nonEmptyTexts[j];
    });
  }

  return { translations, targetLang: target };
}

async function summarizePage(payload) {
  const settings = await atGetSettings();
  let pageText = String(payload?.text || "").trim();
  if (!pageText) throw new Error("页面没有可总结的文本");
  // Cap input size
  const MAX = 12000;
  if (pageText.length > MAX) {
    pageText = pageText.slice(0, MAX) + "\n…[truncated]";
  }
  const content = await atChatCompletion({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages: atSummarizeMessages(
      pageText,
      payload?.title || "",
      payload?.url || ""
    ),
    temperature: 0.4,
    maxTokens: 1500,
  });
  return { summary: content };
}
