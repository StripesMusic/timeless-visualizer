const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePicks, isWithin } = require("../plugin/src/core/picks");

const tree = [
  { id: 1 },
  { id: 2, layers: [{ id: 3 }, { id: 4 }] },
  { id: 5, layers: [{ id: 6, layers: [{ id: 7 }] }] },
  { id: 8 },
];

test("a pick maps to its position in the stack", () => {
  assert.deepEqual(resolvePicks(tree, [3]), { paths: [[1, 0]], missing: [] });
});

test("a group plus its own child counts once, as the group", () => {
  assert.deepEqual(resolvePicks(tree, [3, 2]).paths, [[1]]);
});

test("picking every child of a group counts as the group, so no empty group is left behind", () => {
  assert.deepEqual(resolvePicks(tree, [3, 4]).paths, [[1]]);
  assert.deepEqual(resolvePicks(tree, [7]).paths, [[2]]);
});

test("scattered picks come back in stack order", () => {
  assert.deepEqual(resolvePicks(tree, [8, 3, 1]).paths, [[0], [1, 0], [3]]);
});

test("the same id twice counts once", () => {
  assert.deepEqual(resolvePicks(tree, [1, 1]).paths, [[0]]);
});

test("a pick that isn't in the tree is reported", () => {
  assert.deepEqual(resolvePicks(tree, [99, 1]), { paths: [[0]], missing: [99] });
});

test("a group with no layers isn't treated as fully picked", () => {
  assert.deepEqual(resolvePicks([{ id: 1, layers: [] }, { id: 2 }], [2]).paths, [[1]]);
});

test("isWithin spots a path inside another, or the same path", () => {
  assert.equal(isWithin([1, 0], [1]), true);
  assert.equal(isWithin([1], [1]), true);
  assert.equal(isWithin([1], [1, 0]), false);
  assert.equal(isWithin([2, 0], [1]), false);
});
