// Runs inside Photoshop:
// node dev/ps.js dev/ps-tests/helpers.test.js "{\"path\":\"C:/.../fixture.psd\",\"flyer\":\"...\",\"banner\":\"...\",\"outDir\":\"C:/.../helpers\"}" --timeout=600
const fs = require("fs");
const { app, imaging } = require("photoshop");
const kit = require("./kit");
const { buildArtboards } = require("../../plugin/src/ps/engine");
const { listArtboards } = require("../../plugin/src/ps/doc");
const { exportHelpers, ensureFolder } = require("../../plugin/src/ps/helpers");

const byName = (doc, name) => Array.from(doc.layers).find((l) => l.name === name);
const inBoard = (board, name) => kit.flat(board.layers).find((l) => l.name === name);

// Alpha of every pixel, plus the size, from a file opened in Photoshop.
async function readImage(path) {
  const doc = await kit.openFresh(path.replace(/\\/g, "/"));
  const info = { width: doc.width, height: doc.height };
  await kit.modal(async () => {
    const { imageData } = await imaging.getPixels({ documentID: doc.id, colorSpace: "RGB", componentSize: 8 });
    info.components = imageData.components;
    info.pixelWidth = imageData.width;
    info.bytes = await imageData.getData({ chunky: true });
    imageData.dispose();
    await doc.closeWithoutSaving();
  });
  return info;
}

function opaqueBounds(img) {
  if (img.components < 4) return null;
  const out = { left: Infinity, top: Infinity, right: -1, bottom: -1, count: 0 };
  const w = img.pixelWidth;
  for (let i = 0; i < img.bytes.length / 4; i++) {
    if (img.bytes[i * 4 + 3] < 8) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    out.left = Math.min(out.left, x);
    out.right = Math.max(out.right, x + 1);
    out.top = Math.min(out.top, y);
    out.bottom = Math.max(out.bottom, y + 1);
    out.count++;
  }
  return out;
}

const corners = (img) => {
  const w = img.pixelWidth;
  const h = img.bytes.length / 4 / w;
  return [0, w - 1, (h - 1) * w, h * w - 1].map((i) => img.bytes[i * 4 + 3]);
};

