import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { APP_ROOT_PATH } from '../lib/paths.js';

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/4690 —
// "pl-vector label offset issues in 2nd quadrant".
//
// pl-vector / pl-double-headed-vector position their text label at the arrow head.
// With fabric's default top-left origin the label box always grew down-and-right,
// so it landed back on the shaft whenever the head pointed left/up (the reporter's
// ~110-160 range). The fix adds a pure helper `mechanicsObjects.vectorLabelPosition`
// that anchors the bounding-box corner facing the head and pushes the offset
// outward, so the label clears the shaft in every direction.
//
// mechanicsObjects.js is a browser global script (it references fabric/Sylvester at
// load time), so we can't `import` it. Instead we load the SHIPPED file into a vm
// context with those globals stubbed and exercise the real helper directly.

interface LabelPos {
  left: number;
  top: number;
  originX: 'left' | 'right';
  originY: 'top' | 'bottom';
}
interface VectorObj {
  left: number;
  top: number;
  offsetx: number;
  offsety: number;
}
type VectorLabelPositionFn = (obj: VectorObj, dx: number, dy: number) => LabelPos;

function loadVectorLabelPosition(): VectorLabelPositionFn {
  const file = path.join(APP_ROOT_PATH, 'elements', 'pl-drawing', 'mechanicsObjects.js');
  const src = readFileSync(file, 'utf8');

  // Minimal stubs for the globals the script touches at load time. We only need
  // enough for the file to evaluate; the helper under test is pure arithmetic.
  const noop = () => undefined;
  const vectorStub = (arr: number[]) => ({
    e: (i: number) => arr[i - 1],
    modulus: () => 0,
    toUnitVector: () => vectorStub(arr),
    multiply: () => vectorStub(arr),
    dot: () => 0,
  });
  const Sylvester = {
    Vector: {
      create: (arr: number[]) => vectorStub(arr),
      prototype: {} as Record<string, unknown>,
    },
  };
  const fabric = {
    Object: class {},
    util: {
      createClass: () => class {},
      object: { extend: (a: object) => a },
    },
    Image: { fromURL: noop },
    Text: class {},
    Rect: class {},
    Line: class {},
  };
  const sandbox: Record<string, unknown> = {
    Sylvester,
    fabric,
    MathJax: { startup: { promise: Promise.resolve() } },
    _: {},
    console,
    window: { PLDrawingApi: { registerElements: noop, generateID: () => 0 } },
    // PLDrawingBaseElement is referenced as a bare global in the file.
    PLDrawingBaseElement: class {},
    __mechanicsObjects: undefined as { vectorLabelPosition?: VectorLabelPositionFn } | undefined,
  };
  // Expose mechanicsObjects after the script runs.
  const code = src + '\n;__mechanicsObjects = mechanicsObjects;';
  const ctx = createContext(sandbox);
  runInContext(code, ctx, { filename: 'mechanicsObjects.js' });
  const mo = sandbox.__mechanicsObjects as { vectorLabelPosition?: VectorLabelPositionFn } | undefined;
  expect(mo, 'mechanicsObjects failed to load from the element script').toBeTruthy();
  expect(typeof mo?.vectorLabelPosition, 'vectorLabelPosition helper is missing').toBe('function');
  return mo!.vectorLabelPosition as VectorLabelPositionFn;
}

// The canvas is y-DOWN; `angle` is positive clockwise (see docs/pl-drawing). The
// head displacement is (w*cos, w*sin). For a vector anchored at the tail `(left,
// top)` with the default offset (2,2), the label must sit on the OUTWARD side of
// the head along the vector direction in every quadrant.
const TAIL = { left: 100, top: 100, offsetx: 2, offsety: 2 };
const WIDTH = 80;

function labelAnchorFor(angleDeg: number, place: VectorLabelPositionFn) {
  const a = (Math.PI * angleDeg) / 180;
  const dx = WIDTH * Math.cos(a);
  const dy = WIDTH * Math.sin(a);
  const head = { x: TAIL.left + dx, y: TAIL.top + dy };
  const pos = place(TAIL, dx, dy);
  // Signed projection of (labelAnchor - head) onto the unit vector direction.
  // > 0 means the label anchor is pushed outward (away from the tail) along the
  // shaft axis — i.e. it cannot fall back over the shaft.
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const proj = (pos.left - head.x) * ux + (pos.top - head.y) * uy;
  return { pos, head, proj, dx, dy };
}

describe('pl-vector label offset (issue #4690)', () => {
  const place = loadVectorLabelPosition();

  // The full circle, with the reporter's 110-160 range and all four diagonals.
  const angles = [0, 30, 45, 90, 110, 135, 150, 160, 180, 210, 225, 270, 315, 330];

  it.each(angles)('anchors the label outward of the head at angle %i', (angleDeg) => {
    const { pos, proj, dx, dy } = labelAnchorFor(angleDeg, place);

    // The offset must push the anchor outward (never back over the shaft).
    expect(
      proj,
      `label anchor must be outward of the head (proj >= 0) at ${angleDeg}°`,
    ).toBeGreaterThanOrEqual(0);

    // The chosen origin corner must FACE the head so the box grows away from it.
    expect(pos.originX).toBe(dx < 0 ? 'right' : 'left');
    expect(pos.originY).toBe(dy < 0 ? 'bottom' : 'top');
  });

  it('reproduces the bug class: up-left vectors used to point the label back over the shaft', () => {
    // The reporter's exact range (110-160) and the up-left diagonal (225) are the
    // failing cases. Under the OLD placement (anchor = head + (offsetx, offsety),
    // origin top-left) the projection along the shaft was negative for these; the
    // helper must now keep them outward.
    for (const angleDeg of [110, 135, 150, 160, 180, 210, 225]) {
      const { proj } = labelAnchorFor(angleDeg, place);
      expect(proj, `up-left vector ${angleDeg}° must place the label outward`).toBeGreaterThan(0);
    }
  });

  it('does not move the label for right/down-pointing vectors (no regression)', () => {
    // For the previously-correct cases the helper must reproduce the old placement
    // exactly: anchor = head + (offsetx, offsety), origin top-left.
    for (const angleDeg of [0, 30, 45, 90]) {
      const a = (Math.PI * angleDeg) / 180;
      const dx = WIDTH * Math.cos(a);
      const dy = WIDTH * Math.sin(a);
      const pos = place(TAIL, dx, dy);
      expect(pos.left).toBeCloseTo(TAIL.left + dx + TAIL.offsetx, 6);
      expect(pos.top).toBeCloseTo(TAIL.top + dy + TAIL.offsety, 6);
      expect(pos.originX).toBe('left');
      expect(pos.originY).toBe('top');
    }
  });
});
