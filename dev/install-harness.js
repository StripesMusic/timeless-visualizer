// Dev-only: installs or removes the harness plugin. Usage: node dev/install-harness.js [--remove]
const fs = require("fs");
const path = require("path");

const ID = "com.stripesmusic.tvdev";
const VER = "0.0.1";
const uxpRoot = path.join(process.env.APPDATA, "Adobe", "UXP");
const dest = path.join(uxpRoot, "Plugins", "External", `${ID}_${VER}`);
const registry = path.join(uxpRoot, "PluginsInfo", "v1", "PS.json");
const runDir = path.join(__dirname, "run").replace(/\\/g, "/");

const reg = JSON.parse(fs.readFileSync(registry, "utf8"));
reg.plugins = reg.plugins.filter((p) => p.pluginId !== ID);

if (process.argv.includes("--remove")) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.writeFileSync(registry, JSON.stringify(reg));
  console.log("removed harness");
  process.exit(0);
}

fs.mkdirSync(runDir, { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, "harness"), dest, { recursive: true });
const mainPath = path.join(dest, "main.js");
fs.writeFileSync(mainPath, fs.readFileSync(mainPath, "utf8").replace("__RUN_DIR__", runDir));
reg.plugins.push({
  hostMinVersion: "24.0.0",
  name: "TV Dev Harness",
  path: `$localPlugins\\External\\${ID}_${VER}`,
  pluginId: ID,
  status: "enabled",
  type: "uxp",
  versionString: VER,
});
fs.writeFileSync(registry, JSON.stringify(reg));
console.log("installed harness to", dest, "run dir", runDir);
