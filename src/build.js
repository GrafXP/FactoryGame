import { BUILDINGS, footprint, beltLine } from "./sim/buildings.js";
import { canPlace, place, removeAt, entityAt, tileAt } from "./sim/world.js";

// Build mode: the current tool and facing, the ghost preview, and turning taps and
// drags into sim calls. Tools are a building type, "remove", or null (inspect).
export function createBuilder(world, view, { onChange, onMessage, onInspect } = {}) {
  let tool = null;
  let rot = 0;
  let pointer = null; // ground point the ghost follows
  let paint = null; // { start: tile, end: tile } while dragging a belt line
  let inspected = null; // tile shown with the inspect tool

  const tileOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
  const rectOf = (e) => ({ x: e.x, y: e.y, ...footprint(e.type, e.rot) });

  // Top-left tile for `type` so its footprint sits centred under the pointer.
  const anchorAt = (type, p) => {
    const { w, h } = footprint(type, rot);
    return { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) };
  };

  const planned = () => {
    if (paint) {
      return beltLine(paint.start.x, paint.start.y, paint.end.x, paint.end.y, rot).map((t) => ({ type: "belt", ...t }));
    }
    if (!pointer || !BUILDINGS[tool]) return [];
    return [{ type: tool, rot, ...anchorAt(tool, pointer) }];
  };

  const refresh = () => {
    view.setGhosts(planned().map((p) => ({ ...p, ok: !canPlace(world, p.type, p.x, p.y, p.rot) })));
    if (tool === "remove") {
      const e = pointer && entityAt(world, Math.floor(pointer.x), Math.floor(pointer.y));
      view.setHighlight(e && rectOf(e), "remove");
    } else if (tool === null && inspected) {
      const e = entityAt(world, inspected.x, inspected.y);
      view.setHighlight(e ? rectOf(e) : { ...inspected, w: 1, h: 1 });
    } else {
      view.setHighlight(null);
    }
  };

  const changed = () => {
    onChange?.({ tool, rot });
    refresh();
  };

  return {
    get tool() {
      return tool;
    },
    // Picking the active tool again puts it away.
    setTool(next) {
      tool = next === tool ? null : next;
      paint = null;
      inspected = null;
      onInspect?.(null);
      changed();
    },
    rotate() {
      rot = (rot + 1) % 4;
      changed();
    },
    canPaint: () => tool === "belt",

    point(p) {
      pointer = p;
      refresh();
    },

    tap(p) {
      const t = tileOf(p);
      if (tool === "remove") {
        if (!removeAt(world, t.x, t.y)) onMessage?.("Nothing to remove here");
      } else if (BUILDINGS[tool]) {
        const { x, y } = anchorAt(tool, p);
        const why = canPlace(world, tool, x, y, rot);
        if (why) onMessage?.(`Can't build here: ${why.toLowerCase()}`);
        else place(world, tool, x, y, rot);
      } else {
        inspected = tileAt(world, t.x, t.y);
        onInspect?.(inspected);
      }
      refresh();
    },

    paintStart(p) {
      paint = { start: tileOf(p), end: tileOf(p) };
      refresh();
    },
    paintMove(p) {
      const end = tileOf(p);
      if (end.x === paint.end.x && end.y === paint.end.y) return;
      paint.end = end;
      refresh();
    },
    // Lays every belt of the line that fits, skipping blocked tiles.
    paintEnd() {
      const line = planned();
      paint = null;
      let blocked = 0;
      for (const b of line) if (!place(world, b.type, b.x, b.y, b.rot)) blocked++;
      if (line.length > 1) rot = line[0].rot; // keep facing the way you dragged
      if (blocked === line.length) onMessage?.("Can't build here: something is in the way");
      changed();
    },
    paintCancel() {
      paint = null;
      refresh();
    },
  };
}
