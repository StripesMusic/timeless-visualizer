// Plugin entry point.
const uxp = require("uxp");
const { action } = require("photoshop");
const { createPanel } = require("./src/panel");
const { realServices } = require("./src/services");

let panel = null;

// Photoshop sends these in bursts (a build or an action can fire hundreds), so refresh once things settle.
// Only select-only bursts get the quick refresh.
const SETTLE_MS = 300;
let timer = null;
let quick = true;
function scheduleRefresh(event) {
  if (event !== "select") quick = false;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const opts = { quick };
    timer = null;
    quick = true;
    if (panel) panel.refresh(opts);
  }, SETTLE_MS);
}

uxp.entrypoints.setup({
  panels: {
    timelessVisualizerPanel: {
      show() {
        if (panel) {
          panel.refresh();
          return;
        }
        panel = createPanel(document, realServices());
        action.addNotificationListener(["select", "open", "close", "make", "delete"], (event) => scheduleRefresh(event));
      },
    },
  },
});
