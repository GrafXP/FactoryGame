import { beltNetwork, BELT_LEN } from "../sim/transport.js";

// Places every item riding a belt along its belt's path: straight from the back
// edge to the front, or round the corner of a curve. `items` is the item layer.
const ITEM_Y = 0.17;
const at = { x: 0, y: 0 };

// Where an item t of the way along a north-facing belt sits, relative to the tile's
// centre (x east, y south). A corner fed from the left runs round the north-west
// corner from the west edge to the north edge; from the right, the mirror image.
const along = (shape, t) => {
  if (shape === "straight") {
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
    if (b.type !== "belt" || !b.items.length) continue;
    const kind = shape.get(b) || "straight";
    for (const it of b.items) {
      along(kind, it.pos / BELT_LEN);
      let { x, y } = at;
      for (let r = 0; r < b.rot; r++) [x, y] = [-y, x]; // a quarter turn clockwise
      items.add(it.item, b.x + 0.5 + x, ITEM_Y, b.y + 0.5 + y, (-b.rot * Math.PI) / 2, i * 2.4);
      i++;
    }
  }
}

// How many items drawBeltItems will draw.
export function beltItemCount(world) {
  let n = 0;
  for (const e of world.entities.values()) if (e.type === "belt") n += e.items.length;
  return n;
}
