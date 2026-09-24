import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS } from "../src/sim/buildings.js";
import { CATEGORIES, ABOUT, BUILDING_KEYS } from "../src/ui/catalog.js";

test("every building is in exactly one build menu category, with a description", () => {
  const listed = CATEGORIES.flatMap((c) => c.buildings);
  assert.deepEqual([...listed].sort(), Object.keys(BUILDINGS).sort());
  for (const type in BUILDINGS) assert.ok(ABOUT[type], `${type} has no description`);
});

test("number keys pick real buildings", () => {
  for (const type of Object.values(BUILDING_KEYS)) assert.ok(BUILDINGS[type], type);
});
