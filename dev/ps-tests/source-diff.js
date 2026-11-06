// Finds which source layer renders differently after a build (resume item 4: TMLS047's source composite
// shifts by mean 2.03, worst 20). Read-only on the source: it only toggles visibility on a scratch copy,
// puts it back, and closes the copy without saving.
// node dev/ps.js dev/ps-tests/source-diff.js "$(cat source-diff-arg.json)" --timeout=2400
// arg: {path, source, text:[names], logo:[names], templates:{flyer, banner}, size?: 512,
//       passes?: ["grow", "reopen", "build", "stack"], progressFile?: "C:\\...\\source-diff.log"}
// "stack" (fast, no build) lists every source layer's blend mode, effects and smart filters, then adds
// the layers back one at a time from the bottom, on the normal and the grown canvas, and marks where
// the two first differ. Use passes: ["stack"] for that alone.
// Each pass renders every layer, which is slow on a big file (TMLS047 at Idle: well over an hour for
// all three), so `passes` picks which run, and `progressFile` gets each line as it happens.
//
// Three passes over the same scratch copy, each rendering every source layer on its own:
//   before  - as opened
//   grown   - after two copies of the source board are added far right and far below, the way the
//             build grows the document, then deleted again. Tells "the document grew" from "the build".
//   built   - after a fresh open and a real buildArtboards (no After Effects)
const fs = require("fs");
const { app } = require("photoshop");
const kit = require("./kit");
const a = require("../../plugin/src/ps/actions");
const { listArtboards } = require("../../plugin/src/ps/doc");
const { buildArtboards } = require("../../plugin/src/ps/engine");

const byName = (doc, name) => Array.from(doc.layers).find((l) => l.name === name);
const inList = (layers, name) => kit.flat(layers).find((l) => l.name === name);

// Renders each layer alone: its siblings hidden, its ancestors as they are. Recurses into groups.
async function soloScan(doc, rect, layers, size, out, path = []) {
  const list = Array.from(layers);
  for (const layer of list) {
    const key = [...path, layer.name].join(" / ") + " #" + layer.id;
    const saved = list.map((l) => l.visible);
    await kit.modal(async () => {
      list.forEach((l) => { l.visible = l === layer; });
    });
    out[key] = { kind: String(layer.kind), hidden: !saved[list.indexOf(layer)], px: await kit.pixels(doc, rect, size) };
    if (layer.layers && layer.layers.length) await soloScan(doc, rect, layer.layers, size, out, [...path, layer.name]);
    await kit.modal(async () => {
      list.forEach((l, i) => { l.visible = saved[i]; });
    });
  }
  return out;
}

async function scan(doc, sourceName, size) {
  const board = byName(doc, sourceName);
  const rect = listArtboards(doc).find((b) => b.id === board.id).bounds;
  return {
    rect,
    canvas: { width: doc.width, height: doc.height },
    composite: await kit.pixels(doc, rect, size),
    layers: await soloScan(doc, rect, board.layers, size, {}),
  };
}

function compare(label, a, b, log) {
  const rows = [];
  for (const key of Object.keys(a.layers)) {
    if (!b.layers[key]) {
      rows.push({ key, missing: true });
      continue;
    }
    const d = kit.difference(a.layers[key].px, b.layers[key].px);
    rows.push({ key, kind: a.layers[key].kind, hidden: a.layers[key].hidden, mean: +d.mean.toFixed(3), worst: d.worst });
  }
  const whole = kit.difference(a.composite, b.composite);
  const changed = rows.filter((r) => r.missing || r.mean > 0.05 || r.worst > 2).sort((x, y) => (y.mean || 99) - (x.mean || 99));
  log(`== ${label}: composite mean ${whole.mean.toFixed(3)} worst ${whole.worst}; canvas ${JSON.stringify(a.canvas)} -> ${JSON.stringify(b.canvas)}; source rect ${JSON.stringify(a.rect)} -> ${JSON.stringify(b.rect)}`);
  log(`   ${changed.length} of ${rows.length} layers render differently:`);
  for (const r of changed) log("   " + JSON.stringify(r));
  return { composite: { mean: whole.mean, worst: whole.worst }, changed };
}

