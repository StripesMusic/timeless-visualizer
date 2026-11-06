// Timeless Visualizer: fills in the Visuals template inside After Effects and saves it under a new name.
// The plugin prepends `var TV_SETTINGS = {...};` to this file. ES3 only.
(function () {
    var S = TV_SETTINGS;
    var issues = [];

    // The launcher resends this script until it starts, so any later copy must do nothing.
    if (S.startedPath) {
        var startedFile = new File(S.startedPath);
        if (startedFile.exists) return;
        startedFile.open("w");
        startedFile.write("started");
        startedFile.close();
    }

    function quote(s) {
        var out = '"';
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), n = s.charCodeAt(i);
            if (c === '"' || c === "\\") out += "\\" + c;
            else if (n < 32 || n > 126) out += "\\u" + ("0000" + n.toString(16)).slice(-4);
            else out += c;
        }
        return out + '"';
    }

    function writeResult(ok, error, aepPath) {
        var parts = [];
        for (var i = 0; i < issues.length; i++) parts.push(quote(issues[i]));
        var text = '{"ok":' + ok + ',"error":' + (error ? quote(error) : "null") +
            ',"aepPath":' + (aepPath ? quote(aepPath) : "null") + ',"issues":[' + parts.join(",") + "]}";
        // Write then rename so the plugin never reads a half-written file.
        var tmp = new File(S.resultPath + ".tmp");
        tmp.encoding = "UTF-8";
        tmp.open("w");
        tmp.write(text);
        tmp.close();
        var finalFile = new File(S.resultPath);
        if (finalFile.exists) finalFile.remove();
        tmp.rename(finalFile.name);
    }

    function findItem(type, name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it.name === name && it instanceof type) return it;
        }
        return null;
    }

    function need(type, name) {
        var it = findItem(type, name);
        if (!it) throw new Error("The template has no item named '" + name + "'.");
        return it;
    }

    function replaceFootage(name, path, straightAlpha) {
        var item = need(FootageItem, name);
        var file = new File(path);
        if (!file.exists) throw new Error("Missing file for '" + name + "': " + path);
        item.replace(file);
        item.name = name;
        if (straightAlpha && item.mainSource.hasAlpha) item.mainSource.alphaMode = AlphaMode.STRAIGHT;
        return item;
    }

    function importStill(path, name, folder) {
        var file = new File(path);
        if (!file.exists) throw new Error("Missing file for '" + name + "': " + path);
        var item = app.project.importFile(new ImportOptions(file));
        item.name = name;
        item.parentFolder = folder;
        if (item.mainSource.hasAlpha) item.mainSource.alphaMode = AlphaMode.STRAIGHT;
        return item;
    }

    // A blank audio pick must not leave the template's old release linked.
    function setAudio(footageName, label, path) {
        if (path) {
            replaceFootage(footageName, path, false);
            return;
        }
        var item = need(FootageItem, footageName);
        var comps = item.usedIn;
        item.replaceWithPlaceholder(footageName, 16, 16, 60, 60);
        item.name = footageName;
        for (var c = 0; c < comps.length; c++) {
            for (var l = 1; l <= comps[c].numLayers; l++) {
                var layer = comps[c].layer(l);
                if (layer.source === item) {
                    try { layer.audioEnabled = false; } catch (e1) {}
                    layer.enabled = false;
                }
            }
        }
        issues.push(label + " audio was left blank, so its layer is switched off.");
    }

    function setDate(comp, date) {
        for (var l = 1; l <= comp.numLayers; l++) {
            var layer = comp.layer(l);
            if (layer instanceof TextLayer) {
                var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
                var doc = prop.value;
                doc.text = date;
                prop.setValue(doc);
                layer.name = date;
                return;
            }
        }
        issues.push("Couldn't find the date text in the Coming Soon comp.");
    }

    function hasUnsavedWork() {
        var p = app.project;
        if (!p || p.numItems === 0) return false;
        if (typeof p.dirty !== "undefined") return p.dirty === true;
        return !p.file;
    }

    function build() {
        if (new File(S.outputPath).exists) throw new Error("The project already exists, so it was left alone: " + S.outputPath);
        if (hasUnsavedWork()) throw new Error("After Effects has a project open with unsaved changes. Save or close it, then build again.");

        var template = new File(S.templatePath);
        if (!template.exists) throw new Error("Can't find the Visuals template: " + S.templatePath);
        app.open(template);

        var assets = need(FolderItem, "Assets");
        var renderThese = need(FolderItem, "Render These");
        var flyer = need(CompItem, "Flyer Social");
        var comingSoon = need(CompItem, "Coming Soon");
        var outNow = need(CompItem, "Out Now");
        var coverComp = need(CompItem, "Cover Art");

        var cover = replaceFootage("Cover Art File", S.images.coverArt, false);
        if (cover.width !== coverComp.width || cover.height !== coverComp.height) {
            var coverLayer = coverComp.layer("Cover Art File");
            var coverScale = Math.max(coverComp.width / cover.width, coverComp.height / cover.height) * 100;
            coverLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([coverScale, coverScale]);
        }
        replaceFootage("Coming Soon Text", S.images.comingSoonText, true);
        replaceFootage("Out Now Text", S.images.outNowText, true);
        setAudio("Coming Soon Audio", "Coming Soon", S.audio && S.audio.comingSoon);
        setAudio("Out Now Audio", "Out Now", S.audio && S.audio.outNow);
        setDate(comingSoon, S.date);

        var portrait = importStill(S.images.bgPortrait, "BGPortrait", assets);
        flyer.layers.add(portrait, flyer.duration).moveToEnd();

        comingSoon.name = "ComingSoonReel";
        outNow.name = "OutNowReel";

        var bgAnimation = app.project.items.addComp("BGAnimation", 1080, 1920, 1, 8.65, 60);
        bgAnimation.parentFolder = renderThese;
        bgAnimation.layers.add(flyer);

        var canvas = app.project.items.addComp("SpotifyCanvas", 1080, 1920, 1, 8, 60);
        canvas.parentFolder = renderThese;
        canvas.layers.add(flyer);
        canvas.layers.add(importStill(S.images.canvasText, "CanvasText", assets), canvas.duration);

        // Opening a comp in the viewer marks the project changed, so it happens before the save.
        // Otherwise the next release built in this AE session is refused for "unsaved changes".
        flyer.openInViewer();
        var output = new File(S.outputPath);
        app.project.save(output);
        return output.fsName;
    }

    app.beginSuppressDialogs();
    try {
        writeResult(true, null, build());
    } catch (err) {
        writeResult(false, String(err.message), null);
    }
    app.endSuppressDialogs(false);
})();
