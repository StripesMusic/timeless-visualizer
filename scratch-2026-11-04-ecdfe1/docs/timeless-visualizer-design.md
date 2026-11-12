# Timeless Visualizer: design

A Photoshop panel that turns one finished cover artwork into the full Timeless release pack: 7 new artboards in the PSD and a filled-in After Effects project saved next to it.

## Why

Every release gets the same set of graphics and motion files, built by hand from the same templates. The plugin does the repetitive first pass so the time goes into the final tweaks instead of the setup.

## Goals, non-goals, anti-goals

**Goals**
- One click builds all 7 artboards and the AE project from one piece of art.
- Everything stays editable. Text stays live, art stays layered, and every board can be adjusted afterwards.
- Output names match the deliverable names you already use.

**Non-goals**
- Rendering or exporting deliverables. The plugin makes the files, you render.
- Final-quality layouts. Crops and lockup placement are a first pass you touch up.
- Writing new motion. FlyerSocial gets the art, and you animate it.
- Mac support. Launching AE is Windows-only for now.

**Would count as failure even if it technically works**
- The original artwork changes.
- The templates get overwritten.
- A new release's project still links to another release's art or audio.
- Re-running wipes tweaks you made by hand.

## The panel

| Field | Required | Notes |
|---|---|---|
| Source art | Yes | Dropdown of artboards. Plain PSDs with no artboards use the whole canvas. |
| Text | Yes | Select layers or groups in the Layers panel, then click "Use selection". |
| Logo | Yes | Same as Text. |
| Font to match | Yes | Lists the fonts used in your Text picks and defaults to the largest text layer. |
| Release date | Yes | Free text in the template's format, e.g. `28 AUG 2026`. |
| Coming Soon audio | No | File picker. |
| Out Now audio | No | File picker. |
| Template paths | Set once | Default to your Templates folder and are remembered. |

Then one **Build** button with a progress bar and a final report of anything it skipped or couldn't do.

**Re-running is safe.** It only fills in what's missing. Artboards that already exist are skipped. If the AEP already exists it is left alone and only its helper images are refreshed.

**Undo and saving.** The whole artboard build is one undo step. The plugin does not save your PSD, so you review first and save yourself.

## Artboards

Your source artboard is never touched. If the PSD has no artboards, its layers get wrapped in one called `Cover Art` first, because a document can't mix artboards with loose layers. New boards go in a row to the right of what's already there.

| Artboard | Size | Art | Text | Logo | Added from template |
|---|---|---|---|---|---|
| BGSquare | source size | yes | removed | removed | none |
| SoundCloudBanner | 2480x520 | yes | moved right | removed | logo, OUT NOW block, dots |
| YouTubeThumbnail | 1920x1080 | yes | centered | under the text | none |
| FlyerComingSoon | 1080x1920 | yes | centered | removed | COMING SOON, logo |
| FlyerOutNow | 1080x1920 | yes | centered | removed | OUT NOW (same layer, new wording), logo |
| BGLandscape | 1920x1080 | yes | removed | removed | none |
| BGPortrait | 1080x1920 | yes | removed | removed | none |

**How the layers stay non-destructive**
- Each board gets its own copy of the layer stack, like your current PSDs.
- Art layers with pixels become smart objects first, and every board uses linked copies of them. Scaling loses nothing, you can still move elements per board, and the file stays far smaller than 8 full copies.
- Editing an element's contents updates it on every board.
- Text stays live, shapes stay vector, and adjustment layers stay as they are.

**Crop.** Everything scales together to fill the frame and is centered. Art that runs past the original canvas gets used.

**Seamless look.** Template pieces go at the Text layers' original position in the stack, under the finishing layers such as grain and gradient maps, so they pick up the art's color and texture.

