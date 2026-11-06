// The whole build on scratch copies of real releases, through runBuild, with no clicks.
// node dev/ps.js dev/ps-tests/e2e.test.js "$(cat e2e-arg.json)" --timeout=1800
// arg: {templates:{flyer,banner,visuals}, aePath, docs:[{path, source, text:[names], logo:[names], label}]}
const fs = require("fs");
const uxp = require("uxp");
const { app } = require("photoshop");
const kit = require("./kit");
const { runBuild } = require("../../plugin/src/build");
const { runInAfterEffects } = require("../../plugin/src/ae/bridge");
const { listArtboards, collectFonts } = require("../../plugin/src/ps/doc");
const { BOARDS } = require("../../plugin/src/core/boards");
const { asciiJson } = require("../../plugin/src/core/aerun");
const { play } = require("../../plugin/src/ps/actions");

const url = (p) => "file:" + p.replace(/\\/g, "/");
const exists = (p) => { try { fs.lstatSync(url(p)); return true; } catch (e) { return false; } };
const native = (p) => p.replace(/\//g, "\\");
const byName = (doc, name) => Array.from(doc.layers).find((l) => l.name === name);
const inList = (layers, name) => kit.flat(layers).find((l) => l.name === name);
const SHAPED = new Set(["pixel", "smartObject", "text", "solidColor", "backgroundSheet"]);

function snapshot(layers) {
  return kit.flat(layers).map((l) => [l.name, String(l.blendMode), Math.round(l.opacity), l.visible, l.isClippingMask, SHAPED.has(String(l.kind)) ? JSON.stringify(kit.box(l.boundsNoEffects)) : ""].join("|"));
}

async function runOne(spec, arg, ctx, t) {
  const { check } = t;
  const log = (s) => ctx.log("[" + spec.label + "] " + s);
  const doc = await kit.openFresh(spec.path);
  const hadArtboards = listArtboards(doc).length > 0;
  const scope = spec.source ? byName(doc, spec.source).layers : doc.layers;
  const before = snapshot(scope);
  const sourceRect = spec.source ? listArtboards(doc).find((b) => b.name === spec.source).bounds : { left: 0, top: 0, right: doc.width, bottom: doc.height };
  const compositeBefore = await kit.pixels(doc, sourceRect, 300);
  const boardsBefore = listArtboards(doc).map((b) => b.name);

  const textIds = spec.text.map((n) => inList(scope, n).id);
  const logoIds = spec.logo.map((n) => inList(scope, n).id);
  const fonts = collectFonts(textIds);
  log("fonts " + JSON.stringify(fonts));
  const started = Date.now();
  let last = started;
  const report = await runBuild(
    {
      doc,
      sourceId: spec.source ? byName(doc, spec.source).id : null,
      textIds,
      logoIds,
      font: fonts[0] || null,
      date: "28 AUG 2026",
      audio: {},
      templates: arg.templates,
      aePath: arg.aePath,
    },
    (step, percent) => { log(`${percent}% ${step} +${Math.round((Date.now() - last) / 1000)}s`); last = Date.now(); },
    { aeSource: fs.readFileSync(url(__dirname + "/../../plugin/ae/build_visuals.jsx"), { encoding: "utf-8" }) }
  );
  log("took " + Math.round((Date.now() - started) / 1000) + "s report " + JSON.stringify(report));

  check(spec.label + ": the build succeeds", report.ok, report.issues);
  const boards = listArtboards(doc);
  const names = boards.map((b) => b.name);
  check(spec.label + ": all 7 new boards exist", BOARDS.every((b) => names.includes(b.name)), names);
  check(spec.label + ": the boards that were there stay", boardsBefore.every((n) => names.includes(n)), names);
  check(spec.label + ": no temp board is left", !names.includes("TV Master"), names);
  check(spec.label + ": the AEP sits next to the PSD", report.aepPath && exists(report.aepPath) && report.aepPath.startsWith(native(spec.path.replace(/[\\/][^\\/]*$/, ""))), report.aepPath);
  check(spec.label + ": the AEP has the right name", /_VisualsAEP(_V\d+)?\.aep$/.test(report.aepPath || ""), report.aepPath);
  check(spec.label + ": the template files stay closed", app.documents.length === 1 + (arg.extraDocs || 0), Array.from(app.documents).map((d) => d.name));

  const source = spec.source ? byName(doc, spec.source) : byName(doc, "Cover Art");
  const after = snapshot(source.layers);
  const changed = before.filter((line, i) => line !== after[i]);
  check(spec.label + ": the source layers are unchanged", before.length === after.length && changed.length === 0, { count: [before.length, after.length], changed: changed.slice(0, 8), now: after.filter((line, i) => line !== before[i]).slice(0, 8) });
  const rect = listArtboards(doc).find((b) => b.id === source.id).bounds;
  const compositeAfter = await kit.pixels(doc, rect, 300);
  const diff = kit.difference(compositeBefore, compositeAfter);
  log("source composite before vs after " + JSON.stringify(diff));
  check(spec.label + ": the source looks the same", diff.mean < 1, diff);

  for (const def of BOARDS) {
    const b = boards.find((x) => x.name === def.name).bounds;
    const w = def.width || sourceRect.right - sourceRect.left;
    const h = def.height || sourceRect.bottom - sourceRect.top;
    check(spec.label + ": " + def.name + " is the right size", b.right - b.left === w && b.bottom - b.top === h, b);
    const layers = kit.flat(byName(doc, def.name).layers);
    if (!def.keepText) for (const n of spec.text) check(spec.label + ": " + def.name + " has no " + n, !layers.some((l) => l.name === n));
    if (!def.keepLogo) for (const n of spec.logo) check(spec.label + ": " + def.name + " has no " + n + " from the source", def.template === "flyer" || def.template === "banner" ? n === "Timeless" || !layers.some((l) => l.name === n) : !layers.some((l) => l.name === n));
    const liveFills = layers.filter((l) => ["pattern", "gradientFill"].includes(String(l.kind)));
    check(spec.label + ": " + def.name + " has no live full-canvas fills", liveFills.length === 0, liveFills.map((l) => l.name));
    const pixelLayers = layers.filter((l) => l.kind === "pixel" && !["SC", "YT", "SP", "AM"].includes(l.name));
    check(spec.label + ": " + def.name + " art is all smart objects", pixelLayers.every((l) => { const box = l.boundsNoEffects; return box.right - box.left === 0; }), pixelLayers.map((l) => l.name));
  }

  const dir = spec.path.replace(/[\\/][^\\/]*$/, "");
  const previewDir = dir + "/preview";
  if (!exists(previewDir)) await uxp.storage.localFileSystem.createEntryWithUrl(url(previewDir), { type: uxp.storage.types.folder });
  for (const b of boards) await kit.saveJpeg(doc, b.bounds, 1000, previewDir + "/" + b.name + ".jpg");

  // The new boards should keep the source's look: the square board against the source with its picks hidden.
  await kit.modal(async () => {
    for (const n of [...spec.text, ...spec.logo]) inList(source.layers, n).visible = false;
  });
  const lookSource = await kit.pixels(doc, rect, 300);
  const squareRect = boards.find((b) => b.name === "BGSquare").bounds;
  const lookSquare = await kit.pixels(doc, squareRect, 300);
  const look = kit.difference(lookSource, lookSquare);
  log("BGSquare vs source without picks " + JSON.stringify(look));
  check(spec.label + ": BGSquare has the source's look", look.mean < 12, look);
  await kit.modal(async () => {
    spec.text.forEach((n) => { inList(source.layers, n).visible = true; });
    spec.logo.forEach((n) => { const l = inList(source.layers, n); l.visible = spec.hiddenLogo ? false : true; });
  });

  // What AE has linked. Without an AEP there's nothing to read back, but the save below still runs.
  if (report.aepPath) {
    const dataFile = native(dir + "/readback.txt");
    if (exists(dataFile)) await fs.unlink(url(dataFile));
    await runInAfterEffects(arg.aePath, `(function(){
      var out=new File(${asciiJson(dataFile)});out.encoding="UTF-8";out.open("w");
      out.writeln("PROJECT="+app.project.file.fsName);
      for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i);
        if(it instanceof CompItem)out.writeln("COMP "+it.name+" "+it.width+"x"+it.height+" "+it.duration);
        if(it instanceof FootageItem&&it.file)out.writeln("FILE "+it.name+"="+it.file.fsName);}
      out.writeln("QUEUE="+app.project.renderQueue.numItems);
      out.close();
    })();`, () => (exists(dataFile) ? "done" : null), { timeoutMs: 120000 });
    const lines = exists(dataFile) ? fs.readFileSync(url(dataFile), { encoding: "utf-8" }) : "";
    log(lines);
    check(spec.label + ": AE has this project open", lines.includes(report.aepPath), lines.slice(0, 200));
    const files = lines.split(/\r?\n/).filter((l) => l.startsWith("FILE "));
    const assetsDir = report.aepPath.replace(/\.aep$/, "") + " Assets";
    check(spec.label + ": every linked file is this release's", files.length >= 5 && files.every((l) => l.includes(assetsDir)), files);
    check(spec.label + ": nothing is left in the render queue", lines.includes("QUEUE=0"));
  } else {
    check(spec.label + ": AE has this project open", false, "no AEP was made");
  }

  // Saving, as a copy, to see the real file size. Photoshop refuses a PSD over its 2 GB limit.
  const savedName = spec.path.replace(/^.*[\/]/, "").replace(/.psd$/, "_saved.psd");
  const lfs = uxp.storage.localFileSystem;
  const folderEntry = await lfs.getEntryWithUrl(url(dir));
  let savedError = null;
  const entry = await folderEntry.createFile(savedName, { overwrite: true });
  await kit.modal(async () => {
    try {
      await play([{ _obj: "save", as: { _obj: "photoshop35Format", maximizeCompatibility: true }, in: { _path: lfs.createSessionToken(entry), _kind: "local" }, copy: true, lowerCase: true }]);
    } catch (e) {
      savedError = e.message;
    }
  });
  check(spec.label + ": the PSD can be saved as a PSD", !savedError, savedError);
  const size = (await entry.getMetadata()).size;
  check(spec.label + ": the saved PSD is under 2 GB", !savedError && size < 2 * 1024 * 1024 * 1024, Math.round(size / 1048576) + " MB");
  log("saved size " + Math.round(size / 1048576) + " MB, source was " + Math.round(fs.lstatSync(url(spec.path)).size / 1048576) + " MB");
  if (!savedError) await entry.delete();

  // Build again: nothing is rebuilt, and the AEP is left alone. Without an AEP a rebuild would start a
  // real AE build, so it's skipped and the failure above stands.
  if (report.aepPath) {
    const stamp = String(fs.lstatSync(url(report.aepPath)).mtime);
    const again = await runBuild(
      { doc, sourceId: source.id, textIds, logoIds, font: fonts[0] || null, date: "28 AUG 2026", audio: {}, templates: arg.templates, aePath: arg.aePath },
      () => {},
      { aeSource: "" }
    );
    check(spec.label + ": building again adds nothing", again.built.length === 0 && again.skipped.length === 7, again);
    check(spec.label + ": building again leaves the AEP alone", again.ok && String(fs.lstatSync(url(report.aepPath)).mtime) === stamp && again.issues.some((s) => /left as is/.test(s)), again);
  } else {
    log("no AEP, so the rebuild check was skipped");
  }

  await kit.closeDoc(doc);
}

exports.run = async (arg, ctx) => {
  const t = kit.suite(ctx.log);
  for (const spec of arg.docs) await runOne(spec, arg, ctx, t);
  return t.done();
};
