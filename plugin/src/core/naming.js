// File and folder names derived from the PSD's name.

const COVER_TOKEN = "_CoverArtPSD";
const VISUALS_TOKEN = "_VisualsAEP";

function visualsName(psdBase) {
  if (psdBase.includes(COVER_TOKEN)) return psdBase.replace(COVER_TOKEN, VISUALS_TOKEN);
  return psdBase + VISUALS_TOKEN;
}

function assetsFolder(aepBase) {
  return aepBase + " Assets";
}

module.exports = { visualsName, assetsFolder };
