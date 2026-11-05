// Plugin entry point.
const uxp = require("uxp");
const { action } = require("photoshop");
const { createPanel } = require("./src/panel");
const { realServices } = require("./src/services");

let panel = null;

uxp.entrypoints.setup({
  panels: {
    timelessVisualizerPanel: {
      show() {
        if (panel) {
          panel.refresh();
          return;
        }
        panel = createPanel(document, realServices());
        action.addNotificationListener(["select", "open", "close", "make", "delete"], () => panel.refresh());
      },
    },
  },
});
