// Closes only documents saved under the scratch folder, plus unsaved TV Helper temp documents.
// Checks the full path, because a test copy can share its filename with a real file.
const { app, core } = require("photoshop");

exports.run = async (arg) => {
  const root = arg.root.replace(/\//g, "\\").toLowerCase();
  const closed = [];
  const kept = [];
  await core.executeAsModal(
    async () => {
      for (const d of Array.from(app.documents)) {
        let path = "";
        try {
          path = String(d.path || "");
        } catch (e) {
          path = "";
        }
        if (path.toLowerCase().startsWith(root) || (!path && /^TV Helper/.test(d.name))) {
          closed.push(d.name);
          await d.closeWithoutSaving();
        } else {
          kept.push(d.name);
        }
      }
    },
    { commandName: "TV cleanup" }
  );
  return { closed, kept };
};
