/**
 * chrome.storage.local helpers for extension settings.
 * Loaded via importScripts in the service worker; popup/content duplicate thin wrappers as needed.
 */
const AT_DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  direction: "auto",
};

async function atGetSettings() {
  const data = await chrome.storage.local.get(AT_DEFAULTS);
  return {
    apiKey: (data.apiKey || "").trim(),
    baseUrl: (data.baseUrl || AT_DEFAULTS.baseUrl).trim().replace(/\/+$/, ""),
    model: (data.model || AT_DEFAULTS.model).trim(),
    direction: data.direction || AT_DEFAULTS.direction,
  };
}

async function atSaveSettings(partial) {
  const next = {};
  if (partial.apiKey !== undefined) next.apiKey = String(partial.apiKey).trim();
  if (partial.baseUrl !== undefined) {
    next.baseUrl = String(partial.baseUrl).trim().replace(/\/+$/, "");
  }
  if (partial.model !== undefined) next.model = String(partial.model).trim();
  if (partial.direction !== undefined) next.direction = partial.direction;
  await chrome.storage.local.set(next);
  return atGetSettings();
}
