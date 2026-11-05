# Timeless Visualizer

A Photoshop panel that turns one finished cover artwork into the Timeless release pack: 7 new artboards in the PSD and an After Effects project saved next to it. It makes the files. You render them.

Windows only. Needs Photoshop 2026 and After Effects 2026.

## Install

Double-click `TimelessVisualizer-1.0.0.ccx`, then open **Plugins > Timeless Visualizer** in Photoshop.

## Use

1. Open the saved PSD. Plain PSDs and PSDs with artboards both work.
2. Pick the **Source art** if there are artboards.
3. Select the text layers or groups in the Layers panel and click **Use selection** under **Text**. Do the same for **Logo**. Include anything that belongs to the lockup, such as a line or a blurred copy of the title, because those come off the background boards too.
4. Check **Font to match** and enter the **Release date**, for example `28 AUG 2026`.
5. Add the audio if you have it. If you leave it blank, the audio layer is switched off and the report says so.
6. Click **Build**. After Effects opens if it isn't open already.

The template paths and the After Effects path are at the bottom of the panel, and the panel remembers them.

## What to expect

- The source art isn't changed. On a plain PSD, its layers get wrapped in a `Cover Art` artboard first.
- The whole artboard build is one undo step.
- The PSD isn't saved for you, so review it and save it yourself. The file gets bigger, because every art layer becomes a smart object.
- Building again only fills in what's missing. Boards that exist are skipped, and an existing `_VisualsAEP` project is left alone while its images are refreshed.
- A few layers show a small lock icon: hidden layers, adjustment layers and layers sitting fully off their board. That lock only stops Photoshop from moving them to another artboard when a board moves. You can still edit them.
- If After Effects has an unsaved project open, the script stops without touching it and the report tells you.

## Left for you by hand

- Line up the Out Now audio on the right part of the song. The template starts it 29.05 seconds in.
- Animate `Flyer Social`. `BGAnimation` and `SpotifyCanvas` pick that up automatically.
