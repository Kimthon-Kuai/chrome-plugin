/* global atGetSettings, atSaveSettings, atChatCompletion,
          atResolveLangPair, atTranslateSystemPrompt, atBatchTranslateMessages,
          atParseNumberedTranslations, atSummarizeMessages,
          atAddHistory, atGetHistory, atClearHistory,
          atGetTokenStats, atAddTokenUsage, atClearTokenStats */

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
  return true;
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
    case "GET_HISTORY":
      return atGetHistory(message.limit || 200);
    case "CLEAR_HISTORY":
      return atClearHistory();
    case "GET_TOKEN_STATS":
      return atGetTokenStats();
    case "CLEAR_TOKEN_STATS":
      return atClearTokenStats();
    case "TRANSLATE_TEXT":
      return translateText(message.text || "", message.settingsOverride);
    case "TRANSLATE_BATCH":
      return translateBatch(message.texts || [], message.settingsOverride);
    case "SUMMARIZE":
      return summarizePage(message);
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

async function withSettings(override) {
  const settings = await atGetSettings();
  if (!override) return settings;
  return {
    ...settings,
    ...override,
    sourceLang: override.sourceLang || settings.sourceLang,
    targetLang: override.targetLang || settings.targetLang,
  };
}

function mergeUsage(a, b) {
  return {
    prompt_tokens: (a?.prompt_tokens || 0) + (b?.prompt_tokens || 0),
    completion_tokens: (a?.completion_tokens || 0) + (b?.completion_tokens || 0),
    total_tokens: (a?.total_tokens || 0) + (b?.total_tokens || 0),
  };
}

async function translateText(text, settingsOverride) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("没有可翻译的文本");
  const settings = await withSettings(settingsOverride);
  const pair = atResolveLangPair(settings, trimmed);
  const result = await atChatCompletion({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages: [
      {
        role: "system",
        content: atTranslateSystemPrompt(pair.targetLabel, pair.sourceLabel),
      },
      { role: "user", content: trimmed },
    ],
    temperature: 0.2,
    maxTokens: 2048,
  });

  await atAddTokenUsage(result.usage);
  await atAddHistory({
    type: "translate",
    sourceLang: pair.sourceCode,
    targetLang: pair.targetCode,
    sourceText: trimmed,
    resultText: result.content,
    usage: result.usage,
  });

  return {
    translation: result.content,
    sourceLang: pair.sourceCode,
    targetLang: pair.targetCode,
    usage: result.usage,
  };
}

async function translateBatch(texts, settingsOverride) {
  const list = (texts || []).map((t) => String(t ?? ""));
  if (!list.length) return { translations: [], usage: mergeUsage({}, {}) };

  const settings = await withSettings(settingsOverride);
  const sample = list.find((t) => t.trim()) || "";
  const pair = atResolveLangPair(settings, sample);

  const CHUNK = 20;
  const translations = new Array(list.length).fill("");
  let usage = mergeUsage({}, {});

  for (let start = 0; start < list.length; start += CHUNK) {
    const slice = list.slice(start, start + CHUNK);
    const nonEmptyIdx = [];
    const nonEmptyTexts = [];
    slice.forEach((t, i) => {
      if (t.trim()) {
        nonEmptyIdx.push(i);
        nonEmptyTexts.push(t);
      }
    });
    if (!nonEmptyTexts.length) continue;

    const messages = atBatchTranslateMessages(
      nonEmptyTexts,
      pair.targetLabel,
      pair.sourceLabel
    );
    const result = await atChatCompletion({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      messages,
      temperature: 0.2,
      maxTokens: 4096,
    });
    usage = mergeUsage(usage, result.usage);
    await atAddTokenUsage(result.usage);

    const parsed = atParseNumberedTranslations(
      result.content,
      nonEmptyTexts.length
    );
    parsed.forEach((tr, j) => {
      translations[start + nonEmptyIdx[j]] = tr || nonEmptyTexts[j];
    });
  }

  const previewSrc = list.filter((t) => t.trim()).slice(0, 3).join(" / ");
  const previewOut = translations.filter((t) => t.trim()).slice(0, 3).join(" / ");
  await atAddHistory({
    type: "page",
    sourceLang: pair.sourceCode,
    targetLang: pair.targetCode,
    sourceText: `${list.filter((t) => t.trim()).length} 段 · ${previewSrc}`,
    resultText: previewOut,
    usage,
  });

  return {
    translations,
    sourceLang: pair.sourceCode,
    targetLang: pair.targetCode,
    usage,
  };
}

async function summarizePage(payload) {
  const settings = await atGetSettings();
  let pageText = String(payload?.text || "").trim();
  if (!pageText) throw new Error("页面没有可总结的文本");
  const MAX = 12000;
  if (pageText.length > MAX) {
    pageText = pageText.slice(0, MAX) + "\n…[truncated]";
  }
  const result = await atChatCompletion({
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

  await atAddTokenUsage(result.usage);
  await atAddHistory({
    type: "summarize",
    sourceLang: "",
    targetLang: "zh",
    sourceText: pageText.slice(0, 300),
    resultText: result.content,
    url: payload?.url || "",
    title: payload?.title || "",
    usage: result.usage,
  });

  return { summary: result.content, usage: result.usage };
}
