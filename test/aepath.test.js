const test = require("node:test");
const assert = require("node:assert/strict");
const { aeCandidates, findAfterEffects, isStandardAePath, resolveAePath } = require("../plugin/src/core/aepath");

const now = new Date("2026-11-22T00:00:00Z");
const ae = (year) => `C:\\Program Files\\Adobe\\Adobe After Effects ${year}\\Support Files\\AfterFX.exe`;
const only = (...paths) => (p) => paths.includes(p);

test("candidates run newest first and end with the beta", () => {
  const list = aeCandidates(now);
  assert.equal(list[0], ae(2028));
  assert.ok(list.indexOf(ae(2027)) < list.indexOf(ae(2026)));
  assert.equal(list[list.length - 1], ae("(Beta)"));
});

test("the newest installed version wins", () => {
  assert.equal(findAfterEffects(only(ae(2026), ae(2027)), now), ae(2027));
  assert.equal(findAfterEffects(only(ae(2025)), now), ae(2025));
  assert.equal(findAfterEffects(only(), now), null);
});

test("a remembered 2026 path moves to 2027 once 2026 is gone", () => {
  assert.equal(resolveAePath(ae(2026), only(ae(2027)), ae(2027), now), ae(2027));
});

test("a remembered standard path moves to a newer install even if it still exists", () => {
  assert.equal(resolveAePath(ae(2026), only(ae(2026), ae(2027)), ae(2027), now), ae(2027));
});

test("a hand-picked path is kept while it exists", () => {
  const custom = "D:\\Apps\\AE\\Support Files\\AfterFX.exe";
  assert.equal(resolveAePath(custom, only(custom, ae(2027)), ae(2027), now), custom);
  assert.equal(resolveAePath(custom, only(ae(2027)), ae(2027), now), ae(2027));
});

test("with nothing installed, the remembered path stays so the panel can name it", () => {
  assert.equal(resolveAePath(ae(2026), only(), ae(2027), now), ae(2026));
  assert.equal(resolveAePath("", only(), ae(2027), now), ae(2027));
});

test("standard paths are recognised regardless of case", () => {
  assert.ok(isStandardAePath(ae(2031)));
  assert.ok(isStandardAePath(ae(2026).toLowerCase()));
  assert.ok(!isStandardAePath("D:\\Apps\\AE\\Support Files\\AfterFX.exe"));
});
