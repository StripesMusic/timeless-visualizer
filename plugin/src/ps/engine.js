// Builds the artboards. The source is never edited: a temporary copy of it, the master, holds the
// smart objects, and each board is a copy of the master so its smart objects stay linked.
const { app, core } = require("photoshop");
const { BOARDS, TEMPLATE_LAYOUT } = require("../core/boards");
const { coverScale, fitInto, stackLayout, unionBounds, placeRow, overlaps, boxWidth, boxHeight } = require("../core/geometry");
const { resolvePicks, isWithin } = require("../core/picks");
const { listArtboards } = require("./doc");
const { templateOpener, addTemplatePieces, stylePieces } = require("./templates");
const a = require("./actions");

const HISTORY_NAME = "Timeless Visualizer";
const MASTER_NAME = "TV Master";
const WRAP_NAME = "Cover Art";

// Runs one finishing step and records how long it took, in ms, under `name`.
async function timed(timings, name, step) {
  const started = Date.now();
  try {
    return await step();
  } finally {
    timings[name] = Date.now() - started;
  }
}

const topLayer = (doc, id) => Array.from(doc.layers).find((l) => l.id === id);
const toTree = (layers) => Array.from(layers).map((l) => ({ id: l.id, ...(l.layers ? { layers: toTree(l.layers) } : {}) }));
const notInside = (paths, containers) => paths.filter((p) => !containers.some((c) => isWithin(p, c)));
const shift = (box, x, y) => ({ left: box.left + x, top: box.top + y, right: box.right + x, bottom: box.bottom + y });

function atPath(layers, path) {
  const [first, ...rest] = path;
  return rest.length ? atPath(layers[first].layers, rest) : layers[first];
}

async function wrapInArtboard(doc) {
  const rect = { left: 0, top: 0, right: doc.width, bottom: doc.height };
  const backgroundId = doc.backgroundLayer ? await a.backgroundToLayer() : null;
  if (backgroundId) await a.renameLayer(backgroundId, "Background");
  await a.selectLayers(Array.from(doc.layers).map((l) => l.id));
  await a.makeArtboard(WRAP_NAME, rect);
  if (backgroundId) await a.lockAll(backgroundId);
  return Array.from(doc.layers).find((l) => l.name === WRAP_NAME).id;
}

const allIds = (layers) => Array.from(layers).flatMap((l) => [l.id, ...(l.layers ? allIds(l.layers) : [])]);

// Expects every layer to be unlocked already (see makeMaster).
async function prepareLayers(layers, issues) {
  for (const layer of Array.from(layers)) {
    if (layer.layers) {
      await prepareLayers(layer.layers, issues);
    } else if (String(layer.kind) === "pixel" && a.boundsOf(layer)) {
      try {
        await a.toSmartObject(layer);
      } catch (e) {
        issues.push(`"${layer.name}" couldn't become a smart object, so it stays as pixels on each board.`);
      }
    }
  }
}

// Full-canvas gradient and pattern fills don't belong to their artboard. They stay anchored to the
// document when a board moves, so a gradient lands in the wrong place on every other board, and each
// one stores pixels across the whole document, which pushes the PSD past Photoshop's 2 GB limit.
// As smart objects they move and scale with the board, and converting them where they look right,
// over the source, locks in that look. Fills bounded by a shape stay live.
async function convertFills(layers, issues) {
  for (const layer of Array.from(layers)) {
    if (layer.layers) {
      await convertFills(layer.layers, issues);
      continue;
    }
    const kind = String(layer.kind);
    if (kind !== "gradientFill" && kind !== "pattern") continue;
    const { hasVectorMask, adjustment } = await a.describeLayer(layer.id);
    if (hasVectorMask && (kind === "pattern" || adjustment[0].align)) continue;
    await a.unlock(layer.id);
    try {
      await a.lockNesting(await a.toSmartObject(layer));
    } catch (e) {
      issues.push(`"${layer.name}" couldn't become a smart object, so it may sit differently on each board.`);
      await a.lockNesting(layer.id);
    }
  }
}

async function makeMaster(doc, source, rectsInUse, issues) {
  const id = await a.duplicateArtboard(source.id, MASTER_NAME);
  const { rect } = await a.artboardInfo(id);
  const lock = () => a.setLockMany(Array.from(topLayer(doc, id).layers).map((l) => l.id), { protectArtboardAutonest: true });

  await lock();
  await a.moveArtboard(id, source.bounds.left - rect.left, source.bounds.top - rect.top);
  await convertFills(topLayer(doc, id).layers, issues);

  // Then off to one side, below everything, while the boards get made.
  const lowest = Math.max(...rectsInUse.map((r) => r.bottom));
  await a.moveArtboard(id, 0, lowest + 1000 - source.bounds.top);
  await a.setLockMany(allIds(topLayer(doc, id).layers), { protectNone: true });
  await prepareLayers(topLayer(doc, id).layers, issues);
  await lock();
  return id;
}

