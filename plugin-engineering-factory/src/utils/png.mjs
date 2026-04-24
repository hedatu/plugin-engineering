import zlib from "node:zlib";
import { crc32 } from "./binary.mjs";
import { writeBinary } from "./io.mjs";

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

export function createCanvas(width, height, background = [255, 255, 255, 255]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = background[0];
    pixels[index + 1] = background[1];
    pixels[index + 2] = background[2];
    pixels[index + 3] = background[3];
  }
  return { width, height, pixels };
}

export function fillRect(canvas, x, y, width, height, color) {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(canvas.width, x + width);
  const endY = Math.min(canvas.height, y + height);
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      const offset = (row * canvas.width + column) * 4;
      canvas.pixels[offset] = color[0];
      canvas.pixels[offset + 1] = color[1];
      canvas.pixels[offset + 2] = color[2];
      canvas.pixels[offset + 3] = color[3];
    }
  }
}

export function hexToRgba(hex, alpha = 255) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char.repeat(2)).join("")
    : normalized;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    alpha
  ];
}

export async function writeCanvasPng(filePath, canvas) {
  const rows = [];
  for (let row = 0; row < canvas.height; row += 1) {
    const start = row * canvas.width * 4;
    const end = start + canvas.width * 4;
    rows.push(Buffer.from([0]), Buffer.from(canvas.pixels.slice(start, end)));
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0))
  ]);
  await writeBinary(filePath, png);
}

export async function createDraftIcon(filePath, size, primary, secondary = "#ffffff") {
  const canvas = createCanvas(size, size, hexToRgba(primary));
  const inset = Math.max(1, Math.floor(size * 0.18));
  fillRect(canvas, inset, inset, size - inset * 2, size - inset * 2, hexToRgba(secondary));
  fillRect(canvas, Math.floor(size * 0.28), Math.floor(size * 0.28), Math.floor(size * 0.44), Math.floor(size * 0.12), hexToRgba(primary));
  fillRect(canvas, Math.floor(size * 0.28), Math.floor(size * 0.5), Math.floor(size * 0.32), Math.floor(size * 0.12), hexToRgba(primary));
  await writeCanvasPng(filePath, canvas);
}

export async function createDraftPanelPng(filePath, width, height, palette, layout = "generic") {
  const canvas = createCanvas(width, height, hexToRgba(palette.background));
  fillRect(canvas, 0, 0, width, Math.floor(height * 0.16), hexToRgba(palette.header));
  fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.26), Math.floor(width * 0.88), Math.floor(height * 0.16), hexToRgba(palette.panel));
  fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.48), Math.floor(width * 0.88), Math.floor(height * 0.1), hexToRgba(palette.line));
  fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.62), Math.floor(width * 0.6), Math.floor(height * 0.08), hexToRgba(palette.line));
  fillRect(canvas, Math.floor(width * 0.66), Math.floor(height * 0.78), Math.floor(width * 0.28), Math.floor(height * 0.1), hexToRgba(palette.accent));

  if (layout === "form_fill") {
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.22), Math.floor(width * 0.4), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.34), Math.floor(width * 0.7), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.46), Math.floor(width * 0.8), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.58), Math.floor(width * 0.55), Math.floor(height * 0.08), hexToRgba(palette.line));
  }

  if (layout === "tab_export") {
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.26), Math.floor(width * 0.88), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.38), Math.floor(width * 0.88), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.5), Math.floor(width * 0.88), Math.floor(height * 0.08), hexToRgba(palette.line));
  }

  if (layout === "gmail_snippet") {
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.24), Math.floor(width * 0.32), Math.floor(height * 0.1), hexToRgba(palette.accent));
    fillRect(canvas, Math.floor(width * 0.42), Math.floor(height * 0.24), Math.floor(width * 0.32), Math.floor(height * 0.1), hexToRgba(palette.accent));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.4), Math.floor(width * 0.88), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.52), Math.floor(width * 0.88), Math.floor(height * 0.08), hexToRgba(palette.line));
    fillRect(canvas, Math.floor(width * 0.06), Math.floor(height * 0.64), Math.floor(width * 0.58), Math.floor(height * 0.08), hexToRgba(palette.line));
  }

  await writeCanvasPng(filePath, canvas);
}
