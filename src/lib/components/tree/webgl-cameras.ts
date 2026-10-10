/**
 * Camera preset ids for the WebGL tree views. The DOM canvas names the preset buttons and the
 * scene aims the camera, so both need the ids; keeping them here — free of three.js — lets a
 * canvas component import them statically without pulling its scene module, and three.js with
 * it, into the eager bundle. The scene module is then reachable only through the dynamic
 * `import()` in `createScene`, which is what keeps three.js out of the initial page load.
 */
export const RING_CAMERAS = { ANGLED: 'angled', SIDE: 'side', ABOVE: 'above' } as const;

export const POINCARE_CAMERAS = { ANGLED: 'angled', SIDE: 'side', POLE: 'pole' } as const;

export const RIBBONS_CAMERAS = { ANGLED: 'angled', SIDE: 'side', EDGE: 'edge' } as const;

export const ORRERY_CAMERAS = { ANGLED: 'angled', SIDE: 'side' } as const;
