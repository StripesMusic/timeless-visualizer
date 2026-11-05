// The real Photoshop-facing pieces the panel runs on.
const fs = require("fs");
const uxp = require("uxp");
const { app } = require("photoshop");
const { runBuild } = require("./build");
const { listArtboards, selectionInfo, collectFonts } = require("./ps/doc");

function exists(path) {
  try {
    fs.lstatSync("file:" + path.replace(/\\/g, "/"));
    return true;
  } catch (e) {
    return false;
  }
}

async function pickFile(types) {
  const file = await uxp.storage.localFileSystem.getFileForOpening({ types });
  return file ? file.nativePath : null;
}

function realServices() {
  return {
    activeDocument: () => app.activeDocument || null,
    listArtboards,
    selectionInfo,
    collectFonts,
    exists,
    pickFile,
    runBuild,
    storage: window.localStorage,
  };
}

module.exports = { realServices };
