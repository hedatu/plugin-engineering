import { buildParagraphs, formatTimestamp, titleFromFilename } from "./srtParser.js";

function titleForSources(sourceName, sources = []) {
  if (sourceName) return titleFromFilename(sourceName);
  if (sources.length === 1) return titleFromFilename(sources[0].name);
  if (sources.length > 1) return "Merged transcript notes";
  return "Transcript notes";
}

function sourceNames(sourceName, sources = []) {
  if (sources.length) return sources.map((source) => source.name);
  return [sourceName ?? "transcript"];
}

function frontmatter({ title, sourceName, sources, convertedAt }) {
  const lines = [
    "---",
    `title: "${title.replaceAll("\"", "'")}"`,
    "type: transcript-markdown",
    `converted: "${convertedAt}"`,
    "sources:"
  ];
  for (const source of sourceNames(sourceName, sources)) {
    lines.push(`  - "${source.replaceAll("\"", "'")}"`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function sourceBlock({ sourceName, sources, convertedAt }) {
  const lines = [
    `> Converted locally: ${convertedAt}`,
    ">"
  ];
  for (const source of sourceNames(sourceName, sources)) {
    lines.push(`> Source: ${source}`);
  }
  return lines.join("\n");
}

function renderTranscriptSections({ paragraphs, keepTimestamps, headingLevel = 2 }) {
  const lines = [];
  const timestampHeading = "#".repeat(headingLevel + 1);
  for (const paragraph of paragraphs) {
    if (keepTimestamps) {
      lines.push(`${timestampHeading} ${formatTimestamp(paragraph.startMs)}`, "");
    }
    lines.push(paragraph.text, "");
  }
  return lines;
}

function renderArticle(payload) {
  const lines = [
    `# ${payload.title}`,
    "",
    sourceBlock(payload),
    "",
    "## Summary",
    "",
    "Add a short summary here.",
    "",
    "## Article",
    "",
    ...renderTranscriptSections(payload)
  ];
  return lines.join("\n").trimEnd() + "\n";
}

function renderObsidian(payload) {
  const lines = [
    `# ${payload.title}`,
    "",
    `Converted locally: ${payload.convertedAt}`,
    "",
    "## Sources",
    ""
  ];
  for (const source of sourceNames(payload.sourceName, payload.sources)) {
    lines.push(`- [[${source}]]`);
  }
  lines.push("", "## Notes", "");
  for (const paragraph of payload.paragraphs) {
    const prefix = payload.keepTimestamps ? `- **${formatTimestamp(paragraph.startMs)}** ` : "- ";
    lines.push(`${prefix}${paragraph.text}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderTimestamped(payload) {
  const lines = [
    `# ${payload.title}`,
    "",
    sourceBlock(payload),
    ""
  ];
  for (const paragraph of payload.paragraphs) {
    lines.push(`## ${formatTimestamp(paragraph.startMs)}`, "", paragraph.text, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderBlogOutline(payload) {
  const lines = [
    `# ${payload.title}`,
    "",
    sourceBlock(payload),
    "",
    "## Working title",
    "",
    "- Draft a reader-facing title here.",
    "",
    "## Angle",
    "",
    "- What is the main point this transcript should become?",
    "",
    "## Outline",
    ""
  ];
  payload.paragraphs.forEach((paragraph, index) => {
    lines.push(`${index + 1}. ${paragraph.text}`);
  });
  lines.push("", "## Draft notes", "", ...renderTranscriptSections(payload));
  return lines.join("\n").trimEnd() + "\n";
}

function renderMeetingMinutes(payload) {
  const lines = [
    `# ${payload.title}`,
    "",
    sourceBlock(payload),
    "",
    "## Meeting summary",
    "",
    "- Add the short meeting summary here.",
    "",
    "## Decisions",
    "",
    "- Decision:",
    "",
    "## Action items",
    "",
    "- Owner / task / due date:",
    "",
    "## Transcript notes",
    "",
    ...renderTranscriptSections(payload)
  ];
  return lines.join("\n").trimEnd() + "\n";
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function renderMarkdown({
  items,
  sourceName = "",
  sources = [],
  mode = "article",
  keepTimestamps = false,
  includeFrontmatter = false,
  paragraphDensity = "balanced",
  convertedAt = localDateString()
}) {
  const title = titleForSources(sourceName, sources);
  const paragraphs = buildParagraphs(items, { density: paragraphDensity });
  const payload = { title, sourceName, sources, convertedAt, paragraphs, keepTimestamps };
  let body;

  if (mode === "obsidian") {
    body = renderObsidian(payload);
  } else if (mode === "timestamped") {
    body = renderTimestamped(payload);
  } else if (mode === "blog-outline") {
    body = renderBlogOutline(payload);
  } else if (mode === "meeting-minutes") {
    body = renderMeetingMinutes(payload);
  } else {
    body = renderArticle(payload);
  }

  if (includeFrontmatter) {
    return `${frontmatter({ title, sourceName, sources, convertedAt })}${body}`;
  }
  return body;
}