exports.run = async (arg, ctx) => {
  const size = arg.size || 512;
  const passes = new Set(arg.passes || ["grow", "reopen", "build"]);
  const lines = [];
  const log = (line) => {
    ctx.log(line);
    if (!arg.progressFile) return;
    lines.push(new Date().toISOString().slice(11, 19) + " " + line);
    try {
      fs.writeFileSync("file:" + arg.progressFile.replace(/\\/g, "/"), lines.join("\n") + "\n", { encoding: "utf-8" });
    } catch (e) {
      // A progress file is a nicety; the result still comes back at the end.
    }
  };
  const result = {};
  log("passes " + [...passes].join(", ") + ", size " + size);

  let doc;
  let before = null;
  if (passes.has("grow") || passes.has("reopen") || passes.has("build")) {
    doc = await kit.openFresh(arg.path);
    before = await scan(doc, arg.source, size);
    log("scanned " + Object.keys(before.layers).length + " layers before");
  }
  if (passes.has("grow")) await growPass(doc, arg, size, before, result, log);
  if (doc) await kit.closeDoc(doc);

  if (passes.has("stack")) {
    doc = await kit.openFresh(arg.path);
    await stackPass(doc, arg, size, result, log);
    await kit.closeDoc(doc);
  }

  // A fresh open, then (optionally) a real artboard build.
  if (!passes.has("reopen") && !passes.has("build")) {
    log("open documents now: " + Array.from(app.documents).map((d) => d.name).join(", "));
    return result;
  }
  doc = await kit.openFresh(arg.path);
  const fresh = passes.has("reopen") ? await scan(doc, arg.source, size) : before;
  if (passes.has("reopen")) result.reopen = compare("fresh reopen, nothing done (noise floor)", before, fresh, log);
  if (passes.has("build")) {
    const source = byName(doc, arg.source);
    const textIds = (arg.text || []).map((n) => inList(source.layers, n).id);
    const logoIds = (arg.logo || []).map((n) => inList(source.layers, n).id);
    log("building");
    const report = await buildArtboards({ doc, sourceId: source.id, textIds, logoIds, font: null, flyer: arg.templates.flyer, banner: arg.templates.banner });
    log("built " + JSON.stringify(report.built) + " issues " + JSON.stringify(report.issues));
    const built = await scan(doc, arg.source, size);
    result.built = compare("after buildArtboards", fresh, built, log);
  }
  await kit.closeDoc(doc);

  log("open documents now: " + Array.from(app.documents).map((d) => d.name).join(", "));
  return result;
};

// Grows the document the way the build does (a copy of the source board far right and one far below),
// without building. Returns a function that shrinks it back and restores the source's locks.
async function growDoc(doc, arg) {
  const sourceId = byName(doc, arg.source).id;
  const all = listArtboards(doc);
  const right = Math.max(...all.map((b) => b.bounds.right));
  const bottom = Math.max(...all.map((b) => b.bounds.bottom));
  const src = all.find((b) => b.id === sourceId).bounds;
  const probes = [];
  // Like the build: the source keeps its layers while boards move (nesting lock), and gets its own locks back after.
  const sourceKids = Array.from(byName(doc, arg.source).layers).map((l) => l.id);
  let savedLocks = [];
  await kit.modal(async () => {
    savedLocks = await a.locksOf(sourceKids);
    for (let i = 0; i < sourceKids.length; i++) {
      if (!savedLocks[i].protectAll) await a.setNestingLock(sourceKids[i], true);
    }
    const place = async (name, x, y) => {
      const id = await a.duplicateArtboard(sourceId, name);
      const { rect } = await a.artboardInfo(id);
      await a.moveArtboard(id, x - rect.left, y - rect.top);
      probes.push(id);
    };
    await place("TV Probe Right", right + 2000, src.top);
    await place("TV Probe Below", src.left, bottom + 2000);
  });
  return () =>
    kit.modal(async () => {
      await a.deleteLayers(probes);
      for (let i = 0; i < sourceKids.length; i++) {
        if (!savedLocks[i].protectAll) await a.setNestingLock(sourceKids[i], !!savedLocks[i].protectArtboardAutonest);
      }
    });
}

