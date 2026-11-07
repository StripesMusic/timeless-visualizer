// Dev-only: installs a copy of the real plugin that runs dev/selftest/selftest.js when Photoshop starts,
// with the shipped manifest's permissions. Usage: node dev/install-selftest.js <config.json> | --remove
const fs = require("fs");
const path = require("path");

const ID = "com.stripesmusic.tvselftest";
const VER = "0.0.1";
const uxpRoot = path.join(process.env.APPDATA, "Adobe", "UXP");
const dest = path.join(uxpRoot, "Plugins", "External", `${ID}_${VER}`);
const registry = path.join(uxpRoot, "PluginsInfo", "v1", "PS.json");
const plugin = path.join(__dirname, "..", "plugin");

const reg = JSON.parse(fs.readFileSync(registry, "utf8"));
reg.plugins = reg.plugins.filter((p) => p.pluginId !== ID);

if (process.argv.includes("--remove")) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.writeFileSync(registry, JSON.stringify(reg));
  console.log("removed self test");
  process.exit(0);
}

const config = fs.readFileSync(process.argv[2], "utf8");
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(plugin, dest, { recursive: true });

const manifestPath = path.join(dest, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.id = ID;
manifest.name = "TV Self Test";
manifest.version = VER;
manifest.host.data.loadEvent = "startup";
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const script = fs.readFileSync(path.join(__dirname, "selftest", "selftest.js"), "utf8").replace("__CONFIG__", config.trim());
fs.writeFileSync(path.join(dest, "selftest.js"), script);
const htmlPath = path.join(dest, "index.html");
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, "utf8").replace('<script src="main.js"></script>', '<script src="main.js"></script>\n    <script src="selftest.js"></script>'));

reg.plugins.push({
  hostMinVersion: manifest.host.minVersion,
  name: manifest.name,
  path: `$localPlugins\\External\\${ID}_${VER}`,
  pluginId: ID,
  status: "enabled",
  type: "uxp",
  versionString: VER,
});
fs.writeFileSync(registry, JSON.stringify(reg));
console.log("installed self test to", dest);
