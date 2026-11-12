// Font, color and wording changes on live text.
const { app } = require("photoshop");
const { findLayer } = require("./doc");
const { boxWidth } = require("../core/geometry");
const a = require("./actions");

function solidColor({ red, green, blue }) {
  const color = new app.SolidColor();
  color.rgb.red = red;
  color.rgb.green = green;
  color.rgb.blue = blue;
  return color;
}

// Changes every run of the text. With fitWidth, scales the layer about its center to that width.
async function applyFont(ids, { font, color }, { fitWidth } = {}) {
  for (const id of ids) {
    const layer = findLayer(app.activeDocument.layers, id);
    const style = layer.textItem.characterStyle;
    style.font = font;
    if (color) style.color = solidColor(color);
    if (fitWidth) {
      const b = a.boundsOf(layer);
      const scale = fitWidth / boxWidth(b);
      const cx = (b.left + b.right) / 2;
      const cy = (b.top + b.bottom) / 2;
      await a.transformLayers([id], { scale, dx: cx - cx * scale, dy: cy - cy * scale });
    }
  }
}

// Replaces the words, keeps the layer's size and style, and keeps it centered on x.
async function setWording(id, words, centerX) {
  const layer = findLayer(app.activeDocument.layers, id);
  layer.textItem.contents = words;
  await a.renameLayer(id, words);
  const b = a.boundsOf(layer);
  await layer.translate(centerX - (b.left + b.right) / 2, 0);
}

module.exports = { applyFont, setWording };
