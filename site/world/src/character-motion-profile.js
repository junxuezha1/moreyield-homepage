const ACTOR_ROOT = new URL("../public/assets/characters/v5/", import.meta.url).href.replace(/\/$/, "");
const frame = (actor, direction, index) =>
  `${ACTOR_ROOT}/${actor}/${direction}/${String(index).padStart(2, "0")}.png`;
const frames = (actor, direction) => [1, 2, 3, 4].map((index) => frame(actor, direction, index));

const CANONICAL_FRAME_SIZE = Object.freeze({ width: 98, height: 115 });
const CANONICAL_FOOT_ANCHOR = Object.freeze({ x: 49, y: 115 });

const missingChinRest = Object.freeze({
  available: false,
  type: "stationary",
  semanticState: "chin-rest",
  label: "待同形象托腮素材",
  fps: 0,
  loop: false,
  frames: Object.freeze([]),
  replacementRequired: true,
  reason:
    "V4 sources only include four walk frames. Legacy chin-rest/thinking art changes the character and color, so it is intentionally not used."
});

function makeActor({ id, label, source, scale }) {
  const right = Object.freeze(frames(id, "right"));
  const left = Object.freeze(frames(id, "left"));
  return Object.freeze({
    id,
    label,
    assetRoot: `${ACTOR_ROOT}/${id}`,
    atlases: Object.freeze({ right: `${ACTOR_ROOT}/${id}/right-atlas.png`, left: `${ACTOR_ROOT}/${id}/left-atlas.png` }),
    source,
    frameSize: CANONICAL_FRAME_SIZE,
    footAnchor: CANONICAL_FOOT_ANCHOR,
    scale,
    directions: Object.freeze({
      right: Object.freeze({ source: "original", frames: right }),
      left: Object.freeze({ source: "derived", derivedFrom: "right", transform: "horizontal-mirror", frames: left })
    }),
    states: Object.freeze({
      idle: Object.freeze({
        available: true,
        type: "stationary",
        semanticState: "idle",
        direction: "right",
        label: `${label} idle`,
        fps: 1,
        loop: true,
        frames: Object.freeze([right[1]]),
        footAnchor: CANONICAL_FOOT_ANCHOR
      }),
      "walk-right": Object.freeze({
        available: true,
        type: "locomotion",
        semanticState: "walk-right",
        direction: "right",
        label: `${label} walk right`,
        fps: 8,
        loop: true,
        frames: right,
        footAnchor: CANONICAL_FOOT_ANCHOR
      }),
      "walk-left": Object.freeze({
        available: true,
        type: "locomotion",
        semanticState: "walk-left",
        direction: "left",
        label: `${label} walk left`,
        fps: 8,
        loop: true,
        derivedFrom: "walk-right",
        frames: left,
        footAnchor: CANONICAL_FOOT_ANCHOR
      }),
      "chin-rest": missingChinRest,
      thinking: missingChinRest,
      review: missingChinRest
    })
  });
}

export const MOTION_PROFILE_V5 = Object.freeze({
  version: 5,
  manifest: null,
  purpose:
    "Registered player and NPC poses share their body and foot anchors across the portal and interior.",
  contract: Object.freeze({
    frameSize: CANONICAL_FRAME_SIZE,
    footAnchor: CANONICAL_FOOT_ANCHOR,
    transparentBackground: true,
    noCssFiltersForIdentity: true,
    missingStatePolicy:
      "Do not fill chin-rest with older NPC art or recolored sprites. Show the explicit missing state until matching v4 artwork exists."
  }),
  actors: Object.freeze({
    player: makeActor({
      id: "player",
      label: "white-clothes player",
      scale: 0.42,
      source:
        "Moreyield supplied character artwork"
    }),
    npc: makeActor({
      id: "npc",
      label: "black-clothes NPC",
      scale: 0.42,
      source:
        "Moreyield supplied character artwork"
    })
  }),
  semanticMap: Object.freeze({
    idle: "idle",
    "walk-left": "walk-left",
    "walk-right": "walk-right",
    "run-left": "walk-left",
    "run-right": "walk-right",
    thinking: "chin-rest",
    review: "chin-rest",
    "chin-rest": "chin-rest",
    interacting: "idle",
    waiting: "idle"
  })
});

export const MOTION_PROFILE = MOTION_PROFILE_V5;

export function getActorMotionProfile(actor) {
  const actorProfile = MOTION_PROFILE.actors[actor];
  if (!actorProfile) throw new RangeError(`Unknown actor: ${actor}`);
  return actorProfile;
}

export function normalizeMotionState(state) {
  return MOTION_PROFILE.semanticMap[state] || state;
}

export function getMotionClip(actor, state) {
  const actorProfile = getActorMotionProfile(actor);
  const normalized = normalizeMotionState(state);
  return actorProfile.states[normalized] || actorProfile.states.idle;
}

export function mapNpcSemanticState(semanticState) {
  return normalizeMotionState(semanticState);
}