async function placeLockup(def, rect, textLayers, logoLayers, issues) {
  const layout = TEMPLATE_LAYOUT[def.lockup];
  if (!layout || !textLayers.length) return;
  const box = shift(layout.lockupBox, rect.left, rect.top);
  const textBounds = unionBounds(textLayers.map(a.boundsOf).filter(Boolean));
  if (!textBounds) {
    issues.push(`${def.name}: the Text picks have nothing visible, so the lockup stayed where it was.`);
    return;
  }
  const textIds = textLayers.map((l) => l.id);
  if (def.lockup === "youtube") {
    const logoIds = logoLayers.map((l) => l.id);
    const logoBounds = logoLayers.length ? unionBounds(logoLayers.map(a.boundsOf).filter(Boolean)) : null;
    const out = stackLayout(textBounds, logoBounds, box, layout.logoGap);
    await a.transformLayers(textIds, { scale: out.scale, ...out.text });
    if (logoBounds) await a.transformLayers(logoIds, { scale: out.scale, ...out.logo });
    return;
  }
  await a.transformLayers(textIds, fitInto(textBounds, box, { alignX: layout.alignX }));
}

async function buildBoard(doc, def, { masterId, rect, source, look, picks, issues, font, templatePaths, templates }) {
  const id = await a.duplicateArtboard(masterId, def.name);
  const start = (await a.artboardInfo(id)).rect;
  await a.moveArtboard(id, rect.left - start.left, rect.top - start.top);
  await a.resizeArtboard(id, rect, look);

  const dropped = [...(def.keepText ? [] : picks.text), ...(def.keepLogo ? [] : picks.logo)];
  const outermost = dropped.filter((p, i) => !dropped.some((q, j) => i !== j && isWithin(p, q) && (q.length < p.length || j < i)));
  const textPaths = notInside(def.keepText ? picks.text : [], dropped);
  const logoPaths = notInside(notInside(def.keepLogo ? picks.logo : [], dropped), textPaths);
  const board = topLayer(doc, id);
  const textLayers = textPaths.map((p) => atPath(board.layers, p));
  const logoLayers = logoPaths.map((p) => atPath(board.layers, p));
  // Template pieces go directly above the text, at the board's own level, under the finishing layers.
  const anchor = textPaths.length ? board.layers[textPaths[0][0]] : null;
  if (outermost.length) await a.deleteLayers(outermost.map((p) => atPath(board.layers, p).id));

  // Children sit at the same offsets from the board's corner as they did in the source.
  const srcW = boxWidth(source.bounds);
  const srcH = boxHeight(source.bounds);
  const scale = coverScale(srcW, srcH, boxWidth(rect), boxHeight(rect));
  const dx = rect.left + boxWidth(rect) / 2 - (rect.left + srcW / 2) * scale;
  const dy = rect.top + boxHeight(rect) / 2 - (rect.top + srcH / 2) * scale;
  const kids = Array.from(topLayer(doc, id).layers).map((l) => l.id);
  if (kids.length && (scale !== 1 || dx !== 0 || dy !== 0)) await a.transformLayers(kids, { scale, dx, dy });

  await placeLockup(def, rect, textLayers, logoLayers, issues);

  const templatePath = def.template ? templatePaths[def.template] : null;
  if (templatePath) {
    const layout = TEMPLATE_LAYOUT[def.template];
    const templateDoc = await templates.get(templatePath);
    const pieces = await addTemplatePieces(doc, topLayer(doc, id), rect, templateDoc, layout.copyLayers, anchor, issues);
    await stylePieces(def, layout, pieces, font);
  }
  return { id, name: def.name, rect };
}

// Existing boards keep their layers while new boards appear and move around. Layers that already have
// the same locks are changed together, in one step. Returns what to put back: [{ ids, lock }].
async function guardExisting(doc, boards) {
  const ids = boards.flatMap((b) => Array.from(topLayer(doc, b.id).layers).map((l) => l.id));
  const locks = await a.locksOf(ids);
  const groups = new Map();
  ids.forEach((id, i) => {
    const lock = locks[i];
    if (lock.protectArtboardAutonest || lock.protectAll) return;
    const key = JSON.stringify(lock);
    if (!groups.has(key)) groups.set(key, { ids: [], lock });
    groups.get(key).ids.push(id);
  });
  for (const { ids: same, lock } of groups.values()) await a.setLockMany(same, { ...lock, protectArtboardAutonest: true });
  return [...groups.values()];
}

// Puts back exactly the locks the existing layers had before the build.
async function releaseExisting(guarded) {
  for (const { ids, lock } of guarded) await a.setLockMany(ids, lock);
}

// Copies come out unlocked. Photoshop would later pull a layer off its board if it's outside the
// board, hidden or has no shape of its own, so those keep the nesting lock. It blocks nothing else.
// Two lock changes for all the boards together, not two per layer.
async function finishBoards(doc, made) {
  const all = [];
  const keep = [];
  for (const { id, rect } of made) {
    for (const layer of Array.from(topLayer(doc, id).layers)) {
      all.push(layer.id);
      if (!layer.visible || !overlaps(a.boundsOf(layer), rect)) keep.push(layer.id);
    }
  }
  await a.setLockMany(all, { protectNone: true });
  await a.setLockMany(keep, { protectArtboardAutonest: true });
}

