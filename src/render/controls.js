// Pointer, wheel and keyboard input for the camera: one finger or any mouse button
// drags the map, two fingers pinch-zoom, the wheel zooms at the cursor. A press that
// barely moves is a tap.
//
// `canPaint(p)` decides what a press at ground point p may turn into. "drag" lays
// things down instead of panning: straight away with the left mouse button, or after
// a long press on touch (so a quick drag still pans). "hold" always waits for a long
// press, with a finger or the left button, so a click or quick drag works as normal.
// `onPoint` follows a hovering mouse (null when it leaves); a finger has no hover.
// `onTap(p, pointerType)` says whether a tap came from "mouse", "touch" or "pen".
// Works through the view's `cam`, never touches the sim. All callbacks get ground
// points { x, y } in tile units (floats).
const TAP_SLOP = 10; // px a press may move and still count as a tap
const LONG_PRESS_MS = 350;
const KEY_PAN = 4; // tiles per arrow/WASD press at the default zoom
const GHOST_CLICK_MS = 800; // how long after a press on the canvas ends its click may come

export function createControls(canvas, cam, { onPoint, onTap, canPaint = () => false, onPaint = {} } = {}) {
  const pointers = new Map(); // pointerId → { x, y }
  let anchor = null; // ground point kept under the finger while dragging
  let pinch = null; // { dist, mid } from the last two-finger move
  let press = null; // { id, x, y } of a press that may still become a tap
  let painting = false;
  let longPress = 0;

  const ground = (e) => cam.groundAt(e.clientX, e.clientY);

  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const stopPainting = (commit) => {
    if (!painting) return;
    painting = false;
    commit ? onPaint.end?.() : onPaint.cancel?.();
  };

  const startGesture = () => {
    clearTimeout(longPress);
    if (pointers.size === 1) {
      const [p] = pointers.values();
      anchor = cam.groundAt(p.x, p.y);
      pinch = null;
    } else if (pointers.size === 2) {
      stopPainting(false);
      anchor = null;
      pinch = twoFingers();
    }
  };

  const onDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press = pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    startGesture();
    if (pointers.size !== 1) return;

    const p = ground(e);
    const mouse = e.pointerType === "mouse";
    const mode = p && canPaint(p);
    if (!mode || (mouse && e.button !== 0)) return;
    const beginPaint = () => {
      painting = true;
      anchor = null;
      onPaint.start?.(p);
    };
    if (mouse && mode === "drag") beginPaint();
    else {
      longPress = setTimeout(() => {
        if (!press || pointers.size !== 1) return;
        navigator.vibrate?.(15);
        beginPaint();
      }, LONG_PRESS_MS);
    }
  };

  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === "mouse") onPoint?.(ground(e));
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) {
      press = null;
      if (!painting) clearTimeout(longPress); // it's a pan, not a tap or a long press
    }

    if (painting) {
      const p = ground(e);
      if (p) onPaint.move?.(p);
      if (e.pointerType === "mouse") onPoint?.(p);
    } else if (pointers.size === 1 && anchor) {
      // Pan so the ground point grabbed at pointerdown stays under the pointer.
      const now = ground(e);
      if (now) cam.panBy(anchor.x - now.x, anchor.y - now.y);
    } else if (pointers.size === 2 && pinch) {
      const next = twoFingers();
      const grabbed = cam.groundAt(pinch.mid.x, pinch.mid.y);
      cam.zoomAt(pinch.dist / Math.max(next.dist, 1), pinch.mid.x, pinch.mid.y);
      const now = cam.groundAt(next.mid.x, next.mid.y);
      if (grabbed && now) cam.panBy(grabbed.x - now.x, grabbed.y - now.y);
      pinch = next;
    }
  };

  // A tap can open something over the spot it was on (a building's panel), and the
  // browser's click that follows the press then lands on whatever is there now, such
  // as an Add button. A click from a press that started on the canvas is only ever
  // the canvas's, so one landing anywhere else is dropped. Keyboard clicks (detail 0)
  // are left alone.
  let pressEnded = -Infinity;
  const onClick = (e) => {
    if (e.target === canvas || !e.detail || e.timeStamp - pressEnded > GHOST_CLICK_MS) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onAnyDown = (e) => {
    if (e.target !== canvas) pressEnded = -Infinity; // a press of its own elsewhere clicks as normal
  };

  const onUp = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    pressEnded = e.timeStamp;
    const up = e.type === "pointerup";
    if (painting) stopPainting(up);
    else if (press?.id === e.pointerId && up) {
      const p = ground(e);
      if (p) onTap?.(p, e.pointerType);
    }
    press = null;
    startGesture(); // lifting one finger of a pinch carries on as a drag
  };

  const onWheel = (e) => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines → pixels
    cam.zoomAt(Math.exp(px * 0.0015), e.clientX, e.clientY);
  };

  const onKey = (e) => {
    if (e.target.closest?.("input, textarea")) return;
    const k = e.key.toLowerCase();
    const step = KEY_PAN * (cam.zoom / 24);
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (k === "arrowleft" || k === "a") cam.panBy(-step, 0);
    else if (k === "arrowright" || k === "d") cam.panBy(step, 0);
    else if (k === "arrowup" || k === "w") cam.panBy(0, -step);
    else if (k === "arrowdown" || k === "s") cam.panBy(0, step);
    else if (k === "+" || k === "=") cam.zoomAt(1 / 1.25, cx, cy);
    else if (k === "-" || k === "_") cam.zoomAt(1.25, cx, cy);
    else return;
    e.preventDefault();
  };

  const onLeave = (e) => e.pointerType === "mouse" && !painting && onPoint?.(null);

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", onKey);
  window.addEventListener("click", onClick, true);
  window.addEventListener("pointerdown", onAnyDown, true);

  return () => {
    clearTimeout(longPress);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("pointerdown", onAnyDown, true);
    // The canvas is removed with the view, taking its listeners with it.
  };
}
