const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS, TEMPLATE_LAYOUT, boardByName } = require("../plugin/src/core/boards");

test("the 7 boards, in the spec's order", () => {
  assert.deepEqual(BOARDS.map((b) => b.name), [
    "BGSquare", "SoundCloudBanner", "YouTubeThumbnail", "FlyerComingSoon", "FlyerOutNow", "BGLandscape", "BGPortrait",
  ]);
});

test("spec sizes; BGSquare takes the source size", () => {
  const size = (n) => { const b = boardByName(n); return [b.width, b.height]; };
  assert.deepEqual(size("BGSquare"), [null, null]);
  assert.deepEqual(size("SoundCloudBanner"), [2480, 520]);
  assert.deepEqual(size("YouTubeThumbnail"), [1920, 1080]);
  assert.deepEqual(size("FlyerComingSoon"), [1080, 1920]);
  assert.deepEqual(size("FlyerOutNow"), [1080, 1920]);
  assert.deepEqual(size("BGLandscape"), [1920, 1080]);
  assert.deepEqual(size("BGPortrait"), [1080, 1920]);
});

test("what each board keeps from the source", () => {
  const keep = (n) => { const b = boardByName(n); return [b.keepText, b.keepLogo]; };
  assert.deepEqual(keep("BGSquare"), [false, false]);
  assert.deepEqual(keep("SoundCloudBanner"), [true, false]);
  assert.deepEqual(keep("YouTubeThumbnail"), [true, true]);
  assert.deepEqual(keep("FlyerComingSoon"), [true, false]);
  assert.deepEqual(keep("FlyerOutNow"), [true, false]);
  assert.deepEqual(keep("BGLandscape"), [false, false]);
  assert.deepEqual(keep("BGPortrait"), [false, false]);
});

test("template pieces and wording per board", () => {
  assert.equal(boardByName("SoundCloudBanner").template, "banner");
  assert.equal(boardByName("FlyerComingSoon").template, "flyer");
  assert.equal(boardByName("FlyerComingSoon").flyerWording, "COMING SOON");
  assert.equal(boardByName("FlyerOutNow").template, "flyer");
  assert.equal(boardByName("FlyerOutNow").flyerWording, "OUT NOW");
  assert.equal(boardByName("BGSquare").template, null);
});

test("lockup boxes pin the spec's values", () => {
  assert.deepEqual(TEMPLATE_LAYOUT.banner.lockupBox, { left: 1964, top: 110, right: 2421, bottom: 410 });
  assert.equal(TEMPLATE_LAYOUT.banner.alignX, "right");
  assert.deepEqual(TEMPLATE_LAYOUT.flyer.lockupBox, { left: 249, top: 800, right: 830, bottom: 1036 });
  assert.equal(TEMPLATE_LAYOUT.flyer.alignX, "center");
  assert.deepEqual(TEMPLATE_LAYOUT.youtube.lockupBox, { left: 480, top: 243, right: 1440, bottom: 837 });
  assert.equal(TEMPLATE_LAYOUT.youtube.logoGap, 30);
});

test("template layer names match the real PSDs", () => {
  assert.deepEqual(TEMPLATE_LAYOUT.banner.copyLayers, ["Out Now", "Ellipse 2 copy", "Timeless"]);
  assert.deepEqual(TEMPLATE_LAYOUT.flyer.copyLayers, ["COMING SOON", "Timeless"]);
  assert.equal(TEMPLATE_LAYOUT.banner.outNowTextLayer, "OUT NOW ON TIMELESS");
});
