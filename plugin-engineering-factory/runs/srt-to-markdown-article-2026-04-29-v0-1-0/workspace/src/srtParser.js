export function parseTimestamp(value) {
  const match = `${value ?? ""}`.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) {
    return null;
  }
  const [, hours, minutes, seconds, milliseconds] = match;
  const paddedMs = milliseconds.padEnd(3, "0").slice(0, 3);
  return Number(hours) * 3600000
    + Number(minutes) * 60000
    + Number(seconds) * 1000
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
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\\an\d+\}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSrt(input) {
  const content = `${input ?? ""}`
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

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
      errors.push({ block: blockIndex + 1, reason: "missing_time_range" });
      return;
    }

    const [startRaw, endRaw] = lines[timeLineIndex].split("-->").map((part) => part.trim());
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
      text: current.text.replace(/\s+/g, " ").trim()
    });
    current = null;
  };

  for (const item of items) {
    if (!current) {
      current = { startMs: item.startMs, endMs: item.endMs, text: item.text };
      continue;
    }

    const gap = item.startMs - current.endMs;
    const nextText = `${current.text} ${item.text}`.trim();
    const shouldSplit = gap > pauseMs
      || nextText.length > maxChars
      || (current.text.length > Math.floor(maxChars * 0.58) && endsSentence(current.text));

    if (shouldSplit) {
      flush();
      current = { startMs: item.startMs, endMs: item.endMs, text: item.text };
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
