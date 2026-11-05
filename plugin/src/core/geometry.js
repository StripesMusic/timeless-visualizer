// Scale, fit and placement math. Bounds and boxes are {left, top, right, bottom}.

const boxWidth = (b) => b.right - b.left;
const boxHeight = (b) => b.bottom - b.top;

function coverScale(srcW, srcH, dstW, dstH) {
  return Math.max(dstW / srcW, dstH / srcH);
}

// Scale and offset that place `bounds` inside `box`: newX = x * scale + dx.
function fitInto(bounds, box, { maxScale = Infinity, alignX = "center" } = {}) {
  const scale = Math.min(boxWidth(box) / boxWidth(bounds), boxHeight(box) / boxHeight(bounds), maxScale);
  const dx = alignX === "right"
    ? box.right - bounds.right * scale
    : (box.left + box.right) / 2 - ((bounds.left + bounds.right) / 2) * scale;
  const dy = (box.top + box.bottom) / 2 - ((bounds.top + bounds.bottom) / 2) * scale;
  return { scale, dx, dy };
}

// Fits text with a logo under it into `box`, centered, with a fixed gap at final size.
// Each part moves by its own offset: newX = x * scale + part.dx.
function stackLayout(text, logo, box, gap) {
  if (!logo) {
    const { scale, dx, dy } = fitInto(text, box);
    return { scale, text: { dx, dy }, logo: null };
  }
  const scale = Math.min(
    boxWidth(box) / Math.max(boxWidth(text), boxWidth(logo)),
    (boxHeight(box) - gap) / (boxHeight(text) + boxHeight(logo))
  );
  const total = (boxHeight(text) + boxHeight(logo)) * scale + gap;
  const centerX = (box.left + box.right) / 2;
  const top = (box.top + box.bottom - total) / 2;
  const logoTop = top + boxHeight(text) * scale + gap;
  return {
    scale,
    text: { dx: centerX - ((text.left + text.right) / 2) * scale, dy: top - text.top * scale },
    logo: { dx: centerX - ((logo.left + logo.right) / 2) * scale, dy: logoTop - logo.top * scale },
  };
}

function unionBounds(list) {
  const real = list.filter((b) => boxWidth(b) > 0 && boxHeight(b) > 0);
  if (!real.length) return null;
  return {
    left: Math.min(...real.map((b) => b.left)),
    top: Math.min(...real.map((b) => b.top)),
    right: Math.max(...real.map((b) => b.right)),
    bottom: Math.max(...real.map((b) => b.bottom)),
  };
}

// Places new boards in a row to the right of everything that exists, top-aligned at y=0.
function placeRow(existingRects, sizes, gap = 100) {
  let x = existingRects.length ? Math.max(...existingRects.map((r) => r.right)) + gap : 0;
  return sizes.map(({ width, height }) => {
    const rect = { left: x, top: 0, right: x + width, bottom: height };
    x = rect.right + gap;
    return rect;
  });
}

const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

module.exports = { coverScale, fitInto, stackLayout, unionBounds, placeRow, overlaps, boxWidth, boxHeight };
