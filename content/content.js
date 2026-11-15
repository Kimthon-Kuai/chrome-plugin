(() => {
  if (window.__AT_CONTENT_LOADED__) return;
  window.__AT_CONTENT_LOADED__ = true;

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "CODE",
    "PRE",
    "KBD",
    "SVG",
    "MATH",
    "IFRAME",
  ]);

  /** @type {WeakMap<Text, string>} */
  const originalText = new WeakMap();
  /** @type {Text[]} */
  let translatedNodes = [];

  let selectionTimer = null;
  let lastSelection = "";

  function sendBg(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res?.ok) {
          reject(new Error(res?.error || "请求失败"));
          return;
        }
        resolve(res.data);
      });
    });
  }

  function showToast(text, ms = 2200) {
    let el = document.getElementById("at-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "at-toast";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("at-show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("at-show"), ms);
  }

  function setProgress(ratio) {
    let bar = document.querySelector(".at-progress-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "at-progress-bar";
      document.documentElement.appendChild(bar);
    }
    bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    if (ratio >= 1) {
      setTimeout(() => {
        if (bar) bar.style.width = "0";
      }, 300);
    }
  }

  /* ---------- Selection translate ---------- */

  function removeSelectionPopup() {
    document.getElementById("at-selection-popup")?.remove();
  }

  function placePopupNearSelection(popup, anchorRect) {
    let rect = anchorRect;
    if (!rect) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        rect = sel.getRangeAt(0).getBoundingClientRect();
      }
    }
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
      rect = {
        bottom: 80,
        left: Math.max(16, window.innerWidth / 2 - 120),
        top: 60,
        right: 0,
        width: 0,
        height: 0,
      };
    }
    const top = window.scrollY + rect.bottom + 8;
    let left = window.scrollX + rect.left;
    document.documentElement.appendChild(popup);
    const pw = popup.offsetWidth || 280;
    const maxLeft = window.scrollX + window.innerWidth - pw - 8;
    left = Math.max(window.scrollX + 8, Math.min(left, maxLeft));
    popup.style.top = `${Math.max(8, top)}px`;
    popup.style.left = `${left}px`;
  }

  async function translateSelection(text, anchorRect) {
    removeSelectionPopup();
    const popup = document.createElement("div");
    popup.id = "at-selection-popup";
    popup.className = "at-loading";
    popup.innerHTML =
      '<div class="at-pop-label">翻译</div><div class="at-pop-body">翻译中…</div>';
    placePopupNearSelection(popup, anchorRect);

    try {
      const data = await sendBg("TRANSLATE_TEXT", { text });
      popup.classList.remove("at-loading");
      popup.querySelector(".at-pop-body").textContent = data.translation;
      return data;
    } catch (e) {
      popup.classList.remove("at-loading");
      popup.classList.add("at-error");
      popup.querySelector(".at-pop-body").textContent = e.message || String(e);
      throw e;
    }
  }

  function onMouseUp(e) {
    if (e.target?.closest?.("#at-selection-popup, #at-summary-panel")) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? String(sel.toString()).trim() : "";
      if (!text || text.length < 2) {
        if (!e.target?.closest?.("#at-selection-popup")) removeSelectionPopup();
        return;
      }
      if (text === lastSelection && document.getElementById("at-selection-popup")) {
        return;
      }
      lastSelection = text;
      // Ignore huge selections (page translate instead)
      if (text.length > 1200) {
        showToast("选区过长，请使用「全页翻译」或缩短选区");
        return;
      }
      translateSelection(text).catch((err) => {
        showToast(err?.message || "划词翻译失败");
      });
    }, 180);
  }

  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        removeSelectionPopup();
        closeSummaryPanel();
      }
    },
    true
  );
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!e.target?.closest?.("#at-selection-popup")) {
        // Delay removal so click inside popup still works; mouseup handles re-open
        if (!e.target?.closest?.("#at-selection-popup")) {
          /* keep until mouseup decides */
        }
      }
    },
    true
  );

  /* ---------- Page translate ---------- */

  function isVisibleTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const text = node.nodeValue;
    if (!text || !text.trim()) return false;
    const parent = node.parentElement;
    if (!parent) return false;
    if (SKIP_TAGS.has(parent.tagName)) return false;
    if (parent.closest("#at-selection-popup, #at-summary-panel, #at-toast")) {
      return false;
    }
    if (parent.isContentEditable) return false;
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function collectTextNodes(root = document.body) {
    const nodes = [];
    if (!root) return nodes;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isVisibleTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      // Skip pure punctuation/whitespace-ish short noise optional — keep short labels
      nodes.push(n);
      if (nodes.length >= 400) break; // safety cap
    }
    return nodes;
  }

  function packBatches(nodes, maxChars = 1800) {
    const batches = [];
    let cur = [];
    let size = 0;
    for (const node of nodes) {
      const t = node.nodeValue;
      const len = t.length;
      if (cur.length && size + len > maxChars) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(node);
      size += len + 1;
      if (cur.length >= 18) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
    }
    if (cur.length) batches.push(cur);
    return batches;
  }

  async function translatePage() {
    const nodes = collectTextNodes();
    if (!nodes.length) {
      showToast("未找到可翻译文本");
      return { count: 0 };
    }

    // Restore previous before re-translate for clean state
    restorePage(false);

    const batches = packBatches(nodes);
    let done = 0;
    setProgress(0.05);
    showToast(`开始翻译（${nodes.length} 段）…`);

    for (const batch of batches) {
      const texts = batch.map((n) => n.nodeValue);
      const { translations } = await sendBg("TRANSLATE_BATCH", { texts });
      batch.forEach((node, i) => {
        if (!originalText.has(node)) {
          originalText.set(node, node.nodeValue);
          translatedNodes.push(node);
        }
        if (translations[i] != null && translations[i] !== "") {
          node.nodeValue = translations[i];
        }
      });
      done += batch.length;
      setProgress(done / nodes.length);
    }

    showToast(`全页翻译完成（${nodes.length} 段）`);
    setProgress(1);
    return { count: nodes.length };
  }

  function restorePage(notify = true) {
    let count = 0;
    for (const node of translatedNodes) {
      const orig = originalText.get(node);
      if (orig != null && node.parentNode) {
        node.nodeValue = orig;
        count += 1;
      }
    }
    translatedNodes = [];
    if (notify) showToast(count ? "已还原原文" : "没有可还原的内容");
    return { count };
  }

  /* ---------- Summarize ---------- */

  function extractPageText() {
    const clone = document.body.cloneNode(true);
    clone
      .querySelectorAll(
        "script,style,noscript,iframe,svg,#at-selection-popup,#at-summary-panel,#at-toast,.at-progress-bar,nav,footer"
      )
      .forEach((el) => el.remove());
    const text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  function ensureSummaryPanel() {
    let panel = document.getElementById("at-summary-panel");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "at-summary-panel";
    panel.innerHTML = `
      <div class="at-sum-header">
        <h2 class="at-sum-title">网页总结</h2>
        <button type="button" class="at-sum-close" aria-label="关闭">×</button>
      </div>
      <div class="at-sum-body at-muted">生成中…</div>
    `;
    panel.querySelector(".at-sum-close").addEventListener("click", () => {
      closeSummaryPanel();
    });
    document.documentElement.appendChild(panel);
    return panel;
  }

  function closeSummaryPanel() {
    const panel = document.getElementById("at-summary-panel");
    if (panel) panel.classList.remove("at-open");
  }

  async function summarizePage() {
    const panel = ensureSummaryPanel();
    const body = panel.querySelector(".at-sum-body");
    body.className = "at-sum-body at-muted";
    body.textContent = "正在分析页面…";
    panel.classList.add("at-open");

    try {
      const text = extractPageText();
      if (!text || text.length < 40) {
        throw new Error("页面文本过少，无法总结");
      }
      const data = await sendBg("SUMMARIZE", {
        text,
        title: document.title,
        url: location.href,
      });
      body.className = "at-sum-body";
      body.textContent = data.summary;
      return { summary: data.summary };
    } catch (e) {
      body.className = "at-sum-body at-error";
      body.textContent = e.message || String(e);
      throw e;
    }
  }

  async function translateSelectionText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("没有可翻译的文本");
    const h1 = document.querySelector("h1");
    const anchor = h1 ? h1.getBoundingClientRect() : null;
    const data = await translateSelection(trimmed, anchor);
    return { translation: data.translation };
  }

  /* ---------- Messaging from popup ---------- */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case "PING":
          return { pong: true };
        case "TRANSLATE_PAGE":
          return await translatePage();
        case "RESTORE_PAGE":
          return restorePage(true);
        case "SUMMARIZE_PAGE":
          return await summarizePage();
        case "TRANSLATE_SELECTION_TEXT":
          return await translateSelectionText(message.text || "");
        default:
          throw new Error(`Unknown content message: ${message?.type}`);
      }
    })()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || String(err) })
      );
    return true;
  });
})();
