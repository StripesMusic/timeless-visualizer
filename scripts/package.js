// Builds dist/TimelessVisualizer-<version>.ccx from plugin/. A .ccx is a zip with manifest.json at its root.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const PLUGIN = path.join(__dirname, "..", "plugin");

function listFiles(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), name + "/") : [name];
  });
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0); // version needed
    shared.writeUInt16LE(0x0800, 2); // names are UTF-8
    shared.writeUInt16LE(8, 4); // deflate
    shared.writeUInt32LE(crc, 10);
    shared.writeUInt32LE(packed.length, 14);
    shared.writeUInt32LE(data.length, 18);
    shared.writeUInt16LE(nameBytes.length, 22);
    const localHead = Buffer.alloc(4);
    localHead.writeUInt32LE(0x04034b50);
    const local = Buffer.concat([localHead, shared, nameBytes, packed]);
    const centralHead = Buffer.alloc(6);
    centralHead.writeUInt32LE(0x02014b50);
    centralHead.writeUInt16LE(20, 4);
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(offset, 10);
    centrals.push(Buffer.concat([centralHead, shared, tail, nameBytes]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function readZip(buffer) {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const packedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const data = zlib.inflateRawSync(buffer.subarray(dataAt, dataAt + packedSize));
    if (zlib.crc32(data) !== buffer.readUInt32LE(at + 16)) throw new Error("Bad checksum: " + name);
    files.set(name, data);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function buildPackage(outPath) {
  const names = listFiles(PLUGIN).sort();
  const files = names.map((name) => [name, fs.readFileSync(path.join(PLUGIN, name))]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, zip(files));
  return outPath;
}

if (require.main === module) {
  const { version } = JSON.parse(fs.readFileSync(path.join(PLUGIN, "manifest.json"), "utf8"));
  const out = path.join(__dirname, "..", "dist", `TimelessVisualizer-${version}.ccx`);
  console.log(buildPackage(out));
}

module.exports = { buildPackage, readZip };
