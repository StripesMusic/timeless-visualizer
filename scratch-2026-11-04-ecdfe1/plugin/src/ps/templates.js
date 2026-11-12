// Copies pieces out of the template PSDs. Templates are only read and never saved.
const uxp = require("uxp");
const { app } = require("photoshop");
const { boxWidth } = require("../core/geometry");
const { applyFont, setWording } = require("./text");
const { findLayer } = require("./doc");
const a = require("./actions");

const normalize = (path) => path.replace(/\\/g, "/").toLowerCase();

function pathOf(doc) {
  try {
    return normalize(String(doc.path));
  } catch (e) {
    return "";
  }
}

function findByName(layers, name) {
  for (const layer of layers) {
    if (layer.name === name) return layer;
    const inner = layer.layers ? findByName(layer.layers, name) : null;
    if (inner) return inner;
  }
  return null;
}

// Opens each template once, and at the end closes only the ones it opened.
function templateOpener() {
  const open = new Map();
  return {
    async get(path) {
      const key = normalize(path);
      if (open.has(key)) return open.get(key).doc;
      const already = Array.from(app.documents).find((d) => pathOf(d) === key);
      if (already) {
        open.set(key, { doc: already, ours: false });
        return already;
      }
      const lfs = uxp.storage.localFileSystem;
      let token;
      try {
        token = lfs.createSessionToken(await lfs.getEntryWithUrl("file:" + path.replace(/\\/g, "/")));
      } catch (e) {
        throw new Error("Can't open the template: " + path);
      }
      await a.play([{ _obj: "open", null: { _path: token, _kind: "local" } }]);
      const doc = app.activeDocument;
      open.set(key, { doc, ours: true });
      return doc;
    },
    async closeAll() {
      for (const { doc, ours } of open.values()) if (ours) await doc.closeWithoutSaving();
      open.clear();
    },
  };
}

// A layer copied out of a group loses the group's drop shadow, so the copy gets it directly.
async function parentShadow(layer) {
  const parent = layer.parent;
  if (!parent) return null;
  const effects = (await a.describeLayer(parent.id)).layerEffects;
  return effects && effects.dropShadow && effects.dropShadow.enabled ? { scale: effects.scale, dropShadow: effects.dropShadow } : null;
}

// Puts copies at the template's position on the board, directly above `anchor` in the stack.
// A copy lands directly above whatever is selected in the target document, or at the top of a selected
// artboard, so nothing needs moving in the stack. Returns the new layers by name.
async function addTemplatePieces(doc, board, rect, templateDoc, names, anchor, issues) {
  const pieces = {};
  for (const name of names) {
    const original = findByName(templateDoc.layers, name);
    if (!original) {
      issues.push(`The template has no "${name}" layer, so it was left out of ${board.name}.`);
      continue;
    }
    app.activeDocument = doc;
    await a.selectLayers([(anchor || board).id]);
    app.activeDocument = templateDoc;
    const bounds = a.boundsOf(original);
    const shadow = await parentShadow(original);
    const copy = await original.duplicate(doc);
    app.activeDocument = doc;
    const layer = findLayer(doc.layers, copy.id);
    await a.lockNesting(copy.id);
    const now = a.boundsOf(layer);
    const dx = bounds.left + rect.left - now.left;
    const dy = bounds.top + rect.top - now.top;
    if (dx || dy) await layer.translate(dx, dy);
    if (shadow) await a.setLayerEffects(copy.id, shadow);
    pieces[name] = layer;
  }
  return pieces;
}

async function colorPiece(layer, color) {
  if (String(layer.kind) === "solidColor") await a.setShapeColor(layer.id, color);
  else await a.setColorOverlay(layer.id, color);
}

// Everything keeps the template's width in the new font, and OUT NOW keeps COMING SOON's size.
async function stylePieces(def, layout, pieces, font) {
  const inPieces = (name) => {
    for (const layer of Object.values(pieces)) {
      if (layer.name === name) return layer;
      const inner = layer.layers ? findByName(layer.layers, name) : null;
      if (inner) return inner;
    }
    return null;
  };
  const typeName = layout.wordingLayer || layout.outNowTextLayer;
  const type = typeName ? inPieces(typeName) : null;
  if (type) {
    const before = a.boundsOf(type);
    if (font) await applyFont([type.id], font, { fitWidth: boxWidth(before) });
    if (def.flyerWording && def.flyerWording !== typeName) await setWording(type.id, def.flyerWording, (before.left + before.right) / 2);
  }
  if (font && font.color) {
    for (const name of layout.colorLayers || []) {
      const layer = inPieces(name);
      if (layer) await colorPiece(layer, font.color);
    }
  }
}

module.exports = { templateOpener, addTemplatePieces, stylePieces };