async function growPass(doc, arg, size, before, result, log) {
  const shrink = await growDoc(doc, arg);
  const grown = await scan(doc, arg.source, size);
  result.grown = compare("document grown (probe boards present)", before, grown, log);
  await shrink();
  const shrunk = await scan(doc, arg.source, size);
  result.shrunk = compare("probe boards deleted again", before, shrunk, log);
}

// What each source layer is and does, so a culprit can be read off the list.
async function describeLayers(layers, log, path = []) {
  for (const l of Array.from(layers)) {
    const d = await kit.describe(l.id);
    const so = d.smartObject || d.smartObjectMore;
    const info = {
      kind: String(l.kind),
      blend: String(l.blendMode),
      opacity: Math.round(l.opacity),
      fill: d.fillOpacity !== undefined ? Math.round((d.fillOpacity / 255) * 100) : undefined,
      visible: l.visible,
      clipped: l.isClippingMask,
      effects: d.layerEffects ? Object.keys(d.layerEffects).filter((k) => k !== "_obj" && k !== "scale") : [],
      smartFilters: so && so.filterFX ? so.filterFX.map((f) => (f.filter && f.filter._obj) || f.name) : [],
      adjustment: d.adjustment ? d.adjustment.map((x) => x._obj) : undefined,
      blendIf: !!d.blendRange,
      knockout: d.knockout ? d.knockout._value : undefined,
    };
    log("   layer " + [...path, l.name].join(" / ") + " " + JSON.stringify(info));
    if (l.layers) await describeLayers(l.layers, log, [...path, l.name]);
  }
}

// Shows the layers of `list` from the bottom up, one more each step, and renders each step.
// `ctxShow` sets everything outside `list` first (and is undone by the caller).
async function stackScan(doc, rect, list, size) {
  const saved = list.map((l) => l.visible);
  const steps = [];
  for (let i = list.length - 1; i >= 0; i--) {
    await kit.modal(async () => {
      list.forEach((l, j) => { l.visible = j >= i ? saved[j] : false; });
    });
    steps.push({ name: list[i].name, index: i, px: await kit.pixels(doc, rect, size) });
  }
  await kit.modal(async () => {
    list.forEach((l, j) => { l.visible = saved[j]; });
  });
  return steps;
}

function compareSteps(label, a, b, log) {
  log(`== ${label} (bottom layer first; each row adds one layer on top):`);
  let first = null;
  let prev = 0;
  for (let k = 0; k < a.length; k++) {
    const d = kit.difference(a[k].px, b[k].px);
    const jump = d.mean - prev;
    log(`   +${a[k].name}: mean ${d.mean.toFixed(3)} worst ${d.worst}${jump > 0.1 ? "   <-- jumps here" : ""}`);
    if (first === null && jump > 0.1) first = a[k];
    prev = d.mean;
  }
  return first;
}

// Finds where the difference first appears: the stack built up bottom first, normal vs grown canvas,
// then the same inside the group where it appears.
async function stackPass(doc, arg, size, result, log) {
  const board = byName(doc, arg.source);
  const rect = listArtboards(doc).find((b) => b.id === board.id).bounds;
  log("canvas " + doc.width + "x" + doc.height);
  await describeLayers(board.layers, log);
  const top = Array.from(board.layers);
  const normal = await stackScan(doc, rect, top, size);
  const shrink = await growDoc(doc, arg);
  log("grown canvas " + doc.width + "x" + doc.height);
  const grown = await stackScan(doc, rect, top, size);
  const culprit = compareSteps("top level", normal, grown, log);
  result.stack = { topLevel: culprit ? culprit.name : null };
  const group = culprit && top[culprit.index].layers ? top[culprit.index] : null;
  if (group) {
    // Everything above the group hidden, the group and what's under it as they are; then inside the group.
    const saved = top.map((l) => l.visible);
    await kit.modal(async () => {
      top.forEach((l, j) => { if (j < culprit.index) l.visible = false; });
    });
    const kids = Array.from(group.layers);
    const grownKids = await stackScan(doc, rect, kids, size);
    await shrink();
    const normalKids = await stackScan(doc, rect, kids, size);
    const inner = compareSteps("inside " + group.name, normalKids, grownKids, log);
    result.stack.inGroup = inner ? inner.name : null;
    await kit.modal(async () => {
      top.forEach((l, j) => { l.visible = saved[j]; });
    });
  } else {
    await shrink();
  }
}
