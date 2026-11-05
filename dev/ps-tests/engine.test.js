// Runs inside Photoshop: node dev/ps.js dev/ps-tests/engine.test.js "{\"path\":\"C:/.../fixture.psd\",\"previewDir\":\"C:/...\"}" --timeout=600
const { app, action, core } = require("photoshop");
const kit = require("./kit");
const { buildArtboards } = require("../../plugin/src/ps/engine");
const { listArtboards, selectionInfo, collectFonts } = require("../../plugin/src/ps/doc");
const { selectLayers, moveArtboard } = require("../../plugin/src/ps/actions");
const { BOARDS, TEMPLATE_LAYOUT } = require("../../plugin/src/core/boards");

const BG_BOARDS = ["BGSquare", "BGLandscape", "BGPortrait"];
const NO_LOGO = ["BGSquare", "SoundCloudBanner", "FlyerComingSoon", "FlyerOutNow", "BGLandscape", "BGPortrait"];
const WITH_TEXT = ["SoundCloudBanner", "YouTubeThumbnail", "FlyerComingSoon", "FlyerOutNow"];
const SIZES = { BGSquare: [3000, 3000], SoundCloudBanner: [2480, 520], YouTubeThumbnail: [1920, 1080], FlyerComingSoon: [1080, 1920], FlyerOutNow: [1080, 1920], BGLandscape: [1920, 1080], BGPortrait: [1080, 1920] };

const byName = (doc, name) => doc.layers.find((l) => l.name === name);
const inBoard = (board, name) => kit.flat(board.layers).find((l) => l.name === name);
const unionOf = (layers) => ({
  left: Math.min(...layers.map((l) => l.boundsNoEffects.left)),
  top: Math.min(...layers.map((l) => l.boundsNoEffects.top)),
  right: Math.max(...layers.map((l) => l.boundsNoEffects.right)),
  bottom: Math.max(...layers.map((l) => l.boundsNoEffects.bottom)),
});

function snapshot(layers) {
  return kit.flat(layers).map((l) => ({
    name: l.name,
    kind: l.kind === "backgroundSheet" ? "pixel" : l.kind,
    blend: String(l.blendMode),
    opacity: Math.round(l.opacity),
    visible: l.visible,
    clip: l.isClippingMask,
    bounds: ["curves", "group", "gradientFill"].includes(String(l.kind)) ? null : kit.box(l.bounds),
  }));
}

const picksOf = (doc) => ({
  textIds: [kit.flat(doc.layers).find((l) => l.name === "Text").id],
  logoIds: [kit.flat(doc.layers).find((l) => l.name === "Logo").id],
});

const undo = () => action.batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }], _options: { dialogOptions: "silent" } }], {});

