// Runs inside Photoshop, on copies of the real templates:
// node dev/ps.js dev/ps-tests/templates.test.js "{\"path\":\"C:/.../fixture.psd\",\"flyer\":\"C:/.../flyer.psd\",\"banner\":\"C:/.../banner.psd\",\"previewDir\":\"C:/...\"}" --timeout=600
const fs = require("fs");
const { app, action } = require("photoshop");
const kit = require("./kit");
const { buildArtboards } = require("../../plugin/src/ps/engine");
const { listArtboards, collectFonts } = require("../../plugin/src/ps/doc");

const byName = (doc, name) => Array.from(doc.layers).find((l) => l.name === name);
const inBoard = (board, name) => kit.flat(board.layers).find((l) => l.name === name);
const rectOf = (doc, name) => listArtboards(doc).find((b) => b.name === name).bounds;
const widthOf = (l) => l.boundsNoEffects.right - l.boundsNoEffects.left;
const centerX = (l) => (l.boundsNoEffects.left + l.boundsNoEffects.right) / 2;
const mtime = (p) => String(fs.lstatSync("file:" + p).mtime);
const undo = () => action.batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }], _options: { dialogOptions: "silent" } }], {});

async function textStyle(id) {
  const key = (await kit.describe(id)).textKey;
  const style = key.textStyleRange[0].textStyle;
  return { contents: key.textKey, font: style.fontPostScriptName, color: style.color, size: style.size._value * Math.abs(key.transform.yy), runs: key.textStyleRange };
}

const picks = (doc) => {
  const flat = kit.flat(doc.layers);
  return { textIds: [flat.find((l) => l.name === "Text").id], logoIds: [flat.find((l) => l.name === "Logo").id] };
};
const GOLD = { red: 255, green: 240, blue: 200 };
const isGold = (c, near) => near(c.red, GOLD.red) && near(c.grain, GOLD.green) && near(c.blue, GOLD.blue);

