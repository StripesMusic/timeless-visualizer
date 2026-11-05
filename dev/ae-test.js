// Dev-only: runs plugin/ae/build_visuals.jsx in After Effects against fixtures, then checks the saved project.
// Usage: node dev/ae-test.js [--frames]
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { composeRunScript, batchFileText } = require("../plugin/src/core/aerun");

const AFX = "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe";
const TEMPLATE = "A:\\Personal GDrive\\Media Assets\\Artwork Assets\\Templates\\Timeless Visuals Template.aep";
const SCRATCH = process.env.TV_SCRATCH || path.join(require("os").tmpdir(), "tv-aetest");
const RUN = path.join(SCRATCH, "run");
const fwd = (p) => p.replace(/\\/g, "/");

function png(file, w, h, rgba, box) {
  const row = Buffer.alloc(1 + w * 4);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const r = Buffer.from(row);
    for (let x = 0; x < w; x++) {
      const inside = !box || (x >= box.left && x < box.right && y >= box.top && y < box.bottom);
      const c = inside ? rgba : [0, 0, 0, 0];
      r.set(c, 1 + x * 4);
    }
    rows.push(r);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 1 })), chunk("IEND", Buffer.alloc(0))]));
}

function wav(file, seconds) {
  const rate = 8000, n = rate * seconds, data = Buffer.alloc(n * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function fixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  png(f("CoverArt.png"), 3000, 3000, [200, 60, 40, 255]);
  png(f("BGPortrait.png"), 1080, 1920, [40, 80, 200, 255]);
  png(f("ComingSoonText.png"), 1080, 1920, [255, 255, 255, 255], { left: 249, top: 654, right: 830, bottom: 715 });
  png(f("OutNowText.png"), 1080, 1920, [255, 255, 0, 255], { left: 340, top: 654, right: 740, bottom: 715 });
  png(f("CanvasText.png"), 1080, 1920, [255, 255, 255, 255], { left: 249, top: 800, right: 830, bottom: 1036 });
  wav(f("presave.wav"), 12);
  wav(f("fullmix.wav"), 60);
  return {
    coverArt: f("CoverArt.png"), bgPortrait: f("BGPortrait.png"), comingSoonText: f("ComingSoonText.png"),
    outNowText: f("OutNowText.png"), canvasText: f("CanvasText.png"), presave: f("presave.wav"), fullmix: f("fullmix.wav"),
  };
}

// A fresh started-file path for a run script that reports its own start.
function startedFor(name) {
  const p = path.join(RUN, name + ".started");
  fs.rmSync(p, { force: true });
  return p;
}

// Same route the plugin uses: the batch file opens AE if needed and resends until the script reports it started.
function launch(scriptPath, startedPath) {
  let started = startedPath;
  if (!started) {
    // Helper scripts don't report their own start, so add that here.
    started = startedFor(path.basename(scriptPath));
    const report = `(function(){var m=new File(${JSON.stringify(fwd(started))});m.open("w");m.write("1");m.close();})();\n`;
    fs.writeFileSync(scriptPath, report + fs.readFileSync(scriptPath, "utf8"));
  }
  const bat = path.join(RUN, "launch_" + path.basename(scriptPath) + ".bat");
  fs.writeFileSync(bat, batchFileText(AFX, scriptPath, started));
  // ShellExecute, like File.execute() in Photoshop. A detached node child has no console and AE hangs.
  spawnSync("powershell", ["-NoProfile", "-Command", "Start-Process -FilePath '" + bat + "'"], { stdio: "ignore" });
}

function waitFor(file, seconds) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => {
      if (fs.existsSync(file)) { clearInterval(t); setTimeout(() => resolve(fs.readFileSync(file, "utf8")), 200); }
      else if (Date.now() - started > seconds * 1000) { clearInterval(t); reject(new Error("timed out waiting for " + file)); }
    }, 300);
  });
}

async function runBuild(dir, name, images, audio, extra) {
  const output = path.join(dir, name + ".aep");
  const resultPath = path.join(dir, name + "_result.json");
  for (const p of [output, resultPath]) fs.rmSync(p, { force: true });
  const startedPath = startedFor(name);
  const settings = { templatePath: TEMPLATE, outputPath: output, date: "03 NOV 2026", images, audio, resultPath, startedPath, ...extra };
  const src = fs.readFileSync(path.join(__dirname, "..", "plugin", "ae", "build_visuals.jsx"), "utf8");
  const run = path.join(RUN, name + "_run.jsx");
  fs.writeFileSync(run, composeRunScript(settings, src));
  launch(run, startedPath);
  return { output, result: JSON.parse(await waitFor(resultPath, 240)) };
}

