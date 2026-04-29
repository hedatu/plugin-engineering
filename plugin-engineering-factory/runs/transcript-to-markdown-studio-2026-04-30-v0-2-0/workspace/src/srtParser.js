export function parseTimestamp(value) {
  const normalized = `${value ?? ""}`.trim().split(/\s+/)[0];
  const fullMatch = normalized.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/);
  const shortMatch = normalized.match(/^(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/);
  const match = fullMatch
    ? { hours: fullMatch[1], minutes: fullMatch[2], seconds: fullMatch[3], milliseconds: fullMatch[4] ?? "0" }
    : shortMatch
      ? { hours: "0", minutes: shortMatch[1], seconds: shortMatch[2], milliseconds: shortMatch[3] ?? "0" }
      : null;

  if (!match) return null;

  const paddedMs = match.milliseconds.padEnd(3, "0").slice(0, 3);
  return Number(match.hours) * 3600000
    + Number(match.minutes) * 60000
    + Number(match.seconds) * 1000
    + Number(paddedMs);
}

export function formatTimestamp(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  return [hours, minutes, seconds].map((value) => `${value}`.padStart(2, "0")).join(":");
}

export function cleanCaptionText(value) {
  return `${value ?? ""}`
    .replace(/^\s*WEBVTT\s*$/gim, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\\an\d+\}/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInput(input) {
  return `${input ?? ""}`
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function isIgnorableVttBlock(lines) {
  const first = lines[0] ?? "";
  return first === "WEBVTT"
    || first.startsWith("NOTE")
    || first.startsWith("STYLE")
    || first.startsWith("REGION");
}

export function parseTimedTranscript(input, options = {}) {
  const format = options.format === "vtt" ? "vtt" : "srt";
  const content = normalizeInput(input).trim();

  if (!content) {
    return { items: [], errors: [{ block: 0, reason: "empty_input" }] };
  }

  const blocks = content.split(/\n{2,}/);
  const items = [];
  const errors = [];

  blocks.forEach((block, blockIndex) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) {
      if (format !== "vtt" || !isIgnorableVttBlock(lines)) {
        errors.push({ block: blockIndex + 1, reason: "missing_time_range" });
      }
      return;
    }

    const [startRaw, endRaw] = lines[timeLineIndex]
      .split("-->")
      .map((part) => part.trim().split(/\s+/)[0]);
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    if (startMs === null || endMs === null || endMs < startMs) {
      errors.push({ block: blockIndex + 1, reason: "invalid_time_range" });
      return;
    }

    const indexRaw = timeLineIndex > 0 ? lines[0] : `${items.length + 1}`;
    const text = cleanCaptionText(lines.slice(timeLineIndex + 1).join(" "));
    if (!text) {
      errors.push({ block: blockIndex + 1, reason: "empty_caption" });
      return;
    }

    items.push({
      index: Number.parseInt(indexRaw, 10) || items.length + 1,
      startMs,
      endMs,
      text
    });
  });

  return {
    items: dedupeConsecutiveCaptions(items),
    errors
  };
}

export function parseSrt(input) {
  return parseTimedTranscript(input, { format: "srt" });
}

export function parseVtt(input) {
  return parseTimedTranscript(input, { format: "vtt" });
}

export function parseTxt(input) {
  const content = normalizeInput(input).trim();
  if (!content) {
    return { items: [], errors: [{ block: 0, reason: "empty_input" }] };
  }

  let chunks = content
    .split(/\n{2,}/)
    .map((chunk) => cleanCaptionText(chunk))
    .filter(Boolean);

  if (chunks.length <= 1) {
    chunks = content
      .split("\n")
      .map((line) => cleanCaptionText(line))
      .filter(Boolean);
  }

  const items = chunks.map((text, index) => ({
    index: index + 1,
    startMs: index * 5000,
    endMs: index * 5000 + 4000,
    text
  }));

  return {
    items: dedupeConsecutiveCaptions(items),
    errors: []
  };
}

