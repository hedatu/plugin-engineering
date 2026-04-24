import fs from "node:fs/promises";
import path from "node:path";
import { crc32, toDosDateTime } from "./binary.mjs";
import { ensureDir, listFiles, writeBinary } from "./io.mjs";

function makeLocalHeader(fileNameBuffer, metadata, offset) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(metadata.dosTime, 10);
  header.writeUInt16LE(metadata.dosDate, 12);
  header.writeUInt32LE(metadata.crc, 14);
  header.writeUInt32LE(metadata.size, 18);
  header.writeUInt32LE(metadata.size, 22);
  header.writeUInt16LE(fileNameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return { header, offset };
}

function makeCentralHeader(fileNameBuffer, metadata, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(metadata.dosTime, 12);
  header.writeUInt16LE(metadata.dosDate, 14);
  header.writeUInt32LE(metadata.crc, 16);
  header.writeUInt32LE(metadata.size, 20);
  header.writeUInt32LE(metadata.size, 24);
  header.writeUInt16LE(fileNameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

export async function createZipFromDirectory(sourceDir, zipPath) {
  await ensureDir(path.dirname(zipPath));
  const files = await listFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath);
    const stats = await fs.stat(file.absolutePath);
    const fileNameBuffer = Buffer.from(file.relativePath.replaceAll("\\", "/"));
    const { dosDate, dosTime } = toDosDateTime(stats.mtime);
    const metadata = {
      crc: crc32(content),
      size: content.length,
      dosDate,
      dosTime
    };
    const { header } = makeLocalHeader(fileNameBuffer, metadata, offset);
    localParts.push(header, fileNameBuffer, content);
    centralParts.push(makeCentralHeader(fileNameBuffer, metadata, offset), fileNameBuffer);
    offset += header.length + fileNameBuffer.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localDirectory.length, 16);
  endRecord.writeUInt16LE(0, 20);

  const archive = Buffer.concat([localDirectory, centralDirectory, endRecord]);
  await writeBinary(zipPath, archive);
  return archive.length;
}

