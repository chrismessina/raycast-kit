import assert from "node:assert/strict";
import { test } from "node:test";

// Import the LEAF module, not the barrel: `index.js` re-exports `toast.js`, which
// requires `@raycast/api` — a package with no loadable runtime outside Raycast.
// These helpers are pure TypeScript and must stay testable (and importable) without it.
import { getErrorMessage, isAbortError, redactSecrets } from "../dist/errors.js";

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

// An error handler that throws replaces the user's real failure with an unrelated
// one, and the toast never renders. Hostile shapes are rare but real.
test("getErrorMessage: a throwing getter does not escape", () => {
  const hostile = {
    get message() {
      throw new Error("second failure");
    },
  };
  assert.doesNotThrow(() => getErrorMessage(hostile));
  assert.equal(getErrorMessage(hostile), "An unknown error occurred.");
});

test("getErrorMessage: a Proxy that throws on every read does not escape", () => {
  const proxy = new Proxy(
    {},
    {
      get() {
        throw new Error("proxy trap");
      },
    },
  );
  assert.doesNotThrow(() => getErrorMessage(proxy));
});

test("getErrorMessage: an Error subclass with a throwing message getter is handled", () => {
  class Hostile extends Error {
    get message() {
      throw new Error("nope");
    }
  }
  assert.doesNotThrow(() => getErrorMessage(new Hostile()));
});

// showError puts this text in a toast AND on the clipboard — a screenshot or a
// pasted bug report must not carry a live credential.
test("getErrorMessage: redacts credentials from a realistic SDK 401 payload", () => {
  const apiError = {
    status: 401,
    headers: { authorization: "Bearer sk-ant-api03-REALKEYMATERIAL1234567890" },
    request: { headers: { "x-api-key": "sk-ant-SECRETVALUE0987654321" } },
  };
  const output = getErrorMessage(apiError);

  assert.doesNotMatch(output, /REALKEYMATERIAL/, "bearer token leaked");
  assert.doesNotMatch(output, /SECRETVALUE/, "api key leaked");
});

test("redactSecrets: masks the common credential shapes", () => {
  assert.doesNotMatch(redactSecrets("Authorization: Bearer abcdef1234567890xyz"), /abcdef1234567890xyz/);
  assert.doesNotMatch(redactSecrets('"api_key": "supersecretvalue123"'), /supersecretvalue123/);
  assert.doesNotMatch(redactSecrets("token=abc123def456ghi789"), /abc123def456ghi789/);
  assert.doesNotMatch(redactSecrets("contact user@example.com"), /^.*[^u]user@example\.com/);
});

test("redactSecrets: leaves ordinary error text intact", () => {
  const plain = "Couldn't reach the server (503). Try again in a moment.";
  assert.equal(redactSecrets(plain), plain);
});

// A thrown HTTP error can carry an entire response body; a 50 KB toast is not a toast.
test("getErrorMessage: clamps enormous payloads", () => {
  const huge = { data: "x".repeat(50_000) };
  const output = getErrorMessage(huge);

  assert.ok(output.length < 1000, `expected clamped output, got ${output.length} chars`);
  assert.match(output, /truncated/);
});

test("getErrorMessage: handles bigint and symbol without throwing", () => {
  assert.doesNotThrow(() => getErrorMessage(Symbol("rate-limited")));
  assert.equal(getErrorMessage(10n), "10");
  assert.equal(getErrorMessage(Symbol("rate-limited")), "rate-limited");
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
