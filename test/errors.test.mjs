import assert from "node:assert/strict";
import { test } from "node:test";

// Import the LEAF module, not the barrel: `index.js` re-exports `toast.js`, which
// requires `@raycast/api` — a package with no loadable runtime outside Raycast.
// These helpers are pure TypeScript and must stay testable (and importable) without it.
import { getErrorMessage, isAbortError } from "../dist/errors.js";

test("getErrorMessage: Error instance returns its message", () => {
  assert.equal(getErrorMessage(new Error("Boom")), "Boom");
});

test("getErrorMessage: Error with blank message falls back to its name", () => {
  assert.equal(getErrorMessage(new TypeError("")), "TypeError");
  assert.equal(getErrorMessage(new Error("   ")), "Error");
});

test("getErrorMessage: strings pass through, trimmed", () => {
  assert.equal(getErrorMessage("just a string"), "just a string");
  assert.equal(getErrorMessage("  padded  "), "padded");
});

test("getErrorMessage: blank string does not yield empty copy", () => {
  assert.equal(getErrorMessage("   "), "An unknown error occurred.");
});

test("getErrorMessage: null/undefined yield the generic message", () => {
  assert.equal(getErrorMessage(null), "An unknown error occurred.");
  assert.equal(getErrorMessage(undefined), "An unknown error occurred.");
});

test("getErrorMessage: numbers and booleans stringify", () => {
  assert.equal(getErrorMessage(404), "404");
  assert.equal(getErrorMessage(false), "false");
});

test("getErrorMessage: error-shaped objects yield their message field", () => {
  assert.equal(getErrorMessage({ message: "from API" }), "from API");
  assert.equal(getErrorMessage({ statusText: "Not Found" }), "Not Found");
  assert.equal(getErrorMessage({ detail: "bad token" }), "bad token");
});

test("getErrorMessage: nested { error: { message } } JSON API shape", () => {
  assert.equal(getErrorMessage({ error: { message: "rate limited" } }), "rate limited");
});

test("getErrorMessage: string error field wins over nested lookup", () => {
  assert.equal(getErrorMessage({ error: "flat string" }), "flat string");
});

// This is the case a bare `String(error)` ternary gets wrong — the whole reason
// this function exists rather than inlining the ternary.
test("getErrorMessage: plain object never yields [object Object]", () => {
  const result = getErrorMessage({ a: 1, b: 2 });
  assert.equal(result, '{"a":1,"b":2}');
  assert.doesNotMatch(result, /\[object Object\]/);
});

test("getErrorMessage: circular object degrades gracefully", () => {
  const circular = { self: null };
  circular.self = circular;
  assert.equal(getErrorMessage(circular), "An unknown error occurred.");
});

test("getErrorMessage: empty object yields the generic message", () => {
  assert.equal(getErrorMessage({}), "An unknown error occurred.");
});

test("getErrorMessage: subclassed Error still unwraps", () => {
  class ApiError extends Error {}
  assert.equal(getErrorMessage(new ApiError("subclass message")), "subclass message");
});

test("isAbortError: recognizes AbortError by name", () => {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  assert.equal(isAbortError(error), true);
});

test("isAbortError: recognizes TimeoutError and ABORT_ERR code", () => {
  const timeout = new Error("timed out");
  timeout.name = "TimeoutError";
  assert.equal(isAbortError(timeout), true);

  const coded = new Error("aborted");
  coded.code = "ABORT_ERR";
  assert.equal(isAbortError(coded), true);
});

test("isAbortError: a real failure is not an abort", () => {
  assert.equal(isAbortError(new Error("500 Internal Server Error")), false);
  assert.equal(isAbortError("AbortError"), false);
  assert.equal(isAbortError(null), false);
});

test("isAbortError: matches what a real AbortController throws", async () => {
  const controller = new AbortController();
  controller.abort();
  let caught;
  try {
    await fetch("https://example.com", { signal: controller.signal });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the aborted fetch to throw");
  assert.equal(isAbortError(caught), true, `real abort not detected: ${caught?.name}`);
});
