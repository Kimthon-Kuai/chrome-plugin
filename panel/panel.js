const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  sourceLang: "auto",
  targetLang: "auto",
  pageMode: "overwrite",
};

const TYPE_LABEL = {
  translate: "划词翻译",
  page: "全页翻译",
  summarize: "网页总结",
};

const LANG_LABEL = {
  auto: "自动",
  zh: "中文",
  en: "英文",
};

const $ = (id) => document.getElementById(id);

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || "请求失败");
  return res.data;
}

function setStatus(el, text, kind = "") {
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function switchTab(name) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.id === `tab-${name}`);
  });
  if (name === "history") loadHistory();
  if (name === "stats") loadStats();
}

async function loadSettings() {
  const settings = await send("GET_SETTINGS");
  $("apiKey").value = settings.apiKey || "";
  $("baseUrl").value = settings.baseUrl || DEFAULTS.baseUrl;
  $("model").value = settings.model || DEFAULTS.model;
  $("sourceLang").value = settings.sourceLang || DEFAULTS.sourceLang;
  $("targetLang").value = settings.targetLang || DEFAULTS.targetLang;
  setPageModeRadio(settings.pageMode || DEFAULTS.pageMode);
}

function getPageModeRadio() {
  return (
    document.querySelector('input[name="pageMode"]:checked')?.value ||
    DEFAULTS.pageMode
  );
}

function setPageModeRadio(mode) {
  document.querySelectorAll('input[name="pageMode"]').forEach((input) => {
    input.checked = input.value === mode;
  });
}

function setPageMode(mode) {
  document.querySelectorAll('input[name="pageMode"]').forEach((input) => {
    input.checked = input.value === mode;
  });
  setStatus(
    $("langStatus"),
    mode === "bilingual" ? "已选择双语对照，点击保存生效" : "已选择覆盖翻译，点击保存生效"
  );
}

/** Push the saved mode to the active tab so it can switch in place. */
async function applyModeToActiveTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
    setStatus($("langStatus"), "当前标签页不支持页面翻译", "err");
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/content.js"],
  });
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["content/content.css"],
  });
  const res = await chrome.tabs.sendMessage(tab.id, {
    type: "SET_PAGE_MODE",
    mode,
  });
  if (!res?.ok) throw new Error(res?.error || "切换失败");
  setStatus(
    $("langStatus"),
    res.data?.applied
      ? mode === "bilingual"
        ? "当前页面已切换为双语对照"
        : "当前页面已切换为覆盖翻译"
      : "已保存，下次全页翻译生效",
    "ok"
  );
}

async function saveApi() {
  const settings = {
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("baseUrl").value.trim().replace(/\/+$/, ""),
    model: $("model").value.trim(),
  };
  if (!settings.baseUrl) throw new Error("Base URL 不能为空");
  if (!settings.model) throw new Error("模型不能为空");
  await send("SAVE_SETTINGS", { settings });
  setStatus($("apiStatus"), "已保存", "ok");
}

async function saveLang() {
  const settings = {
    sourceLang: $("sourceLang").value,
    targetLang: $("targetLang").value,
    pageMode: getPageModeRadio(),
  };
  await send("SAVE_SETTINGS", { settings });
  setStatus($("langStatus"), "语言设置已保存", "ok");
}

function swapLang() {
  const src = $("sourceLang").value;
  const tgt = $("targetLang").value;
  // Keep auto meaningful: if both auto, no-op; else swap concrete values
  if (src === "auto" && tgt === "auto") return;
  $("sourceLang").value = tgt === "auto" ? "auto" : tgt;
  $("targetLang").value = src === "auto" ? "auto" : src;
}

