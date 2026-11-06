// Small helpers for tests that run inside Photoshop.
const uxp = require("uxp");
const { app, action, core, imaging } = require("photoshop");

function suite(log) {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok });
    log((ok ? "PASS " : "FAIL ") + name + (ok || detail === undefined ? "" : " :: " + JSON.stringify(detail)));
  };
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  const done = () => ({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, failures: results.filter((r) => !r.ok).map((r) => r.name) });
  return { check, near, done };
}

const modal = (fn) => core.executeAsModal(fn, { commandName: "TV test" });

// Closes an open copy of this exact file first. Matched by full path, never by name, because a test copy
// can share its filename with one of the user's real files.
async function openFresh(path) {
  let doc;
  const want = path.replace(/\//g, "\\").toLowerCase();
  await modal(async () => {
    for (const d of app.documents.slice()) {
      let open = "";
      try {
        open = String(d.path || "").replace(/\//g, "\\").toLowerCase();
      } catch (e) {
        open = "";
      }
      if (open && open === want) await d.closeWithoutSaving();
    }
    doc = await app.open(await uxp.storage.localFileSystem.getEntryWithUrl("file:" + path));
  });
  return doc;
}

const closeDoc = (doc) => modal(() => doc.closeWithoutSaving());

// All layers below `layers`, top of the stack first.
function flat(layers, out = []) {
  for (const l of layers) {
    out.push(l);
    if (l.layers) flat(l.layers, out);
  }
  return out;
}

const describe = async (id) => (await action.batchPlay([{ _obj: "get", _target: [{ _ref: "layer", _id: id }], _options: { dialogOptions: "silent" } }], {}))[0];

const box = (b) => ({ left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) });

// The document's composite for a rectangle, as RGB bytes, scaled to size.
async function pixels(doc, rect, size) {
  let data;
  await modal(async () => {
    const { imageData } = await imaging.getPixels({ documentID: doc.id, sourceBounds: rect, targetSize: { width: size, height: size }, colorSpace: "RGB", componentSize: 8 });
    data = { bytes: await imageData.getData({ chunky: true }), components: imageData.components, width: imageData.width, height: imageData.height };
    imageData.dispose();
  });
  return data;
}

function difference(a, b) {
  let worst = 0, total = 0, count = 0;
  const n = Math.min(a.width * a.height, b.width * b.height);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.bytes[i * a.components + c] - b.bytes[i * b.components + c]);
      worst = Math.max(worst, d);
      total += d;
      count++;
    }
  }
  return { worst, mean: total / count };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function fromBase64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, value = 0, p = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (value >> bits) & 255;
    }
  }
  return out;
}

// Saves a rectangle of the document as a JPEG, for looking at the result.
async function saveJpeg(doc, rect, maxSide, path) {
  const w = rect.right - rect.left, h = rect.bottom - rect.top;
  const f = Math.min(1, maxSide / Math.max(w, h));
  await modal(async () => {
    const { imageData } = await imaging.getPixels({ documentID: doc.id, sourceBounds: rect, targetSize: { width: Math.round(w * f), height: Math.round(h * f) }, colorSpace: "RGB", componentSize: 8, applyAlpha: true });
    const text = await imaging.encodeImageData({ imageData, base64: true });
    imageData.dispose();
    const entry = await uxp.storage.localFileSystem.createEntryWithUrl("file:" + path, { overwrite: true });
    await entry.write(fromBase64(text).buffer, { format: uxp.storage.formats.binary });
  });
}

module.exports = { suite, modal, openFresh, closeDoc, flat, describe, box, pixels, difference, saveJpeg };
