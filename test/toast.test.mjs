import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";

/**
 * `@raycast/api` only resolves inside the Raycast runtime, so stub it at the
 * module-resolution layer before requiring the built output. This lets us assert
 * the exact `showToast` options object — which is the whole contract of showError.
 */
const calls = { toasts: [], copies: [] };

const stub = {
  Toast: {
    Style: { Failure: "FAILURE", Success: "SUCCESS", Animated: "ANIMATED" },
  },
  Clipboard: {
    copy: async (text) => {
      calls.copies.push(text);
    },
  },
  showToast: async (options) => {
    calls.toasts.push(options);
    return { ...options, hide: async () => {} };
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@raycast/api") {
    return stub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { showError, failToast, buildClipboardText, COPY_ERROR_TITLE } = await import("../dist/index.js");

function reset() {
  calls.toasts.length = 0;
  calls.copies.length = 0;
}

test("showError: uses Failure style and the given title", async () => {
  reset();
  await showError(new Error("network down"), { title: "Couldn't Load Devices" });

  assert.equal(calls.toasts.length, 1);
  assert.equal(calls.toasts[0].style, "FAILURE");
  assert.equal(calls.toasts[0].title, "Couldn't Load Devices");
  assert.equal(calls.toasts[0].message, "network down");
});

// The compliance invariant this whole module exists to guarantee.
test("showError: ALWAYS attaches a Copy Error primary action", async () => {
  reset();
  await showError(new Error("boom"), { title: "Failed" });

  const { primaryAction } = calls.toasts[0];
  assert.ok(primaryAction, "primaryAction must exist");
  assert.equal(primaryAction.title, COPY_ERROR_TITLE);
  assert.equal(typeof primaryAction.onAction, "function");
});

test("showError: Copy Error action actually copies the message", async () => {
  reset();
  await showError(new Error("copy me"), { title: "Failed" });

  calls.toasts[0].primaryAction.onAction();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.copies.length, 1);
  assert.match(calls.copies[0], /copy me/);
});

test("showError: unwraps non-Error values for the message", async () => {
  reset();
  await showError({ message: "from API" }, { title: "Failed" });
  assert.equal(calls.toasts[0].message, "from API");

  reset();
  await showError({ a: 1 }, { title: "Failed" });
  assert.doesNotMatch(calls.toasts[0].message, /\[object Object\]/);
});

test("showError: explicit message overrides the derived one", async () => {
  reset();
  await showError(new Error("raw internals"), { title: "Failed", message: "Friendlier text" });
  assert.equal(calls.toasts[0].message, "Friendlier text");
});

test("showError: an extra action becomes secondary, Copy Error stays primary", async () => {
  reset();
  let retried = false;
  await showError(new Error("boom"), {
    title: "Failed",
    action: { title: "Try Again", onAction: () => { retried = true; } },
  });

  assert.equal(calls.toasts[0].primaryAction.title, COPY_ERROR_TITLE);
  assert.equal(calls.toasts[0].secondaryAction.title, "Try Again");
  calls.toasts[0].secondaryAction.onAction();
  assert.equal(retried, true);
});

test("showError: no secondaryAction key when no action given", async () => {
  reset();
  await showError(new Error("boom"), { title: "Failed" });
  assert.equal("secondaryAction" in calls.toasts[0], false);
});

// Aborts are the most common false-positive toast: the user typed another key.
test("showError: swallows abort errors by default and returns undefined", async () => {
  reset();
  const abort = new Error("aborted");
  abort.name = "AbortError";

  const result = await showError(abort, { title: "Search Failed" });

  assert.equal(result, undefined);
  assert.equal(calls.toasts.length, 0, "an aborted request must not toast");
});

test("showError: ignoreAbort:false surfaces the abort", async () => {
  reset();
  const abort = new Error("aborted");
  abort.name = "AbortError";

  await showError(abort, { title: "Search Failed", ignoreAbort: false });
  assert.equal(calls.toasts.length, 1);
});

test("showError: returns the toast for later mutation", async () => {
  reset();
  const toast = await showError(new Error("boom"), { title: "Failed" });
  assert.ok(toast);
  assert.equal(toast.style, "FAILURE");
});

// The progress-toast pattern: an animated toast flipped to Failure in place.
// showError can't serve these sites because it creates a NEW toast.
test("failToast: mutates an existing toast into a compliant failure", () => {
  const toast = { style: "ANIMATED", title: "Exporting…" };
  const result = failToast(toast, new Error("disk full"), { title: "Export Failed" });

  assert.equal(result, true);
  assert.equal(toast.style, "FAILURE");
  assert.equal(toast.title, "Export Failed");
  assert.equal(toast.message, "disk full");
  assert.equal(toast.primaryAction.title, COPY_ERROR_TITLE);
});

test("failToast: Copy Error action copies the payload", async () => {
  reset();
  const toast = { style: "ANIMATED", title: "Working…" };
  failToast(toast, new Error("copy this"), { title: "Failed" });

  toast.primaryAction.onAction();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.copies.length, 1);
  assert.match(calls.copies[0], /copy this/);
});

test("failToast: unwraps non-Error values like showError does", () => {
  const toast = {};
  failToast(toast, { statusText: "Not Found" }, { title: "Failed" });
  assert.equal(toast.message, "Not Found");

  const toast2 = {};
  failToast(toast2, { a: 1 }, { title: "Failed" });
  assert.doesNotMatch(toast2.message, /\[object Object\]/);
});