export function detectTranscriptFormat(filename = "", mimeType = "") {
  const lowerName = filename.toLowerCase();
  const lowerType = mimeType.toLowerCase();
  if (lowerName.endsWith(".vtt") || lowerType.includes("webvtt") || lowerType.includes("vtt")) return "vtt";
  if (lowerName.endsWith(".srt")) return "srt";
  if (lowerName.endsWith(".txt") || lowerType.includes("text/plain")) return "txt";
  return "unknown";
}

export function parseTranscriptFile({ name = "transcript.txt", text = "", type = "" }) {
  const format = detectTranscriptFormat(name, type);
  let parsed;
  if (format === "vtt") {
    parsed = parseVtt(text);
  } else if (format === "srt") {
    parsed = parseSrt(text);
  } else if (format === "txt") {
    parsed = parseTxt(text);
  } else {
    parsed = { items: [], errors: [{ block: 0, reason: "unsupported_format" }] };
  }

  return {
    ...parsed,
    format,
    sourceName: name,
    items: parsed.items.map((item) => ({ ...item, sourceName: name, format }))
  };
}

export function parseTranscriptFiles(files) {
  const sources = [];
  const items = [];
  const errors = [];
  let offsetMs = 0;

  for (const file of files ?? []) {
    const parsed = parseTranscriptFile(file);
    sources.push({
      name: parsed.sourceName,
      format: parsed.format,
      captions: parsed.items.length,
      errors: parsed.errors.length
    });

    for (const error of parsed.errors) {
      errors.push({ ...error, sourceName: parsed.sourceName, format: parsed.format });
    }

    const shifted = parsed.items.map((item) => ({
      ...item,
      startMs: item.startMs + offsetMs,
      endMs: item.endMs + offsetMs
    }));
    items.push(...shifted);

    const maxEnd = shifted.reduce((max, item) => Math.max(max, item.endMs), offsetMs);
    offsetMs = maxEnd + 2000;
  }

  if (!sources.length) {
    errors.push({ block: 0, reason: "no_files" });
  }

  return {
    items: dedupeConsecutiveCaptions(items),
    errors,
    sources
  };
}

export function dedupeConsecutiveCaptions(items) {
  const result = [];
  let previous = "";
  for (const item of items) {
    const normalized = item.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized && normalized !== previous) {
      result.push(item);
    }
    previous = normalized;
  }
  return result;
}

function densityConfig(density) {
  if (density === "compact") {
    return { maxChars: 760, pauseMs: 2600 };
  }
  if (density === "spacious") {
    return { maxChars: 360, pauseMs: 1100 };
  }
  return { maxChars: 520, pauseMs: 1800 };
}

function endsSentence(text) {
  return /[.!?。！？]$/.test(text.trim());
}

export function buildParagraphs(items, options = {}) {
  const { maxChars, pauseMs } = densityConfig(options.density ?? "balanced");
  const paragraphs = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) {
      current = null;
      return;
    }
    paragraphs.push({
      startMs: current.startMs,
      endMs: current.endMs,
      sourceName: current.sourceName,
      text: current.text.replace(/\s+/g, " ").trim()
    });
    current = null;
  };

  for (const item of items) {
    if (!current) {
      current = { startMs: item.startMs, endMs: item.endMs, sourceName: item.sourceName, text: item.text };
      continue;
    }

    const gap = item.startMs - current.endMs;
    const nextText = `${current.text} ${item.text}`.trim();
    const sourceChanged = item.sourceName && current.sourceName && item.sourceName !== current.sourceName;
    const shouldSplit = sourceChanged
      || gap > pauseMs
      || nextText.length > maxChars
      || (current.text.length > Math.floor(maxChars * 0.58) && endsSentence(current.text));

    if (shouldSplit) {
      flush();
      current = { startMs: item.startMs, endMs: item.endMs, sourceName: item.sourceName, text: item.text };
    } else {
      current.text = nextText;
      current.endMs = item.endMs;
    }
  }

  flush();
  return paragraphs;
}

export function titleFromFilename(filename = "Untitled") {
  return `${filename}`
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    || "Untitled";
}