exports.run = async (arg, ctx) => {
  const t = kit.suite(ctx.log);
  const { check, near } = t;
  const paths = { flyer: arg.flyer, banner: arg.banner };
  const stamps = { flyer: mtime(arg.flyer), banner: mtime(arg.banner) };

  let doc = await kit.openFresh(arg.path);
  const font = { font: "ArialMT", color: GOLD };
  const report = await buildArtboards({ doc, sourceId: null, ...picks(doc), font, ...paths });
  ctx.log("issues: " + JSON.stringify(report.issues));
  check("all 7 boards built", report.built.length === 7, report);
  check("no issues", report.issues.length === 0, report.issues);

  // Banner.
  const banner = byName(doc, "SoundCloudBanner");
  const br = rectOf(doc, "SoundCloudBanner");
  const outNow = inBoard(banner, "Out Now");
  check("banner has the Out Now group", outNow && outNow.kind === "group");
  const inGroup = outNow ? Array.from(outNow.layers).map((l) => l.name).sort().join(",") : "";
  check("the group holds the type and 4 icons", inGroup === "AM,OUT NOW ON TIMELESS,SC,SP,YT", inGroup);
  check("banner has the dots", inBoard(banner, "Ellipse 2 copy") && inBoard(banner, "Ellipse 2 copy").kind === "solidColor");
  check("banner has the logo", inBoard(banner, "Timeless") && inBoard(banner, "Timeless").kind === "smartObject");
  for (const name of ["Layer 6", "SHE WANTS", "MAULIK"]) check("banner has no " + name, !inBoard(banner, name));
  const logoB = inBoard(banner, "Timeless").boundsNoEffects;
  check("banner logo sits at about (146,119)", near(logoB.left - br.left, 146, 2) && near(logoB.top - br.top, 119, 2), logoB);
  const bannerType = inBoard(banner, "OUT NOW ON TIMELESS");
  const bannerStyle = await textStyle(bannerType.id);
  check("banner type uses the matched font", bannerStyle.font === "ArialMT", bannerStyle.font);
  check("banner type uses the matched color", isGold(bannerStyle.color, near), bannerStyle.color);
  check("banner type keeps both lines", /OUT NOW/.test(bannerStyle.contents) && /ON TIMELESS/.test(bannerStyle.contents), bannerStyle.contents);
  check("every run of the banner type changes font", bannerStyle.runs.every((r) => r.textStyle.fontPostScriptName === "ArialMT"), bannerStyle.runs.map((r) => r.textStyle.fontPostScriptName));
  check("banner type fits the template's width", Math.abs(widthOf(bannerType) - 290) <= 290 * 0.02, widthOf(bannerType));
  check("banner type stays where the template had it", near(centerX(bannerType) - br.left, 1649, 3), centerX(bannerType) - br.left);
  for (const name of ["SC", "YT", "SP", "AM"]) {
    const fx = (await kit.describe(inBoard(banner, name).id)).layerEffects;
    check(name + " icon takes the matched color", fx && fx.solidFill && fx.solidFill.enabled && isGold(fx.solidFill.color, near), fx && fx.solidFill);
  }
  const dots = (await kit.describe(inBoard(banner, "Ellipse 2 copy").id)).adjustment[0].color;
  check("the dots take the matched color", isGold(dots, near), dots);

  // Flyers.
  const coming = byName(doc, "FlyerComingSoon");
  const cr = rectOf(doc, "FlyerComingSoon");
  const word = inBoard(coming, "COMING SOON");
  check("flyer has live COMING SOON", word && word.kind === "text");
  const wordStyle = await textStyle(word.id);
  check("COMING SOON uses the matched font", wordStyle.font === "ArialMT", wordStyle.font);
  check("COMING SOON uses the matched color", isGold(wordStyle.color, near), wordStyle.color);
  check("COMING SOON is within 2% of the template's width", Math.abs(widthOf(word) - 581) <= 581 * 0.02, widthOf(word));
  check("COMING SOON is centered", near(centerX(word) - cr.left, 540, 3), centerX(word) - cr.left);
  check("COMING SOON keeps the template's shadow", (await kit.describe(word.id)).layerEffects.dropShadow.enabled);
  const logoC = inBoard(coming, "Timeless").boundsNoEffects;
  check("flyer logo sits where the template has it", near(logoC.left - cr.left, 497, 2) && near(logoC.top - cr.top, 1136, 2), logoC);
  for (const name of ["TO PARTY", "MAULIK", "SHE WANTS", "Background "]) check("flyer has no " + name, !inBoard(coming, name));

  const out = byName(doc, "FlyerOutNow");
  const or = rectOf(doc, "FlyerOutNow");
  const outWord = inBoard(out, "OUT NOW");
  check("the other flyer has live OUT NOW", outWord && outWord.kind === "text");
  const outStyle = await textStyle(outWord.id);
  check("it reads OUT NOW", outStyle.contents === "OUT NOW", outStyle.contents);
  check("OUT NOW has the same font size as COMING SOON", near(outStyle.size, wordStyle.size, 0.5), { out: outStyle.size, coming: wordStyle.size });
  check("OUT NOW uses the matched font and color", outStyle.font === "ArialMT" && isGold(outStyle.color, near), outStyle);
  check("OUT NOW is centered", near(centerX(outWord) - or.left, 540, 3), centerX(outWord) - or.left);
  check("no COMING SOON left on that flyer", !inBoard(out, "COMING SOON"));

  // Stack position.
  for (const [name, pieces] of [["SoundCloudBanner", ["Out Now", "Ellipse 2 copy", "Timeless"]], ["FlyerComingSoon", ["COMING SOON", "Timeless"]], ["FlyerOutNow", ["OUT NOW", "Timeless"]]]) {
    const top = Array.from(byName(doc, name).layers).map((l) => l.name);
    const curves = top.indexOf("Curves Finish");
    const text = top.indexOf("Text");
    const at = pieces.map((p) => top.indexOf(p));
    check(name + " pieces sit directly above the text", at.every((i) => i > -1) && Math.max(...at) === text - 1 && text - Math.min(...at) === pieces.length, top);
    check(name + " pieces sit below the Curves", at.every((i) => curves < i), top);
  }

  for (const name of ["BGSquare", "BGLandscape", "BGPortrait", "YouTubeThumbnail"]) {
    check(name + " gets no template pieces", !inBoard(byName(doc, name), "Timeless") && !inBoard(byName(doc, name), "COMING SOON") && !inBoard(byName(doc, name), "Out Now"));
  }

  check("the template files aren't changed", mtime(arg.flyer) === stamps.flyer && mtime(arg.banner) === stamps.banner, stamps);
  check("the templates are closed afterward", app.documents.length === 1, Array.from(app.documents).map((d) => d.name));
  check("the working document stays active", app.activeDocument.id === doc.id);

  if (arg.previewDir) for (const b of listArtboards(doc)) await kit.saveJpeg(doc, b.bounds, 900, arg.previewDir + "/" + b.name + ".jpg");

  await kit.modal(() => undo());
  check("one undo removes the boards and template pieces", listArtboards(doc).length === 0, listArtboards(doc).map((b) => b.name));
  await kit.closeDoc(doc);

  // Nothing missing means no template gets opened.
  // ---- no live text ----
  doc = await kit.openFresh(arg.path);
  const plain = await buildArtboards({ doc, sourceId: null, ...picks(doc), font: null, ...paths });
  check("with no live text the report says so", plain.issues.some((s) => /template font/i.test(s)), plain.issues);
  const keptWord = inBoard(byName(doc, "FlyerComingSoon"), "COMING SOON");
  check("COMING SOON keeps the template font", (await textStyle(keptWord.id)).font === "GalanoGrotesque-Bold");
  check("COMING SOON keeps the template's width", Math.abs(widthOf(keptWord) - 581) <= 581 * 0.02, widthOf(keptWord));
  const keptOut = inBoard(byName(doc, "FlyerOutNow"), "OUT NOW");
  check("OUT NOW still gets its wording", (await textStyle(keptOut.id)).contents === "OUT NOW");
  check("OUT NOW keeps the template font", (await textStyle(keptOut.id)).font === "GalanoGrotesque-Bold");
  await kit.closeDoc(doc);

  // ---- a template that's already open ----
  const openBanner = await kit.openFresh(arg.banner);
  doc = await kit.openFresh(arg.path);
  await buildArtboards({ doc, sourceId: null, ...picks(doc), font, ...paths });
  check("a template you already had open stays open", Array.from(app.documents).some((d) => d.id === openBanner.id));
  check("only that template stays open", app.documents.length === 2, Array.from(app.documents).map((d) => d.name));
  await kit.closeDoc(doc);
  await kit.closeDoc(openBanner);

  // ---- a missing template ----
  doc = await kit.openFresh(arg.path);
  const namesBefore = kit.flat(doc.layers).map((l) => l.name).join("|");
  let message = "";
  let boardsBefore = 0;
  try {
    await buildArtboards({ doc, sourceId: null, ...picks(doc), font, flyer: arg.flyer, banner: "C:/does/not/exist.psd" }, () => { boardsBefore++; });
  } catch (e) {
    message = e.message;
  }
  check("a missing template stops the build before any board is made", boardsBefore === 0, boardsBefore);
  check("a missing template gives a clear error", /template/i.test(message) && /exist\.psd/.test(message), message);
  check("a missing template leaves the document alone", kit.flat(doc.layers).map((l) => l.name).join("|") === namesBefore && listArtboards(doc).length === 0);
  check("a missing template leaves no other document open", app.documents.length === 1);
  await kit.closeDoc(doc);

  // ---- a re-run that only needs one flyer ----
  doc = await kit.openFresh(arg.path);
  await buildArtboards({ doc, sourceId: null, ...picks(doc), font, ...paths });
  const source = byName(doc, "Cover Art");
  await kit.modal(async () => {
    const victim = byName(doc, "FlyerOutNow");
    await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: victim.id }], makeVisible: false, _options: { dialogOptions: "silent" } }, { _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "silent" } }], {});
  });
  const refill = await buildArtboards({ doc, sourceId: source.id, textIds: [inBoard(source, "Text").id], logoIds: [inBoard(source, "Logo").id], font, ...paths });
  check("a refilled flyer gets built", refill.built.length === 1 && refill.built[0] === "FlyerOutNow", refill);
  const refilledWord = inBoard(byName(doc, "FlyerOutNow"), "OUT NOW");
  check("a refilled OUT NOW has the same font size", near((await textStyle(refilledWord.id)).size, (await textStyle(inBoard(byName(doc, "FlyerComingSoon"), "COMING SOON").id)).size, 0.5));
  await kit.closeDoc(doc);

  return t.done();
};
