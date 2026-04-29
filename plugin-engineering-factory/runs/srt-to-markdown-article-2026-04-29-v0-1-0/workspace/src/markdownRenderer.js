import { buildParagraphs, formatTimestamp, titleFromFilename } from "./srtParser.js";

function frontmatter({ title, sourceName, convertedAt }) {
  return [
    "---",
    `title: "${title.replaceAll("\"", "'")}"`,
    `source: "${sourceName.replaceAll("\"", "'")}"`,
    "type: video-note",
    `converted: "${convertedAt}"`,
    "---",
    ""
  ].join("\n");
}

function renderArticle({ title, sourceName, convertedAt, paragraphs, keepTimestamps }) {
  const lines = [
    `# ${title}`,
    "",
    `> Source: ${sourceName}`,
    `> Converted locally: ${convertedAt}`,
    "",
    "## Summary",
    "",
    "Add a short summary here.",
    "",
    "## Article",
    ""
  ];

  for (const paragraph of paragraphs) {
    if (keepTimestamps) {
      lines.push(`### ${formatTimestamp(paragraph.startMs)}`, "");
    }
    lines.push(paragraph.text, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderObsidian({ title, sourceName, convertedAt, paragraphs, keepTimestamps }) {
  const lines = [
    `# ${title}`,
    "",
    `Source: [[${sourceName}]]`,
    `Converted locally: ${convertedAt}`,
    "",
    "## Notes",
    ""
  ];
  for (const paragraph of paragraphs) {
    const prefix = keepTimestamps ? `- **${formatTimestamp(paragraph.startMs)}** ` : "- ";
    lines.push(`${prefix}${paragraph.text}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderTimestamped({ title, sourceName, convertedAt, paragraphs }) {
  const lines = [
    `# ${title}`,
    "",
    `> Source: ${sourceName}`,
    `> Converted locally: ${convertedAt}`,
    ""
  ];
  for (const paragraph of paragraphs) {
    lines.push(`## ${formatTimestamp(paragraph.startMs)}`, "", paragraph.text, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function renderMarkdown({
  items,
  sourceName = "subtitle.srt",
  mode = "article",
  keepTimestamps = false,
  includeFrontmatter = false,
  paragraphDensity = "balanced",
  convertedAt = new Date().toISOString().slice(0, 10)
}) {
  const title = titleFromFilename(sourceName);
  const paragraphs = buildParagraphs(items, { density: paragraphDensity });
  const payload = { title, sourceName, convertedAt, paragraphs, keepTimestamps };
  let body;

  if (mode === "obsidian") {
    body = renderObsidian(payload);
  } else if (mode === "timestamped") {
    body = renderTimestamped(payload);
  } else {
    body = renderArticle(payload);
  }

  if (includeFrontmatter) {
    return `${frontmatter({ title, sourceName, convertedAt })}${body}`;
  }
  return body;
}
