const test = require("node:test");
const assert = require("node:assert/strict");
const { visualsName, assetsFolder } = require("../plugin/src/core/naming");

test("swaps _CoverArtPSD for _VisualsAEP", () => {
  assert.equal(visualsName("TMLS047_NANDAN_SayYoureSorry_CoverArtPSD"), "TMLS047_NANDAN_SayYoureSorry_VisualsAEP");
});

test("keeps a version suffix", () => {
  assert.equal(visualsName("TMLS044_Maulik_SheWantsToParty_CoverArtPSD_V1"), "TMLS044_Maulik_SheWantsToParty_VisualsAEP_V1");
});

test("appends when the token is missing", () => {
  assert.equal(visualsName("Random Art"), "Random Art_VisualsAEP");
});

test("keeps special characters in release names", () => {
  assert.equal(visualsName("TMLS043_Bukkoy&Ray_FlyingSoHigh_CoverArtPSD_V1"), "TMLS043_Bukkoy&Ray_FlyingSoHigh_VisualsAEP_V1");
  assert.equal(visualsName("TMLS049_IØNITH_CutYouDeep_CoverArtPSD"), "TMLS049_IØNITH_CutYouDeep_VisualsAEP");
});

test("assets folder sits beside the AEP under a matching name", () => {
  assert.equal(assetsFolder("X_VisualsAEP"), "X_VisualsAEP Assets");
});
