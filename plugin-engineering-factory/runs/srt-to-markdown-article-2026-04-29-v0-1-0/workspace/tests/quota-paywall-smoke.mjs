import { chromium } from "playwright";
import path from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const workspace = process.cwd();
const executablePath = [
  process.env.CHROME_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean).find((candidate) => existsSync(candidate));

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
    const contentType = filePath.endsWith(".js")
      ? "text/javascript;charset=utf-8"
      : filePath.endsWith(".css")
        ? "text/css;charset=utf-8"
        : "text/html;charset=utf-8";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/converter.html`);
  await page.locator("#languageSelect").selectOption("zh");
  await page.locator("#srtInput").setInputFiles(path.join(workspace, "tests/fixtures-simple.srt"));

  const labelsInChinese = await page.locator("body").textContent();
  if (!labelsInChinese.includes("SRT 转 Markdown")) {
    throw new Error("Chinese language switch did not update the converter title.");
  }

  for (let index = 0; index < 10; index += 1) {
    await page.locator("#convertButton").click();
    await page.waitForFunction(() => document.querySelector("#markdownOutput")?.value?.includes("The file stays local"));
  }

  const quotaAfterTen = await page.locator("#quotaValue").textContent();
  if (quotaAfterTen !== "0") {
    throw new Error(`Expected quota 0 after 10 conversions, got ${quotaAfterTen}`);
  }

  await page.locator("#convertButton").click();
  await page.waitForTimeout(250);
  const paywallVisible = await page.locator("#paywall").isVisible();
  const status = await page.locator("#status").textContent();
  if (!paywallVisible || !status.includes("免费次数")) {
    throw new Error("Paywall did not show after the 11th conversion attempt.");
  }

  console.log(JSON.stringify({
    quotaPaywallSmokePassed: true,
    conversionsAllowed: 10,
    quotaAfterTen,
    paywallVisible,
    status
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
