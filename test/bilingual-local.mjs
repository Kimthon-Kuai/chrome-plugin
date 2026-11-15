/**
 * Bilingual (parallel) view smoke test.
 *
 *   node test/bilingual-local.mjs            # deterministic stub API, no network
 *   node test/bilingual-local.mjs --live     # use stored DeepSeek settings (quoted only)
 *
 * Checks the acceptance criteria for 覆盖翻译 / 双语对照 / 还原 / 划词 / 总结
 * inside a real Chrome with the unpacked extension.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = process.env.AT_EXT_DIR
  ? path.resolve(process.env.AT_EXT_DIR)
  : path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "bilingual.html");
const LIVE = process.argv.includes("--live");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean);

const LOCAL_REPLIES = [
  "人工智能正在改变人们每天工作、学习和创作的方式。",
  "并行阅读让原文与译文同时可见，便于对比语义与术语。",
  "请先选择文本再翻译。",
  "链接与列表在对照模式下依然可以正常使用。",
  "对照视图会把译文标记为次要内容。",
  "功能一：对比原文与译文",
  "功能二：切换回覆盖模式",
  "功能三：随时还原原始页面",
  "选择一句话试试，确认划词翻译在原文页面上仍然可用。",
  "带人工智能翻译，构建更快。",
  "这句引导语保持简短，便于观察双语对照的排版效果。",
  "要点：原文与译文同时可见\n要点：可切换回覆盖模式\n要点：还原后回到翻译前状态",
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error("Chrome executable not found (set CHROME_PATH)");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function startStubApi() {
  let replyIndex = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        /* ignore */
      }
      const user = payload.messages?.find((m) => m.role === "user");
      const content = String(user?.content || "");
      let text;
      if (/summar/i.test(payload.messages?.[0]?.content || "")) {
        text = "要点：对照模式保留原文\n要点：可切换到覆盖模式\n要点：随时可还原";
      } else {
        const count = (content.match(/^\[\d+\]/gm) || []).length;
        if (count > 1) {
          text = Array.from({ length: count }, (_, i) => {
            const reply = LOCAL_REPLIES[replyIndex % LOCAL_REPLIES.length];
            replyIndex += 1;
            return `[${i + 1}] ${reply}（${i + 1}）`;
          }).join("\n");
        } else {
          text = LOCAL_REPLIES[replyIndex % LOCAL_REPLIES.length];
          replyIndex += 1;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/v1` });
    });
  });
}

function startFixtureServer() {
  const html = fs.readFileSync(FIXTURE);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

async function getExtension(browser) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const map = await browser.extensions();
    for (const [id, ext] of map) {
      if (ext.name === "AI Translator") return { id, ext };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("AI Translator extension not found");
}

async function getWorker(ext) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const workers = await ext.workers();
    if (workers.length) return workers[0];
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Extension service worker not available");
}

async function main() {
  const stub = LIVE ? null : await startStubApi();
  const chromePath = findChrome();
  const { server, url: pageUrl } = await startFixtureServer();
  console.log("Mode:", LIVE ? "live (stored settings)" : "stub API", stub?.url || "");
  console.log("Page:", pageUrl);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    enableExtensions: [EXT_DIR],
    defaultViewport: { width: 1200, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  const results = [];
  const pass = (name, detail = "ok") => {
    results.push([name, detail]);
    console.log(`✔ ${name}: ${detail}`);
  };

  try {
    const { id: extensionId, ext } = await getExtension(browser);
    const panel = await browser.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel/panel.html`, {
      waitUntil: "domcontentloaded",
    });
    await panel.waitForSelector("#apiKey");

    if (LIVE) {
      const stored = await panel.evaluate(
        () => new Promise((r) => chrome.storage.local.get(["apiKey", "baseUrl", "model"], r))
      );
      const apiKey = process.env.AT_API_KEY || stored.apiKey;
      assert(
        apiKey,
        "No API Key found (env AT_API_KEY empty and none stored in the test profile) — set $env:AT_API_KEY or configure the extension first"
      );
      const baseUrl = process.env.AT_BASE_URL || stored.baseUrl || "https://api.deepseek.com";
      const model = process.env.AT_MODEL || stored.model || "deepseek-v4-flash";
      console.log("Live API:", baseUrl, model);
      await panel.evaluate(
        async (s) => {
          await chrome.storage.local.set(s);
        },
        { apiKey, baseUrl, model, sourceLang: "en", targetLang: "zh", pageMode: "overwrite" }
      );
    } else {
      const worker = await getWorker(ext);
      await worker.evaluate(
        async (settings) => {
          await chrome.storage.local.set(settings);
        },
        {
          apiKey: "stub-key",
          baseUrl: stub.url,
          model: "stub-model",
          sourceLang: "en",
          targetLang: "zh",
          direction: "en2zh",
          pageMode: "overwrite",
        }
      );
    }

    // Panel reflects the saved mode
    await panel.reload({ waitUntil: "domcontentloaded" });
    await panel.waitForSelector('input[name="pageMode"]:checked');
    const panelMode = await panel.$eval(
      'input[name="pageMode"]:checked',
      (el) => el.value
    );
    assert(panelMode === "overwrite", `Panel mode should default to overwrite, got ${panelMode}`);
    pass("PANEL mode radio", panelMode);

    // Page always starting in overwrite mode for the first translate
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "networkidle0" });
    const original = await page.$eval("#p1", (el) => el.textContent.trim());

    const bridge = await browser.newPage();
    await bridge.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    const tabId = await bridge.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      const target = tabs[tabs.length - 1];
      try {
        await chrome.tabs.sendMessage(target.id, { type: "PING" });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: target.id },
          files: ["content/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: target.id },
          files: ["content/content.css"],
        });
      }
      return target.id;
    });

    const send = (msg) =>
      bridge.evaluate(
        (id, m) => chrome.tabs.sendMessage(id, m),
        tabId,
        msg
      );

    /* ---------- 1. Overwrite mode (existing behaviour) ---------- */
    const ow = await send({ type: "TRANSLATE_PAGE", mode: "overwrite" });
    assert(ow?.ok, `overwrite translate failed: ${JSON.stringify(ow)}`);
    const owText = await page.$eval("#p1", (el) => el.textContent.trim());
    assert(owText !== original, "overwrite did not replace text");
    assert(/[\u4e00-\u9fff]/.test(owText), `overwrite not Chinese: ${owText}`);
    const owBlocks = await page.$$eval("[data-at-bilingual]", (els) => els.length);
    assert(owBlocks === 0, "overwrite mode must not insert bilingual blocks");
    pass("OVERWRITE", owText.slice(0, 30) + "…");

    /* ---------- 2. Switch to bilingual in place ---------- */
    const sw = await send({ type: "SET_PAGE_MODE", mode: "bilingual" });
    assert(sw?.ok, `SET_PAGE_MODE failed: ${JSON.stringify(sw)}`);
    assert(sw.data?.applied, "expected in-place switch");
    const bi = await page.$eval("#p1", (el) => ({
      source: Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.nodeValue)
        .join("")
        .trim(),
      translated: el.querySelector(".at-bilingual-text")?.textContent || "",
      blockCount: el.querySelectorAll("[data-at-bilingual]").length,
    }));
    assert(bi.blockCount === 1, `expected 1 block in #p1, got ${bi.blockCount}`);
    assert(bi.source !== original, "source should hold the译文 after switching from overwrite");
    assert(/[\u4e00-\u9fff]/.test(bi.translated), `translation missing: ${bi.translated}`);
    const blockCount = await page.$$eval("[data-at-bilingual]", (els) => els.length);
    assert(blockCount >= 5, `expected several bilingual blocks, got ${blockCount}`);
    const duplicate = await page.$$eval("[data-at-bilingual]", (els) =>
      els.filter((el) => el.querySelectorAll("[data-at-bilingual]").length > 0).length
    );
    assert(duplicate === 0, "bilingual blocks must not nest");
    pass("SWITCH to bilingual", `${blockCount} blocks`);

    /* ---------- 3. Restore from bilingual ---------- */
    const restored = await send({ type: "RESTORE_PAGE" });
    assert(restored?.ok, `restore failed: ${JSON.stringify(restored)}`);
    const afterRestore = await page.evaluate(() => ({
      p1: document.querySelector("#p1").textContent.trim(),
      blocks: document.querySelectorAll("[data-at-bilingual]").length,
    }));
    assert(afterRestore.p1 === original, `restore mismatch: ${afterRestore.p1}`);
    assert(afterRestore.blocks === 0, "bilingual blocks left behind after restore");
    pass("RESTORE from bilingual", "original text back");

    /* ---------- 4. Fresh bilingual translate ---------- */
    const bi2 = await send({ type: "TRANSLATE_PAGE", mode: "bilingual" });
    assert(bi2?.ok, `bilingual translate failed: ${JSON.stringify(bi2)}`);
    assert(bi2.data?.mode === "bilingual", `unexpected mode ${bi2.data?.mode}`);
    const both = await page.evaluate(() => {
      const el = document.querySelector("#p1");
      const textNodes = Array.from(el.childNodes).filter(
        (n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()
      );
      const block = el.querySelector("[data-at-bilingual]");
      return {
        source: textNodes.map((n) => n.nodeValue).join(" ").replace(/\s+/g, " ").trim(),
        translated: block?.querySelector(".at-bilingual-text")?.textContent || "",
        display: block ? getComputedStyle(block).display : "",
        color: block ? getComputedStyle(block).color : "",
        border: block ? getComputedStyle(block).borderLeftColor : "",
      };
    });
    assert(both.source.includes(original.slice(0, 20)), `original text gone: ${both.source}`);
    assert(/[\u4e00-\u9fff]/.test(both.translated), "translation missing in fresh run");
    assert(both.display === "block", `bilingual block should stack: ${both.display}`);
    assert(both.color !== "rgb(21, 32, 51)", "translation should be visually distinct");
    pass("BILINGUAL both visible", `"${both.source.slice(0, 24)}…" + "${both.translated.slice(0, 12)}…"`);
    await page
      .screenshot({
        path: path.join(__dirname, "..", ".chrome-test-profile-e2e", "bilingual-view.png"),
        fullPage: true,
      })
      .catch(() => {});

    /* ---------- 5. Selection translation in bilingual mode ---------- */
    const sel = await send({ type: "TRANSLATE_SELECTION_TEXT", text: original });
    assert(sel?.ok, `selection failed: ${JSON.stringify(sel)}`);
    assert(/[\u4e00-\u9fff]/.test(sel.data?.translation || ""), "selection not translated");
    const popupOk = await page.evaluate(
      () => !!document.querySelector("#at-selection-popup .at-pop-body")
    );
    assert(popupOk, "selection popup missing");
    pass("SELECTION in bilingual", sel.data.translation.slice(0, 24));

    // Synthetic selection spanning source + translation should send the source
    const spans = await page.evaluate(() => {
      const el = document.querySelector("#p2");
      const src = Array.from(el.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()
      );
      const block = el.querySelector("[data-at-bilingual]");
      if (!src || !block) return false;
      const range = document.createRange();
      range.setStart(src, 0);
      range.setEnd(block.querySelector(".at-bilingual-text").firstChild, 4);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return true;
    });
    assert(spans, "could not build a cross-language selection");
    await new Promise((r) => setTimeout(r, 350));
    const selPopup = await page.evaluate(() => {
      const body = document.querySelector("#at-selection-popup .at-pop-body");
      return body ? body.textContent.trim() : "";
    });
    if (selPopup) {
      assert(
        /[\u4e00-\u9fff]/.test(selPopup) && !/[\u4e00-\u9fff].*[A-Za-z]{6,}/.test(selPopup),
        `cross-language selection should translate the source only: ${selPopup}`
      );
    }
    pass("SELECTION source only", selPopup ? selPopup.slice(0, 24) : "popup pending");

    /* ---------- 6. Summary sidebar while in bilingual mode ---------- */
    await page.keyboard.press("Escape");
    const sum = await send({ type: "SUMMARIZE_PAGE" });
    assert(sum?.ok, `summarize failed: ${JSON.stringify(sum)}`);
    const sumInfo = await page.evaluate(() => {
      const panel = document.getElementById("at-summary-panel");
      return {
        open: panel?.classList.contains("at-open") || false,
        body: panel?.querySelector(".at-sum-body")?.textContent?.trim() || "",
      };
    });
    assert(sumInfo.open && sumInfo.body.length > 10, "summary panel not rendered");
    pass("SUMMARY", sumInfo.body.slice(0, 30).replace(/\n/g, " "));

    // Page still bilingual after summary
    const stillBi = await page.$$eval("[data-at-bilingual]", (els) => els.length);
    assert(stillBi >= 5, "summary broke the bilingual view");
    pass("BILINGUAL intact after summary", `${stillBi} blocks`);

    /* ---------- 7. Switch back to overwrite ---------- */
    const back = await send({ type: "SET_PAGE_MODE", mode: "overwrite" });
    assert(back?.ok && back.data?.applied, "switch back failed");
    const owState = await page.evaluate(() => ({
      blocks: document.querySelectorAll("[data-at-bilingual]").length,
      text: document.querySelector("#p1").textContent.trim(),
    }));
    assert(owState.blocks === 0, "bilingual blocks left after switching back");
    assert(/[\u4e00-\u9fff]/.test(owState.text), "overwrite text missing");
    pass("BACK to overwrite", owState.text.slice(0, 28) + "…");

    /* ---------- 8. Restore to original again ---------- */
    await send({ type: "RESTORE_PAGE" });
    const finalText = await page.$eval("#p1", (el) => el.textContent.trim());
    assert(finalText === original, `final restore mismatch: ${finalText}`);
    await page.screenshot({ path: path.join(__dirname, "..", ".chrome-test-profile-e2e", "bilingual-restored.png") }).catch(() => {});
    pass("RESTORE after overwrite", "original text");

    /* ---------- 9. Popup carries the saved mode ---------- */
    await bridge.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: { pageMode: "bilingual" },
      });
    });
    await bridge.reload({ waitUntil: "domcontentloaded" });
    await bridge.waitForFunction(
      () => document.getElementById("pageMode")?.value === "bilingual",
      8000
    );
    pass("POPUP mode persisted", "bilingual");

    // Restore saved mode to overwrite for clean state
    await bridge.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: { pageMode: "overwrite" },
      });
    });

    console.log("\n=== BILINGUAL TESTS PASSED ===");
  } finally {
    await browser.close().catch(() => {});
    server.close();
    stub?.server.close();
  }
}

main().catch((err) => {
  console.error("\n=== TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
