# Timeless Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Photoshop UXP panel that builds 7 artboards in the open PSD and a filled-in After Effects project next to it, from one piece of art.

**Architecture:** Pure logic (names, geometry, board table) lives in plain CommonJS modules tested with `node:test`. Photoshop work lives in `plugin/src/ps/`, tested inside Photoshop through a dev-only harness plugin that runs code from disk and writes results to a file, so no clicking or screen access is needed. After Effects work is one ES3 script fed by a JSON settings file.

**Tech Stack:** UXP (manifest v5, Photoshop 27.11), batchPlay, ExtendScript (launch stub and AE script), Node 24 for tests and packaging.

**Spec:** `docs/timeless-visualizer-design.md`

## Global Constraints

- Artboard names and sizes: `BGSquare` source size, `SoundCloudBanner` 2480x520, `YouTubeThumbnail` 1920x1080, `FlyerComingSoon` 1080x1920, `FlyerOutNow` 1080x1920, `BGLandscape` 1920x1080, `BGPortrait` 1080x1920.
- The source artwork, the templates, and any existing AEP are never modified. The PSD is never auto-saved.
- Plugin name "Timeless Visualizer", plugin ID `com.stripesmusic.timelessvisualizer`, Windows only.
- AE script path passed to `AfterFX.exe -r` must not be quoted: AE 26.5 quits silently if it is.
- Test only on copies in the scratchpad, never on files under `A:\`.
- Not a git repository, and commits only happen on request, so tasks have no commit step.

## Review Focus

1. Release names with `&` or non-ASCII, such as `TMLS043_Bukkoy&Ray` and `IØNITH`: paths must survive the batch file, JSON and AE. (Task 7)
2. A locked `Background` or `Layer 0` in the source: the build still works and the source stays locked. (Task 3)
3. Text picks that overlap, such as a group plus its own child, or layers scattered across the stack: move each layer once, as one lockup. (Task 3)
4. Templates or AE unavailable, such as `A:` not mounted: a clear message before anything changes. (Task 8)
5. Untitled or never-saved PSD: Build refuses with a clear message, because the AEP has nowhere to go. (Task 8)

---

## File Structure

```
plugin/                        the shipped plugin
  manifest.json, index.html, styles.css, icons/
  src/main.js                  panel wiring, validation, Build button
  src/core/naming.js           file and folder names
  src/core/geometry.js         scale, fit, placement math
  src/core/boards.js           board table and template layout constants
  src/ps/actions.js            batchPlay wrappers
  src/ps/doc.js                read artboards, selection, fonts
  src/ps/engine.js             build the artboards
  src/ps/templates.js          copy layers from template PSDs
  src/ps/text.js               font and color matching
  src/ps/helpers.js            export helper images
  src/ae/bridge.js             settings file, launch, wait for result
  ae/launch_stub.jsx           Photoshop-side launcher
  ae/build_visuals.jsx         builds the AEP inside AE
