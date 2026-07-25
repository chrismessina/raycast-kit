import assert from "node:assert/strict";
import { test } from "node:test";

// Leaf module, not the barrel — see the note in errors.test.mjs.
import { countOf, plural } from "../dist/plural.js";

test("plural: singular at exactly 1", () => {
  assert.equal(plural(1, "device"), "device");
  assert.equal(plural(-1, "device"), "device");
});

test("plural: regular -s", () => {
  assert.equal(plural(0, "device"), "devices");
  assert.equal(plural(2, "device"), "devices");
});

test("plural: sibilant endings take -es", () => {
  assert.equal(plural(2, "match"), "matches");
  assert.equal(plural(2, "box"), "boxes");
  assert.equal(plural(2, "bus"), "buses");
  assert.equal(plural(2, "dish"), "dishes");
});

test("plural: consonant + y takes -ies, vowel + y takes -s", () => {
  assert.equal(plural(2, "city"), "cities");
  assert.equal(plural(2, "entry"), "entries");
  assert.equal(plural(2, "day"), "days");
  assert.equal(plural(2, "key"), "keys");
});

test("plural: irregulars", () => {
  assert.equal(plural(2, "person"), "people");
  assert.equal(plural(2, "child"), "children");
  assert.equal(plural(2, "datum"), "data");
  assert.equal(plural(2, "index"), "indices");
});

test("plural: irregulars preserve capitalization", () => {
  assert.equal(plural(2, "Person"), "People");
});

test("plural: unchanging nouns", () => {
  assert.equal(plural(2, "series"), "series");
  assert.equal(plural(2, "species"), "species");
});

test("plural: -f/-fe becomes -ves", () => {
  assert.equal(plural(2, "leaf"), "leaves");
  assert.equal(plural(2, "life"), "lives");
});

test("plural: -o exceptions stay -s", () => {
  assert.equal(plural(2, "video"), "videos");
  assert.equal(plural(2, "photo"), "photos");
  assert.equal(plural(2, "logo"), "logos");
});

test("plural: explicit override wins", () => {
  assert.equal(plural(2, "match", "matchez"), "matchez");
});

test("countOf: agrees across zero, one, many", () => {
  assert.equal(countOf(0, "device"), "0 devices");
  assert.equal(countOf(1, "device"), "1 device");
  assert.equal(countOf(7, "device"), "7 devices");
});

// The specific defect House Style names: `${n} items` says "1 items" at count 1.
test("countOf: never renders '1 items'", () => {
  assert.equal(countOf(1, "item"), "1 item");
  assert.notEqual(countOf(1, "item"), "1 items");
});

test("countOf: worded zero via the zero option", () => {
  assert.equal(countOf(0, "device", { zero: "No devices" }), "No devices");
  // The option must not leak into non-zero counts.
  assert.equal(countOf(1, "device", { zero: "No devices" }), "1 device");
});

test("countOf: explicit plural passes through", () => {
  assert.equal(countOf(3, "match", { plural: "matches" }), "3 matches");
});

test("countOf: large counts get locale separators", () => {
  assert.equal(countOf(1234, "item"), "1,234 items");
});

test("countOf: output never contains the prohibited (s) crutch", () => {
  for (const n of [0, 1, 2, 11, 100]) {
    assert.doesNotMatch(countOf(n, "item"), /\(s\)|\(es\)/);
  }
});
