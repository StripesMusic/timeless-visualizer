// batchPlay wrappers. Everything here except describeLayer and boundsOf needs executeAsModal.
const { action } = require("photoshop");
const { unionBounds } = require("../core/geometry");

const HERE = { _ref: "layer", _enum: "ordinal", _value: "targetEnum" };
const px = (v) => ({ _unit: "pixelsUnit", _value: v });
const pct = (v) => ({ _unit: "percentUnit", _value: v });
const floatRect = (r) => ({ _obj: "classFloatRect", top: r.top, left: r.left, bottom: r.bottom, right: r.right });

// "dontDisplay" can still pop a blocking error dialog, so everything runs "silent" and errors are checked here.
async function play(commands) {
  const results = await action.batchPlay(commands.map((c) => ({ _options: { dialogOptions: "silent" }, ...c })), { synchronousExecution: false });
  results.forEach((r) => {
    if (r && r._obj === "error") throw new Error(r.message || "Photoshop couldn't finish a step (" + r.result + ").");
  });
  return results;
}

function selectLayers(ids) {
  return play(ids.map((id, i) => ({
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    ...(i ? { selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" } } : {}),
  })));
}

async function describeLayer(id) {
  return (await play([{ _obj: "get", _target: [{ _ref: "layer", _id: id }] }]))[0];
}

const activeLayerId = async () => (await play([{ _obj: "get", _target: [HERE] }]))[0].layerID;

async function backgroundToLayer() {
  const [made] = await play([{
    _obj: "set",
    _target: [{ _ref: "layer", _property: "background" }],
    to: { _obj: "layer", opacity: pct(100), mode: { _enum: "blendMode", _value: "normal" } },
  }]);
  return made.layerID;
}

const renameLayer = (id, name) => play([{ _obj: "set", _target: [{ _ref: "layer", _id: id }], to: { _obj: "layer", name } }]);

const setLock = (id, lock) => play([{ _obj: "applyLocking", _target: [{ _ref: "layer", _id: id }], layerLocking: { _obj: "layerLocking", ...lock } }]);
const lockAll = (id) => setLock(id, { protectAll: true });
const unlock = (id) => setLock(id, { protectNone: true });
// Photoshop re-sorts layers between artboards whenever a board moves or changes size: a layer outside
// its own board goes to whichever board it's over, or out of artboards altogether. This lock stops that.
const lockNesting = (id) => setLock(id, { protectArtboardAutonest: true });

// For layers that aren't ours to reset: changes this one lock and leaves the others as they are.
async function setNestingLock(id, on) {
  const { _obj, ...current } = (await describeLayer(id)).layerLocking;
  await setLock(id, { ...current, protectArtboardAutonest: on });
}

// Wraps the selected layers. There can't be a Background among them.
const makeArtboard = (name, rect) => play([{
  _obj: "make",
  _target: [{ _ref: "artboardSection" }],
  from: HERE,
  using: { _obj: "artboardSection", name },
  artboardRect: floatRect(rect),
}]);

async function duplicateArtboard(id, name) {
  await selectLayers([id]);
  const [out] = await play([{ _obj: "duplicate", _target: [HERE], name, version: 5 }]);
  return out.ID[out.ID.length - 1];
}

async function artboardInfo(id) {
  const { artboard } = await describeLayer(id);
  const r = artboard.artboardRect;
  return {
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    look: { color: artboard.color, artboardBackgroundType: artboard.artboardBackgroundType },
  };
}

async function moveArtboard(id, dx, dy) {
  await selectLayers([id]);
  await play([{ _obj: "move", _target: [HERE], to: { _obj: "offset", horizontal: px(dx), vertical: px(dy) } }]);
}

async function resizeArtboard(id, rect, look) {
  await selectLayers([id]);
  await play([{
    _obj: "editArtboardEvent",
    _target: [HERE],
    artboard: { _obj: "artboard", artboardRect: floatRect(rect), guideIDs: [], artboardPresetName: "Custom", ...look },
    changeSizes: true,
  }]);
}

// Converting a hidden layer makes an empty smart object, and converting a layer with opacity bakes
// the opacity inside. So both are undone for the conversion and put back on the new layer.
async function toSmartObject(layer) {
  const { id, name, visible, opacity, fillOpacity } = layer;
  await selectLayers([id]);
  if (!visible) await play([{ _obj: "show", null: [{ _ref: "layer", _id: id }] }]);
  await play([{ _obj: "set", _target: [HERE], to: { _obj: "layer", opacity: pct(100), fillOpacity: pct(100) } }]);
  await play([{ _obj: "newPlacedLayer" }]);
  await play([{ _obj: "set", _target: [HERE], to: { _obj: "layer", opacity: pct(opacity), fillOpacity: pct(fillOpacity) } }]);
  await play([{ _obj: "set", _target: [HERE], to: { _obj: "layer", name } }]);
  if (!visible) await play([{ _obj: "hide", null: [HERE] }]);
  return activeLayerId();
}

// Scales about the document's origin, then shifts: newX = x * scale + dx.
// Photoshop refuses to transform a selection of only hidden layers, so they're shown for the move.
async function transformLayers(ids, { scale, dx, dy }) {
  const hidden = [];
  for (const id of ids) if (!(await describeLayer(id)).visible) hidden.push(id);
  if (hidden.length) await play(hidden.map((id) => ({ _obj: "show", null: [{ _ref: "layer", _id: id }] })));
  await selectLayers(ids);
  await play([{
    _obj: "transform",
    _target: [HERE],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSIndependent" },
    position: { _obj: "paint", horizontal: px(0), vertical: px(0) },
    offset: { _obj: "offset", horizontal: px(dx), vertical: px(dy) },
    width: pct(scale * 100),
    height: pct(scale * 100),
    linked: true,
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
  }]);
  if (hidden.length) await play(hidden.map((id) => ({ _obj: "hide", null: [{ _ref: "layer", _id: id }] })));
}

async function deleteLayers(ids) {
  await selectLayers(ids);
  await play([{ _obj: "delete", _target: [HERE] }]);
}

const rgb = ({ red, green, blue }) => ({ _obj: "RGBColor", red, grain: green, blue });

async function setLayerEffects(id, effects) {
  await selectLayers([id]);
  await play([{
    _obj: "set",
    _target: [{ _ref: "property", _property: "layerEffects" }, HERE],
    to: { _obj: "layerEffects", ...effects },
  }]);
}

const setColorOverlay = (id, color) => setLayerEffects(id, {
  scale: pct(100),
  solidFill: {
    _obj: "solidFill",
    enabled: true,
    present: true,
    showInDialog: true,
    mode: { _enum: "blendMode", _value: "normal" },
    color: rgb(color),
    opacity: pct(100),
  },
});

async function setShapeColor(id, color) {
  await selectLayers([id]);
  await play([{
    _obj: "set",
    _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "solidColorLayer", color: rgb(color) },
  }]);
}

// Adjustment layers report the whole document as their bounds, so they don't count.
const HAS_SHAPE = new Set(["text", "pixel", "smartObject", "solidColor", "gradientFill", "pattern"]);

function leavesOf(layer) {
  return layer.layers ? Array.from(layer.layers).flatMap(leavesOf) : [layer];
}

// The visible content of a layer or group, without effects such as drop shadows.
function boundsOf(layer) {
  const leaves = leavesOf(layer).filter((l) => HAS_SHAPE.has(String(l.kind)));
  const visible = leaves.filter((l) => l.visible);
  const plain = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
  return unionBounds((visible.length ? visible : leaves).map((l) => plain(l.boundsNoEffects)));
}

module.exports = {
  play,
  selectLayers,
  describeLayer,
  backgroundToLayer,
  renameLayer,
  lockAll,
  unlock,
  lockNesting,
  setNestingLock,
  makeArtboard,
  duplicateArtboard,
  artboardInfo,
  moveArtboard,
  resizeArtboard,
  toSmartObject,
  transformLayers,
  deleteLayers,
  setLayerEffects,
  setColorOverlay,
  setShapeColor,
  boundsOf,
};
