/**
 * Prompt builders for translate / summarize.
 */

const AT_LANG_LABELS = {
  zh: "Simplified Chinese",
  en: "English",
  auto: "auto",
};

function atHasCJK(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

function atDetectLangCode(text) {
  return atHasCJK(text) ? "zh" : "en";
}

/**
 * Resolve concrete source/target language codes and English labels for prompts.
 * @param {{ sourceLang?: string, targetLang?: string, direction?: string }} settings
 * @param {string} sampleText
 */
function atResolveLangPair(settings, sampleText) {
  let source = settings?.sourceLang || "auto";
  let target = settings?.targetLang || "auto";

  // Legacy direction override
  if ((!settings?.sourceLang || !settings?.targetLang) && settings?.direction) {
    if (settings.direction === "zh2en") {
      source = "zh";
      target = "en";
    } else if (settings.direction === "en2zh") {
      source = "en";
      target = "zh";
    }
  }

  const detected = atDetectLangCode(sampleText || "");
  const sourceCode = source === "auto" ? detected : source;
  let targetCode = target;
  if (target === "auto") {
    targetCode = sourceCode === "zh" ? "en" : "zh";
  }
  if (targetCode === sourceCode) {
    targetCode = sourceCode === "zh" ? "en" : "zh";
  }

  return {
    sourceCode,
    targetCode,
    sourceLabel: AT_LANG_LABELS[sourceCode] || "English",
    targetLabel: AT_LANG_LABELS[targetCode] || "Simplified Chinese",
  };
}

/** @deprecated prefer atResolveLangPair */
function atResolveTargetLang(direction, sampleText) {
  const pair = atResolveLangPair({ direction }, sampleText);
  return pair.targetLabel;
}

function atTranslateSystemPrompt(targetLang, sourceLang) {
  const from = sourceLang ? ` from ${sourceLang}` : "";
  return [
    "You are a professional bilingual translator for Chinese and English.",
    `Translate the user's text${from} into ${targetLang}.`,
    "Rules:",
    "- Output ONLY the translation, no quotes, no explanation, no notes.",
    "- Preserve meaning, tone, and formatting (line breaks) when possible.",
    "- Keep proper nouns, code, URLs, and brand names accurate.",
  ].join("\n");
}

function atBatchTranslateMessages(texts, targetLang, sourceLang) {
  const numbered = texts.map((t, i) => `[${i + 1}] ${t}`).join("\n");
  const from = sourceLang ? ` from ${sourceLang}` : "";
  return [
    {
      role: "system",
      content: [
        "You are a professional bilingual translator for Chinese and English.",
        `Translate each numbered segment${from} into ${targetLang}.`,
        "Rules:",
        "- Return the same number of lines, each starting with [n] matching the input index.",
        "- Output ONLY the numbered translations, nothing else.",
        "- Do not merge or split segments.",
      ].join("\n"),
    },
    { role: "user", content: numbered },
  ];
}

function atParseNumberedTranslations(result, count) {
  const map = new Map();
  const lines = String(result).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*\[(\d+)\]\s*(.*)$/);
    if (m) map.set(Number(m[1]), m[2]);
  }
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push(map.has(i) ? map.get(i) : "");
  }
  if (count === 1 && !out[0]) out[0] = String(result).trim();
  return out;
}

function atSummarizeMessages(pageText, pageTitle, pageUrl) {
  return [
    {
      role: "system",
      content: [
        "You are a concise reading assistant.",
        "Summarize the web page content for a bilingual Chinese/English user.",
        "Rules:",
        "- Write the summary in Simplified Chinese.",
        "- Use short bullet points (3–8 bullets) plus a one-line overall takeaway at the top.",
        "- Focus on key facts, claims, and conclusions; ignore nav/footer noise.",
        "- Do not invent information that is not in the text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Title: ${pageTitle || "(none)"}`,
        `URL: ${pageUrl || "(none)"}`,
        "",
        "Page content:",
        pageText,
      ].join("\n"),
    },
  ];
}
