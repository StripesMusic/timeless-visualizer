// Builds the 3000x3000 test PSD. Usage: node dev/ps.js dev/ps-tests/make-fixture.js "{\"path\":\"C:/.../fixture.psd\"}"
const uxp = require("uxp");
const ps = require("photoshop");
const { app, action, core, constants } = ps;

const px = (v) => ({ _unit: "pixelsUnit", _value: v });
const pct = (v) => ({ _unit: "percentUnit", _value: v });
const rgb = ([red, grain, blue]) => ({ _obj: "RGBColor", red, grain, blue });
const dont = { dialogOptions: "dontDisplay" };

const selectRect = (r) => ({
  _obj: "set",
  _target: [{ _ref: "channel", _property: "selection" }],
  to: { _obj: "rectangle", top: px(r.top), left: px(r.left), bottom: px(r.bottom), right: px(r.right) },
  _options: dont,
});
const deselect = () => ({ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" }, _options: dont });

async function pixelLayer(doc, name, rect, color) {
  const layer = await doc.createLayer({ name });
  await action.batchPlay(
    [
      { _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false, _options: dont },
      selectRect(rect),
      { _obj: "fill", using: { _enum: "fillContents", _value: "color" }, color: rgb(color), opacity: pct(100), mode: { _enum: "blendMode", _value: "normal" }, _options: dont },
      deselect(),
    ],
    {}
  );
  return layer;
}

async function addMask(layer, rect) {
  await action.batchPlay(
    [
      { _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false, _options: dont },
      selectRect(rect),
      { _obj: "make", new: { _class: "channel" }, at: { _ref: "channel", _enum: "channel", _value: "mask" }, using: { _enum: "userMaskEnabled", _value: "revealSelection" }, _options: dont },
      deselect(),
    ],
    {}
  );
}

async function addShadow(layer) {
  await action.batchPlay(
    [
      { _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false, _options: dont },
      {
        _obj: "set",
        _target: [{ _ref: "property", _property: "layerEffects" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layerEffects",
          scale: pct(100),
          dropShadow: {
            _obj: "dropShadow",
            enabled: true,
            present: true,
            showInDialog: true,
            mode: { _enum: "blendMode", _value: "multiply" },
            color: rgb([0, 0, 0]),
            opacity: pct(80),
            useGlobalAngle: false,
            localLightingAngle: { _unit: "angleUnit", _value: 90 },
            distance: px(30),
            chokeMatte: px(0),
            blur: px(30),
            noise: pct(0),
          },
        },
        _options: dont,
      },
    ],
    {}
  );
}

async function addCurves(name) {
  await action.batchPlay(
    [
      { _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", name, type: { _obj: "curves", presetKind: { _enum: "presetKindType", _value: "presetKindDefault" } } }, _options: dont },
      {
        _obj: "set",
        _target: [{ _ref: "adjustmentLayer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "curves",
          presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
          adjustment: [
            {
              _obj: "curvesAdjustment",
              channel: { _ref: "channel", _enum: "channel", _value: "composite" },
              curve: [{ _obj: "paint", horizontal: 0, vertical: 20 }, { _obj: "paint", horizontal: 128, vertical: 150 }, { _obj: "paint", horizontal: 255, vertical: 235 }],
            },
          ],
        },
        _options: dont,
      },
    ],
    {}
  );
}

// A radial gradient that isn't aligned to its layer, the kind that stays put when its artboard moves.
async function addGradient(name) {
  await action.batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "contentLayer" }],
        using: {
          _obj: "contentLayer",
          name,
          mode: { _enum: "blendMode", _value: "overlay" },
          opacity: pct(80),
          type: {
            _obj: "gradientLayer",
            angle: { _unit: "angleUnit", _value: -40 },
            type: { _enum: "gradientType", _value: "radial" },
            align: false,
            scale: pct(120),
            offset: { _obj: "paint", horizontal: pct(-30), vertical: pct(-30) },
            gradient: {
              _obj: "gradientClassEvent",
              name: "TV",
              gradientForm: { _enum: "gradientForm", _value: "customStops" },
              interfaceIconFrameDimmed: 4096,
              colors: [
                { _obj: "colorStop", color: rgb([255, 255, 255]), type: { _enum: "colorStopType", _value: "userStop" }, location: 0, midpoint: 50 },
                { _obj: "colorStop", color: rgb([0, 0, 0]), type: { _enum: "colorStopType", _value: "userStop" }, location: 4096, midpoint: 50 },
              ],
              transparency: [
                { _obj: "transferSpec", opacity: pct(100), location: 0, midpoint: 50 },
                { _obj: "transferSpec", opacity: pct(100), location: 4096, midpoint: 50 },
              ],
            },
          },
        },
        _options: dont,
      },
    ],
    {}
  );
}

async function makeFixture(path) {
  const lfs = uxp.storage.localFileSystem;
  let docId;
  await core.executeAsModal(
    async () => {
      const doc = await app.documents.add({ width: 3000, height: 3000, resolution: 72, mode: "RGBColorMode", fill: "white", name: "fixture" });
      docId = doc.id;

      const base = await pixelLayer(doc, "Art Base", { left: 200, top: 200, right: 2800, bottom: 2800 }, [40, 90, 200]);
      await addMask(base, { left: 300, top: 300, right: 2700, bottom: 2700 });

      const clip = await pixelLayer(doc, "Art Clipped", { left: 0, top: 1000, right: 3000, bottom: 2000 }, [230, 200, 60]);
      clip.isClippingMask = true;

      const mult = await pixelLayer(doc, "Art Multiply", { left: 600, top: 600, right: 1800, bottom: 1800 }, [200, 60, 60]);
      mult.blendMode = constants.BlendMode.MULTIPLY;
      mult.opacity = 60;

      const hidden = await pixelLayer(doc, "Art Hidden", { left: 1000, top: 1000, right: 2000, bottom: 2000 }, [255, 0, 255]);
      hidden.visible = false;

      const over = await pixelLayer(doc, "Art Off Canvas", { left: 2400, top: 400, right: 3000, bottom: 1000 }, [60, 200, 120]);
      await over.translate(500, 0);

      const styled = await pixelLayer(doc, "Art Styled", { left: 400, top: 2200, right: 1000, bottom: 2600 }, [250, 250, 250]);
      await addShadow(styled);

      await addGradient("Art Gradient");

      const title = await doc.createTextLayer({ name: "Title", contents: "FLYING SO HIGH", fontName: "ArialMT", fontSize: 200, textColor: (() => { const c = new app.SolidColor(); c.rgb.red = 255; c.rgb.green = 240; c.rgb.blue = 200; return c; })(), position: { x: 500, y: 1300 } });
      const artist = await doc.createTextLayer({ name: "Artist", contents: "BUKKOY & RAY", fontName: "ArialMT", fontSize: 100, position: { x: 900, y: 1500 } });
      await doc.createLayerGroup({ name: "Text", fromLayers: [artist, title] });

      await pixelLayer(doc, "Logo", { left: 1400, top: 2600, right: 1600, bottom: 2800 }, [255, 255, 255]);
      await addCurves("Curves Finish");

      const entry = await lfs.createEntryWithUrl("file:" + path.replace(/\\/g, "/"), { overwrite: true });
      await doc.saveAs.psd(entry, { maximizeCompatibility: true }, true);
    },
    { commandName: "TV fixture" }
  );
  return docId;
}

exports.makeFixture = makeFixture;
exports.run = async (arg) => ({ docId: await makeFixture(arg.path) });
