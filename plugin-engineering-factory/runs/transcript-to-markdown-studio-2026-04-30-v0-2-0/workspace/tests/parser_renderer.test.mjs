import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildParagraphs,
  detectTranscriptFormat,
  formatTimestamp,
  parseSrt,
  parseTimestamp,
  parseTranscriptFiles,
  parseTxt,
  parseVtt
} from "../src/srtParser.js";
import { renderMarkdown } from "../src/markdownRenderer.js";

test("parses timestamp formats used by SRT and VTT", () => {
  assert.equal(parseTimestamp("01:02:03,456"), 3723456);
  assert.equal(parseTimestamp("00:00:01.5"), 1500);
  assert.equal(parseTimestamp("00:01.250"), 1250);
  assert.equal(formatTimestamp(3723456), "01:02:03");
});

test("detects transcript formats by filename and mime type", () => {
  assert.equal(detectTranscriptFormat("demo.srt", ""), "srt");
  assert.equal(detectTranscriptFormat("demo.vtt", ""), "vtt");
  assert.equal(detectTranscriptFormat("demo.txt", ""), "txt");
  assert.equal(detectTranscriptFormat("demo.bin", "text/vtt"), "vtt");
  assert.equal(detectTranscriptFormat("demo.bin", "application/octet-stream"), "unknown");
});

test("parses English SRT and renders article markdown", async () => {
  const srt = await readFile("tests/fixtures-simple.srt", "utf8");
  const parsed = parseSrt(srt);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.items.length, 4);
  const md = renderMarkdown({ items: parsed.items, sourceName: "product-demo.srt", mode: "article", keepTimestamps: true });
  assert.match(md, /^# product demo/m);
  assert.match(md, /## Article/);
  assert.match(md, /The file stays local/);
  assert.match(md, /### 00:00:01/);
});

test("parses VTT and renders blog outline markdown", async () => {
  const vtt = await readFile("tests/fixtures-webvtt.vtt", "utf8");
  const parsed = parseVtt(vtt);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.items.length, 3);
  const md = renderMarkdown({ items: parsed.items, sourceName: "video-demo.vtt", mode: "blog-outline" });
  assert.match(md, /## Working title/);
  assert.match(md, /Markdown outline/);
});

test("parses TXT and renders meeting minutes markdown", async () => {
  const txt = await readFile("tests/fixtures-plain.txt", "utf8");
  const parsed = parseTxt(txt);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.items.length, 3);
  const md = renderMarkdown({ items: parsed.items, sourceName: "meeting.txt", mode: "meeting-minutes" });
  assert.match(md, /## Meeting summary/);
  assert.match(md, /## Action items/);
  assert.match(md, /plain transcript/);
});

test("merges SRT, VTT, and TXT sources into one Markdown document", async () => {
  const files = [
    { name: "part-a.srt", text: await readFile("tests/fixtures-simple.srt", "utf8") },
    { name: "part-b.vtt", text: await readFile("tests/fixtures-webvtt.vtt", "utf8") },
    { name: "notes.txt", text: await readFile("tests/fixtures-plain.txt", "utf8") }
  ];
  const parsed = parseTranscriptFiles(files);
  assert.equal(parsed.sources.length, 3);
  assert.equal(parsed.items.length, 10);
  const md = renderMarkdown({ items: parsed.items, sources: parsed.sources, mode: "obsidian", includeFrontmatter: true });
  assert.match(md, /^---/);
  assert.match(md, /part-a\.srt/);
  assert.match(md, /part-b\.vtt/);
  assert.match(md, /notes\.txt/);
  assert.match(md, /The final note should include decisions/);
});

test("deduplicates consecutive repeated captions", async () => {
  const srt = await readFile("tests/fixtures-duplicates.srt", "utf8");
  const parsed = parseSrt(srt);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].text, "Repeated line");
});

test("reports malformed blocks without failing valid captions", () => {
  const parsed = parseSrt(`bad block\n\n1\n00:00:00,000 --> 00:00:02,000\nValid line.`);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.errors.length, 1);
});

test("paragraph density changes paragraph count", async () => {
  const srt = await readFile("tests/fixtures-simple.srt", "utf8");
  const parsed = parseSrt(srt);
  const compact = buildParagraphs(parsed.items, { density: "compact" });
  const spacious = buildParagraphs(parsed.items, { density: "spacious" });
  assert.ok(compact.length <= spacious.length);
});