test/*.test.js                 node tests for src/core
dev/harness/                   dev-only plugin, never shipped
dev/ps.js                      CLI: run a file inside Photoshop, print the result
dev/ps-tests/*.js              tests that run inside Photoshop
scripts/package.js             builds the .ccx
```

---

### Task 1: Dev harness and the panel-to-AE proof

Clears the design's biggest unknown before anything depends on it.

**Files:**
- Create: `dev/harness/manifest.json`, `dev/harness/index.html`, `dev/harness/main.js`, `dev/ps.js`, `dev/install-harness.js`, `dev/ps-tests/bridge.proof.js`

**Interfaces:**
- Produces: `node dev/ps.js <file.js> [jsonArg]` runs `<file.js>` in Photoshop and prints `{ok, value, error, logs}`. Test files export `async function run(arg, ctx)`, where `ctx.require(path)` loads a module from disk with a small CommonJS loader.

- [ ] **Step 1: Write the harness.** Manifest v5 with `localFileSystem: "fullAccess"`, `allowCodeGenerationFromStrings: true`, and `launchProcess`. It polls a command folder in the scratchpad every 500 ms, runs the named file, and writes `result-<id>.json`.
- [ ] **Step 2: Install it.** Copy to `%APPDATA%\Adobe\UXP\Plugins\External\com.stripesmusic.tvdev_0.0.1`, add its entry to `PluginsInfo\v1\PS.json`, and restart Photoshop only after `ps_state.jsx` reports `documents=0`.
- [ ] **Step 3: Verify the harness loads.** Run `node dev/ps.js dev/ps-tests/ping.js`. Expected: `ok:true` and `value` containing `27.11`. If plugins load lazily and nothing answers, trigger it by script from the command line, then ask the user to open the panel once as a last resort.
- [ ] **Step 4: Prove the chain with AE closed.** `bridge.proof.js` writes a JSX stub and batch file, runs the stub via batchPlay `AdobeScriptAutomation Scripts`, and waits for `pong.txt`. Expected: `pong.txt` exists within 90 s.
- [ ] **Step 5: Prove the chain with AE already open.** Same test. Expected: the script runs in the existing instance and no second AfterFX process remains.
- [ ] **Step 6: If Step 4 fails,** try `uxp.shell.openPath` on the batch file. If that fails too, tell the user before continuing, because the design's fallback changes the Build flow.

### Task 2: Core logic

**Files:**
- Create: `plugin/src/core/naming.js`, `plugin/src/core/geometry.js`, `plugin/src/core/boards.js`, `test/naming.test.js`, `test/geometry.test.js`, `test/boards.test.js`

**Interfaces:**
- Produces:
  - `visualsName(psdBase: string) -> string`, `assetsFolder(aepBase: string) -> string`
  - `coverScale(srcW, srcH, dstW, dstH) -> number`
  - `fitInto(bounds, box, {maxScale, alignX}) -> {scale, dx, dy}`, where bounds and box are `{left, top, right, bottom}` and `alignX` is `"center"` or `"right"`
  - `unionBounds(bounds[]) -> bounds`, ignoring zero-size entries
  - `placeRow(existingRects, sizes, gap = 100) -> rects[]`
  - `BOARDS: [{name, width|null, height|null, keepText, keepLogo, template, lockup}]`, `TEMPLATE_LAYOUT`

- [ ] **Step 1: Write failing tests with these exact values.**

```js
visualsName("TMLS047_NANDAN_SayYoureSorry_CoverArtPSD") === "TMLS047_NANDAN_SayYoureSorry_VisualsAEP"
visualsName("TMLS044_Maulik_SheWantsToParty_CoverArtPSD_V1") === "TMLS044_Maulik_SheWantsToParty_VisualsAEP_V1"
visualsName("Random Art") === "Random Art_VisualsAEP"
assetsFolder("X_VisualsAEP") === "X_VisualsAEP Assets"
coverScale(3000, 3000, 1920, 1080) === 0.64
coverScale(3000, 3000, 2480, 520) === 2480 / 3000
coverScale(5000, 3000, 1080, 1920) === 0.64
fitInto({left:0,top:0,right:1000,bottom:200}, {left:1964,top:110,right:2421,bottom:410}, {alignX:"right"}).scale === 0.457
// right edge lands on 2421, vertical center on 260
unionBounds([{left:0,top:0,right:0,bottom:0},{left:5,top:5,right:9,bottom:9}]) // {5,5,9,9}
placeRow([{left:0,top:0,right:3000,bottom:3000}], [{width:1920,height:1080}])[0].left === 3100
BOARDS.map(b => b.name) // the 7 names in spec order
BOARDS.find(b => b.name === "BGSquare").width === null
```

- [ ] **Step 2: Run to verify they fail.** `node --test test/`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement.** `TEMPLATE_LAYOUT` holds:
  - Banner lockup box `{left:1964, top:110, right:2421, bottom:410}`, right-aligned.
  - Flyer lockup box `{left:249, top:800, right:830, bottom:1036}`, centered.
  - YouTube lockup box 960x594 centered in 1920x1080, with a 30 px gap to the logo.
- [ ] **Step 4: Run to verify they pass.** `node --test test/`. Expected: all PASS.

### Task 3: Artboard engine

**Files:**
- Create: `plugin/src/ps/actions.js`, `plugin/src/ps/doc.js`, `plugin/src/ps/engine.js`, `dev/ps-tests/make-fixture.js`, `dev/ps-tests/engine.test.js`

**Interfaces:**
- Consumes: `coverScale`, `fitInto`, `unionBounds`, `placeRow`, `BOARDS`.
- Produces:
  - `listArtboards(doc) -> [{id, name, bounds}]`
  - `selectionInfo() -> [{id, name, kind}]`
  - `collectFonts(ids) -> [{font, color, size, widthPx}]`, largest first
  - `buildArtboards({doc, sourceId, textIds, logoIds, font, flyer, banner}, onProgress) -> {built, skipped, issues}`
  - Internal stage helpers `addTemplatePieces` and `applyFont` are no-ops until Task 4.

- [ ] **Step 1: Write the fixture.** `make-fixture.js` creates a 3000x3000 test PSD in the scratchpad containing:
  - a locked background
  - a pixel layer with a mask
  - a pixel layer clipped to it
  - a Multiply layer at 60% opacity
  - a hidden layer
  - a layer extending past the canvas
  - a type-layer group named `Text` and a logo layer
  - a Curves adjustment above the text
  - a pixel layer with a layer style
- [ ] **Step 2: Write failing tests in `engine.test.js`.**
  - Exactly the 7 boards exist with the spec's sizes, plus the source.
  - The source's layer list and bounds match a snapshot taken before the build, and its background is still locked.
  - `BGSquare`, `BGLandscape`, `BGPortrait` and both flyers have none of the source's logo layers. The three BG boards have no text layers.
  - Art layers in a board are smart objects sharing one linked source across boards.
  - Blend mode, opacity, clipping and hidden state match the source per layer.
  - The Curves layer is still above the text in each board.
  - `BGSquare` pixels match the source with text and logo hidden, within a small tolerance.
  - Building twice adds no boards and reports them as skipped.
  - One undo removes every new board.
  - A pick list holding a group plus its child moves that child once.
- [ ] **Step 3: Run to verify they fail.** `node dev/ps.js dev/ps-tests/engine.test.js`. Expected: FAIL, `buildArtboards` not defined.
- [ ] **Step 4: Implement `actions.js`.** Exports `selectLayers`, `makeArtboard`, `duplicateInto`, `transformLayers`, `toSmartObject`, `deleteLayers`, `boundsOf`, using batchPlay inside `executeAsModal` with `hostControl.suspendHistory`.
- [ ] **Step 5: Implement `engine.js`.** The algorithm:
  1. If the document has no artboards, wrap its layers in a `Cover Art` artboard.
  2. Duplicate the source into a temporary master and convert each pixel-bearing art layer there to a smart object.
  3. For each missing board: make the artboard at its `placeRow` rect, duplicate the master's children in, scale and center them by `coverScale`, delete what `keepText` and `keepLogo` exclude, and place the lockup.
  4. Delete the master.
  5. Map picks to new layers by position in the stack, because IDs change on duplication. A pick means every layer inside it.
- [ ] **Step 6: Run to verify they pass.** Expected: all PASS. Also export each board to PNG and view them.

### Task 4: Template pieces and font matching

**Files:**
- Create: `plugin/src/ps/templates.js`, `plugin/src/ps/text.js`, `dev/ps-tests/templates.test.js`
- Modify: `plugin/src/ps/engine.js`

**Interfaces:**
- Consumes: `buildArtboards` stage helpers, `TEMPLATE_LAYOUT`, `collectFonts`.
- Produces: `addTemplatePieces(doc, board, templatePath, stackAnchorId) -> newIds`, `applyFont(ids, {font, color}, {fitWidth}) -> void`.

- [ ] **Step 1: Write failing tests**, using copies of the real template PSDs.
  - `SoundCloudBanner` contains `Out Now` (type layer plus 4 icons), `Ellipse 2 copy` and `Timeless`, with no `Layer 6` and no `SHE WANTS` or `MAULIK` placeholders.
  - `Timeless` sits at about (146,119) relative to the board.
  - `FlyerComingSoon` has a `COMING SOON` type layer in the matched font, width within 2% of the template's 581 px, centered on x=540.
  - `FlyerOutNow` has a type layer reading `OUT NOW` at the same font size, also centered.
  - Template pieces sit directly above the Text layers' position, and below the Curves layer.
  - Icons and dots take the matched color.
  - The template files' modified times are unchanged and their documents are closed afterward.
  - With a title that's only a smart object, the template font stays and `issues` says so.
- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Template documents open read-only and close without saving. Layers are copied with `Layer.duplicate(targetDoc)`, then moved to the stack anchor. Icons and dots get their color from a Color Overlay style or shape fill. Mixed-font text uses the first run's font.
- [ ] **Step 4: Run to verify they pass, and view exported boards** against the finished TMLS deliverables. Expected: all PASS, with layouts recognizably close.

### Task 5: Helper images

**Files:**
- Create: `plugin/src/ps/helpers.js`, `dev/ps-tests/helpers.test.js`

**Interfaces:**
- Produces: `exportHelpers(doc, folderEntry, {sourceId, boards}) -> {coverArt, bgPortrait, comingSoonText, outNowText, canvasText}` (native paths).

- [ ] **Step 1: Write failing tests.**
  - All five files exist.
  - `CoverArt.jpg` is 3000x3000 and `BGPortrait.jpg` is 1080x1920.
  - The three PNGs are 1080x1920 with transparent corners.
  - `ComingSoonText.png` has opaque pixels only inside the flyer's `COMING SOON` bounds.
  - The working document's layer count and active document are unchanged afterward, and no temp documents remain open.
  - Exporting again overwrites in place.
- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Create a temp document at board size, duplicate the needed layers in with the board offset removed, save with `saveAs.jpg` (quality 12) or `saveAs.png`, and close without saving. `canvasText` holds the flyer's text and logo without `COMING SOON`, plus any adjustment layers above them, so color carries over.
- [ ] **Step 4: Run to verify they pass.** Expected: all PASS.

### Task 6: After Effects builder

**Files:**
- Create: `plugin/ae/build_visuals.jsx`, `dev/ae-test.js`

**Interfaces:**
- Consumes: a settings file `{templatePath, outputPath, date, images:{...}, audio:{comingSoon, outNow}, resultPath}`, UTF-8 JSON, parsed by a small ES3 reader.
- Produces: `result.json` containing `{ok, aepPath, issues: string[]}`.

- [ ] **Step 1: Write the failing test.** `dev/ae-test.js` runs the script on a scratch copy of the template with fixture images, using `AfterFX.exe -r <unquoted path>`, and a second dump script then asserts:
  - Comps `ComingSoonReel`, `OutNowReel`, `BGAnimation` (8.65s) and `SpotifyCanvas` (8s) exist at 1080x1920 and 60 fps, in `Render These`.
  - `Flyer Social` has `Adjustment Layer 3` above a `BGPortrait` layer.
  - `SpotifyCanvas` has `CanvasText` above `Flyer Social`.
  - The date text layer reads the fixture date and its name matches.
  - No footage path contains `TMLS044` or `She Wants`.
  - With blank audio, both audio layers are off and `issues` names them.
  - Nothing is in the render queue.
  - The template's modified time is unchanged.
- [ ] **Step 2: Run to verify it fails.** `node dev/ae-test.js`. Expected: FAIL, script missing.
- [ ] **Step 3: Implement.** Stop with `ok:false` and touch nothing if the open project has unsaved changes or the output exists. Use `app.beginSuppressDialogs`. Use `item.replace(File)` and restore each item's name afterward. Blank audio becomes a placeholder and the layer is switched off. Save with `app.project.save(File(outputPath))`. Leave AE open on the result.
- [ ] **Step 4: Run to verify it passes,** then view `comp.saveFrameToPng` frames at 3 s for all four render comps. Check `COMING SOON` sits above the card in the reels, and adjust the text image's placement if not.

### Task 7: Bridge

**Files:**
- Create: `plugin/src/ae/bridge.js`, `plugin/ae/launch_stub.jsx`, `dev/ps-tests/bridge.test.js`

**Interfaces:**
- Consumes: the Task 1 launch chain, the Task 6 settings format.
- Produces: `buildVisuals(settings, onProgress) -> Promise<{ok, aepPath, issues}>`, timing out at 5 minutes with a clear message.

- [ ] **Step 1: Write failing tests.**
  - A full run produces the AEP.
  - An output folder named `TMLS043_Bukkoy&Ray_Ø Test` works, and the AEP footage paths read back correctly.
  - A plugin folder with spaces in its path still launches.
  - When the output AEP exists, AE isn't launched and `ok:true` with a "left as is" note comes back.
  - A bad AE path returns `ok:false` without launching.
- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Write the run script to the temp folder as a per-run file. In the batch file, use `%~s` to get a short path and leave it unquoted. Poll for `result.json`.
- [ ] **Step 4: Run to verify they pass.** Expected: all PASS.

### Task 8: Panel and end-to-end run

**Files:**
- Create: `plugin/manifest.json`, `plugin/index.html`, `plugin/styles.css`, `plugin/icons/*`, `plugin/src/main.js`, `plugin/src/core/validate.js`, `test/validate.test.js`, `dev/ps-tests/e2e.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `validateInputs({docPath, sourceId, textIds, logoIds, font, date, templates, aePath}) -> string[]` (empty when ready), and `runBuild(inputs, onProgress) -> report`, callable without the UI.

- [ ] **Step 1: Write failing node tests for `validateInputs`.** Exact messages for: unsaved PSD ("Save the PSD first."), missing Text picks, missing Logo picks, overlapping Text and Logo picks, empty date, missing template file, missing AE.
- [ ] **Step 2: Implement the validator and panel.** Spectrum widgets in Photoshop's own theme, the spec's fields in order, "Use selection" buttons showing picked names, a progress bar and report area. Build stays disabled until valid. Template paths and AE path persist; per-release fields don't.
- [ ] **Step 3: Run the end-to-end test** through `runBuild` on scratch copies of TMLS043 (no artboards, locked `Layer 0`, `&` in the name) and TMLS047 (artboards, finishing layers above text). Expected: 7 boards, AEP next to the copy, no stale links, source unchanged, under 2 GB when saved.
- [ ] **Step 4: Compare results by eye.** Export all boards and comp frames and view them next to the finished deliverables. Fix anything that isn't a reasonable first pass.

### Task 9: Package and install

**Files:**
- Create: `scripts/package.js`, `plugin/README.md`

- [ ] **Step 1: Build the `.ccx`** with `node scripts/package.js`. Expected: `dist/TimelessVisualizer-1.0.0.ccx` containing `manifest.json` at the root and no `dev/` files.
- [ ] **Step 2: Remove the harness:** its folder, its `PS.json` entry and its storage.
- [ ] **Step 3: Install the `.ccx`** with `UnifiedPluginInstallerAgent.exe`, restart Photoshop only when `documents=0`, and confirm it's listed in `PS.json` as enabled.
- [ ] **Step 4: Report what's left for the user:** a click-through of the panel itself, or screen access for that step, and how to install on another machine.
