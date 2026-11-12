// Prints the active document's layer tree. Usage: node dev/ps.js dev/ps-tests/dump.js
const { app, action } = require("photoshop");

async function details(id) {
  const [d] = await action.batchPlay(
    [{ _obj: "get", _target: [{ _ref: "layer", _id: id }], _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: true }
  );
  return d;
}

async function walk(layers, depth, out) {
  for (const l of layers) {
    const d = await details(l.id);
    const b = l.bounds;
    const so = d.smartObject ? " so=" + (d.smartObjectMore && d.smartObjectMore.ID ? String(d.smartObjectMore.ID).slice(0, 8) : "?") : "";
    const ab = d.artboardEnabled ? " ARTBOARD" : "";
    out.push(
      " ".repeat(depth * 2) +
        `#${l.id} ${l.name} [${l.kind}]${ab}${so} ${String(l.blendMode).toLowerCase()} ${Math.round(l.opacity)}%` +
        (l.visible ? "" : " HIDDEN") +
        (l.isClippingMask ? " CLIP" : "") +
        (l.allLocked ? " LOCKED" : "") +
        ` (${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)})`
    );
    if (l.layers) await walk(l.layers, depth + 1, out);
  }
}

exports.run = async () => {
  const doc = app.activeDocument;
  if (!doc) return { documents: 0 };
  const lines = [];
  await walk(doc.layers, 0, lines);
  return { name: doc.name, id: doc.id, w: doc.width, h: doc.height, tree: lines };
};
