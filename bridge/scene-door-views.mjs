// The scene MovingDoors' manual view IDs (browser/assets/recovered/scene/manifest.json doors[i].viewID), for a gateway
// run without recoveredDir (tools/gateway.mjs): they are never Created, so without this list GameBridge rejects every
// Context:A on a town or monument door as unknown-target and the door never opens.
export const SCENE_DOOR_VIEWS=Object.freeze([54,42,52,46,48,38,16,40,41,23,59,56,49,43,4,60,37,44,57,50,39,55,31,21,53,61,3,47,45,51,58,62]);
