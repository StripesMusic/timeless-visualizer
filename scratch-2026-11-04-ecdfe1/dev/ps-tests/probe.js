// Scratch probe: saves the open document as a PSB copy to measure it. Not a test.
const uxp = require("uxp");
const { app } = require("photoshop");
const kit = require("./kit");
const a = require("../../plugin/src/ps/actions");
exports.run = async (arg, ctx) => {
  const log = ctx.log;
  const doc = app.activeDocument;
  const lfs = uxp.storage.localFileSystem;
  log("doc " + doc.name + " " + doc.width + "x" + doc.height);
  const folder = await lfs.getEntryWithUrl("file:" + arg.dir);
  const entry = await folder.createFile(arg.name, { overwrite: true });
  const started = Date.now();
  await kit.modal(async () => {
    const token = lfs.createSessionToken(entry);
    await a.play([{ _obj: "save", as: { _obj: "largeDocumentFormat", maximizeCompatibility: !!arg.compat }, in: { _path: token, _kind: "local" }, copy: true, lowerCase: true }]);
  });
  const meta = await entry.getMetadata();
  log("took " + Math.round((Date.now() - started) / 1000) + "s size " + Math.round(meta.size / 1048576) + " MB");
  return { size: meta.size };
};
