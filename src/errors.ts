/**
 * Safe unwrapping of `unknown` catch values.
 *
 * A `catch` binding is `unknown` — touching `.message` on it is unsound, and
 * `String(error)` on a plain object yields the useless `"[object Object]"`.
 * This is the one canonical unwrap for the whole fleet.
 */

/** Fallback shown when a thrown value carries no usable message at all. */
const UNKNOWN = "An unknown error occurred.";

/**
 * Turn any thrown value into a human-readable string.
 *
 * Replaces the hand-written `error instanceof Error ? error.message : String(error)`
 * ternary (98 occurrences across 16 extensions as of 2026-07-25), and additionally
 * handles the cases that bare ternary gets wrong.
 *
 * @example
 * getErrorMessage(new Error("Boom"))        // "Boom"
 * getErrorMessage("just a string")         // "just a string"
 * getErrorMessage({ message: "from API" }) // "from API"
 * getErrorMessage(null)                    // "An unknown error occurred."
 * getErrorMessage({ a: 1 })                // '{"a":1}'  — never "[object Object]"
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // An Error with an empty message is worse than useless in a toast.
    return error.message.trim() || error.name || UNKNOWN;
  }

  if (typeof error === "string") {
    return error.trim() || UNKNOWN;
  }

  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }

  if (error === null || error === undefined) {
    return UNKNOWN;
  }

  // Error-shaped objects that aren't `Error` instances: fetch/HTTP wrappers,
  // structured-clone survivors, and cross-realm errors all land here.
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;

    for (const key of ["message", "error", "description", "detail", "statusText"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    // A nested `{ error: { message } }` shape, common in JSON API responses.
    const nested = record.error;
    if (nested && typeof nested === "object") {
      const nestedMessage = (nested as Record<string, unknown>).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage.trim();
      }
    }

    // Last resort: JSON, so the user sees the payload instead of "[object Object]".
    // This is the specific failure `String(error)` produces and why the bare
    // ternary is not good enough on its own.
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") {
        return json;
      }
    } catch {
      // Circular or non-serializable — fall through to the generic message.
    }
  }

  return UNKNOWN;
}

/**
 * `true` when the value is an abort/cancellation rather than a real failure.
 *
 * Aborted requests are the single most common false-positive failure toast: a
 * user types another keystroke, the in-flight `AbortController` fires, and the
 * `catch` shows an error for something that worked exactly as designed.
 * `AbortController` appears in 8 extensions, so this guard is load-bearing.
 *
 * @example
 * try { await fetch(url, { signal }); }
 * catch (error) { if (!isAbortError(error)) await showError(error, { title: "Search failed" }); }
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    // Undici/node-fetch and the DOM both use the name; DOMException adds code 20.
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return true;
    }
    if ((error as { code?: unknown }).code === "ABORT_ERR") {
      return true;
    }
  }
  return false;
}
