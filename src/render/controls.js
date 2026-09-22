// Pointer, wheel and keyboard input for the camera: one finger or any mouse button
// drags the map, two fingers pinch-zoom, the wheel zooms at the cursor. A press that
// barely moves is a tap. Works through the view's `cam`, never touches the sim.
const TAP_SLOP = 10; // px a press may move and still count as a tap
const KEY_PAN = 4; // tiles per arrow/WASD press

export function createControls(canvas, cam, { onTap, onHover } = {}) {
  const pointers = new Map(); // pointerId → { x, y }
  let anchor = null; // ground point kept under the finger while dragging
  let pinch = null; // { dist, mid } from the last two-finger move
  let press = null; // { id, x, y } of a press that may still become a tap

  const tileAt = (x, y) => {
    const p = cam.groundAt(x, y);
    return p && { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const startGesture = () => {
    if (pointers.size === 1) {
      const [p] = pointers.values();
      anchor = cam.groundAt(p.x, p.y);
      pinch = null;
    } else if (pointers.size === 2) {
      anchor = null;
      pinch = twoFingers();
    }
  };

  const onDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press = pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    startGesture();
  };

  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === "mouse") onHover?.(tileAt(e.clientX, e.clientY));
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) press = null;

    if (pointers.size === 1 && anchor) {
      // Pan so the ground point grabbed at pointerdown stays under the pointer.
      const now = cam.groundAt(e.clientX, e.clientY);
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

  const onUp = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (press?.id === e.pointerId && e.type === "pointerup") onTap?.(tileAt(e.clientX, e.clientY));
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

  const onLeave = (e) => e.pointerType === "mouse" && onHover?.(null);

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", onKey);

  return () => {
    window.removeEventListener("keydown", onKey);
    // The canvas is removed with the view, taking its listeners with it.
  };
}