function renderDaily(byDay) {
  const root = $("dailyStats");
  const days = Object.keys(byDay || {}).sort().reverse().slice(0, 7);
  if (!days.length) {
    root.innerHTML = '<p class="history-empty">暂无按日统计</p>';
    return;
  }
  const max = Math.max(...days.map((d) => byDay[d].totalTokens || 0), 1);
  root.innerHTML = days
    .map((day) => {
      const item = byDay[day];
      const pct = Math.round(((item.totalTokens || 0) / max) * 100);
      return `
        <div class="daily-item">
          <strong>${day}</strong>
          <div class="bar" title="${formatNumber(item.totalTokens)} tokens">
            <span style="width:${pct}%"></span>
          </div>
          <span>${formatNumber(item.totalTokens)} · ${formatNumber(item.requestCount)} 次</span>
        </div>
      `;
    })
    .join("");
}

async function loadStats() {
  const stats = await send("GET_TOKEN_STATS");
  $("statTotal").textContent = formatNumber(stats.totalTokens);
  $("statPrompt").textContent = formatNumber(stats.promptTokens);
  $("statCompletion").textContent = formatNumber(stats.completionTokens);
  $("statRequests").textContent = formatNumber(stats.requestCount);
  renderDaily(stats.byDay);
}

function renderHistory(list) {
  const root = $("historyList");
  const filter = $("historyFilter").value;
  const filtered =
    filter === "all" ? list : list.filter((item) => item.type === filter);

  if (!filtered.length) {
    root.innerHTML = '<p class="history-empty">暂无历史记录</p>';
    return;
  }

  root.innerHTML = filtered
    .map((item) => {
      const usage = item.usage || {};
      const lang =
        item.sourceLang || item.targetLang
          ? `${LANG_LABEL[item.sourceLang] || item.sourceLang || "—"} → ${LANG_LABEL[item.targetLang] || item.targetLang || "—"}`
          : "总结";
      return `
        <article class="history-item">
          <div class="history-meta">
            <span class="badge">${TYPE_LABEL[item.type] || item.type}</span>
            <span>${formatTime(item.ts)}</span>
            <span>${lang}</span>
            <span>${formatNumber(usage.total_tokens || 0)} tokens</span>
            ${item.title ? `<span>${escapeHtml(item.title)}</span>` : ""}
          </div>
          <p class="history-source">${escapeHtml(item.sourceText || "")}</p>
          <p class="history-result">${escapeHtml(item.resultText || "")}</p>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadHistory() {
  const list = await send("GET_HISTORY");
  renderHistory(list);
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  try {
    await loadSettings();
    await loadStats();
    await loadHistory();
  } catch (e) {
    setStatus($("apiStatus"), e.message, "err");
  }

  $("saveApiBtn").addEventListener("click", async () => {
    try {
      await saveApi();
    } catch (e) {
      setStatus($("apiStatus"), e.message, "err");
    }
  });

  $("saveLangBtn").addEventListener("click", async () => {
    try {
      await saveLang();
    } catch (e) {
      setStatus($("langStatus"), e.message, "err");
    }
  });

  $("swapLangBtn").addEventListener("click", () => {
    swapLang();
    setStatus($("langStatus"), "已互换，点击保存生效");
  });

  document.querySelectorAll('input[name="pageMode"]').forEach((input) => {
    input.addEventListener("change", () => setPageMode(input.value));
  });

  $("applyPageModeBtn").addEventListener("click", async () => {
    try {
      await applyModeToActiveTab(getPageModeRadio());
    } catch (e) {
      setStatus($("langStatus"), e.message, "err");
    }
  });

  $("clearStatsBtn").addEventListener("click", async () => {
    if (!confirm("确定清零全部 Token 统计？")) return;
    await send("CLEAR_TOKEN_STATS");
    await loadStats();
  });

  $("clearHistoryBtn").addEventListener("click", async () => {
    if (!confirm("确定清空全部翻译历史？")) return;
    await send("CLEAR_HISTORY");
    await loadHistory();
  });

  $("refreshHistoryBtn").addEventListener("click", () => loadHistory());
  $("historyFilter").addEventListener("change", () => loadHistory());

  // Deep-link: panel.html#history
  const hash = (location.hash || "").replace("#", "");
  if (["api", "lang", "stats", "history"].includes(hash)) {
    switchTab(hash);
  }
});
