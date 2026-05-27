// Barrel re-export. Split into three focused sub-modules:
//   drawing-store.js   — DrawingStore, PrefsStore, util
//   drawing-tools.js   — TOOL_DEFS, geometry helpers
//   drawing-layer.js   — DrawingLayer, StyleModal, SettingsPopover

export { DrawingStore, PrefsStore, util }           from "./modules/drawing-store.js";
export { TOOL_DEFS, TOOL_DEFS_BY_ID, distPointToSegment }
                                                    from "./modules/drawing-tools.js";
export { DrawingLayer, StyleModal, SettingsPopover } from "./modules/drawing-layer.js";
