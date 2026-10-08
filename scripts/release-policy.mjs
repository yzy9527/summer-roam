// Phase-two baseline: 38 files / 118.82 MiB. Three user-supplied zombie GLBs
// add 12.4 MiB without texture recompression; allow this registered expansion.
// The wooden cattle cart adds one embedded-texture GLB (1.33 MiB).
// The completed user-supplied Hokage mountain adds one 7.47 MiB GLB and credits.
// Byte budgets are packaging limits, never FPS claims.
// The user-supplied animated cooking set adds one embedded-texture GLB.
// Existing corral updates already exceed 800 KiB; include the native animation mixer.
// Night background music adds one original 8.18 MiB MP3.
// Nohara exploration adds two user-supplied rigs and four short Mandarin preview clips.
// Retired human actors and speech are local-only in local-archive/.
// Existing limits remain caps, not a statement of current shipped size.
// Calf pursuit/rescue state machine, giant running and its QA add ~16 KiB of code.
export const RELEASE_BUDGET = Object.freeze({
  // Crew cart adds a separately editable 1.4 MiB asset; original cart is retained.
  files: 58,
  totalBytes: 224 * 1024 * 1024,
  // Object-specific action menu, manual calf tasks and voice calls add ~20 KiB.
  // White radial buttons, action icons and contextual hotkeys add up to 8 KiB.
  // Hanging lookout bell, independent ringing/alarm actions and media-driven
  // warning voice add up to 8 KiB. Binary recording stays within totalBytes.
  // Extracted flag skin, upright holding/fist pose, cloth flutter and hand QA
  // add up to 8 KiB; keep the binary/file limits unchanged.
  // Independent unloading/parking, calf throw into the pen and the left-hand
  // guard gesture with its media lifecycle/inspection add up to 8 KiB.
  // Paddy ploughing reuses existing GLBs. Its convoy, deforming tools,
  // bounded water/mud effects and original synthesized foley add ~14 KiB.
  // Its independent curved wooden plough adds one ~0.5 MiB GLB within the
  // existing file/byte caps; surface-fitting harness code stays within this cap.
  // Fixed canvas cursor removes continuous scene picking and its code;
  // rendering cadence/distance gates now fit the original 1024 KiB cap.
  // This cap tracks code bytes; it is not a frame-time target.
  // User-approved captured-calf ploughing adds the round-trip task, shared gate
  // handoff, contextual actions and QA; allow 16 KiB without raising asset caps.
  // Independent field-worker lifecycle, idle patrols, supported giant squat and
  // route-aware traffic/patrol selection total about 1043 KiB after minification.
  // Allow this approved runtime expansion; retain the asset/file caps.
  // Merged-field bounds and the skin-mounted whip holster add about 3 KiB.
  codeBytes: 1048 * 1024,
});
