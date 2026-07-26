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
 * Ceiling on returned text. A thrown HTTP error can carry a whole response body;
 * a 50 KB toast is not a toast, and a 50 KB clipboard entry is not a bug report.
 */
const MAX_LENGTH = 800;

/**
 * Read a property that might be a throwing getter or a Proxy trap.
 *
 * An error handler that throws is worse than useless: it replaces the failure the
 * user hit with an unrelated one, and `showError` never renders. Hostile shapes
 * are rare but real (Proxy-wrapped SDK errors, lazily-deserialized payloads).
 */
function safeRead(source: Record<string, unknown>, key: string): unknown {
  try {
    return source[key];
  } catch {
    return undefined;
  }
}

/** Truncate at a word boundary where possible, marking that content was dropped. */
function clamp(text: string): string {
  if (text.length <= MAX_LENGTH) {
    return text;
  }
  const head = text.slice(0, MAX_LENGTH);
  const lastSpace = head.lastIndexOf(" ");
  return `${(lastSpace > MAX_LENGTH * 0.8 ? head.slice(0, lastSpace) : head).trimEnd()}… (truncated)`;
}

/**
 * Mask credentials before they reach a toast or the clipboard.
 *
 * `showError` displays this text AND copies it, so anything here can end up in a
 * screenshot or pasted into a GitHub issue. A thrown HTTP/SDK error routinely
 * carries `authorization` headers, `x-api-key`, or a token in a URL — the
 * 2026-07-25 check found a realistic Anthropic 401 shape putting a live
 * `sk-ant-…` key into both.
 *
 * Mirrors the redaction in `@chrismessina/raycast-logger`, deliberately: the two
 * packages protect the same secrets from the same payloads.
 */
export function redactSecrets(text: string): string {
  return (
    text
      // PEM private keys — mask the whole block, including its newlines. Must run
      // FIRST: the body is base64 that later rules would only partially rewrite.
      .replace(
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
        "-----BEGIN PRIVATE KEY----- *** -----END PRIVATE KEY-----",
      )
      // JWTs — three base64url segments. Before the bearer rule, so a bare token
      // (not preceded by "Bearer") is still caught.
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "eyJ***")
      // Bearer tokens, in headers or JSON.
      .replace(/(bearer\s+)[\w.\-~+/]+=*/gi, "$1***")
      // key/value secrets: "api_key": "...", x-api-key=..., token: ...
      .replace(
        /("?\b(?:[\w-]*(?:api[_-]?key|secret|token|password|passwd|pwd|auth(?:orization)?|credential|session)[\w-]*)\b"?\s*[:=]\s*"?)([^"',}\s]+)/gi,
        "$1***",
      )
      // Provider-shaped keys that appear bare (no label): sk-…, ghp_…, xoxb-…
      .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "$1-***")
      .replace(/\b(gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}/g, "$1_***")
      // AWS access key IDs are bare and unlabeled by design (AKIA…/ASIA…).
      .replace(/\b(A(?:KIA|SIA|GPA|IDA|ROA|IPA|NPA|NVA))[A-Z0-9]{12,}/g, "$1***")
      // Credentials in a URL authority: scheme://user:password@host. Covers hosts the
      // email rule can't see — `db:5432` has no dot, so a connection string like
      // `postgres://admin:hunter2@db:5432/prod` would otherwise pass through intact.
      // `[^\s/:@]*` (not `+`) so an empty username still matches — `redis://:pw@host`
      // is a real shape.
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)[^\s/@]+(@)/gi, "$1***$2")
      // Email addresses → first char + domain.
      .replace(
        /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
        "$1***$2",
      )
  );
}

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
  return clamp(redactSecrets(extractMessage(error)));
}

/** The raw extraction, before redaction and clamping. */
function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    // An Error with an empty message is worse than useless in a toast.
    // `.message`/`.name` can be getters on a subclass, so read them defensively.
    const message = safeRead(error as unknown as Record<string, unknown>, "message");
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
    const name = safeRead(error as unknown as Record<string, unknown>, "name");
    return typeof name === "string" && name.trim() ? name.trim() : UNKNOWN;
  }

  if (typeof error === "string") {
    return error.trim() || UNKNOWN;
  }

  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }

  // `String()` throws on a symbol; bigint needs the `n` suffix stripped for copy.
  if (typeof error === "bigint") {
    return `${error}`;
  }
  if (typeof error === "symbol") {
    return error.description ?? error.toString();
  }

  if (error === null || error === undefined) {
    return UNKNOWN;
  }

  // Error-shaped objects that aren't `Error` instances: fetch/HTTP wrappers,
  // structured-clone survivors, and cross-realm errors all land here.
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;

    for (const key of ["message", "error", "description", "detail", "statusText"] as const) {
      const value = safeRead(record, key);
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    // A nested `{ error: { message } }` shape, common in JSON API responses.
    const nested = safeRead(record, "error");
    if (nested && typeof nested === "object") {
      const nestedMessage = safeRead(nested as Record<string, unknown>, "message");
      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage.trim();
      }
    }

    // Last resort: JSON, so the user sees the payload instead of "[object Object]"
    // — the specific failure `String(error)` produces, and why the bare ternary is
    // not good enough on its own. Redaction and clamping are applied by the caller.
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") {
        return json;
      }
    } catch {
      // Circular, non-serializable, or a throwing getter reached during
      // serialization — fall through to the generic message.
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
