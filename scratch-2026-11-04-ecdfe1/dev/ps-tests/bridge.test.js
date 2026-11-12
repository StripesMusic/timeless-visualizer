// Runs inside Photoshop, with After Effects closed. Leaves AE open on the result; quit it gracefully afterward.
// node dev/ps.js dev/ps-tests/bridge.test.js "{\"template\":\"...\",\"aePath\":\"...\",\"imagesDir\":\"...\",\"outDir\":\"...\"}" --timeout=800
const fs = require("fs");
const kit = require("./kit");
const { buildVisuals, runInAfterEffects } = require("../../plugin/src/ae/bridge");
const { ensureFolder } = require("../../plugin/src/ps/helpers");
const { asciiJson } = require("../../plugin/src/core/aerun");

const url = (p) => "file:" + p.replace(/\\/g, "/");
const exists = (p) => { try { fs.lstatSync(url(p)); return true; } catch (e) { return false; } };

exports.run = async (arg, ctx) => {
  const t = kit.suite(ctx.log);
  const { check } = t;
  const aeSource = fs.readFileSync(url(__dirname + "/../../plugin/ae/build_visuals.jsx"), { encoding: "utf-8" });
  const native = (p) => p.replace(/\//g, "\\");
  const name = (f) => native(arg.imagesDir + "/" + f);
  const images = { coverArt: name("CoverArt.jpg"), bgPortrait: name("BGPortrait.jpg"), comingSoonText: name("ComingSoonText.png"), outNowText: name("OutNowText.png"), canvasText: name("CanvasText.png") };
  const folder = arg.outDir + "/TMLS043_Bukkoy&Ray_Ø Test";
  await kit.modal(() => ensureFolder(folder));
  const output = native(folder + "/TMLS043_Bukkoy&Ray_Ø_VisualsAEP.aep");
  const settings = { aePath: native(arg.aePath), templatePath: native(arg.template), outputPath: output, date: "28 AUG 2026", images, audio: {} };

  // Nothing here should reach After Effects.
  let before = Date.now();
  const noAE = await buildVisuals({ ...settings, aePath: "C:\\nope\\AfterFX.exe" }, () => {}, { aeSource });
  check("a bad AE path fails without launching", noAE.ok === false && /After Effects/.test(noAE.issues[0]) && !exists(output), noAE);
  check("a bad AE path fails right away", Date.now() - before < 3000);

  const kept = native(folder + "/Kept_VisualsAEP.aep");
  fs.writeFileSync(url(kept), "keep me", { encoding: "utf-8" });
  before = Date.now();
  const left = await buildVisuals({ ...settings, outputPath: kept }, () => {}, { aeSource });
  check("an existing AEP is left as is", left.ok === true && left.aepPath === kept && left.issues.some((s) => /left as is/i.test(s)), left);
  check("an existing AEP doesn't launch AE", Date.now() - before < 3000);
  check("an existing AEP isn't changed", fs.readFileSync(url(kept), { encoding: "utf-8" }) === "keep me");

  // The real thing.
  const steps = [];
  const full = await buildVisuals(settings, (s) => { if (steps[steps.length - 1] !== s) steps.push(s); }, { aeSource });
  ctx.log("result " + JSON.stringify(full) + " steps " + JSON.stringify(steps));
  check("a full run succeeds", full.ok === true, full);
  check("a full run returns the AEP", full.aepPath && /_VisualsAEP\.aep$/.test(full.aepPath), full.aepPath);
  check("the AEP is on disk, in a folder with & and Ø", exists(output));
  check("blank audio is in the report", full.issues.some((s) => /audio/i.test(s)), full.issues);
  check("progress was reported", steps.length >= 1, steps);

  // Read the project back from AE.
  const dataFile = native(arg.outDir + "/readback.txt");
  if (exists(dataFile)) await fs.unlink(url(dataFile));
  const readback = `(function(){
    var out=new File(${asciiJson(dataFile)});out.encoding="UTF-8";out.open("w");
    out.writeln("PROJECT="+app.project.file.fsName);
    for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i);
      if(it instanceof FootageItem&&it.file)out.writeln(it.name+"="+it.file.fsName);}
    out.close();
  })();`;
  const ran = await runInAfterEffects(settings.aePath, readback, () => (exists(dataFile) ? "done" : null), { timeoutMs: 120000 });
  check("a second script reaches the open AE", ran === "done", ran);
  const lines = exists(dataFile) ? fs.readFileSync(url(dataFile), { encoding: "utf-8" }) : "";
  ctx.log(lines);
  check("AE has the new project open", lines.includes("TMLS043_Bukkoy&Ray_Ø_VisualsAEP.aep"), lines.slice(0, 300));
  for (const f of ["CoverArt.jpg", "ComingSoonText.png", "OutNowText.png", "BGPortrait.jpg", "CanvasText.png"]) {
    check("AE links " + f + " through the & and Ø path", lines.includes("TMLS043_Bukkoy&Ray_Ø Test_VisualsAEP Assets\\" + f), lines);
  }
  check("no footage links to another release", !/TMLS044|She Wants/.test(lines), lines);

  // A failure inside AE comes back in the report.
  const broken = await buildVisuals({ ...settings, outputPath: native(folder + "/Broken_VisualsAEP.aep"), templatePath: "C:\\nope\\template.aep" }, () => {}, { aeSource });
  ctx.log("broken " + JSON.stringify(broken));
  check("an error in AE comes back as a failure", broken.ok === false && broken.issues.length > 0, broken);

  return t.done();
};
