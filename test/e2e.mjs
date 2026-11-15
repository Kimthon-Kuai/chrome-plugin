/**
 * End-to-end smoke test for AI Translator Chrome extension.
 *
 *   node test/e2e.mjs
 *
 * Optional env: AT_API_KEY, AT_BASE_URL, AT_MODEL, AT_EXT_DIR, CHROME_PATH
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = process.env.AT_EXT_DIR
  ? path.resolve(process.env.AT_EXT_DIR)
  : path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "sample.html");

const API_KEY = process.env.AT_API_KEY || "";
const BASE_URL = process.env.AT_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.AT_MODEL || "deepseek-v4-flash";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome executable not found");
}

function startFixtureServer() {
  const html = fs.readFileSync(FIXTURE);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function getExtension(browser) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const map = await browser.extensions();
    for (const [id, ext] of map) {
      if (ext.name === "AI Translator" || ext.path.includes("at-ext-test") || ext.path.includes("web plug-in") || ext.path.includes("web%20plug")) {
        return { id, ext };
      }
    }
    if (map.size === 1) {
      const [[id, ext]] = [...map];
      return { id, ext };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const map = await browser.extensions();
  throw new Error(
    "AI Translator extension not found. Installed: " +
      JSON.stringify(
        [...map].map(([id, e]) => ({ id, name: e.name, path: e.path }))
      )
  );
}

async function getWorker(ext) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const workers = await ext.workers();
    if (workers.length) return workers[0];
    // Wake SW by opening an extension page
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Extension service worker not available");
}

async function main() {
  assert(
    API_KEY,
    "Missing AT_API_KEY. Example: $env:AT_API_KEY='sk-...'; node test/e2e.mjs"
  );
  assert(fs.existsSync(path.join(EXT_DIR, "manifest.json")), `manifest missing in ${EXT_DIR}`);
  const chromePath = findChrome();
  const { server, url: fixtureUrl } = await startFixtureServer();
  console.log("Extension dir:", EXT_DIR);
  console.log("Fixture:", fixtureUrl);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    enableExtensions: [EXT_DIR],
    defaultViewport: { width: 1100, height: 800 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  const results = [];
  try {
    const { id: extensionId, ext } = await getExtension(browser);
    console.log("Extension:", ext.name, extensionId);

    // Open popup once to ensure SW is alive, then get worker
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: "domcontentloaded",
    });
    await popupPage.waitForSelector("#apiKey");

    const worker = await getWorker(ext);

    await worker.evaluate(async (settings) => {
      await chrome.storage.local.set(settings);
    }, {
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      direction: "en2zh",
    });
    results.push(["SAVE_SETTINGS", "ok"]);

    // Reload popup to pick up settings
    await popupPage.reload({ waitUntil: "domcontentloaded" });
    await popupPage.waitForFunction(
      (m) => document.getElementById("model")?.value === m,
      { timeout: 8000 },
      MODEL
    );
    const keyFilled = await popupPage.$eval("#apiKey", (el) => el.value.length > 0);
    assert(keyFilled, "API Key not loaded into popup");
    results.push(["POPUP", "settings loaded"]);

    // TRANSLATE_TEXT via SW globals
    const t1 = await worker.evaluate(async () => {
      const settings = await atGetSettings();
      const target = atResolveTargetLang(settings.direction, "Hello world");
      const translation = await atChatCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages: [
          { role: "system", content: atTranslateSystemPrompt(target) },
          { role: "user", content: "Hello world" },
        ],
        temperature: 0.2,
        maxTokens: 64,
      });
      return { translation, target };
    });
    console.log("TRANSLATE_TEXT:", t1.translation);
    assert(/[\u4e00-\u9fff]/.test(t1.translation), `Expected Chinese, got: ${t1.translation}`);
    results.push(["TRANSLATE_TEXT", t1.translation]);

    // TRANSLATE_BATCH
    const t2 = await worker.evaluate(async () => {
      const settings = await atGetSettings();
      const texts = ["Good morning", "Thank you"];
      const target = atResolveTargetLang(settings.direction, texts[0]);
      const messages = atBatchTranslateMessages(texts, target);
      const raw = await atChatCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages,
        temperature: 0.2,
        maxTokens: 128,
      });
      return atParseNumberedTranslations(raw, texts.length);
    });
    console.log("TRANSLATE_BATCH:", t2);
    assert(
      t2.length === 2 && t2.every((x) => /[\u4e00-\u9fff]/.test(x)),
      `Batch failed: ${JSON.stringify(t2)}`
    );
    results.push(["TRANSLATE_BATCH", t2.join(" | ")]);

    // SUMMARIZE
    const t3 = await worker.evaluate(async () => {
      const settings = await atGetSettings();
      const pageText = [
        "Artificial intelligence is transforming how people work, learn, and create every day.",
        "This sample page is used to verify full-page translation, selection translation, and webpage summarization features.",
        "Feature one: page translation. Feature two: selection translation. Feature three: page summary.",
      ].join("\n");
      return atChatCompletion({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages: atSummarizeMessages(
          pageText,
          "AI Translator Test Page",
          "http://127.0.0.1/test"
        ),
        temperature: 0.3,
        maxTokens: 400,
      });
    });
    console.log("SUMMARIZE:", t3.slice(0, 180).replace(/\n/g, " "));
    assert(t3.length > 20 && /[\u4e00-\u9fff]/.test(t3), `Bad summary: ${t3}`);
    results.push(["SUMMARIZE", t3.slice(0, 60).replace(/\n/g, " ") + "…"]);

    // Content script + page translate via messaging from popup context
    const page = await browser.newPage();
    await page.goto(fixtureUrl, { waitUntil: "networkidle0" });

    const bridge = await browser.newPage();
    await bridge.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // Ensure content script is injected (auto-inject can lag under automation)
    const injectRes = await bridge.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      const target = tabs[0];
      if (!target?.id) return { ok: false, error: "fixture tab not found" };
      try {
        await chrome.tabs.sendMessage(target.id, { type: "PING" });
        return { ok: true, already: true, tabId: target.id };
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: target.id },
          files: ["content/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: target.id },
          files: ["content/content.css"],
        });
        await chrome.tabs.sendMessage(target.id, { type: "PING" });
        return { ok: true, injected: true, tabId: target.id };
      }
    });
    console.log("CONTENT inject:", injectRes);
    assert(injectRes?.ok, `Content inject failed: ${JSON.stringify(injectRes)}`);
    // Content scripts run in an isolated world — do not expect page-visible globals.
    const before = await page.$eval("#p1", (el) => el.textContent.trim());

    const tabId = injectRes.tabId;
    const translateResult = await bridge.evaluate(async (id) => {
      return chrome.tabs.sendMessage(id, { type: "TRANSLATE_PAGE" });
    }, tabId);
    console.log("TRANSLATE_PAGE message:", translateResult);
    assert(translateResult?.ok, `Page translate failed: ${JSON.stringify(translateResult)}`);

    const after = await page.$eval("#p1", (el) => el.textContent.trim());
    console.log("PAGE before:", before);
    console.log("PAGE after:", after);
    assert(after !== before, "Page text unchanged");
    assert(/[\u4e00-\u9fff]/.test(after), `Not Chinese: ${after}`);
    results.push(["TRANSLATE_PAGE", after.slice(0, 50) + "…"]);

    // Summarize panel on the same tab
    const sumRes = await bridge.evaluate(async (id) => {
      return chrome.tabs.sendMessage(id, { type: "SUMMARIZE_PAGE" });
    }, tabId);
    console.log("SUMMARIZE_PAGE message:", sumRes);
    assert(sumRes?.ok, `Summarize page failed: ${JSON.stringify(sumRes)}`);

    const panelInfo = await page.evaluate(() => {
      const panel = document.getElementById("at-summary-panel");
      if (!panel) return { exists: false };
      return {
        exists: true,
        className: panel.className,
        body: panel.querySelector(".at-sum-body")?.textContent?.trim() || "",
      };
    });
    console.log("PANEL info:", {
      exists: panelInfo.exists,
      className: panelInfo.className,
      body: (panelInfo.body || "").slice(0, 120),
    });
    assert(panelInfo.exists, "Summary panel DOM missing");
    assert(
      panelInfo.body.length > 20 &&
        /[\u4e00-\u9fff]/.test(panelInfo.body) &&
        !panelInfo.body.includes("正在分析"),
      `Panel summary bad: ${panelInfo.body}`
    );
    results.push([
      "SUMMARIZE_PAGE",
      panelInfo.body.slice(0, 50).replace(/\n/g, " ") + "…",
    ]);

    // Selection translate via content-script message bridge (more reliable than synthetic mouseup)
    const selRes = await bridge.evaluate(async (id) => {
      return chrome.tabs.sendMessage(id, {
        type: "TRANSLATE_SELECTION_TEXT",
        text: "Hello World",
      });
    }, tabId);
    console.log("SELECTION message:", selRes);
    assert(selRes?.ok, `Selection translate failed: ${JSON.stringify(selRes)}`);
    assert(
      /[\u4e00-\u9fff]/.test(selRes.data?.translation || ""),
      `Selection not Chinese: ${JSON.stringify(selRes)}`
    );
    // Also verify floating popup appears
    await page.waitForSelector("#at-selection-popup .at-pop-body", { timeout: 10000 });
    const selText = await page.$eval(
      "#at-selection-popup .at-pop-body",
      (el) => el.textContent.trim()
    );
    console.log("SELECTION popup:", selText);
    results.push(["SELECTION_TRANSLATE", selText || selRes.data.translation]);

    console.log("\n=== ALL TESTS PASSED ===");
    for (const [name, detail] of results) {
      console.log(`✔ ${name}: ${detail}`);
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error("\n=== TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
