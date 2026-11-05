// Reads artboards, the current selection and fonts. Nothing here changes the document.
const { app, action } = require("photoshop");

function describeNow(id) {
  return action.batchPlay([{ _obj: "get", _target: [{ _ref: "layer", _id: id }], _options: { dialogOptions: "silent" } }], { synchronousExecution: true })[0];
}

function listArtboards(doc) {
  const boards = [];
  for (const layer of doc.layers) {
    if (String(layer.kind) !== "group") continue;
    const info = describeNow(layer.id);
    if (!info.artboardEnabled) continue;
    const r = info.artboard.artboardRect;
    boards.push({ id: layer.id, name: layer.name, bounds: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }
  return boards;
}

function selectionInfo() {
  const doc = app.activeDocument;
  if (!doc) return [];
  return Array.from(doc.activeLayers).map((l) => ({ id: l.id, name: l.name, kind: String(l.kind) }));
}

function findLayer(layers, id) {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    const inner = layer.layers ? findLayer(layer.layers, id) : null;
    if (inner) return inner;
  }
  return null;
}

function textLayersIn(layer) {
  if (layer.layers) return Array.from(layer.layers).flatMap(textLayersIn);
  return String(layer.kind) === "text" ? [layer] : [];
}

// Every live text layer inside the picks, largest first. Mixed-font text reports its first run.
function collectFonts(ids) {
  const doc = app.activeDocument;
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const picked = findLayer(doc.layers, id);
    if (!picked) continue;
    for (const layer of textLayersIn(picked)) {
      if (seen.has(layer.id)) continue;
      seen.add(layer.id);
      const key = describeNow(layer.id).textKey;
      const style = key.textStyleRange[0].textStyle;
      const scale = key.transform ? Math.abs(key.transform.yy) : 1;
      const points = style.size && style.size._value !== undefined ? style.size._value : style.size;
      const c = style.color || {};
      const b = layer.boundsNoEffects;
      out.push({
        font: style.fontPostScriptName,
        color: { red: c.red, green: c.grain, blue: c.blue },
        size: points * scale,
        widthPx: b.right - b.left,
      });
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

module.exports = { listArtboards, selectionInfo, collectFonts, findLayer };

