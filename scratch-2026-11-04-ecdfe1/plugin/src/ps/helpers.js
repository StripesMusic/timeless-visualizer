// Saves the images the After Effects project links to. The working document isn't changed: flat images
// come from its composite, and text images from layer copies in a temporary document.
const uxp = require("uxp");
const { app, core, imaging } = require("photoshop");
const { unionBounds, boxWidth, boxHeight } = require("../core/geometry");
const { resolvePicks } = require("../core/picks");
const { listArtboards } = require("./doc");
const a = require("./actions");

const SRGB = "sRGB IEC61966-2.1";
const COMING_SOON_BOARD = "FlyerComingSoon";
const OUT_NOW_BOARD = "FlyerOutNow";
const LOGO_LAYER = "Timeless";
const NOT_ADJUSTMENTS = new Set(["group", "text", "pixel", "smartObject", "solidColor", "gradientFill", "pattern", "video", "threeD", "backgroundSheet"]);

const toTree = (layers) => Array.from(layers).map((l) => ({ id: l.id, ...(l.layers ? { layers: toTree(l.layers) } : {}) }));

function atPath(layers, path) {
  const [first, ...rest] = path;
  return rest.length ? atPath(layers[first].layers, rest) : layers[first];
}

function findByName(layers, name) {
  for (const layer of layers) {
    if (layer.name === name) return layer;
    const inner = layer.layers ? findByName(layer.layers, name) : null;
    if (inner) return inner;
  }
  return null;
}

async function ensureFolder(path) {
  const lfs = uxp.storage.localFileSystem;
  const url = "file:" + path.replace(/\\/g, "/");
  try {
    return await lfs.getEntryWithUrl(url);
  } catch (e) {
    return lfs.createEntryWithUrl(url, { type: uxp.storage.types.folder });
  }
}

const newFile = (folder, name) => folder.createFile(name, { overwrite: true });

// documents.add can hand back the previously active document, so the new one is read from the app.
// Closing the wrong one here would lose unsaved work, so that's checked before anything else happens.
async function tempDocument(doc, rect) {
  await app.documents.add({
    width: boxWidth(rect),
    height: boxHeight(rect),
    resolution: doc.resolution,
    mode: "RGBColorMode",
    fill: "transparent",
    profile: SRGB,
    name: "TV Helper",
  });
  const temp = app.activeDocument;
  if (temp.id === doc.id) throw new Error("Photoshop didn't open a temporary document for the helper images.");
  return temp;
}

async function saveComposite(doc, rect, folder, name) {
  const { imageData } = await imaging.getPixels({ documentID: doc.id, sourceBounds: rect, colorSpace: "RGB", colorProfile: SRGB, componentSize: 8 });
  const temp = await tempDocument(doc, rect);
  try {
    await imaging.putPixels({ documentID: temp.id, layerID: temp.layers[0].id, imageData, replace: true });
    const file = await newFile(folder, name);
    await temp.saveAs.jpg(file, { quality: 12 }, true);
    return file.nativePath;
  } finally {
    imageData.dispose();
    await temp.closeWithoutSaving();
    app.activeDocument = doc;
  }
}

async function saveLayers(doc, layers, rect, folder, name, { withoutEffects = false } = {}) {
  const before = unionBounds(layers.map(a.boundsOf).filter(Boolean));
  const temp = await tempDocument(doc, rect);
  try {
    const blank = temp.layers[0].id;
    app.activeDocument = doc;
    // The return value of duplicateLayers isn't reliable, so the copies are read from the document.
    await doc.duplicateLayers(layers, temp);
    app.activeDocument = temp;
    const copies = Array.from(temp.layers).filter((l) => l.id !== blank);
    const after = unionBounds(copies.map(a.boundsOf).filter(Boolean));
    const dx = before.left - rect.left - after.left;
    const dy = before.top - rect.top - after.top;
    for (const copy of copies) {
      if ((dx || dy) && a.boundsOf(copy)) await copy.translate(dx, dy);
      if (withoutEffects && (await a.describeLayer(copy.id)).layerEffects) {
        await a.selectLayers([copy.id]);
        await a.play([{ _obj: "disableLayerStyle", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }]);
      }
    }
    const file = await newFile(folder, name);
    await temp.saveAs.png(file, {}, true);
    return file.nativePath;
  } finally {
    await temp.closeWithoutSaving();
    app.activeDocument = doc;
  }
}

function boardOf(doc, boards, name) {
  const board = boards.find((b) => b.name === name);
  if (!board) throw new Error(`The ${name} artboard isn't in this PSD, so its helper image can't be saved.`);
  return { rect: board.bounds, layer: Array.from(doc.layers).find((l) => l.id === board.id) };
}

function wordLayer(board, word, boardName) {
  const layer = findByName(board.layer.layers, word);
  if (!layer) throw new Error(`The "${word}" layer isn't on ${boardName}, so its helper image can't be saved.`);
  return layer;
}

// The flyer's own stack, top first: adjustments above the lockup, then the lockup itself, without
// the COMING SOON wording. Grain or texture layers don't come along, only adjustments.
function canvasLayers(board, source, textIds) {
  const { paths } = resolvePicks(toTree(source.layers), textIds);
  const lockup = paths.map((p) => findByName(board.layer.layers, atPath(source.layers, p).name)).filter(Boolean);
  const logo = findByName(board.layer.layers, LOGO_LAYER);
  const parts = logo ? [logo, ...lockup] : lockup;
  const top = Array.from(board.layer.layers);
  const topIndex = (layer) => {
    let at = layer;
    while (at.parent && at.parent.id !== board.layer.id) at = at.parent;
    return top.findIndex((l) => l.id === at.id);
  };
  const highest = Math.min(...parts.map(topIndex));
  const adjustments = top.slice(0, Math.max(highest, 0)).filter((l) => l.visible && !NOT_ADJUSTMENTS.has(String(l.kind)));
  const ordered = parts.slice().sort((p, q) => topIndex(p) - topIndex(q));
  return [...adjustments, ...ordered];
}

async function exportHelpers(doc, folder, { sourceId, textIds }) {
  const out = {};
  await core.executeAsModal(
    async () => {
      app.activeDocument = doc;
      const boards = listArtboards(doc);
      const source = boards.find((b) => b.id === sourceId);
      if (!source) throw new Error("The source art isn't an artboard in this document.");
      const sourceLayer = Array.from(doc.layers).find((l) => l.id === sourceId);
      const coming = boardOf(doc, boards, COMING_SOON_BOARD);
      const outNow = boardOf(doc, boards, OUT_NOW_BOARD);

      out.coverArt = await saveComposite(doc, source.bounds, folder, "CoverArt.jpg");
      out.bgPortrait = await saveComposite(doc, boardOf(doc, boards, "BGPortrait").rect, folder, "BGPortrait.jpg");
      // After Effects adds its own shadows to these two, so they're saved without the layer's.
      out.comingSoonText = await saveLayers(doc, [wordLayer(coming, "COMING SOON", COMING_SOON_BOARD)], coming.rect, folder, "ComingSoonText.png", { withoutEffects: true });
      out.outNowText = await saveLayers(doc, [wordLayer(outNow, "OUT NOW", OUT_NOW_BOARD)], outNow.rect, folder, "OutNowText.png", { withoutEffects: true });
      out.canvasText = await saveLayers(doc, canvasLayers(coming, sourceLayer, textIds), coming.rect, folder, "CanvasText.png");
    },
    { commandName: "Timeless Visualizer images" }
  );
  return out;
}

module.exports = { exportHelpers, ensureFolder };
