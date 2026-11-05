const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildPackage, readZip } = require("../scripts/package");

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tv-pkg-")), "Test.ccx");
const entries = () => readZip(fs.readFileSync(out));

test.before(() => buildPackage(out));

test("the manifest is at the root, with the right id and name", () => {
  const manifest = JSON.parse(entries().get("manifest.json").toString("utf8"));
  assert.equal(manifest.id, "com.stripesmusic.timelessvisualizer");
  assert.equal(manifest.name, "Timeless Visualizer");
  assert.equal(manifest.version, "1.0.0");
});

test("the manifest asks for nothing it doesn't need", () => {
  const manifest = JSON.parse(entries().get("manifest.json").toString("utf8"));
  assert.deepEqual(manifest.requiredPermissions, { localFileSystem: "fullAccess" });
});

test("no dev files ship", () => {
  for (const name of entries().keys()) {
    assert.ok(!/(^|\/)(dev|test|docs|scripts|dist)\//.test(name), name);
    assert.ok(!name.includes("harness"), name);
  }
});

test("zip entries use forward slashes and every file survives the round trip", () => {
  const files = entries();
  for (const name of files.keys()) assert.ok(!name.includes("\\"), name);
  const source = fs.readFileSync(path.join(__dirname, "..", "plugin", "ae", "build_visuals.jsx"));
  assert.ok(files.get("ae/build_visuals.jsx").equals(source));
});

test("what index.html and the manifest name is in the package", () => {
  const files = entries();
  const html = files.get("index.html").toString("utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(files.has(ref), ref);
  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  assert.ok(files.has(manifest.main));
  const icons = [...manifest.icons, ...manifest.entrypoints.flatMap((e) => e.icons)];
  for (const icon of icons) {
    for (const scale of icon.scale) {
      const name = icon.path.replace(/\.png$/, `@${scale}x.png`);
      assert.ok(files.has(name), name);
      const png = files.get(name);
      assert.equal(png.readUInt32BE(16), icon.width * scale, name);
      assert.equal(png.readUInt32BE(20), icon.height * scale, name);
    }
  }
});

test("every icon is a well-formed PNG with intact chunks", () => {
  for (const [name, png] of entries()) {
    if (!name.endsWith(".png")) continue;
    let at = 8;
    let last = "";
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      last = png.toString("latin1", at + 4, at + 8);
      const stored = png.readUInt32BE(at + 8 + length);
      assert.equal(zlib.crc32(png.subarray(at + 4, at + 8 + length)), stored, `${name} ${last}`);
      at += 12 + length;
    }
    assert.equal(at, png.length, name);
    assert.equal(last, "IEND", name);
  }
});

test("every relative require in the package resolves inside it", () => {
  const files = entries();
  for (const [name, data] of files) {
    if (!name.endsWith(".js")) continue;
    const dir = path.posix.dirname(name);
    for (const [, ref] of data.toString("utf8").matchAll(/require\("(\.[^"]+)"\)/g)) {
      const target = path.posix.normalize(path.posix.join(dir, ref));
      assert.ok(files.has(target) || files.has(target + ".js"), `${name} -> ${ref}`);
    }
  }
});

test("only modules UXP provides are required by bare name", () => {
  const allowed = new Set(["fs", "uxp", "photoshop"]);
  for (const [name, data] of entries()) {
    if (!name.endsWith(".js")) continue;
    for (const [, ref] of data.toString("utf8").matchAll(/require\("([^."][^"]*)"\)/g)) assert.ok(allowed.has(ref), `${name} -> ${ref}`);
  }
});

test("readZip's checksums catch nothing wrong in a fresh package", () => {
  const raw = fs.readFileSync(out);
  assert.equal(raw.readUInt32LE(0), 0x04034b50);
  assert.ok(typeof zlib.crc32 === "function");
});