**Title text.** The art's own title lockup replaces the template's Maulik placeholders, scaled to fit where they sat. On the banner it is right-aligned, up to 457 px wide and 300 px tall (my call, since long titles need more height than the template's single line).

**Matching the art's font.** COMING SOON, OUT NOW and OUT NOW ON TIMELESS switch to the font and color you pick, then resize to fit the template's width. The banner's icons and dots take the same color. If your Text picks contain no live text, for example a title that's only a smart object, those layers keep the template font and the report says so.

## After Effects project

Saved next to the PSD with `_CoverArtPSD` swapped for `_VisualsAEP`, keeping any `_V1` suffix:

`TMLS047_NANDAN_SayYoureSorry_CoverArtPSD.psd` → `TMLS047_NANDAN_SayYoureSorry_VisualsAEP.aep`

The plugin opens your template in AE, fills it in, and saves it under the new name, so the template itself is never saved over. AE stays open on the finished project. Nothing is added to the render queue.

| Comp | Length | What it is |
|---|---|---|
| Flyer Social | 8.65s (template) | BGPortrait art under the template's existing adjustment layer. **This is the one you animate.** |
| BGAnimation | 8.65s | Flyer Social nested, so anything you animate there carries over. |
| SpotifyCanvas | 8s | Flyer Social nested, with text and logo on top. |
| ComingSoonReel | template | The template's `Coming Soon` comp, renamed, with new art, text, date and audio. |
| OutNowReel | template | The template's `Out Now` comp, renamed, with new art, text and audio. |

BGAnimation, SpotifyCanvas and both reels sit in `Render These`.

**Helper images.** As far as I know, AE scripts can only import a whole PSD, not one artboard, so the plugin saves a few images in a `<name>_VisualsAEP Assets` folder next to the AEP:
- `CoverArt.jpg`
- `BGPortrait.jpg`
- `ComingSoonText.png`
- `OutNowText.png`
- `CanvasText.png`

Build again after changing the PSD and the images update in place.

**No old release left behind.** Every linked file in the template gets replaced. If you leave an audio file blank, that layer is switched off and its link cleared, and the report tells you.

**Left for you by hand**
- Line up Out Now audio on the right part of the song. The template starts it 29.05s in, and that offset stays.
- Animate Flyer Social. Overlord 2.6+ or a layered PSD import would both work if you want individual elements.

## How it's built

- **Plugin type:** a UXP panel, the same type as your other plugins. Plugin ID `com.stripesmusic.timelessvisualizer`, delivered as a `.ccx` you can install.
- **Reaching AE:** the panel writes an AE script with its settings built in, plus a small batch file, then has Photoshop run the batch file. The batch file opens AE if it's closed, waits for AE's project window, and sends the script, resending every 20 seconds until the script reports it started. If AE has an unsaved project open, the script stops without touching it and the panel tells you.

**What the build found out**
- The panel can launch AE through Photoshop's script engine with no script warning, with AE closed or already open.
- AE quits silently if the script path is quoted on the command line, so run files go in a folder with no spaces or symbols: the plugin's data folder, or `C:\Users\Public\TimelessVisualizer` if that one won't do.
- AE can take minutes to start and ignores a script sent while it's loading, which is why the batch file waits and resends.
- The template has no expressions that refer to comps by name, so renaming comps is safe.
- Photoshop re-sorts layers between artboards when a board moves or resizes. The build locks that while it works, and leaves the lock on the new boards' hidden layers, adjustment layers and layers fully off the board, so they stay put later. You'll see a small lock icon on those. It doesn't stop you editing them.
- Photoshop can't open documents while its window is minimized, so the build needs the window restored. It can sit behind other windows.

## Testing

I'd test on copies, never your originals: a small made-up PSD first, then TMLS043 (no artboards) and TMLS047 (has artboards). I'd export every board and comp frame to images and compare them against your finished deliverables. You declined screen access, so a final click-through of the panel itself would be yours, or you can allow screen access for that step.

## My calls, for you to check

1. **Flyer Social gets one flat BGPortrait image**, not live PSD layers. It matches the art exactly and keeps the project light. Past projects used layered imports, which could be slow and lost the finishing look.
2. **BGAnimation and SpotifyCanvas exist as thin comps** on top of Flyer Social, so you get the 8s Canvas and correct render names while animating in one place.
3. **Helper images** are saved next to the AEP, rather than linking the PSD.
4. **`CanvasText.png` is exported on its own.** It keeps the art's color adjustments, but grain or texture layers may not carry over, so it can look slightly cleaner than the PSD.
5. **YouTube layout is always centered**, with the logo under the text, like TMLS046 and 047. TMLS044's corner layout would be a manual move.
