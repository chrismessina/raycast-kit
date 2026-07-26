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

// Credential shapes that a naive label/bearer-only redactor lets through. Each of
// these LEAKED in v0.1.0 and was found by attacking the function rather than by
// waiting for a report.
test("redactSecrets: masks JWTs, including unlabeled ones", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.doesNotMatch(redactSecrets(jwt), /dBjftJeZ/);
  assert.doesNotMatch(redactSecrets(`Authorization: Bearer ${jwt}`), /dBjftJeZ/);
});

test("redactSecrets: masks PEM private key blocks including the body", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7f2K\n-----END RSA PRIVATE KEY-----";
  const out = redactSecrets(pem);
  assert.doesNotMatch(out, /MIIEowIBAAKCAQEA/);

  const ec = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIB\n-----END EC PRIVATE KEY-----";
  assert.doesNotMatch(redactSecrets(ec), /MHcCAQEEIB/);
});

test("redactSecrets: masks bare AWS access key ids", () => {
  assert.doesNotMatch(redactSecrets("AKIAIOSFODNN7EXAMPLE"), /IOSFODNN7EXAMPLE/);
  assert.doesNotMatch(redactSecrets("ASIAY34FZKBOKMUTVV7A"), /Y34FZKBOKMUTVV7A/);
});

test("redactSecrets: masks credentials embedded in URLs and connection strings", () => {
  // A dotted host is caught by the email rule; a dotless one (`db:5432`) is not —
  // which is why the URL-authority rule exists.
  assert.doesNotMatch(redactSecrets("https://chris:sup3rs3cr3tpass@api.example.com/v1"), /sup3rs3cr3tpass/);
  assert.doesNotMatch(redactSecrets("postgres://admin:hunter2hunter2@db:5432/prod"), /hunter2hunter2/);
  assert.doesNotMatch(redactSecrets("mongodb+srv://user:p%40ssw0rd@cluster0.mongodb.net"), /p%40ssw0rd/);
  // Empty username is a real shape (redis), so the pattern must not require one.
  assert.doesNotMatch(redactSecrets("redis://:justapassword@localhost:6379"), /justapassword/);
});

// `Basic dXNlcjpwYXNz` base64-decodes to `user:pass`. Masking only the scheme word
// is worse than useless — it looks redacted while the credential sits beside it.
test("redactSecrets: masks the credential after an HTTP auth scheme, not just the word", () => {
  const out = redactSecrets("Authorization: Basic dXNlcjpwYXNz");
  assert.doesNotMatch(out, /dXNlcjpwYXNz/);

  for (const scheme of ["Digest", "NTLM", "Token", "ApiKey"]) {
    assert.doesNotMatch(redactSecrets(`Authorization: ${scheme} abcdef1234567890`), /abcdef1234567890/);
  }
});

test("redactSecrets: masks PGP private key blocks", () => {
  const pgp = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBFxyz123\n-----END PGP PRIVATE KEY BLOCK-----";
  assert.doesNotMatch(redactSecrets(pgp), /lQOYBFxyz123/);
});

// A JSON string containing an escaped quote ended the value class early, leaking
// everything after it: `"api_key":"alpha\"bravo"` → `"***"bravo"`.
test("redactSecrets: masks a quoted value containing an escaped quote", () => {
  const out = redactSecrets('"api_key":"alpha\\"bravo"');
  assert.doesNotMatch(out, /bravo/);
});

test("redactSecrets: many unterminated PEM headers stay linear", () => {
  const evil = "-----BEGIN RSA PRIVATE KEY-----\n".repeat(6000);
  const start = Date.now();
  redactSecrets(evil);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `PEM scan took ${elapsed}ms on 6000 unterminated markers`);
});

test("redactSecrets: a URL with no credentials is left alone", () => {
  const url = "https://api.example.com/v1/items?limit=20";
  assert.equal(redactSecrets(url), url);
});

// Redaction must run BEFORE clamping, or truncation could cut a secret in half and
// leave the first part readable.
test("getErrorMessage: a secret near the clamp boundary is still masked", () => {
  const out = getErrorMessage({
    note: "x".repeat(770),
    authorization: "Bearer sk-ant-REALKEYMATERIAL0987654321",
  });
  assert.doesNotMatch(out, /REALKEYMATERIAL/);
});

// These patterns run on arbitrary error payloads; a pathological input must not hang
// the extension.
test("redactSecrets: no catastrophic backtracking on adversarial input", () => {
  const inputs = [
    "eyJ" + "A".repeat(5000),
    "-----BEGIN RSA PRIVATE KEY-----\n" + "A".repeat(20000),
    "Bearer abc ".repeat(3000),
    `{"token":"${"a".repeat(10000)}"}`,
  ];
  const start = Date.now();
  for (const input of inputs) redactSecrets(input);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `redaction took ${elapsed}ms on adversarial input`);
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
