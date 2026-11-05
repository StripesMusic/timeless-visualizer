// Dev-only. Runs JS files from disk inside Photoshop so tests don't need clicks or a reload.
const fs = require("fs");
const uxp = require("uxp");
const ps = require("photoshop");

const RUN_DIR = "__RUN_DIR__"; // filled in by dev/install-harness.js, e.g. C:/.../dev/.run
const url = (p) => "file:" + p.replace(/\\/g, "/");

function writeJson(path, value) {
  fs.writeFileSync(url(path), JSON.stringify(value, null, 1), { encoding: "utf-8" });
}

function makeLoader(log) {
  const cache = new Map();
  const norm = (p) => {
    const out = [];
    p.replace(/\\/g, "/").split("/").forEach((s) => {
      if (s === "..") out.pop();
      else if (s !== "." && s !== "") out.push(s);
    });
    return out.join("/");
  };
  function load(abs) {
    let file = norm(abs);
    if (!/\.jsx?$/.test(file)) file += ".js";
    if (cache.has(file)) return cache.get(file).exports;
    const src = fs.readFileSync(url(file), { encoding: "utf-8" });
    const module = { exports: {} };
    cache.set(file, module);
    const dir = file.replace(/\/[^/]*$/, "");
    const req = (name) => {
      if (name.startsWith(".")) return load(dir + "/" + name);
      if (/^[A-Za-z]:/.test(name)) return load(name);
      return require(name);
    };
    const consoleShim = { log: (...a) => log(a.map(String).join(" ")), warn: (...a) => log("WARN " + a.join(" ")), error: (...a) => log("ERR " + a.join(" ")) };
    new Function("require", "module", "exports", "__dirname", "__filename", "console", src)(req, module, module.exports, dir, file, consoleShim);
    return module.exports;
  }
  return load;
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const names = fs.readdirSync(url(RUN_DIR)).filter((n) => /^cmd-.*\.json$/.test(n)).sort();
    if (names.length) {
      const path = RUN_DIR + "/" + names[0];
      const cmd = JSON.parse(fs.readFileSync(url(path), { encoding: "utf-8" }));
      await fs.unlink(url(path));
      const logs = [];
      const log = (s) => logs.push(s);
      const result = { id: cmd.id, ok: false, value: null, error: null, logs };
      writeJson(RUN_DIR + "/running-" + cmd.id + ".json", { started: Date.now() });
      try {
        const load = makeLoader(log);
        const mod = load(cmd.file);
        result.value = await mod.run(cmd.arg, { require: load, log, runDir: RUN_DIR });
        result.ok = !(result.value && result.value.failed > 0);
      } catch (e) {
        result.error = (e && (e.stack || e.message)) || String(e);
      }
      await fs.unlink(url(RUN_DIR + "/running-" + cmd.id + ".json"));
      writeJson(RUN_DIR + "/result-" + cmd.id + ".json", result);
    }
  } catch (e) {
    try { writeJson(RUN_DIR + "/harness-error.json", { message: String(e && e.message), at: Date.now() }); } catch (_) {}
  }
  busy = false;
}

try {
  writeJson(RUN_DIR + "/harness-loaded.json", { at: Date.now(), ps: ps.app.version, uxp: uxp.versions.uxp });
} catch (_) {}
setInterval(tick, 400);

const { entrypoints } = uxp;
entrypoints.setup({
  plugin: { create() {}, destroy() {} },
  panels: { tvdevPanel: { create() {}, show() {} } },
});