const DUMP = `
(function () {
  var S = TV_DUMP;
  var o = { comps: {}, footage: [], renderQueue: app.project.renderQueue.numItems, projectFile: app.project.file ? app.project.file.fsName : null };
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof CompItem && it.name.indexOf("Transition - ") !== 0) {
      var layers = [];
      for (var l = 1; l <= it.numLayers; l++) {
        var L = it.layer(l), a = null;
        try { a = L.audioEnabled; } catch (e) {}
        var t = null;
        if (L instanceof TextLayer) t = L.property("ADBE Text Properties").property("ADBE Text Document").value.text;
        layers.push({ name: L.name, src: L.source ? L.source.name : null, on: L.enabled, audio: a, text: t, out: L.outPoint });
      }
      o.comps[it.name] = { w: it.width, h: it.height, fps: Math.round(it.frameRate * 1000) / 1000, dur: Math.round(it.duration * 1000) / 1000, folder: it.parentFolder.name, layers: layers };
      if (S.frameDir && S.frames[it.name] !== undefined) { try { it.saveFrameToPng(S.frames[it.name], new File(S.frameDir + "/" + it.name + ".png")); } catch (eF) { o.frameError = String(eF.message); } }
    } else if (it instanceof FootageItem) {
      var p = null;
      try { p = it.file ? it.file.fsName : null; } catch (e2) {}
      o.footage.push({ name: it.name, path: p });
    }
  }
  var f = new File(S.out); f.encoding = "UTF-8"; f.open("w");
  function ser(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return '"' + v.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/[\\r\\n]/g, " ") + '"';
    if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(ser(v[i])); return "[" + a.join(",") + "]"; }
    var b = []; for (var k in v) if (v.hasOwnProperty(k)) b.push('"' + k + '":' + ser(v[k])); return "{" + b.join(",") + "}";
  }
  f.write(ser(o)); f.close();
})();`;

async function dump(dir, frames) {
  const out = path.join(dir, "dump.json");
  fs.rmSync(out, { force: true });
  const script = path.join(RUN, "dump.jsx");
  const frameDir = frames ? fwd(path.join(dir, "frames")) : null;
  if (frameDir) fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(script, "var TV_DUMP = " + JSON.stringify({ out: fwd(out), frameDir, frames: { ComingSoonReel: 3, OutNowReel: 3, BGAnimation: 3, SpotifyCanvas: 3 } }) + ";\n" + DUMP);
  launch(script);
  return JSON.parse(await waitFor(out, 180));
}

function aeRunning() {
  return /AfterFX/i.test(spawnSync("tasklist", ["/FI", "IMAGENAME eq AfterFX.exe"], { encoding: "utf8" }).stdout);
}

async function quitAe(dir) {
  const q = path.join(RUN, "quit.jsx");
  fs.writeFileSync(q, "app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.quit();");
  launch(q);
  const started = Date.now();
  while (aeRunning() && Date.now() - started < 30000) await new Promise((r) => setTimeout(r, 500));
}

function check(failures, cond, msg) { if (!cond) failures.push(msg); }

