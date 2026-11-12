const test = require("node:test");
const assert = require("node:assert/strict");
const { composeRunScript, batchFileText, pickRunDir } = require("../plugin/src/core/aerun");

const AFX = "C:\\AE\\AfterFX.exe";
const SCRIPT = "C:\\run\\run.jsx";
const STARTED = "C:\\run\\run.started";

test("run script carries settings as pure ASCII", () => {
  const script = composeRunScript({ name: "IØNITH & Joe\n", path: "C:\\A\\B" }, "SOURCE();");
  assert.ok(/^[\x00-\x7f]*$/.test(script));
  assert.ok(script.endsWith("SOURCE();"));
  const value = new Function(script.replace("SOURCE();", "") + "; return TV_SETTINGS;")();
  assert.equal(value.name, "IØNITH & Joe\n");
  assert.equal(value.path, "C:\\A\\B");
});

test("batch file passes the script path bare", () => {
  const bat = batchFileText("C:\\Program Files\\Adobe\\AfterFX.exe", "C:\\Users\\me\\run.jsx", STARTED);
  assert.ok(bat.includes('start "" "C:\\Program Files\\Adobe\\AfterFX.exe" -r C:\\Users\\me\\run.jsx'));
  assert.ok(!bat.includes('-r "'));
});

test("batch file opens AE first when it's closed, then sends the script", () => {
  const lines = batchFileText(AFX, SCRIPT, STARTED).split("\r\n");
  const plain = lines.indexOf(`start "" "${AFX}"`);
  const send = lines.indexOf(`start "" "${AFX}" -r ${SCRIPT}`);
  assert.ok(plain > -1, "plain launch line");
  assert.ok(send > plain, "script is sent after the plain launch");
  assert.ok(lines.some((l) => /tasklist\.exe" .*AfterFX\.exe/.test(l) && /find\.exe" \/I "AfterFX\.exe"/.test(l)), "checks whether AE is running");
});

test("batch file waits for the project window, because AE's loading windows appear long before it can run scripts", () => {
  const lines = batchFileText(AFX, SCRIPT, STARTED).split("\r\n");
  const check = lines.findIndex((l) => /tasklist\.exe" \/V/.test(l) && /find\.exe" \/I "\.aep"/.test(l));
  const send = lines.indexOf(`start "" "${AFX}" -r ${SCRIPT}`);
  assert.ok(check > -1, "looks for .aep in AE's window title");
  assert.ok(send > check, "only sends once the project window is up");
  assert.ok(!lines.some((l) => /Adobe After Effects"/.test(l)), "doesn't accept any window with AE's name");
});

test("batch file also waits when AE is already running, since it may still be loading", () => {
  const lines = batchFileText(AFX, SCRIPT, STARTED).split("\r\n");
  const running = lines.findIndex((l) => /find\.exe" \/I "AfterFX\.exe"/.test(l));
  assert.equal(lines[running + 1], "if not errorlevel 1 goto waitready");
  assert.ok(lines.includes(":waitready"));
  assert.ok(lines.indexOf(":waitready") < lines.indexOf(`start "" "${AFX}" -r ${SCRIPT}`));
  assert.ok(lines.indexOf(":waitready") > lines.indexOf(`start "" "${AFX}"`), "skips the plain launch");
});

test("batch file resends the script until the run reports it started", () => {
  const lines = batchFileText(AFX, SCRIPT, STARTED).split("\r\n");
  const label = lines.indexOf(":send");
  const send = lines.indexOf(`start "" "${AFX}" -r ${SCRIPT}`);
  const done = lines.indexOf(`if exist "${STARTED}" exit /b 0`);
  const again = lines.indexOf("if %sends% lss 15 goto send");
  assert.ok(label > -1 && label < send, "send has a label to come back to");
  assert.ok(done > send, "stops as soon as the started file exists");
  assert.ok(again > done, "tries again, a limited number of times");
});

test("batch file waits without needing a console", () => {
  const bat = batchFileText(AFX, SCRIPT, STARTED);
  assert.ok(!/\btimeout\b/.test(bat), "timeout.exe fails when stdin is redirected");
  assert.ok(/ping\.exe" -n \d+ 127\.0\.0\.1/i.test(bat));
});

test("batch file calls Windows' own tools by full path, because another find can come first on PATH", () => {
  const lines = batchFileText(AFX, SCRIPT, STARTED).split("\r\n");
  const tools = lines.filter((l) => /\b(tasklist|find|ping)\b/i.test(l) && !/^echo /.test(l));
  assert.ok(tools.length >= 4, "the tool lines are there");
  for (const line of tools) {
    const names = line.match(/[^\s"|]*\b(tasklist|find|ping)(\.exe)?(?=["\s])/gi);
    for (const name of names) assert.match(name, /^%SystemRoot%\\System32\\(tasklist|find|ping)\.exe$/i, line);
  }
});

test("batch file refuses a script path AE can't accept", () => {
  assert.throws(() => batchFileText(AFX, "C:\\Users\\my name\\run.jsx", STARTED), /spaces/);
  assert.throws(() => batchFileText(AFX, "C:\\a&b\\run.jsx", STARTED), /spaces/);
});

test("batch file refuses a started path it can't safely check", () => {
  assert.throws(() => batchFileText(AFX, SCRIPT, "C:\\a%b\\run.started"), /spaces/);
  assert.throws(() => batchFileText(AFX, SCRIPT), /started/i);
});

test("batch file uses UTF-8 and Windows line endings", () => {
  const bat = batchFileText(AFX, "C:\\Users\\Ø\\run.jsx", STARTED);
  assert.ok(bat.startsWith("@echo off\r\nchcp 65001 >nul\r\n"));
  assert.ok(bat.includes("Ø"));
});

test("pickRunDir takes the first folder AE can accept", () => {
  assert.equal(pickRunDir(["C:\\Users\\my name\\data", "C:\\Users\\Public\\TimelessVisualizer"]), "C:\\Users\\Public\\TimelessVisualizer");
  assert.equal(pickRunDir(["C:\\Users\\me\\data", "C:\\Users\\Public\\TimelessVisualizer"]), "C:\\Users\\me\\data");
  assert.equal(pickRunDir(["C:\\a b", "C:\\c&d"]), null);
});

test("launch stub runs the batch file and stays pure ASCII", () => {
  const { launchStubText } = require("../plugin/src/core/aerun");
  const stub = launchStubText("C:\\run\\Ø\\launch.bat");
  assert.ok(/^[\x00-\x7f]*$/.test(stub));
  assert.ok(stub.includes(".execute()"));
  const seen = [];
  new Function("File", stub)(function File(p) { seen.push(p); this.execute = () => seen.push("ran"); });
  assert.deepEqual(seen, ["C:/run/Ø/launch.bat", "ran"]);
});

test("waitFor returns the first truthy answer", async () => {
  const { waitFor } = require("../plugin/src/core/aerun");
  let calls = 0;
  const value = await waitFor(() => (++calls === 3 ? "done" : null), { timeoutMs: 1000, intervalMs: 1, sleep: async () => {} });
  assert.equal(value, "done");
  assert.equal(calls, 3);
});

test("waitFor gives up with null when time runs out", async () => {
  const { waitFor } = require("../plugin/src/core/aerun");
  let clock = 0;
  const value = await waitFor(() => null, { timeoutMs: 100, intervalMs: 30, now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal(value, null);
  assert.ok(clock >= 100 && clock < 200);
});
