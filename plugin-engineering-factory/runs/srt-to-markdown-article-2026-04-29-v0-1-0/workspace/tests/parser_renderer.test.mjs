import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSrt, parseTimestamp, buildParagraphs, formatTimestamp } from "../src/srtParser.js";
import { renderMarkdown } from "../src/markdownRenderer.js";

test("parses timestamp formats", () => {
  assert.equal(parseTimestamp("01:02:03,456"), 3723456);
  assert.equal(parseTimestamp("00:00:01.5"), 1500);
  assert.equal(formatTimestamp(3723456), "01:02:03");
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

test("parses Chinese SRT and renders Obsidian note", async () => {
  const srt = await readFile("tests/fixtures-chinese.srt", "utf8");
  const parsed = parseSrt(srt);
  assert.equal(parsed.items.length, 3);
  const md = renderMarkdown({ items: parsed.items, sourceName: "中文课程.srt", mode: "obsidian", includeFrontmatter: true });
  assert.match(md, /^---/);
  assert.match(md, /# 中文课程/);
  assert.match(md, /本地完成/);
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
