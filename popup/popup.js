const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  direction: "auto",
};

const $ = (id) => document.getElementById(id);

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || "请求失败");
  return res.data;
}

async function ensureContentReady(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/content.css"],
    });
    return true;
  }
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("未找到当前标签页");
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    throw new Error("当前页面不支持（请打开普通网页）");
  }
  await ensureContentReady(tab.id);
  const res = await chrome.tabs.sendMessage(tab.id, message);
  if (!res?.ok) throw new Error(res?.error || "页面操作失败");
  return res.data;
}

function setStatus(el, text, kind = "") {
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function readForm() {
  return {
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("baseUrl").value.trim().replace(/\/+$/, ""),
    model: $("model").value.trim(),
    direction: $("direction").value,
  };
}

function fillForm(settings) {
  $("apiKey").value = settings.apiKey || "";
  $("baseUrl").value = settings.baseUrl || DEFAULTS.baseUrl;
  $("model").value = settings.model || DEFAULTS.model;
  $("direction").value = settings.direction || DEFAULTS.direction;
}

async function loadSettings() {
  const settings = await send("GET_SETTINGS");
  fillForm(settings);
}

async function saveSettings() {
  const settings = readForm();
  if (!settings.baseUrl) throw new Error("Base URL 不能为空");
  if (!settings.model) throw new Error("模型不能为空");
  await send("SAVE_SETTINGS", { settings });
  setStatus($("saveStatus"), "已保存", "ok");
}

function withBusy(btn, fn) {
  return async () => {
    const prev = btn.textContent;
    btn.disabled = true;
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadSettings();
  } catch (e) {
    setStatus($("saveStatus"), e.message, "err");
  }

  $("saveBtn").addEventListener(
    "click",
    withBusy($("saveBtn"), async () => {
      try {
        await saveSettings();
      } catch (e) {
        setStatus($("saveStatus"), e.message, "err");
      }
    })
  );

  $("translatePageBtn").addEventListener(
    "click",
    withBusy($("translatePageBtn"), async () => {
      setStatus($("actionStatus"), "正在翻译页面…");
      try {
        await saveSettings();
        await sendToActiveTab({ type: "TRANSLATE_PAGE" });
        setStatus($("actionStatus"), "全页翻译完成", "ok");
      } catch (e) {
        setStatus($("actionStatus"), e.message, "err");
      }
    })
  );

  $("restorePageBtn").addEventListener(
    "click",
    withBusy($("restorePageBtn"), async () => {
      try {
        await sendToActiveTab({ type: "RESTORE_PAGE" });
        setStatus($("actionStatus"), "已还原原文", "ok");
      } catch (e) {
        setStatus($("actionStatus"), e.message, "err");
      }
    })
  );

  $("summarizeBtn").addEventListener(
    "click",
    withBusy($("summarizeBtn"), async () => {
      setStatus($("actionStatus"), "正在生成总结…");
      try {
        await saveSettings();
        await sendToActiveTab({ type: "SUMMARIZE_PAGE" });
        setStatus($("actionStatus"), "总结已显示在页面侧栏", "ok");
      } catch (e) {
        setStatus($("actionStatus"), e.message, "err");
      }
    })
  );
});