async function main() {
  if (aeRunning()) { console.log("After Effects is already running; close it before this test."); process.exit(3); }
  const wantFrames = process.argv.includes("--frames");
  const dir = path.join(SCRATCH, "ae test");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(RUN, { recursive: true });
  const fx = fixtures(dir);
  const images = { coverArt: fx.coverArt, bgPortrait: fx.bgPortrait, comingSoonText: fx.comingSoonText, outNowText: fx.outNowText, canvasText: fx.canvasText };
  const tMtime = fs.statSync(TEMPLATE).mtimeMs;
  const failures = [];

  // Run 1: blank audio.
  const a = await runBuild(dir, "Blank_VisualsAEP", images, { comingSoon: "", outNow: "" });
  console.log("run 1 result:", JSON.stringify(a.result));
  check(failures, a.result.ok === true, "run 1 ok");
  check(failures, fs.existsSync(a.output), "run 1 saved the AEP");
  check(failures, a.result.issues.some((s) => /Coming Soon audio/i.test(s)), "issue names Coming Soon audio");
  check(failures, a.result.issues.some((s) => /Out Now audio/i.test(s)), "issue names Out Now audio");
  let d = await dump(dir, wantFrames);
  const c = d.comps;
  for (const [n, dur] of [["BGAnimation", 8.65], ["SpotifyCanvas", 8]]) {
    check(failures, c[n] && c[n].dur === dur, `${n} is ${dur}s (got ${c[n] && c[n].dur})`);
  }
  for (const n of ["ComingSoonReel", "OutNowReel", "BGAnimation", "SpotifyCanvas"]) {
    check(failures, c[n] && c[n].w === 1080 && c[n].h === 1920 && c[n].fps === 60, `${n} is 1080x1920 at 60 fps`);
    check(failures, c[n] && c[n].folder === "Render These", `${n} is in Render These`);
  }
  check(failures, !c["Coming Soon"] && !c["Out Now"], "old reel comp names are gone");
  const fl = c["Flyer Social"];
  check(failures, fl && fl.layers[0].name === "Adjustment Layer 3" && fl.layers[fl.layers.length - 1].src === "BGPortrait", "Flyer Social: adjustment above BGPortrait");
  check(failures, fl && fl.layers[fl.layers.length - 1].out >= 8.65 - 0.02, "BGPortrait runs the full Flyer Social length");
  const sc = c.SpotifyCanvas;
  check(failures, sc && sc.layers[0].src === "CanvasText" && sc.layers[1].src === "Flyer Social", "SpotifyCanvas: text above Flyer Social");
  check(failures, c.BGAnimation && c.BGAnimation.layers.length === 1 && c.BGAnimation.layers[0].src === "Flyer Social", "BGAnimation nests Flyer Social only");
  const reel = c.ComingSoonReel;
  const dateLayer = reel && reel.layers.find((l) => l.text !== null);
  check(failures, dateLayer && dateLayer.text === "03 NOV 2026" && dateLayer.name === "03 NOV 2026", "date text and layer name updated");
  const aud = (comp, nameRe) => comp.layers.find((l) => nameRe.test(l.src || ""));
  check(failures, reel && aud(reel, /Coming Soon Audio/) && aud(reel, /Coming Soon Audio/).on === false, "blank Coming Soon audio layer is off");
  check(failures, c.OutNowReel && aud(c.OutNowReel, /Out Now Audio/) && aud(c.OutNowReel, /Out Now Audio/).on === false, "blank Out Now audio layer is off");
  const stale = d.footage.filter((f) => f.path && /TMLS044|She Wants/i.test(f.path));
  check(failures, stale.length === 0, "no stale footage: " + stale.map((s) => s.path).join("; "));
  check(failures, d.renderQueue === 0, "render queue empty");
  for (const n of ["Cover Art File", "Coming Soon Text", "Out Now Text"]) {
    check(failures, d.footage.some((f) => f.name === n), `footage item keeps its name: ${n}`);
  }

  // Run 2: refuses to overwrite an existing project.
  fs.rmSync(path.join(dir, "Keep_result.json"), { force: true });
  fs.writeFileSync(path.join(dir, "Keep.aep"), "hand-tweaked");
  const keepResult = path.join(dir, "Keep_result.json");
  const keepRun = path.join(RUN, "Keep_run.jsx");
  const srcAgain = fs.readFileSync(path.join(__dirname, "..", "plugin", "ae", "build_visuals.jsx"), "utf8");
  const keepStarted = startedFor("Keep");
  fs.writeFileSync(keepRun, composeRunScript({ templatePath: TEMPLATE, outputPath: path.join(dir, "Keep.aep"), date: "X", images, audio: {}, resultPath: keepResult, startedPath: keepStarted }, srcAgain));
  launch(keepRun, keepStarted);
  const keep = JSON.parse(await waitFor(keepResult, 60));
  check(failures, keep.ok === false && /already exists/i.test(keep.error), "refuses to overwrite an AEP");
  check(failures, fs.readFileSync(path.join(dir, "Keep.aep"), "utf8") === "hand-tweaked", "existing AEP untouched");

  // Run 3: real audio, name with & and Ø in the folder.
  const odd = path.join(dir, "TMLS043_Bukkoy&Ray_Ø Test");
  fs.mkdirSync(odd, { recursive: true });
  const fx2 = fixtures(odd);
  const b = await runBuild(odd, "Odd_VisualsAEP", { coverArt: fx2.coverArt, bgPortrait: fx2.bgPortrait, comingSoonText: fx2.comingSoonText, outNowText: fx2.outNowText, canvasText: fx2.canvasText }, { comingSoon: fx2.presave, outNow: fx2.fullmix });
  console.log("run 3 result:", JSON.stringify(b.result));
  check(failures, b.result.ok === true && b.result.issues.length === 0, "run 3 ok with no issues");
  check(failures, fs.existsSync(b.output), "run 3 saved into the odd folder");
  d = await dump(dir, false);
  const ourAudio = d.footage.find((f) => f.name === "Coming Soon Audio");
  check(failures, ourAudio && /Bukkoy&Ray_Ø Test/.test(ourAudio.path), "odd path reads back correctly: " + (ourAudio && ourAudio.path));
  check(failures, d.comps.ComingSoonReel.layers.find((l) => /Coming Soon Audio/.test(l.src || "")).on === true, "audio layer stays on when a file is picked");

  // Run 4: an open project with unsaved changes is never touched.
  const dirtyMark = path.join(RUN, "dirty.jsx");
  const dirtyDone = path.join(dir, "dirty_done.txt");
  fs.writeFileSync(dirtyMark, `app.project.items.addFolder("TV unsaved marker"); var f = new File(${JSON.stringify(fwd(dirtyDone))}); f.open("w"); f.write("dirty=" + app.project.dirty); f.close();`);
  launch(dirtyMark);
  console.log("dirty state:", await waitFor(dirtyDone, 60));
  const dirtyResult = path.join(dir, "Dirty_result.json");
  const dirtyRun = path.join(RUN, "Dirty_run.jsx");
  const dirtyStarted = startedFor("Dirty");
  fs.writeFileSync(dirtyRun, composeRunScript({ templatePath: TEMPLATE, outputPath: path.join(dir, "Dirty_VisualsAEP.aep"), date: "X", images, audio: {}, resultPath: dirtyResult, startedPath: dirtyStarted }, srcAgain));
  launch(dirtyRun, dirtyStarted);
  const dirty = JSON.parse(await waitFor(dirtyResult, 60));
  check(failures, dirty.ok === false && /unsaved/i.test(dirty.error), "stops when AE has unsaved changes: " + dirty.error);
  check(failures, !fs.existsSync(path.join(dir, "Dirty_VisualsAEP.aep")), "no project written when stopped");
  d = await dump(dir, false);
  check(failures, /Odd_VisualsAEP/.test(d.projectFile || ""), "the open project stayed open: " + d.projectFile);

  // Run 5: a resent copy of a script that already started does nothing at all.
  const twiceResult = path.join(dir, "Twice_result.json");
  const twiceOutput = path.join(dir, "Twice_VisualsAEP.aep");
  const twiceRun = path.join(RUN, "Twice_run.jsx");
  const twiceStarted = startedFor("Twice");
  fs.writeFileSync(twiceStarted, "started");
  fs.writeFileSync(twiceRun, composeRunScript({ templatePath: TEMPLATE, outputPath: twiceOutput, date: "X", images, audio: {}, resultPath: twiceResult, startedPath: twiceStarted }, srcAgain));
  launch(twiceRun, twiceStarted);
  // AE runs scripts one at a time, so once this later one has run, the copy above has too.
  const afterTwice = path.join(dir, "after_twice.txt");
  fs.rmSync(afterTwice, { force: true });
  const afterTwiceJsx = path.join(RUN, "after_twice.jsx");
  fs.writeFileSync(afterTwiceJsx, `var f = new File(${JSON.stringify(fwd(afterTwice))}); f.open("w"); f.write("done"); f.close();`);
  launch(afterTwiceJsx);
  await waitFor(afterTwice, 60);
  check(failures, !fs.existsSync(twiceResult), "a resent copy writes no result");
  check(failures, !fs.existsSync(twiceOutput), "a resent copy saves no project");

  check(failures, fs.statSync(TEMPLATE).mtimeMs === tMtime, "template modified time unchanged");
  await quitAe(dir);
  if (failures.length) { console.log("FAILED:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL PASS");
}

main().catch((e) => { console.log("ERROR", e.message); process.exit(2); });
