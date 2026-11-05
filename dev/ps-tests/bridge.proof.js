// Proves: panel code -> batchPlay runs a JSX stub -> File.execute runs the batch file -> AE runs our script.
// Usage: node dev/ps.js dev/ps-tests/bridge.proof.js "{\"afx\":\"C:/.../AfterFX.exe\"}" --timeout=150
const fs = require("fs");
const uxp = require("uxp");
const ps = require("photoshop");

const url = (p) => "file:" + p.replace(/\\/g, "/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function exists(p) {
  try {
    fs.lstatSync(url(p));
    return true;
  } catch (_) {
    return false;
  }
}

exports.run = async (arg, ctx) => {
  const { batchFileText, pickRunDir, asciiJson } = ctx.require(ctx.runDir + "/../../plugin/src/core/aerun.js");
  const lfs = uxp.storage.localFileSystem;
  const data = (await lfs.getDataFolder()).nativePath.replace(/[\\/]+$/, "");
  ctx.log("data folder: " + data);
  const dir = pickRunDir([data]);
  if (!dir) return { failed: 1, reason: "data folder isn't safe for AE: " + data };

  const pong = dir + "\\pong.txt";
  const aeScript = dir + "\\ae_pong.jsx";
  const bat = dir + "\\launch.bat";
  const stub = dir + "\\launch_stub.jsx";
  if (exists(pong)) await fs.unlink(url(pong));

  fs.writeFileSync(
    url(aeScript),
    "(function(){var f=new File(" + asciiJson(pong.replace(/\\/g, "/")) + ");f.open('w');f.writeln('pong '+app.version);f.close();})();\n",
    { encoding: "utf-8" }
  );
  fs.writeFileSync(url(bat), batchFileText(arg.afx.replace(/\//g, "\\"), aeScript, pong), { encoding: "utf-8" });
  fs.writeFileSync(
    url(stub),
    "(function(){new File(" + asciiJson(bat.replace(/\\/g, "/")) + ").execute();})();\n",
    { encoding: "utf-8" }
  );

  const entry = await lfs.getEntryWithUrl(url(stub));
  const token = lfs.createSessionToken(entry);
  const started = Date.now();
  let stubResult;
  await ps.core.executeAsModal(
    async () => {
      stubResult = await ps.action.batchPlay(
        [{ _obj: "AdobeScriptAutomation Scripts", javaScript: { _path: token, _kind: "local" }, javaScriptMessage: "TV", _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false }
      );
    },
    { commandName: "TV bridge proof" }
  );
  const stubMs = Date.now() - started;
  ctx.log("stub returned after " + stubMs + " ms: " + JSON.stringify(stubResult));

  const limit = (arg.seconds || 90) * 1000;
  while (Date.now() - started < limit) {
    if (exists(pong)) {
      const text = fs.readFileSync(url(pong), { encoding: "utf-8" }).trim();
      return { failed: 0, pong: text, stubMs, totalMs: Date.now() - started, dir };
    }
    await sleep(500);
  }
  return { failed: 1, reason: "no pong within " + limit / 1000 + "s", stubMs, dir };
};