exports.run = async (arg, ctx) => {
  const t = kit.suite(ctx.log);
  const { check, near } = t;

  // ---- doc.js ----
  let doc = await kit.openFresh(arg.path);
  check("listArtboards finds none in a plain PSD", listArtboards(doc).length === 0);
  const text = kit.flat(doc.layers).find((l) => l.name === "Text");
  await kit.modal(() => selectLayers([text.id]));
  const sel = selectionInfo();
  check("selectionInfo reports the picked layer", sel.length === 1 && sel[0].id === text.id && sel[0].name === "Text" && sel[0].kind === "group", sel);
  const fonts = await collectFonts([text.id]);
  check("collectFonts returns every text layer, largest first", fonts.length === 2 && fonts[0].size > fonts[1].size && near(fonts[0].size, 200, 1), fonts);
  check("collectFonts reads font and color", fonts[0].font === "ArialMT" && near(fonts[0].color.red, 255) && near(fonts[0].color.green, 240) && near(fonts[0].color.blue, 200), fonts[0]);
  check("collectFonts reads width", near(fonts[0].widthPx, 1576, 4), fonts[0]);

  // ---- a failed build ----
  const before = snapshot(doc.layers);
  let threw = false;
  try {
    await buildArtboards({ doc, sourceId: null, ...picksOf(doc) }, () => { throw new Error("stop here"); });
  } catch (e) {
    threw = /stop here/.test(e.message);
  }
  check("a failed build reports its error", threw);
  check("a failed build leaves the document as it was", JSON.stringify(snapshot(doc.layers)) === JSON.stringify(before), snapshot(doc.layers).map((l) => l.name));
  check("a failed build leaves no artboards", listArtboards(doc).length === 0);

  // ---- the real build ----
  const progress = [];
  const report = await buildArtboards({ doc, sourceId: null, ...picksOf(doc) }, (name) => progress.push(name));
  ctx.log("issues: " + JSON.stringify(report.issues));

  const boards = listArtboards(doc);
  check("8 artboards: the source plus 7 new", boards.length === 8, boards.map((b) => b.name));
  check("the plain PSD got wrapped in Cover Art", boards.some((b) => b.name === "Cover Art"));
  check("no temporary board is left behind", !byName(doc, "TV Master"));
  check("reports all 7 as built", report.built.length === 7 && report.skipped.length === 0, report);
  check("reports progress for each board", progress.length === 7, progress);
  for (const def of BOARDS) {
    const b = boards.find((x) => x.name === def.name);
    const [w, h] = SIZES[def.name];
    check(def.name + " is " + w + "x" + h, b && b.bounds.right - b.bounds.left === w && b.bounds.bottom - b.bounds.top === h, b);
  }
  const rects = boards.slice().sort((a, b) => a.bounds.left - b.bounds.left);
  check("boards sit in a row with nothing overlapping", rects.every((r, i) => i === 0 || r.bounds.left >= rects[i - 1].bounds.right), rects.map((r) => r.bounds));
  check("the source stays leftmost at its own spot", rects[0].name === "Cover Art" && rects[0].bounds.left === 0 && rects[0].bounds.top === 0);

  const source = byName(doc, "Cover Art");
  const afterSource = snapshot(source.layers);
  check("the source layers match the snapshot", JSON.stringify(afterSource) === JSON.stringify(before), { before, afterSource });
  check("the source background is still locked", inBoard(source, "Background").allLocked);
  check("the source art is still pixels", inBoard(source, "Art Base").kind === "pixel");

  for (const name of NO_LOGO) check(name + " has no logo", !inBoard(byName(doc, name), "Logo"));
  check("YouTubeThumbnail keeps the logo", !!inBoard(byName(doc, "YouTubeThumbnail"), "Logo"));
  for (const name of BG_BOARDS) check(name + " has no text", !kit.flat(byName(doc, name).layers).some((l) => l.kind === "text") && !inBoard(byName(doc, name), "Text"));
  for (const name of WITH_TEXT) {
    const items = kit.flat(byName(doc, name).layers).filter((l) => l.kind === "text");
    check(name + " keeps both text layers live", items.length === 2 && items.some((l) => l.textItem.contents === "FLYING SO HIGH"), items.map((l) => l.name));
  }

  const artNames = ["Art Base", "Art Clipped", "Art Multiply", "Art Hidden", "Art Off Canvas", "Art Styled", "Art Gradient", "Background"];
  for (const art of artNames) {
    const ids = [];
    let allSmart = true;
    for (const def of BOARDS) {
      const l = inBoard(byName(doc, def.name), art);
      if (!l || l.kind !== "smartObject") { allSmart = false; continue; }
      ids.push((await kit.describe(l.id)).smartObjectMore.ID);
    }
    check(art + " is a smart object on every board", allSmart && ids.length === 7, ids);
    check(art + " shares one linked source across boards", new Set(ids).size === 1, ids);
  }

  for (const def of BOARDS) {
    const board = byName(doc, def.name);
    const wrong = [];
    for (const src of kit.flat(source.layers)) {
      const l = inBoard(board, src.name);
      if (!l) continue;
      if (String(l.blendMode) !== String(src.blendMode) || Math.round(l.opacity) !== Math.round(src.opacity) || l.isClippingMask !== src.isClippingMask || l.visible !== src.visible) wrong.push(src.name);
    }
    check(def.name + " matches the source's blend, opacity, clip and hidden state", wrong.length === 0, wrong);
    const flatBoard = kit.flat(board.layers);
    const curves = flatBoard.findIndex((l) => l.name === "Curves Finish");
    const art = flatBoard.findIndex((l) => l.name === "Art Base");
    const txt = flatBoard.findIndex((l) => l.name === "Text");
    check(def.name + " keeps Curves above the art", curves > -1 && curves < art, flatBoard.map((l) => l.name));
    if (txt > -1) check(def.name + " keeps Curves above the text", curves < txt);
    const locked = [];
    for (const l of flatBoard) {
      const lock = (await kit.describe(l.id)).layerLocking;
      if (lock.protectAll || lock.protectPosition || lock.protectTransparency || lock.protectComposite) locked.push(l.name);
    }
    check(def.name + " has no locked layers, so it can be edited", locked.length === 0, locked);
    const bounds = boards.find((x) => x.name === def.name).bounds;
    const needless = [];
    for (const l of Array.from(board.layers)) {
      const b = l.boundsNoEffects;
      const overlaps = b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top;
      const lock = (await kit.describe(l.id)).layerLocking;
      if (lock.protectArtboardAutonest && l.visible && overlaps && l.kind !== "curves" && l.kind !== "group") needless.push(l.name);
    }
    check(def.name + " only keeps the nesting lock on layers that could otherwise leave", needless.length === 0, needless);
    const names = flatBoard.map((l) => l.name);
    check(def.name + " keeps every art layer, on the canvas or off it", artNames.every((n) => names.includes(n)), names);
  }

  // Scale and centering. 3000x3000 art, so landscape and portrait both scale to 0.64.
  const landscape = byName(doc, "BGLandscape");
  const lr = boards.find((b) => b.name === "BGLandscape").bounds;
  const base = inBoard(landscape, "Art Base").bounds;
  check("BGLandscape scales the art to cover", near(base.right - base.left, 2400 * 0.64) && near((base.left + base.right) / 2, lr.left + 960) && near((base.top + base.bottom) / 2, lr.top + 540), base);
  const hidden = inBoard(landscape, "Art Hidden").bounds;
  check("a hidden layer keeps its content and scales with the rest", near(hidden.right - hidden.left, 640) && near(hidden.left, lr.left + 960 - 500 * 0.64), hidden);
  const off = inBoard(landscape, "Art Off Canvas").bounds;
  check("art past the canvas scales with the rest", near(off.right, lr.left + 960 + 2000 * 0.64) && near(off.right - off.left, 600 * 0.64), off);
  const square = byName(doc, "BGSquare");
  const sr = boards.find((b) => b.name === "BGSquare").bounds;
  const sq = inBoard(square, "Art Base").bounds;
  check("BGSquare keeps the art at full size", near(sq.left, sr.left + 300) && near(sq.right, sr.left + 2700) && near(sq.top, 300), sq);

  // Lockups.
  const leaves = (board) => kit.flat(board.layers).filter((l) => l.kind === "text");
  const banner = byName(doc, "SoundCloudBanner");
  const br = boards.find((b) => b.name === "SoundCloudBanner").bounds;
  const bu = unionOf(leaves(banner));
  const bb = TEMPLATE_LAYOUT.banner.lockupBox;
  check("banner text is right-aligned", near(bu.right, br.left + bb.right, 3), bu);
  check("banner text fits the box", bu.right - bu.left <= bb.right - bb.left + 3 && bu.bottom - bu.top <= bb.bottom - bb.top + 3 && bu.left >= br.left + bb.left - 3, bu);
  const flyer = byName(doc, "FlyerComingSoon");
  const fr = boards.find((b) => b.name === "FlyerComingSoon").bounds;
  const fu = unionOf(leaves(flyer));
  const fb = TEMPLATE_LAYOUT.flyer.lockupBox;
  check("flyer text is centered in its box", near((fu.left + fu.right) / 2, fr.left + (fb.left + fb.right) / 2, 3), fu);
  check("flyer text fits its box", near(fu.right - fu.left, fb.right - fb.left, 4) && fu.top >= fb.top - 3 && fu.bottom <= fb.bottom + 3, fu);
  const yt = byName(doc, "YouTubeThumbnail");
  const yr = boards.find((b) => b.name === "YouTubeThumbnail").bounds;
  const yu = unionOf(leaves(yt));
  const logo = inBoard(yt, "Logo").bounds;
  const yb = TEMPLATE_LAYOUT.youtube.lockupBox;
  check("YouTube text and logo are centered", near((yu.left + yu.right) / 2, yr.left + 960, 3) && near((logo.left + logo.right) / 2, yr.left + 960, 3), { yu, logo });
  check("YouTube logo sits under the text with the gap", near(logo.top - yu.bottom, TEMPLATE_LAYOUT.youtube.logoGap, 3), { yu, logo });
  check("YouTube text and logo stay in the box", yu.top >= yr.top + yb.top - 3 && logo.bottom <= yr.top + yb.bottom + 3 && yu.left >= yr.left + yb.left - 3 && yu.right <= yr.left + yb.right + 3, { yu, logo });

  // Pictures to look at.
  if (arg.previewDir) {
    for (const b of boards) await kit.saveJpeg(doc, b.bounds, 900, arg.previewDir + "/" + b.name + ".jpg");
  }

  // Pixels: BGSquare against the source with text and logo hidden.
  const srcRect = boards.find((b) => b.name === "Cover Art").bounds;
  await kit.modal(async () => {
    inBoard(source, "Text").visible = false;
    inBoard(source, "Logo").visible = false;
  });
  const a = await kit.pixels(doc, srcRect, 300);
  const b = await kit.pixels(doc, sr, 300);
  const diff = kit.difference(a, b);
  ctx.log("BGSquare vs source: " + JSON.stringify(diff));
  check("BGSquare looks like the source without text and logo", diff.mean < 2, diff);
  // BGLandscape shows the middle of the art at 0.64, so the same crop of the source should match it.
  const landscapePixels = await kit.pixels(doc, lr, 300);
  const cropPixels = await kit.pixels(doc, { left: srcRect.left, top: srcRect.top + 656, right: srcRect.right, bottom: srcRect.top + 2344 }, 300);
  const cropDiff = kit.difference(landscapePixels, cropPixels);
  ctx.log("BGLandscape vs source crop: " + JSON.stringify(cropDiff));
  check("BGLandscape looks like the middle of the source, gradients included", cropDiff.mean < 3, cropDiff);
  await kit.modal(async () => {
    inBoard(source, "Text").visible = true;
    inBoard(source, "Logo").visible = true;
  });

  // ---- re-running ----
  const moved = inBoard(landscape, "Art Base");
  await kit.modal(() => moved.translate(11, 13));
  const tweaked = kit.box(moved.bounds);
  const again = await buildArtboards({ doc, sourceId: source.id, textIds: [inBoard(source, "Text").id], logoIds: [inBoard(source, "Logo").id] });
  check("building again adds no boards", listArtboards(doc).length === 8);
  check("building again reports all 7 as skipped", again.built.length === 0 && again.skipped.length === 7, again);
  check("building again leaves hand tweaks alone", JSON.stringify(kit.box(inBoard(byName(doc, "BGLandscape"), "Art Base").bounds)) === JSON.stringify(tweaked));

  // Photoshop re-sorts layers between artboards when one moves, so a board moved by hand mustn't scramble them.
  const contents = () => JSON.stringify(listArtboards(doc).map((x) => [x.name, kit.flat(byName(doc, x.name).layers).map((l) => l.name)]).sort());
  const beforeMove = contents();
  const portraitId = byName(doc, "BGPortrait").id;
  await kit.modal(() => moveArtboard(portraitId, 0, 300));
  check("moving a board by hand keeps every board's layers", contents() === beforeMove, contents());
  await kit.modal(() => moveArtboard(portraitId, -1500, 0));
  check("moving a board over its neighbor keeps every board's layers", contents() === beforeMove, contents());
  await kit.modal(() => moveArtboard(portraitId, 1500, -300));

  await kit.modal(async () => { await selectLayers([byName(doc, "BGPortrait").id]); await action.batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "silent" } }], {}); });
  const refill = await buildArtboards({ doc, sourceId: source.id, textIds: [inBoard(source, "Text").id], logoIds: [inBoard(source, "Logo").id] });
  check("a missing board gets filled in", refill.built.length === 1 && refill.built[0] === "BGPortrait" && refill.skipped.length === 6, refill);
  check("filling in leaves hand tweaks alone", JSON.stringify(kit.box(inBoard(byName(doc, "BGLandscape"), "Art Base").bounds)) === JSON.stringify(tweaked));
  const refilled = listArtboards(doc).find((x) => x.name === "BGPortrait");
  const others = listArtboards(doc).filter((x) => x.name !== "BGPortrait");
  check("a filled-in board doesn't overlap the others", others.every((o) => refilled.bounds.left >= o.bounds.right || refilled.bounds.right <= o.bounds.left), refilled);

  // ---- a source artboard that isn't at the origin ----
  await kit.modal(async () => { await selectLayers([byName(doc, "BGPortrait").id]); await action.batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "silent" } }], {}); });
  const flyerSource = byName(doc, "FlyerOutNow");
  const fromFlyer = await buildArtboards({ doc, sourceId: flyerSource.id, textIds: [inBoard(flyerSource, "Text").id], logoIds: [] });
  check("builds from a source artboard away from the origin", fromFlyer.built.length === 1, fromFlyer);
  const portrait = byName(doc, "BGPortrait");
  const pr = listArtboards(doc).find((x) => x.name === "BGPortrait").bounds;
  const flyerRect = listArtboards(doc).find((x) => x.name === "FlyerOutNow").bounds;
  const flyerBase = inBoard(flyerSource, "Art Base").bounds;
  const portraitBase = inBoard(portrait, "Art Base").bounds;
  check("art keeps its place relative to the board", near(portraitBase.left - pr.left, flyerBase.left - flyerRect.left) && near(portraitBase.top - pr.top, flyerBase.top - flyerRect.top), { portraitBase, flyerBase });
  check("a bad pick does not stop a build with nothing missing", (await buildArtboards({ doc, sourceId: source.id, textIds: [999999], logoIds: [] })).skipped.length === 7);
  await kit.closeDoc(doc);

  // ---- undo ----
  doc = await kit.openFresh(arg.path);
  const historyAtOpen = doc.historyStates.length;
  await buildArtboards({ doc, sourceId: null, ...picksOf(doc) });
  check("the build adds one history step", doc.historyStates.length === historyAtOpen + 1 && doc.historyStates[doc.historyStates.length - 1].name === "Timeless Visualizer", doc.historyStates.map((h) => h.name));
  await kit.modal(() => undo());
  check("one undo removes every new board", listArtboards(doc).length === 0, listArtboards(doc).map((x) => x.name));
  check("one undo brings the original layers back", JSON.stringify(snapshot(doc.layers).map((l) => l.name)) === JSON.stringify(before.map((l) => l.name)));
  await kit.closeDoc(doc);

  // ---- overlapping picks ----
  doc = await kit.openFresh(arg.path);
  const child = kit.flat(doc.layers).find((l) => l.name === "FLYING SO HIGH");
  const overlap = await buildArtboards({ doc, sourceId: null, textIds: [picksOf(doc).textIds[0], child.id], logoIds: picksOf(doc).logoIds });
  const obu = unionOf(kit.flat(byName(doc, "SoundCloudBanner").layers).filter((l) => l.kind === "text"));
  check("a group plus its child moves once", near(obu.right, br.left + bb.right, 3) && near(obu.right - obu.left, bu.right - bu.left, 3), { obu, bu });
  check("overlapping picks raise no issue", overlap.issues.length === 0, overlap.issues);
  await kit.closeDoc(doc);

  // ---- bad picks ----
  doc = await kit.openFresh(arg.path);
  const bad = await buildArtboards({ doc, sourceId: null, textIds: [picksOf(doc).textIds[0], 999999], logoIds: picksOf(doc).logoIds });
  check("a pick outside the source goes in the report", bad.issues.some((s) => /999999|outside|source/i.test(s)), bad.issues);
  check("the build still finishes with a bad pick", bad.built.length === 7, bad);
  await kit.closeDoc(doc);

  // ---- a locked layer ----
  doc = await kit.openFresh(arg.path);
  const lockedArt = kit.flat(doc.layers).find((l) => l.name === "Art Base");
  await kit.modal(() => action.batchPlay([{ _obj: "applyLocking", _target: [{ _ref: "layer", _id: lockedArt.id }], layerLocking: { _obj: "layerLocking", protectAll: true } }], {}));
  const lockedRun = await buildArtboards({ doc, sourceId: null, ...picksOf(doc) });
  check("builds with a locked art layer", lockedRun.built.length === 7, lockedRun);
  check("the locked source layer stays locked", inBoard(byName(doc, "Cover Art"), "Art Base").allLocked);
  check("the locked layer's copy still scaled", near(inBoard(byName(doc, "BGLandscape"), "Art Base").bounds.right - inBoard(byName(doc, "BGLandscape"), "Art Base").bounds.left, 2400 * 0.64));
  await kit.closeDoc(doc);

  // ---- a source that keeps other locks, a hidden logo, and a layer sitting right of the source ----
  doc = await kit.openFresh(arg.path);
  const positionLocked = kit.flat(doc.layers).find((l) => l.name === "Art Multiply");
  const hiddenLogo = kit.flat(doc.layers).find((l) => l.name === "Logo");
  const stray = kit.flat(doc.layers).find((l) => l.name === "Art Styled");
  await kit.modal(async () => {
    await action.batchPlay([{ _obj: "applyLocking", _target: [{ _ref: "layer", _id: positionLocked.id }], layerLocking: { _obj: "layerLocking", protectPosition: true } }], {});
    hiddenLogo.visible = false;
    await stray.translate(3000, 0);
  });
  const strayBefore = kit.box(stray.bounds);
  const hiddenRun = await buildArtboards({ doc, sourceId: null, ...picksOf(doc) });
  check("builds with a hidden logo", hiddenRun.built.length === 7, hiddenRun);
  const hiddenSource = byName(doc, "Cover Art");
  const ytHidden = inBoard(byName(doc, "YouTubeThumbnail"), "Logo");
  const textHidden = unionOf(kit.flat(byName(doc, "YouTubeThumbnail").layers).filter((l) => l.kind === "text"));
  check("a hidden logo still goes under the text, and stays hidden", !ytHidden.visible && near(ytHidden.boundsNoEffects.top - textHidden.bottom, TEMPLATE_LAYOUT.youtube.logoGap, 3), { logo: ytHidden.boundsNoEffects, textHidden });
  check("a source layer sitting where the boards go stays in the source", !!inBoard(hiddenSource, "Art Styled") && JSON.stringify(kit.box(inBoard(hiddenSource, "Art Styled").bounds)) === JSON.stringify(strayBefore), strayBefore);
  check("new boards are placed past the source's stray layers", listArtboards(doc).filter((x) => x.name !== "Cover Art").every((x) => x.bounds.left >= strayBefore.right), listArtboards(doc).map((x) => x.bounds));
  const keptLock = (await kit.describe(inBoard(hiddenSource, "Art Multiply").id)).layerLocking;
  check("the source's own lock is unchanged", keptLock.protectPosition && !keptLock.protectArtboardAutonest, keptLock);
  const sourceNesting = [];
  for (const l of kit.flat(hiddenSource.layers)) if (l.name !== "Background" && (await kit.describe(l.id)).layerLocking.protectArtboardAutonest) sourceNesting.push(l.name);
  check("no nesting lock is left on the source", sourceNesting.length === 0, sourceNesting);
  await kit.closeDoc(doc);

  return t.done();
};
