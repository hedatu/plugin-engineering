import { chromium } from "playwright";
import path from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const workspace = process.cwd();
const chromeCandidates = [
  process.env.CHROME_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));

const mimeTypes = new Map([
  [".html", "text/html;charset=utf-8"],
  [".js", "text/javascript;charset=utf-8"],
  [".css", "text/css;charset=utf-8"],
  [".srt", "text/plain;charset=utf-8"],
  [".vtt", "text/vtt;charset=utf-8"],
  [".txt", "text/plain;charset=utf-8"],
  [".png", "image/png"]
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestedPath = decodeURIComponent(url.pathname === "/" ? "/converter.html" : url.pathname);
    const normalized = path.normalize(requestedPath).replace(/^([/\\])+/, "");
    const filePath = path.join(workspace, normalized);
    if (!filePath.startsWith(workspace)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const converterUrl = `http://127.0.0.1:${port}/converter.html`;

const cases = [
  {
    name: "english srt article",
    files: ["tests/fixtures-simple.srt"],
    outputType: "article",
    expected: "The file stays local"
  },
  {
    name: "webvtt blog outline",
    files: ["tests/fixtures-webvtt.vtt"],
    outputType: "blog-outline",
    expected: "## Working title"
  },
  {
    name: "txt meeting minutes",
    files: ["tests/fixtures-plain.txt"],
    outputType: "meeting-minutes",
    expected: "## Action items"
  },
  {
    name: "multi file obsidian merge",
    files: ["tests/fixtures-simple.srt", "tests/fixtures-webvtt.vtt", "tests/fixtures-plain.txt"],
    outputType: "obsidian",
    expected: "The final note should include decisions"
  },
  {
    name: "timestamped duplicate cleanup",
    files: ["tests/fixtures-duplicates.srt"],
    outputType: "timestamped",
    expected: "Unique line after duplicate"
  }
];

const browser = await chromium.launch({
  headless: true,
  executablePath
});
const results = [];

try {
  for (const testCase of cases) {
    const page = await browser.newPage();
    await page.goto(converterUrl);
    await page.locator("#outputType").selectOption(testCase.outputType);
    await page.locator("#transcriptInput").setInputFiles(testCase.files.map((file) => path.join(workspace, file)));
    await page.locator("#convertButton").click();
    await page.waitForFunction(() => document.querySelector("#markdownOutput")?.value?.length > 20);
    const markdown = await page.locator("#markdownOutput").inputValue();
    const status = await page.locator("#status").textContent();
    const passed = markdown.includes(testCase.expected);
    results.push({
      name: testCase.name,
      passed,
      markdownLength: markdown.length,
      status
    });
    if (!passed) {
      throw new Error(`browser smoke failed: ${testCase.name}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(JSON.stringify({
  browserSmokePassed: true,
  cases: results
}, null, 2));
