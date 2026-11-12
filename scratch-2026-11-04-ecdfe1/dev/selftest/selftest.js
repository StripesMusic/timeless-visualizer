// Dev-only. Added to a copy of the real plugin, with the real permissions, by dev/install-selftest.js.
// Proves what the harness can't: the plugin's own file loading, its own requires, and the whole Build
// running from the real panel code with only the permissions the shipped manifest asks for.
(function () {
  const fs = require("fs");
  const uxp = require("uxp");
  const { app, core } = require("photoshop");
  const { createPanel } = require("./src/panel");
  const { realServices } = require("./src/services");
  const { selectLayers } = require("./src/ps/actions");

  const CONFIG = __CONFIG__;
  const out = { started: Date.now(), checks: [], log: [], done: false };
  const save = () => fs.writeFileSync("file:" + CONFIG.resultPath, JSON.stringify(out, null, 1), { encoding: "utf-8" });
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok: !!ok, detail: ok ? undefined : detail });
    save();
  };
  const log = (s) => {
    out.log.push(s);
    save();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.querySelector("#" + id);
  const fire = (node, type) => node.dispatchEvent(new Event(type));
  const allLayers = (layers, list = []) => {
    for (const l of layers) {
      list.push(l);
      if (l.layers) allLayers(l.layers, list);
    }
    return list;
  };

  async function run() {
    const script = fs.readFileSync("plugin:/ae/build_visuals.jsx", { encoding: "utf-8" });
    check("the plugin can read its own AE script", script.includes("TV_SETTINGS"));
    check("the panel's page is loaded", !!el("build") && !!el("source"));
    const data = (await uxp.storage.localFileSystem.getDataFolder()).nativePath;
    log("data folder " + data);

    let doc;
    await core.executeAsModal(
      async () => {
        doc = await app.open(await uxp.storage.localFileSystem.getEntryWithUrl("file:" + CONFIG.psd));
      },
      { commandName: "TV self test" }
    );
    check("a PSD opens from the plugin", !!doc && doc.name === CONFIG.psd.replace(/^.*\//, ""), doc && doc.name);

    const panel = createPanel(document, realServices());
    for (const [fieldId, value] of [["pathFlyer", CONFIG.flyer], ["pathBanner", CONFIG.banner], ["pathVisuals", CONFIG.visuals]]) {
      el(fieldId).value = value;
      fire(el(fieldId), "change");
    }
    panel.refresh();

    const layers = allLayers(doc.layers);
    await core.executeAsModal(() => selectLayers([layers.find((l) => l.name === "Text").id]), { commandName: "TV self test" });
    fire(el("useText"), "click");
    await core.executeAsModal(() => selectLayers([layers.find((l) => l.name === "Logo").id]), { commandName: "TV self test" });
    fire(el("useLogo"), "click");
    el("date").value = "28 AUG 2026";
    fire(el("date"), "input");
    check("Build turns on in the real panel", !el("build").hasAttribute("disabled"), el("problems").textContent);
    log("problems: " + el("problems").textContent);

    const started = Date.now();
    fire(el("build"), "click");
    await sleep(500);
    check("Build starts from a click", panel.state.busy === true);
    while (panel.state.busy && Date.now() - started < 15 * 60 * 1000) {
      await sleep(2000);
      if (out.lastStatus !== el("status").textContent) {
        out.lastStatus = el("status").textContent;
        log(Math.round((Date.now() - started) / 1000) + "s " + out.lastStatus);
      }
    }
    const report = el("report").textContent;
    log("report: " + report);
    check("the build finishes", !panel.state.busy);
    check("the report says it's done", el("status").textContent === "Done", el("status").textContent);
    check("every board is reported as built", ["BGSquare", "SoundCloudBanner", "YouTubeThumbnail", "FlyerComingSoon", "FlyerOutNow", "BGLandscape", "BGPortrait"].every((n) => report.includes(n)), report);
    const dir = CONFIG.psd.replace(/\/[^/]*$/, "");
    const aep = dir + "/" + CONFIG.psd.replace(/^.*\//, "").replace("_CoverArtPSD.psd", "_VisualsAEP.aep");
    let aepThere = false;
    try {
      fs.lstatSync("file:" + aep);
      aepThere = true;
    } catch (e) {
      aepThere = false;
    }
    check("the AEP is on disk", aepThere, aep);
    check("the report names the AEP", report.includes("_VisualsAEP.aep"), report);

    await core.executeAsModal(() => doc.closeWithoutSaving(), { commandName: "TV self test" });
    out.done = true;
    save();
  }

  setTimeout(() => {
    run().catch((e) => {
      out.error = String((e && (e.stack || e.message)) || e);
      out.done = true;
      save();
    });
  }, 8000);
})();
