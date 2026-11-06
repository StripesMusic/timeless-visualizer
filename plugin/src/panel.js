// Wires the panel to the build. Everything Photoshop-facing comes in through `services`, so a test
// can drive the real controls without clicking.
const { validateInputs, explainError } = require("./core/validate");
const { BOARDS } = require("./core/boards");

const STORE_KEY = "timelessVisualizer.paths";
const TEMPLATES_DIR = "A:\\Personal GDrive\\Media Assets\\Artwork Assets\\Templates\\";
const DEFAULT_PATHS = {
  flyer: TEMPLATES_DIR + "Timeless Flyer Social Template.psd",
  banner: TEMPLATES_DIR + "Timeless SC Banner Template.psd",
  visuals: TEMPLATES_DIR + "Timeless Visuals Template.aep",
  ae: "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe",
};
const PATH_FIELDS = [
  ["flyer", "pathFlyer", "chooseFlyer", ["psd"]],
  ["banner", "pathBanner", "chooseBanner", ["psd"]],
  ["visuals", "pathVisuals", "chooseVisuals", ["aep"]],
  ["ae", "pathAe", "chooseAe", ["exe"]],
];
const AUDIO_TYPES = ["wav", "mp3", "aif", "aiff", "m4a", "flac"];
const GENERATED = new Set(BOARDS.map((b) => b.name));

const baseName = (path) => path.replace(/^.*[\\/]/, "");

function loadPaths(storage) {
  try {
    return { ...DEFAULT_PATHS, ...JSON.parse(storage.getItem(STORE_KEY) || "{}") };
  } catch (e) {
    return { ...DEFAULT_PATHS };
  }
}

function documentPath(doc) {
  try {
    return doc.saved === false && !doc.path ? "" : String(doc.path || "");
  } catch (e) {
    return "";
  }
}

function fillPicker(root, menuId, labels) {
  const menu = root.querySelector("#" + menuId);
  while (menu.firstChild) menu.removeChild(menu.firstChild);
  labels.forEach((label) => {
    const item = root.createElement("sp-menu-item");
    item.textContent = label;
    menu.appendChild(item);
  });
}

function setDisabled(el, disabled) {
  if (disabled) el.setAttribute("disabled", "true");
  else el.removeAttribute("disabled");
}

function setList(root, id, lines) {
  const list = root.querySelector("#" + id);
  while (list.firstChild) list.removeChild(list.firstChild);
  lines.forEach((line) => {
    const row = root.createElement("sp-body");
    row.setAttribute("size", "XS");
    row.textContent = line;
    list.appendChild(row);
  });
}

function reportLines(report) {
  const lines = [];
  if (report.built.length) lines.push(`Built: ${report.built.join(", ")}`);
  if (report.skipped.length) lines.push(`Already there, left alone: ${report.skipped.join(", ")}`);
  if (report.aepPath) lines.push(`After Effects project: ${report.aepPath}`);
  report.issues.forEach((issue) => lines.push(issue));
  if (report.ok) lines.push("Nothing was saved in the PSD, so review it and save when you're happy.");
  return lines;
}

