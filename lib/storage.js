/**
 * chrome.storage.local helpers for settings, history, and token stats.
 */
const AT_DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  // Legacy shortcut; kept in sync with sourceLang/targetLang
  direction: "auto",
  sourceLang: "auto", // auto | zh | en
  targetLang: "auto", // auto | zh | en
};

const AT_HISTORY_KEY = "history";
const AT_STATS_KEY = "tokenStats";
const AT_HISTORY_MAX = 200;

const AT_EMPTY_STATS = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  byDay: {},
};

function atNormalizeDirectionPair(sourceLang, targetLang) {
  const src = sourceLang || "auto";
  const tgt = targetLang || "auto";
  if (src === "zh" && tgt === "en") return "zh2en";
  if (src === "en" && tgt === "zh") return "en2zh";
  return "auto";
}

function atPairFromDirection(direction) {
  if (direction === "zh2en") return { sourceLang: "zh", targetLang: "en" };
  if (direction === "en2zh") return { sourceLang: "en", targetLang: "zh" };
  return { sourceLang: "auto", targetLang: "auto" };
}

async function atGetSettings() {
  const data = await chrome.storage.local.get(AT_DEFAULTS);
  let sourceLang = data.sourceLang || AT_DEFAULTS.sourceLang;
  let targetLang = data.targetLang || AT_DEFAULTS.targetLang;
  // Migrate older installs that only had direction
  if (
    (!data.sourceLang || !data.targetLang) &&
    data.direction &&
    data.direction !== "auto"
  ) {
    const pair = atPairFromDirection(data.direction);
    sourceLang = pair.sourceLang;
    targetLang = pair.targetLang;
  }
  return {
    apiKey: (data.apiKey || "").trim(),
    baseUrl: (data.baseUrl || AT_DEFAULTS.baseUrl).trim().replace(/\/+$/, ""),
    model: (data.model || AT_DEFAULTS.model).trim(),
    sourceLang,
    targetLang,
    direction: atNormalizeDirectionPair(sourceLang, targetLang),
  };
}

async function atSaveSettings(partial) {
  const next = {};
  if (partial.apiKey !== undefined) next.apiKey = String(partial.apiKey).trim();
  if (partial.baseUrl !== undefined) {
    next.baseUrl = String(partial.baseUrl).trim().replace(/\/+$/, "");
  }
  if (partial.model !== undefined) next.model = String(partial.model).trim();

  if (partial.sourceLang !== undefined || partial.targetLang !== undefined) {
    const current = await atGetSettings();
    const sourceLang = partial.sourceLang ?? current.sourceLang;
    const targetLang = partial.targetLang ?? current.targetLang;
    next.sourceLang = sourceLang;
    next.targetLang = targetLang;
    next.direction = atNormalizeDirectionPair(sourceLang, targetLang);
  } else if (partial.direction !== undefined) {
    const pair = atPairFromDirection(partial.direction);
    next.direction = partial.direction;
    next.sourceLang = pair.sourceLang;
    next.targetLang = pair.targetLang;
  }

  await chrome.storage.local.set(next);
  return atGetSettings();
}

function atDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function atNormalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const total =
    Number(usage.total_tokens) || prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

async function atGetTokenStats() {
  const data = await chrome.storage.local.get({ [AT_STATS_KEY]: AT_EMPTY_STATS });
  const stats = data[AT_STATS_KEY] || AT_EMPTY_STATS;
  return {
    promptTokens: Number(stats.promptTokens) || 0,
    completionTokens: Number(stats.completionTokens) || 0,
    totalTokens: Number(stats.totalTokens) || 0,
    requestCount: Number(stats.requestCount) || 0,
    byDay: stats.byDay && typeof stats.byDay === "object" ? stats.byDay : {},
  };
}

async function atAddTokenUsage(usage) {
  const u = atNormalizeUsage(usage);
  if (!u.total_tokens && !u.prompt_tokens && !u.completion_tokens) {
    const stats = await atGetTokenStats();
    return stats;
  }
  const stats = await atGetTokenStats();
  const day = atDayKey();
  const dayStat = stats.byDay[day] || {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
  };
  dayStat.promptTokens += u.prompt_tokens;
  dayStat.completionTokens += u.completion_tokens;
  dayStat.totalTokens += u.total_tokens;
  dayStat.requestCount += 1;

  stats.promptTokens += u.prompt_tokens;
  stats.completionTokens += u.completion_tokens;
  stats.totalTokens += u.total_tokens;
  stats.requestCount += 1;
  stats.byDay[day] = dayStat;

  await chrome.storage.local.set({ [AT_STATS_KEY]: stats });
  return stats;
}

async function atClearTokenStats() {
  await chrome.storage.local.set({ [AT_STATS_KEY]: { ...AT_EMPTY_STATS, byDay: {} } });
  return atGetTokenStats();
}

async function atGetHistory(limit = AT_HISTORY_MAX) {
  const data = await chrome.storage.local.get({ [AT_HISTORY_KEY]: [] });
  const list = Array.isArray(data[AT_HISTORY_KEY]) ? data[AT_HISTORY_KEY] : [];
  return list.slice(0, Math.max(1, limit));
}

async function atAddHistory(entry) {
  const list = await atGetHistory();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    type: entry.type || "translate",
    sourceLang: entry.sourceLang || "",
    targetLang: entry.targetLang || "",
    sourceText: String(entry.sourceText || "").slice(0, 500),
    resultText: String(entry.resultText || "").slice(0, 800),
    url: entry.url || "",
    title: entry.title || "",
    usage: atNormalizeUsage(entry.usage),
  };
  list.unshift(item);
  await chrome.storage.local.set({
    [AT_HISTORY_KEY]: list.slice(0, AT_HISTORY_MAX),
  });
  return item;
}

async function atClearHistory() {
  await chrome.storage.local.set({ [AT_HISTORY_KEY]: [] });
  return [];
}
