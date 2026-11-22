// Finds After Effects. Each yearly release installs into its own "Adobe After Effects <year>" folder,
// so a hard-coded year breaks as soon as a new version replaces the old one.
const AE_ROOT = "C:\\Program Files\\Adobe\\";
const AE_EXE = "\\Support Files\\AfterFX.exe";
const OLDEST_YEAR = 2024;

const aeExe = (folder) => AE_ROOT + folder + AE_EXE;

// Newest first: a couple of years past the current one, down to OLDEST_YEAR, then the beta.
function aeCandidates(now = new Date()) {
  const out = [];
  for (let year = now.getFullYear() + 2; year >= OLDEST_YEAR; year--) out.push(aeExe(`Adobe After Effects ${year}`));
  out.push(aeExe("Adobe After Effects (Beta)"));
  return out;
}

// The newest installed After Effects, or null when none of the usual places has one.
function findAfterEffects(exists, now) {
  return aeCandidates(now).find((p) => exists(p)) || null;
}

// True for the standard install folders aeCandidates looks in, so a path like that was filled in for
// the user rather than picked by hand.
function isStandardAePath(path) {
  return /^C:\\Program Files\\Adobe\\Adobe After Effects (\d{4}|\(Beta\))\\Support Files\\AfterFX\.exe$/i.test(String(path || ""));
}

// The path to use. A path the user picked by hand wins while it exists. A standard install path gives
// way to the newest installed version, so a new yearly release is picked up on its own. When nothing
// is found, keep the remembered (or fallback) path so the panel can say which file it couldn't find.
function resolveAePath(remembered, exists, fallback, now) {
  if (remembered && !isStandardAePath(remembered) && exists(remembered)) return remembered;
  return findAfterEffects(exists, now) || remembered || fallback;
}

module.exports = { aeCandidates, findAfterEffects, isStandardAePath, resolveAePath };
