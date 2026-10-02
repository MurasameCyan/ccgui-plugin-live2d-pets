import { registerCubism5Runtime } from "./cubism5";

// The adapter is loaded as the final classic script after Pixi and the shared
// pixi-live2d-display factory have initialized their globals.
registerCubism5Runtime();