exports.run = async (arg, ctx) => {
  const t = kit.suite(ctx.log);
  const { check, near } = t;
  const doc = await kit.openFresh(arg.path);
  const flat = kit.flat(doc.layers);
  const textIds = [flat.find((l) => l.name === "Text").id];
  const logoIds = [flat.find((l) => l.name === "Logo").id];
  const font = { font: "ArialMT", color: { red: 255, green: 240, blue: 200 } };
  const build = await buildArtboards({ doc, sourceId: null, textIds, logoIds, font, flyer: arg.flyer, banner: arg.banner });
  const source = byName(doc, "Cover Art");
  const sourceText = [inBoard(source, "Text").id];

  const folderPath = arg.outDir + "/TMLS043_Bukkoy&Ray_Ø Test_VisualsAEP Assets";
  const folder = await ensureFolder(folderPath);
  const layersBefore = kit.flat(doc.layers).length;
  const out = await exportHelpers(doc, folder, { sourceId: source.id, textIds: sourceText });
  ctx.log(JSON.stringify(out));

  const names = { coverArt: "CoverArt.jpg", bgPortrait: "BGPortrait.jpg", comingSoonText: "ComingSoonText.png", outNowText: "OutNowText.png", canvasText: "CanvasText.png" };
  for (const key of Object.keys(names)) check(names[key] + " is written and its path returned", out[key] && out[key].endsWith(names[key]) && fs.lstatSync("file:" + out[key].replace(/\\/g, "/")).isFile(), out[key]);
  check("the paths are native Windows paths", /^[A-Za-z]:\\/.test(out.coverArt), out.coverArt);

  check("the working document keeps its layers", kit.flat(doc.layers).length === layersBefore);
  check("the working document stays active", app.activeDocument.id === doc.id);
  check("no temp documents stay open", app.documents.length === 1, Array.from(app.documents).map((d) => d.name));

  const cover = await readImage(out.coverArt);
  check("CoverArt.jpg is the source size", cover.width === 3000 && cover.height === 3000, cover);
  const bg = await readImage(out.bgPortrait);
  check("BGPortrait.jpg is 1080x1920", bg.width === 1080 && bg.height === 1920, bg);

  // CoverArt shows the source's own composite, text included.
  const srcRect = listArtboards(doc).find((b) => b.name === "Cover Art").bounds;
  const composite = await kit.pixels(doc, srcRect, 300);
  const coverDoc = await kit.openFresh(out.coverArt.replace(/\\/g, "/"));
  const coverPixels = await kit.pixels(coverDoc, { left: 0, top: 0, right: 3000, bottom: 3000 }, 300);
  await kit.closeDoc(coverDoc);
  const diff = kit.difference(composite, coverPixels);
  ctx.log("CoverArt vs source " + JSON.stringify(diff));
  check("CoverArt.jpg matches the source art", diff.mean < 2, diff);

  const rectFlyer = listArtboards(doc).find((b) => b.name === "FlyerComingSoon").bounds;
  for (const [key, board, word] of [["comingSoonText", "FlyerComingSoon", "COMING SOON"], ["outNowText", "FlyerOutNow", "OUT NOW"]]) {
    const img = await readImage(out[key]);
    check(names[key] + " is 1080x1920", img.width === 1080 && img.height === 1920, [img.width, img.height]);
    check(names[key] + " has transparent corners", corners(img).every((a) => a === 0), corners(img));
    const seen = opaqueBounds(img);
    const r = listArtboards(doc).find((b) => b.name === board).bounds;
    const b = inBoard(byName(doc, board), word).boundsNoEffects;
    const want = { left: b.left - r.left, top: b.top - r.top, right: b.right - r.left, bottom: b.bottom - r.top };
    check(names[key] + " only has the word in it, without its shadow", seen && seen.count > 0 && seen.left >= want.left - 3 && seen.right <= want.right + 3 && seen.top >= want.top - 3 && seen.bottom <= want.bottom + 3, { seen, want });
  }

  const canvas = await readImage(out.canvasText);
  check("CanvasText.png is 1080x1920", canvas.width === 1080 && canvas.height === 1920);
  check("CanvasText.png has transparent corners", corners(canvas).every((a) => a === 0), corners(canvas));
  const seenCanvas = opaqueBounds(canvas);
  const flyer = byName(doc, "FlyerComingSoon");
  const textB = inBoard(flyer, "Text").boundsNoEffects;
  const logoB = inBoard(flyer, "Timeless").boundsNoEffects;
  const wordB = inBoard(flyer, "COMING SOON").boundsNoEffects;
  check("CanvasText.png reaches from the title down through the logo", seenCanvas && near(seenCanvas.top, textB.top - rectFlyer.top, 4) && near(seenCanvas.bottom, logoB.bottom - rectFlyer.top, 4), { seenCanvas, textB, logoB });
  check("CanvasText.png leaves out COMING SOON", seenCanvas && seenCanvas.top > wordB.bottom - rectFlyer.top, { seenCanvas, wordB });

  // The Curves above the text lifts the color, so CanvasText carries it. Title color before curves: 255,240,200.
  const titleB = inBoard(flyer, "FLYING SO HIGH").boundsNoEffects;
  const row = Math.round((titleB.top + titleB.bottom) / 2 - rectFlyer.top);
  let brightest = [0, 0, 0];
  for (let x = 0; x < canvas.pixelWidth; x++) {
    const i = (row * canvas.pixelWidth + x) * 4;
    if (canvas.bytes[i + 3] > 250 && canvas.bytes[i + 2] > brightest[2]) brightest = [canvas.bytes[i], canvas.bytes[i + 1], canvas.bytes[i + 2]];
  }
  ctx.log("title color in CanvasText " + JSON.stringify(brightest));
  check("CanvasText.png carries the color adjustments above it", Math.abs(brightest[0] - 235) <= 8, brightest);

  // Exporting again writes over the same files.
  const again = await exportHelpers(doc, folder, { sourceId: source.id, textIds: sourceText });
  const files = fs.readdirSync("file:" + folderPath).sort().join(",");
  check("exporting again overwrites in place", files === "BGPortrait.jpg,CanvasText.png,ComingSoonText.png,CoverArt.jpg,OutNowText.png", files);
  check("exporting again returns the same paths", JSON.stringify(again) === JSON.stringify(out), again);

  await kit.closeDoc(doc);
  return t.done();
};
