// The 7 artboards and where template pieces and lockups go on them.

const BOARDS = [
  { name: "BGSquare", width: null, height: null, keepText: false, keepLogo: false, template: null, lockup: null },
  { name: "SoundCloudBanner", width: 2480, height: 520, keepText: true, keepLogo: false, template: "banner", lockup: "banner" },
  { name: "YouTubeThumbnail", width: 1920, height: 1080, keepText: true, keepLogo: true, template: null, lockup: "youtube" },
  { name: "FlyerComingSoon", width: 1080, height: 1920, keepText: true, keepLogo: false, template: "flyer", lockup: "flyer", flyerWording: "COMING SOON" },
  { name: "FlyerOutNow", width: 1080, height: 1920, keepText: true, keepLogo: false, template: "flyer", lockup: "flyer", flyerWording: "OUT NOW" },
  { name: "BGLandscape", width: 1920, height: 1080, keepText: false, keepLogo: false, template: null, lockup: null },
  { name: "BGPortrait", width: 1080, height: 1920, keepText: false, keepLogo: false, template: null, lockup: null },
];

// Coordinates are relative to the board, taken from the template PSDs.
const TEMPLATE_LAYOUT = {
  banner: {
    // Right-aligned, up to 457 wide and 300 tall, centered on the template's text line (y=260).
    lockupBox: { left: 1964, top: 110, right: 2421, bottom: 410 },
    alignX: "right",
    copyLayers: ["Out Now", "Ellipse 2 copy", "Timeless"],
    outNowTextLayer: "OUT NOW ON TIMELESS",
    colorLayers: ["SC", "YT", "SP", "AM", "Ellipse 2 copy"],
  },
  flyer: {
    // The area the template's MAULIK / SHE WANTS / TO PARTY placeholders fill.
    lockupBox: { left: 249, top: 800, right: 830, bottom: 1036 },
    alignX: "center",
    copyLayers: ["COMING SOON", "Timeless"],
    wordingLayer: "COMING SOON",
  },
  youtube: {
    // 960x594, centered in 1920x1080.
    lockupBox: { left: 480, top: 243, right: 1440, bottom: 837 },
    alignX: "center",
    logoGap: 30,
  },
};

const boardByName = (name) => BOARDS.find((b) => b.name === name);

module.exports = { BOARDS, TEMPLATE_LAYOUT, boardByName };
