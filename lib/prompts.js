/**
 * Prompt builders for translate / summarize.
 */

function atHasCJK(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

/**
 * Resolve target language label for prompts.
 * @param {'auto'|'zh2en'|'en2zh'} direction
 * @param {string} sampleText
 */
function atResolveTargetLang(direction, sampleText) {
  if (direction === "zh2en") return "English";
  if (direction === "en2zh") return "Simplified Chinese";
  // auto
  return atHasCJK(sampleText) ? "English" : "Simplified Chinese";
}

function atTranslateSystemPrompt(targetLang) {
  return [
    "You are a professional bilingual translator for Chinese and English.",
    `Translate the user's text into ${targetLang}.`,
    "Rules:",
    "- Output ONLY the translation, no quotes, no explanation, no notes.",
    "- Preserve meaning, tone, and formatting (line breaks) when possible.",
    "- Keep proper nouns, code, URLs, and brand names accurate.",
  ].join("\n");
}

/**
 * Batch translate: numbered lines for alignment.
 * @param {string[]} texts
 * @param {string} targetLang
 */
function atBatchTranslateMessages(texts, targetLang) {
  const numbered = texts.map((t, i) => `[${i + 1}] ${t}`).join("\n");
  return [
    {
      role: "system",
      content: [
        "You are a professional bilingual translator for Chinese and English.",
        `Translate each numbered segment into ${targetLang}.`,
        "Rules:",
        "- Return the same number of lines, each starting with [n] matching the input index.",
        "- Output ONLY the numbered translations, nothing else.",
        "- Do not merge or split segments.",
      ].join("\n"),
    },
    { role: "user", content: numbered },
  ];
}

/**
 * Parse [n] lines back into array aligned with input length.
 * @param {string} result
 * @param {number} count
 * @returns {string[]}
 */
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
  // Fallback: if nothing parsed, treat whole as single segment
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
