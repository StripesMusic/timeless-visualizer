// Dev-only: run a file inside Photoshop through the harness and print the result.
// Usage: node dev/ps.js <file.js> [jsonArg] [--timeout=seconds]
const fs = require("fs");
const path = require("path");

const runDir = path.join(__dirname, "run");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--timeout="));
const timeoutArg = process.argv.find((a) => a.startsWith("--timeout="));
const timeoutMs = (timeoutArg ? Number(timeoutArg.split("=")[1]) : 120) * 1000;
const file = path.resolve(args[0]).replace(/\\/g, "/");
const arg = args[1] ? JSON.parse(args[1]) : null;
const id = Date.now().toString(36);

fs.mkdirSync(runDir, { recursive: true });
const tmp = path.join(runDir, `tmp-${id}`);
fs.writeFileSync(tmp, JSON.stringify({ id, file, arg }));
fs.renameSync(tmp, path.join(runDir, `cmd-${id}.json`));

const resultPath = path.join(runDir, `result-${id}.json`);
const started = Date.now();
const timer = setInterval(() => {
  if (fs.existsSync(resultPath)) {
    clearInterval(timer);
    const r = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    fs.unlinkSync(resultPath);
    if (r.logs && r.logs.length) console.log(r.logs.join("\n"));
    if (r.error) console.log("ERROR:\n" + r.error);
    console.log(JSON.stringify(r.value, null, 1));
    console.log(r.ok ? "OK" : "FAILED");
    process.exit(r.ok ? 0 : 1);
  }
  if (Date.now() - started > timeoutMs) {
    clearInterval(timer);
    const left = fs.existsSync(path.join(runDir, `cmd-${id}.json`));
    console.log(`TIMEOUT after ${timeoutMs / 1000}s; command ${left ? "was never picked up (harness not running?)" : "is still running in Photoshop"}`);
    process.exit(2);
  }
}, 250);
