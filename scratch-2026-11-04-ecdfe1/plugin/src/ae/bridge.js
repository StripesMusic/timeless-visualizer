// Gets After Effects to run a script: panel -> batchPlay runs a small JSX stub -> the stub runs a batch
// file -> the batch file hands the script to AE. Then waits for the script to write its result.
const fs = require("fs");
const uxp = require("uxp");
const { core } = require("photoshop");
const { composeRunScript, batchFileText, pickRunDir, asciiJson, launchStubText, waitFor } = require("../core/aerun");
const { ensureFolder } = require("../ps/helpers");
const { play } = require("../ps/actions");

const TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 1000;
const OLD_RUN_MS = 60 * 60 * 1000;
const PUBLIC_RUN_DIR = "C:\\Users\\Public\\TimelessVisualizer";

const url = (p) => "file:" + p.replace(/\\/g, "/");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseName = (p) => p.replace(/^.*[\\/]/, "");

function exists(path) {
  try {
    fs.lstatSync(url(path));
    return true;
  } catch (e) {
    return false;
  }
}

// AE can't take a script path with spaces or symbols, so run files go in a folder without any.
async function runFolder() {
  const data = (await uxp.storage.localFileSystem.getDataFolder()).nativePath.replace(/[\\/]+$/, "");
  const dir = pickRunDir([data, PUBLIC_RUN_DIR]);
  if (dir) await ensureFolder(dir);
  return dir;
}

// Run files stay until a later run clears them, because the batch file can still be checking them
// for a moment after the result appears. Removing them early would make it send a missing script.
async function clearOldRuns(dir) {
  const cutoff = Date.now() - OLD_RUN_MS;
  for (const name of fs.readdirSync(url(dir))) {
    const stamp = /^run-(\d+)/.exec(name);
    if (!stamp || Number(stamp[1]) > cutoff) continue;
    try {
      await fs.unlink(url(dir + "\\" + name));
    } catch (e) {
      // Still in use. The next run gets it.
    }
  }
}

async function launch(aePath, dir, id, scriptText, startedPath) {
  const scriptPath = `${dir}\\${id}.jsx`;
  const batPath = `${dir}\\${id}.bat`;
  const stubPath = `${dir}\\${id}_stub.jsx`;
  fs.writeFileSync(url(scriptPath), scriptText, { encoding: "utf-8" });
  fs.writeFileSync(url(batPath), batchFileText(aePath, scriptPath, startedPath), { encoding: "utf-8" });
  fs.writeFileSync(url(stubPath), launchStubText(batPath), { encoding: "utf-8" });

  const lfs = uxp.storage.localFileSystem;
  const token = lfs.createSessionToken(await lfs.getEntryWithUrl(url(stubPath)));
  await core.executeAsModal(
    () => play([{ _obj: "AdobeScriptAutomation Scripts", javaScript: { _path: token, _kind: "local" }, javaScriptMessage: "TV" }]),
    { commandName: "Timeless Visualizer" }
  );
}

// Runs one script in AE and waits until `check` returns something.
async function runInAfterEffects(aePath, scriptText, check, { timeoutMs = TIMEOUT_MS } = {}) {
  const dir = await runFolder();
  if (!dir) throw new Error("There's no folder without spaces to run the After Effects script from.");
  const id = "run-" + Date.now();
  const startedPath = `${dir}\\${id}.started`;
  const guard = "var tvStarted=new File(" + asciiJson(startedPath) + ");";
  const guarded = guard + 'if(!tvStarted.exists){tvStarted.open("w");tvStarted.write("started");tvStarted.close();\n' + scriptText + "\n}\n";
  await launch(aePath, dir, id, guarded, startedPath);
  return waitFor(check, { timeoutMs, intervalMs: POLL_MS, sleep });
}

// Resolves to {ok, aepPath, issues}. Problems come back in `issues` rather than as errors.
async function buildVisuals(settings, onProgress = () => {}, options = {}) {
  const { aePath, outputPath, templatePath, date, images, audio } = settings;
  if (exists(outputPath)) {
    return { ok: true, aepPath: outputPath, issues: [`${baseName(outputPath)} already exists, so it was left as is. Its images were updated.`] };
  }
  if (!aePath || !exists(aePath)) {
    return { ok: false, aepPath: null, issues: [`After Effects wasn't found at ${aePath || "the path in the panel"}.`] };
  }
  const dir = await runFolder();
  if (!dir) {
    return { ok: false, aepPath: null, issues: ["There's no folder without spaces to run the After Effects script from."] };
  }
  await clearOldRuns(dir);

  const id = "run-" + Date.now();
  const startedPath = `${dir}\\${id}.started`;
  const resultPath = `${dir}\\${id}.result.json`;
  const source = options.aeSource || fs.readFileSync("plugin:/ae/build_visuals.jsx", { encoding: "utf-8" });
  const script = composeRunScript({ templatePath, outputPath, date, images, audio: audio || {}, resultPath, startedPath }, source);

  onProgress("Starting After Effects");
  await launch(aePath, dir, id, script, startedPath);
  const result = await waitFor(
    () => {
      if (exists(startedPath)) onProgress("After Effects is building the project");
      return exists(resultPath) ? JSON.parse(fs.readFileSync(url(resultPath), { encoding: "utf-8" })) : null;
    },
    { timeoutMs: options.timeoutMs || TIMEOUT_MS, intervalMs: POLL_MS, sleep }
  );

  if (!result) {
    return { ok: false, aepPath: null, issues: ["After Effects didn't finish within 12 minutes. Check it for an open dialog, then build again."] };
  }
  if (!result.ok) {
    return { ok: false, aepPath: null, issues: [result.error || "After Effects couldn't build the project.", ...(result.issues || [])] };
  }
  return { ok: true, aepPath: result.aepPath || outputPath, issues: result.issues || [] };
}

module.exports = { buildVisuals, runInAfterEffects };
