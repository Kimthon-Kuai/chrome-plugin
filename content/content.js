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

  const PAGE_MODES = ["overwrite", "bilingual"];
  let pageMode = "overwrite";
  /** @type {Map<Text, HTMLElement>} */
  let bilingualBlocks = new Map();
  /** @type {{ text: string, rect: DOMRect | null } | null} */
  let lastSelectionInfo = null;

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
    removeSelectionReopen();
    const rect =
      anchorRect ||
      (window.getSelection() && window.getSelection().rangeCount > 0
        ? window.getSelection().getRangeAt(0).getBoundingClientRect()
        : null);
    lastSelectionInfo = { text, rect };
    if (pageMode === "bilingual") renderSelectionReopen();
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
    if (e.target?.closest?.("#at-sel-reopen")) {
      reopenSelectionPopup();
      return;
    }
    const quick = readSelection();
    if (!quick) dismissSelectionPopup();
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const picked = readSelection();
      if (!picked) {
        dismissSelectionPopup();
        return;
      }
      const { text } = picked;
      if (text.length < 2) {
        dismissSelectionPopup();
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

  function reopenSelectionPopup() {
    if (!lastSelectionInfo?.text) return;
    translateSelection(lastSelectionInfo.text, lastSelectionInfo.rect).catch(
      (err) => {
        showToast(err?.message || "划词翻译失败");
      }
    );
  }

  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        dismissSelectionPopup();
        removeSelectionReopen();
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
    if (
      parent.closest(
        "#at-selection-popup, #at-summary-panel, #at-toast, #at-sel-reopen"
      )
    ) {
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

  function applyTranslation(node, translation) {
    if (translation == null || translation === "") return;
    if (pageMode === "bilingual") {
      if (!ensureBilingualBlock(node, translation)) return;
    } else {
      node.nodeValue = translation;
    }
    if (!translatedNodes.includes(node)) translatedNodes.push(node);
  }

  function normalizeMode(mode) {
    return PAGE_MODES.includes(mode) ? mode : "overwrite";
  }

  async function translatePage(mode = "overwrite") {
    const nodes = collectTextNodes();
    if (!nodes.length) {
      showToast("未找到可翻译文本");
      return { count: 0, mode: normalizeMode(mode) };
    }

    // Restore previous before re-translate for clean state
    restorePage(false);
    pageMode = normalizeMode(mode);

    const batches = packBatches(nodes);
    let done = 0;
    setProgress(0.05);
    showToast(
      `${pageMode === "bilingual" ? "开始双语对照" : "开始翻译"}（${nodes.length} 段）…`
    );

    try {
      for (const batch of batches) {
        const texts = batch.map((n) => n.nodeValue);
        const { translations } = await sendBg("TRANSLATE_BATCH", { texts });
        batch.forEach((node, i) => {
          if (!originalText.has(node)) {
            originalText.set(node, node.nodeValue);
          }
          applyTranslation(node, translations[i]);
        });
        done += batch.length;
        setProgress(done / nodes.length);
      }
    } catch (err) {
      // Keep partial results usable instead of leaving a half-rendered state
      setProgress(0);
      showToast(`翻译中断：${err?.message || err}`, 3200);
      throw err;
    }

    showToast(
      `${
        pageMode === "bilingual" ? "双语对照已完成" : "全页翻译完成"
      }（${nodes.length} 段）`
    );
    setProgress(1);
    return { count: nodes.length, mode: pageMode };
  }

  /** Switch an already translated page between overwrite and bilingual view. */
  function setPageMode(mode) {
    const next = normalizeMode(mode);
    if (!translatedNodes.length) {
      pageMode = next;
      return { mode: next, count: 0, applied: false };
    }
    pageMode = next;
    const replaced = new Set();
    for (const node of translatedNodes) {
      if (!node.parentNode) continue;
      if (next === "bilingual") {
        const block = bilingualBlocks.get(node);
        if (block && block.classList.contains("at-has-translation")) continue;
        const text = node.nodeValue;
        // Collapse duplicates produced by the current overwrite render
        if (replaced.has(text)) continue;
        replaced.add(text);
        ensureBilingualBlock(node, text);
      } else {
        const block = bilingualBlocks.get(node);
        const text = bilingualTextOf(block);
        removeBilingualBlock(node);
        if (text) node.nodeValue = text;
      }
    }
    removeSelectionPopup();
    renderSelectionReopen();
    showToast(next === "bilingual" ? "已切换到双语对照" : "已切换到覆盖翻译");
    return { mode: next, count: translatedNodes.length, applied: true };
  }

  function restorePage(notify = true) {
    let count = 0;
    for (const node of translatedNodes) {
      removeBilingualBlock(node);
      const orig = originalText.get(node);
      if (orig != null && node.parentNode) {
        node.nodeValue = orig;
        count += 1;
      }
    }
    translatedNodes = [];
    bilingualBlocks = new Map();
    lastSelectionInfo = null;
    removeSelectionReopen();
    if (notify) showToast(count ? "已还原原文" : "没有可还原的内容");
    return { count, mode: pageMode };
  }

  /* ---------- Bilingual parallel view ---------- */

  // Wrapper inserted after each translated source node in bilingual mode.
  const BILINGUAL_SELECTOR = "[data-at-bilingual]";

  function bilingualTextOf(block) {
    return block?.querySelector(".at-bilingual-text")?.textContent || "";
  }

  /**
   * Keep the original text node in place and append the translation right
   * after it, so the source and target are visible together.
   */
  function ensureBilingualBlock(node, translation) {
    if (!node.parentNode || node.parentNode.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    if (translation == null || translation === "") return null;
    let block = bilingualBlocks.get(node);
    if (block && !block.isConnected) {
      bilingualBlocks.delete(node);
      block = null;
    }
    if (!block) {
      block = document.createElement("span");
      block.className = "at-bilingual";
      block.setAttribute("data-at-bilingual", "");
      block.setAttribute("lang", "zh-CN");
      const text = document.createElement("span");
      text.className = "at-bilingual-text";
      block.appendChild(text);
      node.parentNode.insertBefore(block, node.nextSibling);
      bilingualBlocks.set(node, block);
    }
    const textEl = block.querySelector(".at-bilingual-text");
    const value = String(translation).trim();
    if (textEl.textContent !== value) textEl.textContent = value;
    return block;
  }

  function removeBilingualBlock(node) {
    const block = bilingualBlocks.get(node);
    if (block) {
      block.remove();
      bilingualBlocks.delete(node);
    }
  }

  /* ---------- Selection helpers for bilingual mode ---------- */

  function selectionSourceNode(selectionNode) {
    if (!selectionNode) return null;
    if (selectionNode.nodeType === Node.TEXT_NODE) {
      return bilingualBlocks.has(selectionNode) ? selectionNode : null;
    }
    const el =
      selectionNode.nodeType === Node.ELEMENT_NODE
        ? selectionNode
        : selectionNode.parentElement;
    const prev = el?.closest?.(BILINGUAL_SELECTOR)?.previousSibling;
    return prev?.nodeType === Node.TEXT_NODE ? prev : null;
  }

  /** In bilingual mode the raw selection includes both languages. */
  function readSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const text = String(sel.toString()).trim();
    if (!text) return null;
    if (pageMode !== "bilingual") return { text };
    const srcNode = selectionSourceNode(sel.anchorNode);
    if (srcNode) {
      const raw = String(srcNode.nodeValue || "");
      if (raw.includes(text)) return { text, sourceNode: srcNode };
      // Selections that cross a block boundary yield "source\ntranslation".
      const firstLine = text.split(/\n/)[0].trim();
      if (firstLine && raw.includes(firstLine)) {
        return { text: firstLine, sourceNode: srcNode };
      }
    }
    return { text };
  }

  function dismissSelectionPopup() {
    const hadPopup = !!document.getElementById("at-selection-popup");
    removeSelectionPopup();
    if (hadPopup) renderSelectionReopen();
  }

  /** Small "translate original" chip shown after closing the floating popup. */
  function renderSelectionReopen() {
    removeSelectionReopen();
    if (pageMode !== "bilingual" || !lastSelectionInfo?.text) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "at-sel-reopen";
    btn.textContent = "翻译原文";
    document.documentElement.appendChild(btn);
    const rect = lastSelectionInfo.rect;
    if (rect && (rect.left || rect.top)) {
      const top = Math.max(8, window.scrollY + rect.bottom + 6);
      let left = window.scrollX + rect.left;
      left = Math.max(
        window.scrollX + 8,
        Math.min(left, window.scrollX + window.innerWidth - 96)
      );
      btn.style.top = `${top}px`;
      btn.style.left = `${left}px`;
    } else {
      btn.style.top = "50vh";
      btn.style.left = "50vw";
    }
  }

  function removeSelectionReopen() {
    document.getElementById("at-sel-reopen")?.remove();
  }

  /* ---------- Summarize ---------- */

  function extractPageText() {
    const clone = document.body.cloneNode(true);
    clone
      .querySelectorAll(
        "script,style,noscript,iframe,svg,#at-selection-popup,#at-summary-panel,#at-toast,.at-progress-bar,nav,footer"
      )
      .forEach((el) => el.remove());
    // Bilingual view: keep only the original text so summaries read naturally.
    clone.querySelectorAll("[data-at-bilingual]").forEach((el) => el.remove());
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
    if (pageMode === "bilingual") {
      // Translate the original text (not the already rendered translation).
      const raw = String(text || "").trim();
      const src = translatedNodes.find(
        (n) => String(n.nodeValue || "").trim() === raw
      );
      const data = await translateSelection(
        raw,
        src ? src.parentElement?.getBoundingClientRect() : null
      );
      return { translation: data.translation, sourceText: raw };
    }
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
          return await translatePage(message.mode);
        case "SET_PAGE_MODE":
          return setPageMode(message.mode);
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
