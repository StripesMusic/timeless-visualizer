const test = require("node:test");
const assert = require("node:assert/strict");
const { validateInputs } = require("../plugin/src/core/validate");

const ready = {
  docPath: "C:\\Art\\TMLS047_CoverArtPSD.psd",
  hasArtboards: true,
  sourceId: 5,
  textIds: [1],
  logoIds: [2],
  fontChoices: 1,
  font: { font: "ArialMT", color: { red: 1, green: 2, blue: 3 } },
  date: "28 AUG 2026",
  templates: { flyer: "C:\\T\\flyer.psd", banner: "C:\\T\\banner.psd", visuals: "C:\\T\\visuals.aep" },
  aePath: "C:\\AE\\AfterFX.exe",
};
const allExist = () => true;

test("no messages when everything is ready", () => {
  assert.deepEqual(validateInputs(ready, allExist), []);
});

test("a PSD that was never saved", () => {
  assert.ok(validateInputs({ ...ready, docPath: "" }, allExist).includes("Save the PSD first."));
  assert.ok(validateInputs({ ...ready, docPath: null }, allExist).includes("Save the PSD first."));
});

test("no document open", () => {
  assert.deepEqual(validateInputs({ ...ready, noDocument: true }, allExist), ["Open a PSD first."]);
});

test("source art is needed when the PSD has artboards", () => {
  assert.ok(validateInputs({ ...ready, sourceId: null }, allExist).includes("Pick the source art."));
});

test("source art isn't needed when the PSD has no artboards", () => {
  assert.deepEqual(validateInputs({ ...ready, hasArtboards: false, sourceId: null }, allExist), []);
});

test("missing Text picks", () => {
  assert.ok(validateInputs({ ...ready, textIds: [] }, allExist).includes("Pick the text layers, then click Use selection."));
});

test("missing Logo picks", () => {
  assert.ok(validateInputs({ ...ready, logoIds: [] }, allExist).includes("Pick the logo layers, then click Use selection."));
});

test("the same layer picked as Text and Logo", () => {
  assert.ok(validateInputs({ ...ready, textIds: [1, 2], logoIds: [2] }, allExist).includes("A layer can't be both Text and Logo."));
});

test("a font has to be picked when the Text picks have live text", () => {
  assert.ok(validateInputs({ ...ready, font: null }, allExist).includes("Pick the font to match."));
});

test("no font is needed when the Text picks have no live text", () => {
  assert.deepEqual(validateInputs({ ...ready, font: null, fontChoices: 0 }, allExist), []);
});

test("empty date", () => {
  for (const date of ["", "   ", null]) {
    assert.ok(validateInputs({ ...ready, date }, allExist).includes("Enter the release date."));
  }
});

test("missing template files name the file", () => {
  const out = validateInputs(ready, (p) => !p.includes("banner"));
  assert.deepEqual(out, ["Can't find the SoundCloud banner template: C:\\T\\banner.psd"]);
  assert.ok(validateInputs(ready, (p) => !p.includes("flyer"))[0].startsWith("Can't find the flyer template:"));
  assert.ok(validateInputs(ready, (p) => !p.includes("visuals"))[0].startsWith("Can't find the Visuals template:"));
});

test("a blank template path counts as missing", () => {
  const out = validateInputs({ ...ready, templates: { ...ready.templates, flyer: "" } }, allExist);
  assert.deepEqual(out, ["Set the flyer template path."]);
});

test("missing AE", () => {
  const out = validateInputs(ready, (p) => !p.includes("AfterFX"));
  assert.deepEqual(out, ["Can't find After Effects: C:\\AE\\AfterFX.exe"]);
  assert.deepEqual(validateInputs({ ...ready, aePath: "" }, allExist), ["Set the After Effects path."]);
});

test("messages come back in the panel's order", () => {
  const out = validateInputs({ ...ready, sourceId: null, textIds: [], date: "" }, allExist);
  assert.deepEqual(out, ["Pick the source art.", "Pick the text layers, then click Use selection.", "Enter the release date."]);
});

test("explainError turns Photoshop's docking error into what to do", () => {
  const { explainError } = require("../plugin/src/core/validate");
  const raw = "Could not complete the Open command because there isn't enough room to dock it on this monitor. Try turning off Open Documents as Tabs in the Workspace Preference panel.";
  assert.equal(explainError(raw), "Photoshop can't open another document while its window is minimized. Restore the window and build again.");
});

test("explainError leaves other messages alone", () => {
  const { explainError } = require("../plugin/src/core/validate");
  assert.equal(explainError("Can't open the template: C:\\x.psd"), "Can't open the template: C:\\x.psd");
});
