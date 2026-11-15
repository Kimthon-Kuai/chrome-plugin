const DEFAULTS = {
  sourceLang: "auto",
  targetLang: "auto",
  pageMode: "overwrite",
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

function fillLang(settings) {
  $("sourceLang").value = settings.sourceLang || DEFAULTS.sourceLang;
  $("targetLang").value = settings.targetLang || DEFAULTS.targetLang;
}

async function loadSettings() {
  const settings = await send("GET_SETTINGS");
  fillLang(settings);
  $("pageMode").value = settings.pageMode || DEFAULTS.pageMode;
}

async function saveLang() {
  await send("SAVE_SETTINGS", {
    settings: {
      sourceLang: $("sourceLang").value,
      targetLang: $("targetLang").value,
    },
  });
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

  $("swapLangBtn").addEventListener("click", () => {
    const src = $("sourceLang").value;
    const tgt = $("targetLang").value;
    if (src === "auto" && tgt === "auto") return;
    $("sourceLang").value = tgt === "auto" ? "auto" : tgt;
    $("targetLang").value = src === "auto" ? "auto" : src;
  });

  $("saveLangBtn").addEventListener(
    "click",
    withBusy($("saveLangBtn"), async () => {
      try {
        await saveLang();
      } catch (e) {
        setStatus($("saveStatus"), e.message, "err");
      }
    })
  );

  $("openPanelBtn").addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") });
    }
  });

  $("translatePageBtn").addEventListener(
    "click",
    withBusy($("translatePageBtn"), async () => {
      const mode = $("pageMode").value;
      setStatus(
        $("actionStatus"),
        mode === "bilingual" ? "正在生成双语对照…" : "正在翻译页面…"
      );
      try {
        await saveLang();
        await send("SAVE_SETTINGS", { settings: { pageMode: mode } });
        const data = await sendToActiveTab({ type: "TRANSLATE_PAGE", mode });
        setStatus(
          $("actionStatus"),
          data?.mode === "bilingual"
            ? `双语对照完成（${data.count} 段）`
            : "全页翻译完成",
          "ok"
        );
      } catch (e) {
        setStatus($("actionStatus"), e.message, "err");
      }
    })
  );

  // Switching the mode on an already translated page applies it in place.
  $("pageMode").addEventListener("change", async () => {
    const mode = $("pageMode").value;
    try {
      await send("SAVE_SETTINGS", { settings: { pageMode: mode } });
      const data = await sendToActiveTab({ type: "SET_PAGE_MODE", mode });
      setStatus(
        $("actionStatus"),
        data?.applied
          ? mode === "bilingual"
            ? "已切换为双语对照"
            : "已切换为覆盖翻译"
          : "已保存翻译方式，下次全页翻译生效",
        data?.applied ? "ok" : ""
      );
    } catch (e) {
      setStatus($("actionStatus"), e.message, "err");
    }
  });

  $("restorePageBtn").addEventListener(
    "click",
    withBusy($("restorePageBtn"), async () => {
      try {
        await sendToActiveTab({ type: "RESTORE_PAGE" });
        setStatus($("actionStatus"), "已还原原文", "ok");      } catch (e) {
        setStatus($("actionStatus"), e.message, "err");
      }
    })
  );

  $("summarizeBtn").addEventListener(
    "click",
    withBusy($("summarizeBtn"), async () => {
      setStatus($("actionStatus"), "正在生成总结…");
      try {
        await saveLang();
        await sendToActiveTab({ type: "SUMMARIZE_PAGE" });
        setStatus($("actionStatus"), "总结已显示在页面侧栏", "ok");
      } catch (e) {
        setStatus($("actionStatus"), e.message, "err");
      }
    })
  );
});
