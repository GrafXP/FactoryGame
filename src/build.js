import { BUILDINGS, footprint, beltLine } from "./sim/buildings.js";
import { canFit, place, removeAt, refundOf, entityAt, tileAt, startMining, stopMining } from "./sim/world.js";
import { affordable, missing } from "./sim/inventory.js";
import { describe } from "./sim/items.js";

// Build mode: the current tool and facing, the ghost preview, and turning taps and
// drags into sim calls. Tools are a building type, "remove", or null (inspect).
// With no tool, pressing and holding on ore hand-mines it.
//
// A mouse shows the ghost under the cursor and a click builds. A finger would hide
// the ghost, so touch builds in two taps: the first leaves the ghost where you
// tapped, a tap on the ghost builds it, and a tap anywhere else moves it. Removing
// works the same way: the first tap marks a building, a second tap on it removes it.
export function createBuilder(world, view, { onChange, onMessage, onInspect } = {}) {
  let tool = null;
  let rot = 0;
  let pointer = null; // ground point under a hovering mouse
  let pending = null; // ground point where a touch-placed ghost waits for its second tap
  let marked = null; // building a touch has marked for removal, waiting for its second tap
  const hinted = new Set(); // each "tap again" hint is shown once
  const hint = (text) => {
    if (!hinted.has(text)) onMessage?.(text);
    hinted.add(text);
  };
  let paint = null; // { start: tile, end: tile } while dragging a belt line
  let gesture = null; // "belt" or "mine" while a press-and-hold is under way
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
    const at = pointer || pending;
    if (!at || !BUILDINGS[tool]) return [];
    return [{ type: tool, rot, ...anchorAt(tool, at) }];
  };

  // Whether ground point p is on the waiting touch ghost.
  const onPending = (p) => {
    if (!pending) return false;
    const a = anchorAt(tool, pending);
    const { w, h } = footprint(tool, rot);
    const t = tileOf(p);
    return t.x >= a.x && t.x < a.x + w && t.y >= a.y && t.y < a.y + h;
  };

  const refresh = () => {
    // Ghosts are green where they fit, for as many as the inventory can pay for.
    const list = planned();
    let budget = list.length ? affordable(world.inventory, BUILDINGS[list[0].type].cost) : 0;
    view.setGhosts(
      list.map((p) => {
        const ok = !canFit(world, p.type, p.x, p.y, p.rot) && budget > 0;
        if (ok) budget--;
        return { ...p, ok };
      }),
    );
    if (tool === "remove") {
      if (marked && !world.entities.has(marked.id)) marked = null;
      const e = pointer ? entityAt(world, Math.floor(pointer.x), Math.floor(pointer.y)) : marked;
      view.setHighlight(e && rectOf(e), "remove");
    } else if (tool === null && inspected && !gesture) {
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

  // Mines the tile under p, or stops if there's nothing there to mine.
  const mineAt = (p) => {
    const t = tileOf(p);
    if (startMining(world, t.x, t.y)) stopMining(world);
  };

  return {
    get tool() {
      return tool;
    },
    // Picking the active tool again puts it away.
    setTool(next) {
      tool = next === tool ? null : next;
      paint = null;
      pending = null;
      marked = null;
      inspected = null;
      onInspect?.(null);
      changed();
    },
    // Drops the inspected tile, e.g. when its panel is closed.
    closeInspect() {
      inspected = null;
      onInspect?.(null);
      refresh();
    },
    rotate() {
      rot = (rot + 1) % 4;
      changed();
    },
    // Belts are dragged out in lines; with no tool, holding on bare ore mines it.
    canPaint(p) {
      if (tool === "belt") return "drag";
      if (tool !== null) return false;
      const t = tileAt(world, Math.floor(p.x), Math.floor(p.y));
      return t && t.ore && !t.entity ? "hold" : false;
    },

    point(p) {
      pointer = p;
      refresh();
    },

    tap(p, pointerType) {
      const t = tileOf(p);
      const twoTap = pointerType === "touch" || pointerType === "pen";
      if (tool === "remove") {
        const e = entityAt(world, t.x, t.y);
        if (!e) {
          marked = null;
          onMessage?.("Nothing to remove here");
        } else if (twoTap && e !== marked) {
          marked = e;
          hint("Tap it again to remove it");
        } else {
          const back = refundOf(e);
          removeAt(world, t.x, t.y);
          marked = null;
          onMessage?.(`Got back ${describe(back)}`);
        }
      } else if (BUILDINGS[tool] && twoTap && !onPending(p)) {
        pending = p;
        hint("Tap the ghost again to build");
      } else if (BUILDINGS[tool]) {
        const { x, y } = anchorAt(tool, twoTap ? pending : p);
        const short = missing(world.inventory, BUILDINGS[tool].cost);
        const why = canFit(world, tool, x, y, rot);
        if (short) onMessage?.(`Can't build: missing ${describe(short)}`);
        else if (why) onMessage?.(`Can't build here: ${why.toLowerCase()}`);
        else {
          place(world, tool, x, y, rot);
          pending = null;
        }
      } else {
        inspected = tileAt(world, t.x, t.y);
        onInspect?.(inspected);
      }
      refresh();
    },

    paintStart(p) {
      if (tool === "belt") {
        gesture = "belt";
        paint = { start: tileOf(p), end: tileOf(p) };
      } else {
        gesture = "mine";
        mineAt(p);
      }
      refresh();
    },
    paintMove(p) {
      if (gesture === "mine") return mineAt(p);
      const end = tileOf(p);
      if (!paint || (end.x === paint.end.x && end.y === paint.end.y)) return;
      paint.end = end;
      refresh();
    },
    // Lays every belt of the line that fits and can be paid for, skipping blocked tiles.
    paintEnd() {
      const was = gesture;
      gesture = null;
      if (was === "mine") {
        stopMining(world);
        return refresh();
      }
      if (!paint) return refresh();
      const line = planned();
      paint = null;
      let placed = 0;
      let blocked = 0;
      for (const b of line) {
        if (canFit(world, b.type, b.x, b.y, b.rot)) blocked++;
        else if (place(world, b.type, b.x, b.y, b.rot)) placed++;
      }
      const unpaid = line.length - placed - blocked;
      const short = unpaid && describe(missing(world.inventory, BUILDINGS.belt.cost, unpaid));
      if (line.length > 1) rot = line[0].rot; // keep facing the way you dragged
      if (unpaid && placed) onMessage?.(`Built ${placed} of ${placed + unpaid} belts: missing ${short}`);
      else if (unpaid) onMessage?.(`Can't build: missing ${short}`);
      else if (blocked === line.length) onMessage?.("Can't build here: something is in the way");
      changed();
    },
    paintCancel() {
      if (gesture === "mine") stopMining(world);
      gesture = null;
      paint = null;
      refresh();
    },
  };
}
