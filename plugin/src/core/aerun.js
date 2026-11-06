// Builds the two text files that get After Effects to run our script.

// AE 26.5 quits silently if the -r path is quoted, so the path has to be safe to pass bare.
const BARE_SAFE = /^[^\s&|<>^%"()]+$/;

// Full paths, because PATH can put another program called find first (Git's, for one).
const TASKLIST = '"%SystemRoot%\\System32\\tasklist.exe"';
const FIND = '"%SystemRoot%\\System32\\find.exe"';
const PING = '"%SystemRoot%\\System32\\PING.EXE"';

function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function composeRunScript(settings, source) {
  return "var TV_SETTINGS = " + asciiJson(settings) + ";\n" + source;
}

function pickRunDir(candidates) {
  return candidates.find((dir) => BARE_SAFE.test(dir)) || null;
}

// A cold `AfterFX -r` runs the script and then closes AE, so when AE is closed the batch file
// opens it plainly first. Sent to an open AE, -r runs and AE stays open.
// A cold start can take minutes, and a -r sent while AE is still loading is dropped. So the batch
// file waits for the project in AE's window title, then resends until the script reports it started.
function batchFileText(afxPath, scriptPath, startedPath) {
  if (!startedPath) throw new Error("The launcher needs a started file path.");
  [scriptPath, startedPath].forEach((p) => {
    if (!BARE_SAFE.test(p)) throw new Error("The AE script path can't contain spaces or symbols: " + p);
  });
  const afx = afxPath.replace(/%/g, "%%");
  return [
    "@echo off",
    "chcp 65001 >nul",
    "title Timeless Visualizer",
    `${TASKLIST} /FI "IMAGENAME eq AfterFX.exe" /FO CSV /NH | ${FIND} /I "AfterFX.exe" >nul`,
    "if not errorlevel 1 goto waitready",
    "echo Starting After Effects for Timeless Visualizer. This can take a few minutes.",
    `start "" "${afx}"`,
    ":waitready",
    "set /a tries=0",
    "set /a steady=0",
    // A cold AE shows "Untitled Project.aep" in its title while it's still loading and not responding,
    // and a script sent then is lost (TMLS047, 2026-11-06). So the project window has to be there and
    // answering on three checks in a row, about 6 seconds, before the script goes.
    ":wait",
    `${TASKLIST} /V /FI "IMAGENAME eq AfterFX.exe" /FI "STATUS ne NOT RESPONDING" /FO CSV /NH | ${FIND} /I ".aep" >nul`,
    "if errorlevel 1 goto notyet",
    "set /a steady+=1",
    "if %steady% geq 3 goto ready",
    "goto nextcheck",
    ":notyet",
    "set /a steady=0",
    ":nextcheck",
    `${PING} -n 3 127.0.0.1 >nul`,
    "set /a tries+=1",
    "if %tries% lss 150 goto wait",
    "echo After Effects didn't finish opening.",
    "exit /b 1",
    ":ready",
    "set /a sends=0",
    ":send",
    `start "" "${afx}" -r ${scriptPath}`,
    "set /a sends+=1",
    "set /a checks=0",
    ":check",
    `${PING} -n 3 127.0.0.1 >nul`,
    `if exist "${startedPath}" exit /b 0`,
    "set /a checks+=1",
    "if %checks% lss 10 goto check",
    "if %sends% lss 15 goto send",
    "echo After Effects didn't run the script.",
    "exit /b 1",
    "",
  ].join("\r\n");
}

// Photoshop runs this to start the batch file without showing its script warning.
function launchStubText(batPath) {
  return "(function(){new File(" + asciiJson(batPath.replace(/\\/g, "/")) + ").execute();})();\n";
}

async function waitFor(check, { timeoutMs, intervalMs, now = Date.now, sleep }) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

module.exports = { composeRunScript, batchFileText, pickRunDir, asciiJson, launchStubText, waitFor };