function createPanel(root, services) {
  const el = (id) => root.querySelector("#" + id);
  const paths = loadPaths(services.storage);
  const state = { docId: null, boards: [], textIds: [], logoIds: [], fonts: [], audio: { comingSoon: null, outNow: null }, busy: false };

  const selectedSource = () => {
    const index = el("source").selectedIndex;
    return index === undefined || index === null || index < 0 ? null : (state.sources || [])[index] || null;
  };
  const selectedFont = () => {
    const index = el("font").selectedIndex;
    return index === undefined || index === null || index < 0 ? null : state.fonts[index] || null;
  };

  function inputs() {
    const doc = services.activeDocument();
    if (!doc) return { noDocument: true };
    const source = selectedSource();
    return {
      doc,
      docPath: documentPath(doc),
      hasArtboards: state.boards.length > 0,
      sourceId: source ? source.id : null,
      textIds: state.textIds,
      logoIds: state.logoIds,
      fontChoices: state.fonts.length,
      font: selectedFont(),
      date: el("date").value,
      audio: state.audio,
      templates: { flyer: paths.flyer, banner: paths.banner, visuals: paths.visuals },
      aePath: paths.ae,
    };
  }

  function validate() {
    const problems = validateInputs(inputs(), services.exists);
    setList(root, "problems", state.busy ? [] : problems);
    setDisabled(el("build"), state.busy || problems.length > 0);
    return problems;
  }

  function showSources() {
    const doc = services.activeDocument();
    state.boards = doc ? services.listArtboards(doc) : [];
    const before = selectedSource();
    state.sources = state.boards;
    fillPicker(root, "sourceMenu", state.sources.map((b) => b.name));
    setDisabled(el("source"), state.sources.length === 0);
    el("sourceNote").textContent = doc && state.sources.length === 0 ? "No artboards yet, so the whole canvas is the source. Its layers get wrapped in Cover Art." : "";
    if (state.sources.length) {
      const keep = before ? state.sources.findIndex((b) => b.id === before.id) : -1;
      const firstOwn = state.sources.findIndex((b) => !GENERATED.has(b.name));
      el("source").selectedIndex = keep > -1 ? keep : Math.max(firstOwn, 0);
    }
  }

  function showFonts() {
    const seen = new Set();
    state.fonts = services.collectFonts(state.textIds).filter((f) => {
      if (seen.has(f.font)) return false;
      seen.add(f.font);
      return true;
    });
    fillPicker(root, "fontMenu", state.fonts.map((f) => f.font));
    setDisabled(el("font"), state.fonts.length === 0);
    if (state.fonts.length) el("font").selectedIndex = 0;
    el("fontNote").textContent = state.textIds.length && !state.fonts.length ? "No live text in your picks, so the template font stays." : "";
  }

  function resetForDocument() {
    state.textIds = [];
    state.logoIds = [];
    state.fonts = [];
    el("textNames").textContent = "Nothing picked";
    el("logoNames").textContent = "Nothing picked";
    showFonts();
    setList(root, "report", []);
  }

  function refresh() {
    if (state.busy) return;
    const doc = services.activeDocument();
    const id = doc ? doc.id : null;
    if (id !== state.docId) {
      state.docId = id;
      el("source").selectedIndex = -1;
      resetForDocument();
    }
    showSources();
    validate();
  }

  function pick(key, labelId) {
    const layers = services.selectionInfo();
    state[key] = layers.map((l) => l.id);
    el(labelId).textContent = layers.length ? layers.map((l) => l.name).join(", ") : "Nothing picked";
    if (key === "textIds") showFonts();
    validate();
  }

  async function chooseAudio(key, labelId) {
    const file = await services.pickFile(AUDIO_TYPES);
    if (!file) return;
    state.audio[key] = file;
    el(labelId).textContent = baseName(file);
  }

  function clearAudio(key, labelId) {
    state.audio[key] = null;
    el(labelId).textContent = "None";
  }

  function setPath(key, fieldId, value) {
    paths[key] = value;
    el(fieldId).value = value;
    services.storage.setItem(STORE_KEY, JSON.stringify(paths));
    validate();
  }

  async function build() {
    const current = inputs();
    if (validateInputs(current, services.exists).length) return;
    state.busy = true;
    validate();
    setList(root, "report", []);
    el("progress").classList.remove("hidden");
    el("progress").setAttribute("value", "0");
    const onProgress = (step, percent) => {
      el("status").textContent = step;
      el("progress").setAttribute("value", String(percent));
    };
    let report;
    try {
      report = await services.runBuild(current, onProgress);
    } catch (e) {
      report = { ok: false, built: [], skipped: [], aepPath: null, issues: [explainError(e)] };
    }
    state.busy = false;
    el("progress").classList.add("hidden");
    el("status").textContent = report.ok ? "Done" : "Finished with a problem";
    setList(root, "report", reportLines(report));
    showSources();
    validate();
    return report;
  }

  el("useText").addEventListener("click", () => pick("textIds", "textNames"));
  el("useLogo").addEventListener("click", () => pick("logoIds", "logoNames"));
  el("source").addEventListener("change", validate);
  el("font").addEventListener("change", validate);
  el("date").addEventListener("input", validate);
  el("audioComing").addEventListener("click", () => chooseAudio("comingSoon", "audioComingName"));
  el("audioOut").addEventListener("click", () => chooseAudio("outNow", "audioOutName"));
  el("audioComingClear").addEventListener("click", () => clearAudio("comingSoon", "audioComingName"));
  el("audioOutClear").addEventListener("click", () => clearAudio("outNow", "audioOutName"));
  el("build").addEventListener("click", build);
  for (const [key, fieldId, buttonId, types] of PATH_FIELDS) {
    el(fieldId).value = paths[key];
    el(fieldId).addEventListener("change", (event) => setPath(key, fieldId, event.target.value));
    el(buttonId).addEventListener("click", async () => {
      const file = await services.pickFile(types);
      if (file) setPath(key, fieldId, file);
    });
  }

  refresh();
  return { refresh, build, state };
}

module.exports = { createPanel, DEFAULT_PATHS, STORE_KEY };