async function build(doc, { sourceId, textIds, logoIds, font, flyer, banner }, onProgress, onStage, timings) {
  const issues = [];
  let boards = listArtboards(doc);

  // Templates open first, so a missing file or a minimized Photoshop stops the build straight away.
  const templatePaths = { flyer, banner };
  const named = new Set(boards.map((b) => b.name));
  const templates = templateOpener();
  try {
    for (const def of BOARDS) {
      if (!named.has(def.name) && def.template && templatePaths[def.template]) await templates.get(templatePaths[def.template]);
    }
    app.activeDocument = doc;
    return await buildAll(doc, { sourceId, textIds, logoIds, font, templatePaths, templates, boards, issues }, onProgress, onStage, timings);
  } finally {
    await timed(timings, "closeTemplates", () => templates.closeAll());
    app.activeDocument = doc;
  }
}

async function buildAll(doc, { sourceId, textIds, logoIds, font, templatePaths, templates, boards, issues }, onProgress, onStage, timings) {
  if (!boards.length) {
    sourceId = await wrapInArtboard(doc);
    boards = listArtboards(doc);
  }
  const source = boards.find((b) => b.id === sourceId);
  if (!source) throw new Error("The source art isn't an artboard in this document.");

  const taken = new Set(boards.map((b) => b.name));
  const missing = BOARDS.filter((b) => !taken.has(b.name));
  const skipped = BOARDS.filter((b) => taken.has(b.name)).map((b) => b.name);

  const tree = toTree(topLayer(doc, source.id).layers);
  const text = resolvePicks(tree, textIds);
  const logo = resolvePicks(tree, logoIds);
  if (text.missing.length) issues.push(`${text.missing.length} Text pick(s) aren't in the source art, so they were ignored.`);
  if (logo.missing.length) issues.push(`${logo.missing.length} Logo pick(s) aren't in the source art, so they were ignored.`);

  const srcW = boxWidth(source.bounds);
  const srcH = boxHeight(source.bounds);
  // Past everything that exists, including art hanging off the edge of a board.
  const inUse = boards.flatMap((b) => [b.bounds, ...Array.from(topLayer(doc, b.id).layers).map(a.boundsOf).filter(Boolean)]);
  const rects = placeRow(inUse, missing.map((b) => ({ width: b.width || srcW, height: b.height || srcH })));
  const { look } = await a.artboardInfo(source.id);
  const guarded = await timed(timings, "guardExisting", () => guardExisting(doc, boards));
  const masterId = await timed(timings, "makeMaster", () => makeMaster(doc, source, [...inUse, ...rects], issues));

  if (!font && missing.some((b) => b.template && templatePaths[b.template])) {
    issues.push("Your Text picks have no live text, so COMING SOON, OUT NOW and OUT NOW ON TIMELESS keep the template font.");
  }
  const built = [];
  const made = [];
  for (let i = 0; i < missing.length; i++) {
    const def = missing[i];
    const started = Date.now();
    made.push(await buildBoard(doc, def, { masterId, rect: rects[i], source, look, picks: { text: text.paths, logo: logo.paths }, issues, font, templatePaths, templates }));
    built.push(def.name);
    timings["board " + def.name] = Date.now() - started;
    await onProgress(def.name, i + 1, missing.length);
  }
  // TMLS047 sat here for 20 minutes where TMLS043 took 9 s, so each step is timed for the report.
  await onStage("Finishing up");
  await timed(timings, "deleteMaster", () => a.deleteLayers([masterId]));
  await timed(timings, "finishBoards", () => finishBoards(doc, made));
  await timed(timings, "releaseLocks", () => releaseExisting(guarded));
  return { built, skipped, issues, sourceId: source.id, boards: made };
}

// One undo step. If anything fails, the document goes back to how it was and the error is passed on.
// The report's `timings` holds how long each finishing step took, in ms.
async function buildArtboards({ doc, sourceId, textIds, logoIds, font, flyer, banner }, onProgress = () => {}, onStage = () => {}) {
  const existing = listArtboards(doc);
  if (existing.length) {
    const taken = new Set(existing.map((b) => b.name));
    if (BOARDS.every((b) => taken.has(b.name))) {
      return { built: [], skipped: BOARDS.map((b) => b.name), issues: [], sourceId, boards: [], timings: {} };
    }
  }
  let report;
  let failure = null;
  const timings = {};
  await core.executeAsModal(
    async (modal) => {
      app.activeDocument = doc;
      const suspension = await modal.hostControl.suspendHistory({ documentID: doc.id, name: HISTORY_NAME });
      try {
        report = await build(doc, { sourceId, textIds, logoIds, font, flyer, banner }, onProgress, onStage, timings);
        await onStage("Finishing up: saving the undo step");
        await timed(timings, "resumeHistory", () => modal.hostControl.resumeHistory(suspension, true));
      } catch (e) {
        failure = e;
        await modal.hostControl.resumeHistory(suspension, false);
      }
    },
    { commandName: HISTORY_NAME }
  );
  if (failure) throw failure;
  return { ...report, timings };
}

module.exports = { buildArtboards };
