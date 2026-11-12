// One Build: the artboards, then the helper images, then the After Effects project.
const { buildArtboards } = require("./ps/engine");
const { exportHelpers, ensureFolder } = require("./ps/helpers");
const { buildVisuals } = require("./ae/bridge");
const { visualsName, assetsFolder } = require("./core/naming");
const { explainError } = require("./core/validate");

function splitPath(path) {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const file = path.slice(cut + 1);
  return { dir: path.slice(0, cut), base: file.replace(/\.[^.]*$/, "") };
}

// Each step stands on the one before. A failed artboard build changes nothing in the document. Later
// failures leave the boards in place, since they're fine and a re-run only fills in what's missing.
async function runBuild(inputs, onProgress = () => {}, options = {}) {
  const { doc, sourceId, textIds, logoIds, font, date, audio, templates, aePath } = inputs;
  const report = { ok: false, built: [], skipped: [], issues: [], aepPath: null };
  const { dir, base } = splitPath(String(doc.path));
  const aepBase = visualsName(base);

  onProgress("Building artboards", 2);
  let boards;
  try {
    boards = await buildArtboards(
      { doc, sourceId, textIds, logoIds, font, flyer: templates.flyer, banner: templates.banner },
      (name, done, total) => onProgress(`Built ${name}`, 2 + Math.round((60 * done) / total))
    );
  } catch (e) {
    report.issues.push(`The artboards couldn't be built, so the PSD wasn't changed: ${explainError(e.message)}`);
    return report;
  }
  report.built = boards.built;
  report.skipped = boards.skipped;
  report.issues.push(...boards.issues);

  onProgress("Saving images for After Effects", 65);
  let images;
  try {
    const folder = await ensureFolder(`${dir}\\${assetsFolder(aepBase)}`);
    images = await exportHelpers(doc, folder, { sourceId: boards.sourceId, textIds });
  } catch (e) {
    report.issues.push(`The artboards are built, but the images for After Effects couldn't be saved: ${explainError(e.message)}`);
    return report;
  }

  onProgress("Starting After Effects", 80);
  const visuals = await buildVisuals(
    { aePath, templatePath: templates.visuals, outputPath: `${dir}\\${aepBase}.aep`, date, images, audio: audio || {} },
    (step) => onProgress(step, 88),
    options
  );
  report.issues.push(...visuals.issues);
  report.aepPath = visuals.aepPath;
  report.ok = visuals.ok;
  onProgress(visuals.ok ? "Done" : "Finished with a problem", 100);
  return report;
}

module.exports = { runBuild };
