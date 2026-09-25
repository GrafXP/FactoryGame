import { BUILDINGS, footprint, beltLine } from "./sim/buildings.js";
import { canFit, place, entityAt, tileAt, startMining, stopMining } from "./sim/world.js";
import { affordable, missing } from "./sim/inventory.js";
import { describe } from "./sim/items.js";
import { usesPower } from "./sim/power.js";
import { lockedWhy } from "./sim/progress.js";
import { exitSpots } from "./sim/underground.js";
import { entitiesIn, layoutOf, rotateLayout, layoutCost, planLayout, buildLayout, layoutFits, removeEntities } from "./sim/layout.js";

// Buildings that show which ground the poles power while you place them or look at them.
const onPower = (type) => type === "pole" || type === "generator" || usesPower(type);

const UNDO_LIMIT = 50;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What a paste or an undo couldn't build, e.g. "2 in the way, missing 4 iron plates".
const skippedText = (r) =>
  [r.blocked && `${r.blocked} in the way`, r.locked && `${r.locked} locked`, r.short && `missing ${describe(r.short)}`]
    .filter(Boolean)
    .join(", ");

// Build mode: the current tool and facing, the ghost preview, and turning taps and
// drags into sim calls. Tools are a building type, "remove", "select", "paste", or
// null (inspect). With no tool, pressing and holding on ore hand-mines it.
//
// A mouse shows the ghost under the cursor and a click builds. A finger would hide
// the ghost, so touch builds in two taps: the first leaves the ghost where you
// tapped, a tap on the ghost builds it, and a tap anywhere else moves it. Removing
// works the same way: the first tap marks a building, a second tap on it removes it.
// With a building picked, tapping another building (not the ghost) picks one like
// it, facing the same way.
//
// Underground belts go in two steps: after an entrance is built, the tiles ahead of
// it where its exit can go light up, and a tap on one builds the exit there (one
// tap, touch too, since the lit tile shows where it goes). Tapping an entrance that
// has no exit lights its tiles again. Tapping anywhere else, rotating or changing
// tools goes back to placing entrances.
//
// Select: drag a box, like a belt line (touch: press and hold first), or tap a
// building. The buildings with a tile in the box are selected, and can be copied,
// cut, removed, or turned where they stand. Copying or cutting switches to pasting
// (sim/layout.js): the whole layout is one ghost, placed like a building, green
// where each part fits and can be paid for; Rotate turns it. It stays picked, to
// paste again. Undo takes back the last build, removal, cut, paste or turn, up to
// UNDO_LIMIT of them. Neither the clipboard nor the undo history is saved.
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
  let box = null; // { start: tile, end: tile } while dragging a selection box
  let gesture = null; // "belt", "box" or "mine" while a press-and-hold is under way
  let inspected = null; // tile shown with the inspect tool
  let entrance = null; // an underground entrance waiting for its exit
  let selection = null; // { x, y, w, h }: the box selected with the Select tool
  let clipboard = null; // the layout copied or cut last
  const history = []; // what Undo takes back, newest last: { built: [ids], removed: layout | null }

  const fits = (type, r) => (x, y) => !canFit(world, type, x, y, r);
  // Where the waiting entrance's exit can go, or [] if it's no longer waiting.
  const spots = () => {
    if (entrance && (!world.entities.has(entrance.id) || entrance.pair)) entrance = null;
    return entrance ? exitSpots(world, entrance, fits("underground", entrance.rot)) : [];
  };
  const spotAt = (t) => spots().find((s) => s.x === t.x && s.y === t.y);

  const tileOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
  const rectOf = (e) => ({ x: e.x, y: e.y, ...footprint(e.type, e.rot) });
  const inRect = (t, r) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
  const boxOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 });

  // Top-left tile for `type` so its footprint sits centred under the pointer.
  const anchorAt = (type, p) => {
    const { w, h } = footprint(type, rot);
    return { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) };
  };
  // The box the clipboard would be pasted into, centred under the pointer.
  const pasteRect = (p) => ({ x: Math.round(p.x - clipboard.w / 2), y: Math.round(p.y - clipboard.h / 2), w: clipboard.w, h: clipboard.h });

  // The box being dragged, or else the selection; and the buildings in it.
  const selBox = () => (box ? boxOf(box.start, box.end) : selection);
  const selected = () => {
    const b = selBox();
    return b ? entitiesIn(world, b) : [];
  };

  const planned = () => {
    if (paint) {
      return beltLine(paint.start.x, paint.start.y, paint.end.x, paint.end.y, rot).map((t) => ({ type: "belt", ...t }));
    }
    const at = pointer || pending;
    if (!at || !BUILDINGS[tool]) return [];
    if (tool === "underground" && entrance) {
      const spot = spotAt(tileOf(at));
      return spot ? [{ type: tool, rot: entrance.rot, model: "underground-out", ...spot }] : [];
    }
    return [{ type: tool, rot, ...anchorAt(tool, at), ...(tool === "underground" ? { model: "underground-in" } : {}) }];
  };

  // Ghosts are green where they fit, for as many as the inventory can pay for.
  const ghosts = () => {
    if (tool === "paste") {
      const at = pointer || pending;
      if (!at) return [];
      const { x, y } = pasteRect(at);
      return planLayout(world, clipboard, x, y).map((p) => ({
        type: p.type,
        x: p.x,
        y: p.y,
        rot: p.rot,
        ...(p.type === "underground" ? { model: `underground-${p.end}` } : {}),
        ok: !p.why,
      }));
    }
    const list = planned();
    let budget = list.length ? affordable(world.inventory, BUILDINGS[list[0].type].cost) : 0;
    return list.map((p) => {
      const ok = !canFit(world, p.type, p.x, p.y, p.rot) && budget > 0;
      if (ok) budget--;
      return { ...p, ok };
    });
  };

  // Whether ground point p is on the waiting touch ghost.
  const onPending = (p) => {
    if (!pending) return false;
    const r = tool === "paste" ? pasteRect(pending) : { ...anchorAt(tool, pending), ...footprint(tool, rot) };
    return inRect(tileOf(p), r);
  };

  const refresh = () => {
    const sel = tool === "select" ? selBox() : null;
    view.setMarks(tool === "underground" ? spots() : sel ? entitiesIn(world, sel).map(rectOf) : null);
    const list = ghosts();
    view.setGhosts(list);
    if (tool === "remove") {
      if (marked && !world.entities.has(marked.id)) marked = null;
      const e = pointer ? entityAt(world, Math.floor(pointer.x), Math.floor(pointer.y)) : marked;
      view.setHighlight(e && rectOf(e), "remove");
    } else if (sel) {
      view.setHighlight(sel, "box");
    } else if (tool === "paste" && (pointer || pending)) {
      view.setHighlight(pasteRect(pointer || pending), "box");
    } else if (tool === null && inspected && !gesture) {
      const e = entityAt(world, inspected.x, inspected.y);
      view.setHighlight(e ? rectOf(e) : { ...inspected, w: 1, h: 1 });
    } else {
      view.setHighlight(null);
    }
    // Where power reaches, while placing something electric (with a new pole's
    // area and wires) or looking at it.
    const looking = tool === null && inspected && entityAt(world, inspected.x, inspected.y);
    const electric = tool === "paste" ? clipboard.parts.some((p) => onPower(p.type)) : onPower(tool);
    if (electric) view.setPowerOverlay({ pole: tool === "pole" && list[0] ? { x: list[0].x, y: list[0].y } : null });
    else view.setPowerOverlay(looking && onPower(looking.type) ? { pole: null } : null);
  };

  // What the build controls show: the tool, how many buildings are selected, what
  // the clipboard holds and costs, and whether there's anything to undo.
  const state = () => ({
    tool,
    rot,
    selected: tool === "select" && selection ? entitiesIn(world, selection).length : 0,
    clipboard: clipboard && { count: clipboard.parts.length, cost: layoutCost(clipboard) },
    canUndo: history.length > 0,
  });

  const changed = () => {
    onChange?.(state());
    refresh();
  };

  // Remembers an action for Undo: the buildings it built and the layout of those
  // it removed (taken before they went).
  const record = (built, removed = null) => {
    history.push({ built: built.map((e) => e.id), removed });
    if (history.length > UNDO_LIMIT) history.shift();
    onChange?.(state());
  };

  // Switches to tool `next`, dropping whatever the last one was part way through.
  const use = (next) => {
    tool = next;
    paint = null;
    box = null;
    pending = null;
    marked = null;
    inspected = null;
    entrance = null;
    selection = null;
    onInspect?.(null);
    changed();
  };

  // Picks a building like e, facing the same way.
  const pick = (e) => {
    const locked = lockedWhy(world, e.type);
    if (locked) return onMessage?.(locked);
    rot = e.rot;
    use(e.type);
  };

  // Selects the buildings with a tile in `rect`; a single tile selects the whole
  // of the building on it.
  const select = (rect) => {
    const list = entitiesIn(world, rect);
    selection = !list.length ? null : rect.w === 1 && rect.h === 1 ? rectOf(list[0]) : rect;
    changed();
  };

  // Pastes the clipboard centred on ground point p.
  const paste = (p) => {
    const { x, y } = pasteRect(p);
    const r = buildLayout(world, clipboard, x, y);
    pending = null;
    if (r.built.length) record(r.built);
    const n = r.built.length;
    if (n === r.total) onMessage?.(`Pasted ${plural(n, "building")}`);
    else if (n) onMessage?.(`Pasted ${n} of ${plural(r.total, "building")}: ${skippedText(r)}`);
    else onMessage?.(`Can't paste here: ${skippedText(r)}`);
  };

  // Turns the selected buildings a quarter clockwise where they stand. They're
  // taken down and built again turned, so what they held goes to the inventory.
  const turnSelection = () => {
    const list = selected();
    if (!list.length) return onMessage?.("Select some buildings to rotate first");
    const before = layoutOf(list);
    const turned = rotateLayout(before);
    const why = layoutFits(world, turned, turned.x, turned.y, new Set(list.map((e) => e.id)));
    if (why) return onMessage?.(`Can't rotate it here: ${why.toLowerCase()}`);
    const back = removeEntities(world, list);
    const r = buildLayout(world, turned, turned.x, turned.y);
    record(r.built, before);
    selection = { x: turned.x, y: turned.y, w: turned.w, h: turned.h };
    // What they held: what came back, less what building them again took.
    const held = { ...back };
    for (const e of r.built) for (const [id, n] of Object.entries(BUILDINGS[e.type].cost)) held[id] -= n;
    for (const id in held) if (held[id] <= 0) delete held[id];
    if (r.built.length < r.total) onMessage?.(`Rotated ${r.built.length} of ${plural(r.total, "building")}: ${skippedText(r)}`);
    else if (Object.keys(held).length) onMessage?.(`Rotated. What they held went to your inventory: ${describe(held)}`);
    changed();
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
    // Picking the active tool again puts it away. A locked building can't be
    // picked, and there's nothing to paste until something has been copied.
    setTool(next) {
      const locked = BUILDINGS[next] && lockedWhy(world, next);
      if (locked) return onMessage?.(locked);
      if (next === "paste" && !clipboard) return onMessage?.("Nothing to paste yet: select some buildings and copy them");
      use(next === tool ? null : next);
    },
    // Puts the tools away and shows building e's panel, as if it had been tapped.
    inspect(e) {
      if (tool !== null) this.setTool(null);
      inspected = tileAt(world, e.x, e.y);
      onInspect?.(inspected);
      refresh();
    },
    // Drops the inspected tile, e.g. when its panel is closed.
    closeInspect() {
      inspected = null;
      onInspect?.(null);
      refresh();
    },
    // Turns the next building, the ghost being pasted, or the selection where it stands.
    rotate() {
      if (tool === "paste") {
        clipboard = rotateLayout(clipboard);
        return changed();
      }
      if (tool === "select") return turnSelection();
      rot = (rot + 1) % 4;
      entrance = null;
      changed();
    },
    // Picks the building under the mouse, if there is one. Returns whether it did.
    pickHovered() {
      const e = pointer && entityAt(world, Math.floor(pointer.x), Math.floor(pointer.y));
      if (e) pick(e);
      return !!e;
    },
    // Copies the selection and switches to pasting it.
    copy() {
      const list = selected();
      if (!list.length) return onMessage?.("Select some buildings to copy first");
      clipboard = layoutOf(list);
      use("paste");
    },
    // Takes the selection down and switches to pasting it somewhere else.
    cut() {
      const list = selected();
      if (!list.length) return onMessage?.("Select some buildings to cut first");
      clipboard = layoutOf(list);
      removeEntities(world, list);
      record([], clipboard);
      use("paste");
      onMessage?.(`Cut ${plural(list.length, "building")}. Paste to put them down again`);
    },
    // Removes everything selected, giving back what it cost and held.
    removeSelected() {
      const list = selected();
      if (!list.length) return onMessage?.("Select some buildings to remove first");
      const layout = layoutOf(list);
      const back = removeEntities(world, list);
      record([], layout);
      selection = null;
      onMessage?.(`Removed ${plural(list.length, "building")}. Got back ${describe(back)}`);
      changed();
    },
    // Takes back the last action: what it built comes down (and is refunded), and
    // what it removed is built again, paid for, with its settings.
    undo() {
      const entry = history.pop();
      if (!entry) return onMessage?.("Nothing to undo");
      const gone = entry.built.map((id) => world.entities.get(id)).filter(Boolean);
      const back = removeEntities(world, gone);
      const rebuilt = entry.removed && buildLayout(world, entry.removed, entry.removed.x, entry.removed.y);
      if (rebuilt) {
        // Rebuilt buildings have new ids; older entries that built them follow.
        for (const h of history) h.built = h.built.map((id) => rebuilt.ids.get(id) ?? id);
        const n = rebuilt.built.length;
        if (n < rebuilt.total) onMessage?.(`Undone, but only ${n} of ${plural(rebuilt.total, "building")} rebuilt: ${skippedText(rebuilt)}`);
        else onMessage?.(`Undone: rebuilt ${plural(n, "building")}`);
      } else if (gone.length) onMessage?.(`Undone. Got back ${describe(back)}`);
      else onMessage?.("Nothing left to undo there");
      changed();
    },
    // Belts are dragged out in lines and selections in boxes; with no tool, holding
    // on bare ore mines it.
    canPaint(p) {
      if (tool === "belt" || tool === "select") return "drag";
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
      if (tool === "underground" && entrance) {
        const spot = spotAt(t);
        if (spot) {
          const short = missing(world.inventory, BUILDINGS.underground.cost);
          if (short) onMessage?.(`Can't build: missing ${describe(short)}`);
          else {
            const exit = place(world, "underground", spot.x, spot.y, entrance.rot, { end: "out" });
            if (exit) record([exit]);
          }
          pending = null;
          return refresh();
        }
        entrance = null; // somewhere else: back to placing entrances
      }
      const here = entityAt(world, t.x, t.y);
      if (tool === "underground" && here?.type === "underground" && here.end === "in" && !here.pair) {
        entrance = here; // an entrance without an exit: light up where it can go
        pending = null;
        hint("Tap a lit tile to place the exit");
        return refresh();
      }
      if (tool === "select") {
        if (!here) hint(twoTap ? "Press and hold, then drag a box over buildings to select them" : "Drag a box over buildings to select them");
        return select({ ...t, w: 1, h: 1 });
      }
      if (tool === "paste") {
        if (twoTap && !onPending(p)) {
          pending = p;
          hint("Tap the ghost again to paste");
        } else paste(twoTap ? pending : p);
        return refresh();
      }
      if (tool === "remove") {
        if (!here) {
          marked = null;
          onMessage?.("Nothing to remove here");
        } else if (twoTap && here !== marked) {
          marked = here;
          hint("Tap it again to remove it");
        } else {
          const layout = layoutOf([here]);
          const back = removeEntities(world, [here]);
          record([], layout);
          marked = null;
          onMessage?.(`Got back ${describe(back)}`);
        }
      } else if (BUILDINGS[tool] && here && !onPending(p)) {
        pick(here);
        hint("Tapping a building picks one like it, facing the same way");
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
          const built = place(world, tool, x, y, rot);
          pending = null;
          if (built) record([built]);
          if (built?.type === "underground" && !built.pair) {
            entrance = built;
            if (spots().length) hint("Tap a lit tile to place the exit");
          }
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
      } else if (tool === "select") {
        gesture = "box";
        box = { start: tileOf(p), end: tileOf(p) };
      } else {
        gesture = "mine";
        mineAt(p);
      }
      refresh();
    },
    paintMove(p) {
      if (gesture === "mine") return mineAt(p);
      const drag = gesture === "box" ? box : paint;
      const end = tileOf(p);
      if (!drag || (end.x === drag.end.x && end.y === drag.end.y)) return;
      drag.end = end;
      refresh();
    },
    // Lays every belt of the line that fits and can be paid for, skipping blocked
    // tiles, or selects the box. A mouse click is a drag that stays on one tile:
    // on a building, it picks that building (belts) or selects it.
    paintEnd() {
      const was = gesture;
      gesture = null;
      if (was === "mine") {
        stopMining(world);
        return refresh();
      }
      if (was === "box" && box) {
        const rect = boxOf(box.start, box.end);
        box = null;
        return select(rect);
      }
      if (!paint) return refresh();
      const line = planned();
      paint = null;
      const on = line.length === 1 && entityAt(world, line[0].x, line[0].y);
      if (on) return pick(on);
      const built = [];
      let blocked = 0;
      for (const b of line) {
        if (canFit(world, b.type, b.x, b.y, b.rot)) blocked++;
        else {
          const e = place(world, b.type, b.x, b.y, b.rot);
          if (e) built.push(e);
        }
      }
      if (built.length) record(built);
      const placed = built.length;
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
      box = null;
      refresh();
    },
  };
}
