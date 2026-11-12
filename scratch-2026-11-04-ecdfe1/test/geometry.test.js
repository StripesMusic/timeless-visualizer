const test = require("node:test");
const assert = require("node:assert/strict");
const { coverScale, fitInto, unionBounds, placeRow, boxWidth, boxHeight } = require("../plugin/src/core/geometry");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || `${a} != ${b}`);

test("coverScale fills the frame on the tighter side", () => {
  close(coverScale(3000, 3000, 1920, 1080), 0.64);
  close(coverScale(3000, 3000, 2480, 520), 2480 / 3000);
  close(coverScale(3000, 3000, 1080, 1920), 0.64);
  close(coverScale(5000, 3000, 1080, 1920), 0.64);
  close(coverScale(3000, 3000, 3000, 3000), 1);
});

test("fitInto right-aligns and centers vertically on the banner box", () => {
  const box = { left: 1964, top: 110, right: 2421, bottom: 410 };
  const src = { left: 0, top: 0, right: 1000, bottom: 200 };
  const r = fitInto(src, box, { alignX: "right" });
  close(r.scale, 0.457);
  close(src.right * r.scale + r.dx, 2421);
  close(((src.top + src.bottom) / 2) * r.scale + r.dy, 260);
});

test("fitInto centers horizontally by default and honors maxScale", () => {
  const box = { left: 249, top: 800, right: 830, bottom: 1036 };
  const src = { left: 100, top: 100, right: 200, bottom: 150 };
  const r = fitInto(src, box, { maxScale: 1 });
  close(r.scale, 1);
  close(((src.left + src.right) / 2) * r.scale + r.dx, 539.5);
  close(((src.top + src.bottom) / 2) * r.scale + r.dy, 918);
});

test("fitInto is limited by height when the lockup is tall", () => {
  const box = { left: 0, top: 0, right: 1000, bottom: 100 };
  const r = fitInto({ left: 0, top: 0, right: 100, bottom: 400 }, box, {});
  close(r.scale, 0.25);
});

test("unionBounds ignores zero-size entries such as adjustment layers", () => {
  assert.deepEqual(
    unionBounds([{ left: 0, top: 0, right: 0, bottom: 0 }, { left: 5, top: 5, right: 9, bottom: 9 }, { left: 2, top: 7, right: 6, bottom: 12 }]),
    { left: 2, top: 5, right: 9, bottom: 12 }
  );
});

test("unionBounds returns null when nothing has size", () => {
  assert.equal(unionBounds([{ left: 0, top: 0, right: 0, bottom: 0 }]), null);
});

test("placeRow starts right of existing boards with a 100 px gap", () => {
  const rects = placeRow([{ left: 0, top: 0, right: 3000, bottom: 3000 }], [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]);
  assert.deepEqual(rects[0], { left: 3100, top: 0, right: 5020, bottom: 1080 });
  assert.deepEqual(rects[1], { left: 5120, top: 0, right: 6200, bottom: 1920 });
});

test("placeRow copes with boards at negative coordinates, like TMLS044", () => {
  const rects = placeRow([{ left: -10467, top: 794, right: -7467, bottom: 3794 }, { left: 0, top: 0, right: 1080, bottom: 1920 }], [{ width: 100, height: 100 }]);
  assert.deepEqual(rects[0], { left: 1180, top: 0, right: 1280, bottom: 100 });
});

test("placeRow starts at the origin with no boards", () => {
  assert.equal(placeRow([], [{ width: 10, height: 10 }])[0].left, 0);
});

test("box helpers", () => {
  assert.equal(boxWidth({ left: 2, right: 10 }), 8);
  assert.equal(boxHeight({ top: 3, bottom: 5 }), 2);
});

test("stackLayout centers text with the logo under it, inside the box", () => {
  const { stackLayout } = require("../plugin/src/core/geometry");
  const text = { left: 100, top: 50, right: 1100, bottom: 250 };
  const logo = { left: 500, top: 900, right: 700, bottom: 1100 };
  const box = { left: 480, top: 243, right: 1440, bottom: 837 };
  const out = stackLayout(text, logo, box, 30);
  assert.ok(Math.abs(out.scale - 0.96) < 1e-9);
  const place = (b, m) => ({ left: b.left * out.scale + m.dx, top: b.top * out.scale + m.dy, right: b.right * out.scale + m.dx, bottom: b.bottom * out.scale + m.dy });
  const t = place(text, out.text);
  const l = place(logo, out.logo);
  assert.ok(Math.abs(t.left - 480) < 1e-6 && Math.abs(t.right - 1440) < 1e-6);
  assert.ok(Math.abs(t.top - 333) < 1e-6 && Math.abs(t.bottom - 525) < 1e-6);
  assert.ok(Math.abs(l.top - 555) < 1e-6 && Math.abs(l.bottom - 747) < 1e-6);
  assert.ok(Math.abs((l.left + l.right) / 2 - 960) < 1e-6);
});

test("stackLayout is limited by height when the stack is tall", () => {
  const { stackLayout } = require("../plugin/src/core/geometry");
  const out = stackLayout({ left: 0, top: 0, right: 100, bottom: 1000 }, { left: 0, top: 0, right: 100, bottom: 1000 }, { left: 0, top: 0, right: 1000, bottom: 530 }, 30);
  assert.ok(Math.abs(out.scale - 0.25) < 1e-9);
});

test("stackLayout with no logo just fits the text", () => {
  const { stackLayout } = require("../plugin/src/core/geometry");
  const out = stackLayout({ left: 0, top: 0, right: 100, bottom: 100 }, null, { left: 0, top: 0, right: 200, bottom: 400 }, 30);
  assert.equal(out.scale, 2);
  assert.equal(out.text.dx, 0);
  assert.equal(out.text.dy, 100);
  assert.equal(out.logo, null);
});

test("overlaps is true only when two boxes share area", () => {
  const { overlaps } = require("../plugin/src/core/geometry");
  const box = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(overlaps(box, { left: 50, top: 50, right: 150, bottom: 150 }), true);
  assert.equal(overlaps(box, { left: 100, top: 0, right: 200, bottom: 100 }), false);
  assert.equal(overlaps(box, { left: 0, top: 200, right: 100, bottom: 300 }), false);
  assert.equal(overlaps(box, null), false);
});
