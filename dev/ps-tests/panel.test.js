// Drives the real panel controls inside Photoshop without clicking. runBuild is faked here; e2e.test.js runs the real one.
// node dev/ps.js dev/ps-tests/panel.test.js "{\"path\":\"C:/.../fixture.psd\",\"unsaved\":true}" --timeout=120
const fs = require("fs");
const { app } = require("photoshop");
const kit = require("./kit");
const { createPanel, DEFAULT_PATHS, STORE_KEY } = require("../../plugin/src/panel");
const { listArtboards, selectionInfo, collectFonts } = require("../../plugin/src/ps/doc");
const { selectLayers } = require("../../plugin/src/ps/actions");

const html = fs.readFileSync("file:" + __dirname + "/../../plugin/index.html", { encoding: "utf-8" });
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1];

function fakeStorage(seed) {
  const data = { ...(seed || {}) };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data };
}

const click = (el) => el.dispatchEvent(new Event("click"));

exports.run = async (arg, ctx) => {
  const t = kit.suite(ctx.log);
  const { check } = t;
  const root = document;
  root.body.innerHTML = body;
  const el = (id) => root.querySelector("#" + id);

  const calls = [];
  const picked = [];
  let answer = { ok: true, built: ["BGSquare"], skipped: ["BGPortrait"], issues: ["Coming Soon audio was left blank, so its layer is switched off."], aepPath: "C:\\Art\\X_VisualsAEP.aep" };
  const services = {
    activeDocument: () => app.activeDocument || null,
    listArtboards,
    selectionInfo,
    collectFonts,
    exists: () => true,
    pickFile: async (types) => { picked.push(types); return "C:\\Music\\Song Name.wav"; },
    runBuild: async (inputs, onProgress) => {
      calls.push(inputs);
      onProgress("Building artboards", 50);
      check("progress shows while building", el("status").textContent === "Building artboards" && el("progress").getAttribute("value") === "50");
      check("Build is off while building", el("build").hasAttribute("disabled"));
      if (answer instanceof Error) throw answer;
      return answer;
    },
    storage: fakeStorage(),
  };

  // No document.
  for (const d of Array.from(app.documents)) if (d.name === "fixture.psd") await kit.closeDoc(d);
  let panel = createPanel(root, services);
  check("with no document, Build is off", el("build").hasAttribute("disabled"));
  check("with no document, the panel says to open one", el("problems").textContent.includes("Open a PSD first."), el("problems").textContent);
  check("default template paths are filled in", el("pathFlyer").value === DEFAULT_PATHS.flyer && el("pathAe").value === DEFAULT_PATHS.ae, el("pathFlyer").value);

  // Unsaved document.
  await kit.modal(() => app.documents.add({ width: 100, height: 100, resolution: 72, mode: "RGBColorMode", fill: "white", name: "TV Helper Unsaved" }));
  panel.refresh();
  check("a never-saved PSD is refused", el("problems").textContent.includes("Save the PSD first."), el("problems").textContent);
  check("a never-saved PSD keeps Build off", el("build").hasAttribute("disabled"));
  await kit.modal(() => app.activeDocument.closeWithoutSaving());

  // A real document with no artboards.
  const doc = await kit.openFresh(arg.path);
  panel.refresh();
  check("the panel notices the new document", panel.state.docId === doc.id);
  check("no artboards: the source picker is off and explains", el("source").hasAttribute("disabled") && /whole canvas/i.test(el("sourceNote").textContent), el("sourceNote").textContent);
  check("nothing picked yet", el("textNames").textContent === "Nothing picked" && el("logoNames").textContent === "Nothing picked");
  check("Build stays off until the picks are made", el("build").hasAttribute("disabled"));
  check("the panel lists what's missing", /text layers/.test(el("problems").textContent) && /logo layers/.test(el("problems").textContent) && /release date/.test(el("problems").textContent), el("problems").textContent);

  const flat = kit.flat(doc.layers);
  const textLayer = flat.find((l) => l.name === "Text");
  const logoLayer = flat.find((l) => l.name === "Logo");
  await kit.modal(() => selectLayers([textLayer.id]));
  click(el("useText"));
  check("Use selection shows the picked names", el("textNames").textContent === "Text", el("textNames").textContent);
  check("the font picker turns on", !el("font").hasAttribute("disabled"));
  check("the font picker lists each font once", root.querySelectorAll("#fontMenu sp-menu-item").length === 1 && root.querySelector("#fontMenu sp-menu-item").textContent === "ArialMT");
  check("the largest text's font is picked by default", el("font").selectedIndex === 0 && panel.state.fonts[0].font === "ArialMT");

  await kit.modal(() => selectLayers([logoLayer.id]));
  click(el("useLogo"));
  check("Logo shows the picked names", el("logoNames").textContent === "Logo");
  el("date").value = "28 AUG 2026";
  el("date").dispatchEvent(new Event("input"));
  check("Build turns on when everything is ready", !el("build").hasAttribute("disabled"), el("problems").textContent);
  check("no problems are listed when ready", el("problems").textContent.trim() === "", el("problems").textContent);

  // Same layer for both.
  await kit.modal(() => selectLayers([textLayer.id]));
  click(el("useLogo"));
  check("the same layer as Text and Logo is refused", /both Text and Logo/.test(el("problems").textContent) && el("build").hasAttribute("disabled"));
  await kit.modal(() => selectLayers([logoLayer.id]));
  click(el("useLogo"));

  // Audio.
  click(el("audioComing"));
  await new Promise((r) => setTimeout(r, 50));
  check("audio shows the chosen file's name", el("audioComingName").textContent === "Song Name.wav");
  click(el("audioOut"));
  await new Promise((r) => setTimeout(r, 50));
  click(el("audioOutClear"));
  check("audio can be cleared", el("audioOutName").textContent === "None" && panel.state.audio.outNow === null);

  // Build.
  const report = await panel.build();
  check("Build passes the panel's values on", calls.length === 1 && calls[0].doc.id === doc.id && calls[0].textIds[0] === textLayer.id && calls[0].logoIds[0] === logoLayer.id && calls[0].date === "28 AUG 2026" && calls[0].sourceId === null, calls[0] && { t: calls[0].textIds, l: calls[0].logoIds, d: calls[0].date });
  check("Build passes the font and color", calls[0].font.font === "ArialMT" && calls[0].font.color.red > 250);
  check("Build passes the audio", calls[0].audio.comingSoon === "C:\\Music\\Song Name.wav" && calls[0].audio.outNow === null);
  check("Build passes the template and AE paths", calls[0].templates.flyer === DEFAULT_PATHS.flyer && calls[0].aePath === DEFAULT_PATHS.ae);
  const text = el("report").textContent;
  check("the report lists what was built and skipped", text.includes("Built: BGSquare") && text.includes("left alone: BGPortrait"), text);
  check("the report gives the AEP and any issues", text.includes("X_VisualsAEP.aep") && text.includes("left blank"), text);
  check("the report reminds you nothing was saved", /Nothing was saved/.test(text), text);
  check("Build comes back on afterward", !el("build").hasAttribute("disabled"));
  check("the progress bar hides afterward", el("progress").classList.contains("hidden"));

  // A build that throws.
  answer = new Error("Something broke");
  await panel.build();
  check("a thrown error shows in the report", el("report").textContent.includes("Something broke") && el("status").textContent.includes("problem"), el("report").textContent);
  check("Build comes back on after an error", !el("build").hasAttribute("disabled"));

  // Paths persist.
  el("pathFlyer").value = "D:\\Other\\flyer.psd";
  el("pathFlyer").dispatchEvent(Object.assign(new Event("change"), {}));
  check("a changed path is remembered", JSON.parse(services.storage.data[STORE_KEY]).flyer === "D:\\Other\\flyer.psd", services.storage.data);
  root.body.innerHTML = body;
  panel = createPanel(root, services);
  check("a new panel reads the remembered path", el("pathFlyer").value === "D:\\Other\\flyer.psd", el("pathFlyer").value);
  check("per-release fields don't carry over", el("date").value === "" || el("date").value === undefined, el("date").value);

  // Missing template path blocks Build.
  services.exists = (p) => !p.includes("flyer");
  panel.refresh();
  check("a missing template blocks Build with its path", /Can't find the flyer template/.test(el("problems").textContent), el("problems").textContent);
  services.exists = () => true;

  // A document with artboards.
  await kit.closeDoc(doc);
  root.body.innerHTML = "";
  return t.done();
};