test("failToast: leaves the toast untouched on an ignored abort", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  const toast = { style: "ANIMATED", title: "Working…" };

  const result = failToast(toast, abort, { title: "Failed" });

  assert.equal(result, false);
  assert.equal(toast.style, "ANIMATED", "an aborted request must not flip the toast");
  assert.equal(toast.title, "Working…");
});

test("failToast: attaches a secondary action when given", () => {
  const toast = {};
  failToast(toast, new Error("x"), { title: "Failed", action: { title: "Retry", onAction() {} } });
  assert.equal(toast.secondaryAction.title, "Retry");
});

test("failToast: redacts credentials into the clipboard payload", async () => {
  reset();
  const toast = {};
  failToast(toast, { headers: { authorization: "Bearer sk-ant-LEAKED1234567890abc" } }, { title: "Failed" });

  toast.primaryAction.onAction();
  await new Promise((resolve) => setImmediate(resolve));

  assert.doesNotMatch(calls.copies[0], /LEAKED1234567890abc/);
});

// Documented contract for the `message` override (JSDoc on ShowErrorOptions.message).
// The first adopter assumed the override affected only the toast; it affects both.
test("showError: an overridden message replaces the CLIPBOARD text too", async () => {
  reset();
  await showError(new Error("ENOENT: no such file or directory, realpath '/Users/x'"), {
    title: "Folder Not Found",
    message: "The folder has been moved, renamed, or deleted.",
    copyContext: "/Users/x/Artifacts",
  });

  calls.toasts[0].primaryAction.onAction();
  await new Promise((resolve) => setImmediate(resolve));

  const copied = calls.copies[0];
  assert.match(copied, /has been moved/, "override should reach the clipboard");
  assert.match(copied, /Users\/x\/Artifacts/, "copyContext should survive the override");
});

test("showError: message:undefined uses the derived message (the ternary shape)", async () => {
  reset();
  const missing = false;
  await showError(new Error("real cause"), {
    title: "Failed",
    message: missing ? "friendly text" : undefined,
  });

  assert.equal(calls.toasts[0].message, "real cause");
});

test("showError: copyContext is redacted like the rest of the payload", async () => {
  reset();
  await showError(new Error("boom"), {
    title: "Failed",
    copyContext: "GET https://api.example.com/x?api_key=SUPERSECRETVALUE123",
  });

  calls.toasts[0].primaryAction.onAction();
  await new Promise((resolve) => setImmediate(resolve));

  assert.doesNotMatch(calls.copies[0], /SUPERSECRETVALUE123/);
});

// The override bypassed redaction entirely: a caller interpolating error text into
// `message` put a live credential in a screenshot-able toast. The clipboard path was
// already safe, which is exactly why this was easy to miss.
test("showError: an overridden message is REDACTED before display", async () => {
  reset();
  await showError(new Error("x"), {
    title: "Failed",
    message: "Authorization: Basic dXNlcjpwYXNz and token=SUPERSECRET123456",
  });

  assert.doesNotMatch(calls.toasts[0].message, /SUPERSECRET123456/);
  assert.doesNotMatch(calls.toasts[0].message, /dXNlcjpwYXNz/);
});

test("failToast: an overridden message is REDACTED before display", () => {
  const toast = {};
  failToast(toast, new Error("x"), {
    title: "Failed",
    message: "token=SUPERSECRET123456",
  });

  assert.doesNotMatch(toast.message, /SUPERSECRET123456/);
});

// A progress toast usually carries a "Cancel" for the work that just failed.
// Leaving it attached offers an action that no longer means anything.
test("failToast: clears a stale secondaryAction when no new action is given", () => {
  const toast = {
    style: "ANIMATED",
    title: "Exporting…",
    secondaryAction: { title: "Cancel", onAction() {} },
  };

  failToast(toast, new Error("disk full"), { title: "Export Failed" });

  assert.equal(toast.secondaryAction, undefined);
});

test("buildClipboardText: includes title, message, and context", () => {
  const text = buildClipboardText({
    title: "Search Failed",
    errorMessage: "429 Too Many Requests",
    copyContext: "GET https://api.example.com/search",
  });

  assert.match(text, /Search Failed: 429 Too Many Requests/);
  assert.match(text, /GET https:\/\/api\.example\.com\/search/);
});

test("buildClipboardText: does not duplicate the title into the message", () => {
  const text = buildClipboardText({ title: "Failed", errorMessage: "Failed to reach host" });
  assert.equal(text, "Failed to reach host");
});

test("buildClipboardText: includes stack frames but drops the redundant first line", () => {
  const error = new Error("with stack");
  const text = buildClipboardText({ title: "Failed", errorMessage: "with stack", error });

  assert.match(text, /with stack/);
  assert.match(text, /at /, "expected stack frames");
  // "Error: with stack" is the stack's first line and duplicates the message.
  assert.equal(text.includes("Error: with stack"), false);
});

test("buildClipboardText: no stack section for non-Error values", () => {
  const text = buildClipboardText({ title: "Failed", errorMessage: "plain", error: "plain" });
  assert.equal(text, "Failed: plain");
});
