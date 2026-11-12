// What still stands between the panel and a Build. An empty list means ready.

const TEMPLATE_LABELS = [
  ["flyer", "flyer"],
  ["banner", "SoundCloud banner"],
  ["visuals", "Visuals"],
];

function validateInputs(inputs, exists) {
  if (inputs.noDocument) return ["Open a PSD first."];
  const { docPath, hasArtboards, sourceId, textIds, logoIds, fontChoices, font, date, templates, aePath } = inputs;
  const out = [];
  if (!docPath) out.push("Save the PSD first.");
  if (hasArtboards && !sourceId) out.push("Pick the source art.");
  if (!textIds.length) out.push("Pick the text layers, then click Use selection.");
  if (!logoIds.length) out.push("Pick the logo layers, then click Use selection.");
  if (textIds.some((id) => logoIds.includes(id))) out.push("A layer can't be both Text and Logo.");
  if (fontChoices > 0 && !font) out.push("Pick the font to match.");
  if (!date || !date.trim()) out.push("Enter the release date.");
  for (const [key, label] of TEMPLATE_LABELS) {
    if (!templates[key]) out.push(`Set the ${label} template path.`);
    else if (!exists(templates[key])) out.push(`Can't find the ${label} template: ${templates[key]}`);
  }
  if (!aePath) out.push("Set the After Effects path.");
  else if (!exists(aePath)) out.push(`Can't find After Effects: ${aePath}`);
  return out;
}

// Photoshop can't open a document tab while minimized, and its own message points at the wrong setting.
function explainError(message) {
  if (/enough room to dock/i.test(message)) {
    return "Photoshop can't open another document while its window is minimized. Restore the window and build again.";
  }
  return message;
}

module.exports = { validateInputs, explainError };
