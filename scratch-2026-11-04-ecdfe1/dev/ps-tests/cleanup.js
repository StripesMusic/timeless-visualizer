// Closes documents left open by a failed test run, by name only.
const { app, core } = require("photoshop");
exports.run = async (arg) => {
  const names = (arg && arg.names) || [];
  const closed = [];
  await core.executeAsModal(async () => {
    for (const d of Array.from(app.documents)) {
      if (/^TV Helper/.test(d.name) || names.includes(d.name)) { closed.push(d.name); await d.closeWithoutSaving(); }
    }
  }, { commandName: "TV cleanup" });
  return { closed, left: Array.from(app.documents).map((d) => d.name) };
};
