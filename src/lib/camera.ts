// A board's camera: the window, `span` cells across, that a fixed-size board
// shows of a larger grid. Everything is in cell units, and a camera is the
// window's top-left corner.

export type Camera = { x: number; y: number };
/** The window's size in cells: one number for a square window. */
export type Span = number | { w: number; h: number };

function sides(span: Span): { w: number; h: number } {
  return typeof span === "number" ? { w: span, h: span } : span;
}
/** The area a camera may show, in cells: `max` is exclusive. */
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function clampAxis(at: number, span: number, min: number, max: number) {
  if (max - min <= span) return min - (span - (max - min)) / 2;
  return Math.min(Math.max(at, min), max - span);
}

/**
 * Keeps the window inside `bounds`. Bounds narrower than the window are
 * centred in it instead, so the board never pans over nothing.
 */
export function clampCamera(cam: Camera, span: Span, bounds: Bounds): Camera {
  const { w, h } = sides(span);
  const x = clampAxis(cam.x, w, bounds.minX, bounds.maxX);
  const y = clampAxis(cam.y, h, bounds.minY, bounds.maxY);
  return x === cam.x && y === cam.y ? cam : { x, y };
}

/** The window with the middle of `at` in its middle. */
export function centreOn(at: Camera, span: Span): Camera {
  const { w, h } = sides(span);
  return { x: at.x + 0.5 - w / 2, y: at.y + 0.5 - h / 2 };
}

function followAxis(cam: number, at: number, span: number, margin: number) {
  if (at < cam + margin) return at - margin;
  if (at + 1 > cam + span - margin) return at + 1 + margin - span;
  return cam;
}

/**
 * The least movement that keeps the cell `at` at least `margin` cells inside
 * the window, so the view only moves as the cell nears an edge. A cell
 * already out of view is centred instead: the view jumps to it rather than
 * leaving it pinned against the edge.
 */
export function follow(
  cam: Camera,
  at: Camera,
  span: Span,
  margin: number,
): Camera {
  const { w, h } = sides(span);
  const outside =
    at.x + 1 <= cam.x ||
    at.x >= cam.x + w ||
    at.y + 1 <= cam.y ||
    at.y >= cam.y + h;
  if (outside) return centreOn(at, span);
  const x = followAxis(cam.x, at.x, w, margin);
  const y = followAxis(cam.y, at.y, h, margin);
  return x === cam.x && y === cam.y ? cam : { x, y };
}

/**
 * Where an editor opens: centred on what is painted, or on the middle of an
 * empty frame, so a maze can grow from there in every direction.
 */
export function framePainted(
  cells: readonly Camera[],
  span: Span,
  bounds: Bounds,
): Camera {
  const { w, h } = sides(span);
  if (cells.length === 0) {
    return clampCamera(
      {
        x: Math.round((bounds.minX + bounds.maxX - w) / 2),
        y: Math.round((bounds.minY + bounds.maxY - h) / 2),
      },
      span,
      bounds,
    );
  }
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const middle = {
    x: (Math.min(...xs) + Math.max(...xs) + 1) / 2,
    y: (Math.min(...ys) + Math.max(...ys) + 1) / 2,
  };
  return clampCamera(
    { x: Math.round(middle.x - w / 2), y: Math.round(middle.y - h / 2) },
    span,
    bounds,
  );
}
