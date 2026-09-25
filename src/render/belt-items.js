import { beltNetwork, isConveyor, isSplitter, BELT_LEN, MID } from "../sim/transport.js";

// Places every item riding a conveyor along its path: straight from the back edge
// to the front, round the corner of a curve, or on a splitter, through the middle
// and out the way it picked. Items underground aren't drawn. `items` is the item layer.
const ITEM_Y = 0.17;
const at = { x: 0, y: 0, turn: 0 };

// Where an item t of the way along a north-facing conveyor sits, relative to the
// tile's centre (x east, y south), and how far it has turned (quarter turns
// clockwise). A corner fed from the left runs round the north-west corner from the
// west edge to the north edge; from the right, the mirror image. A splitter's item
// going left or right (exit 1 or 2) turns at the middle.
const along = (shape, t, exit) => {
  at.turn = 0;
  if (exit) {
    const s = exit === 1 ? -1 : 1;
    at.x = s * (t - 0.5);
    at.y = 0;
    at.turn = s;
  } else if (shape === "straight") {
    at.x = 0;
    at.y = 0.5 - t;
  } else {
    const a = (t * Math.PI) / 2;
    const s = shape === "left" ? 1 : -1;
    at.x = s * (-0.5 + 0.5 * Math.sin(a));
    at.y = -0.5 + 0.5 * Math.cos(a);
  }
};

export function drawBeltItems(world, items) {
  const { shape } = beltNetwork(world);
  let i = 0;
  for (const b of world.entities.values()) {
    if (!isConveyor(b) || !b.items.length) continue;
    const kind = shape.get(b) || "straight";
    const split = isSplitter(b);
    for (const it of b.items) {
      if (it.pos > BELT_LEN) continue; // underground
      along(kind, it.pos / BELT_LEN, split && it.pos > MID ? it.exit : undefined);
      let { x, y } = at;
      for (let r = 0; r < b.rot; r++) [x, y] = [-y, x]; // a quarter turn clockwise
      items.add(it.item, b.x + 0.5 + x, ITEM_Y, b.y + 0.5 + y, (-(b.rot + at.turn) * Math.PI) / 2, i * 2.4);
      i++;
    }
  }
}

// How many items drawBeltItems will draw, at most.
export function beltItemCount(world) {
  let n = 0;
  for (const e of world.entities.values()) if (isConveyor(e)) n += e.items.length;
  return n;
}
