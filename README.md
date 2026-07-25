# @chrismessina/raycast-kit

House-style primitives for Raycast extensions. Zero runtime dependencies;
`@raycast/api` is a peer.

Companion to [`@chrismessina/raycast-logger`](https://github.com/chrismessina/raycast-logger).

## Why this exists

Every export here earned its place in a fleet audit (2026-07-25, 24 self-authored
extensions, ~85k LOC). The rule wasn't "this might be handy" — it was "this is
hand-written many times over, and often hand-written *wrong*."

| Pattern | Hand-written | Repos |
| --- | --- | --- |
| `Toast.Style.Failure` | 124 | 20 |
| …of which carry a **Copy Error** action | **26** | **9** |
| `error instanceof Error ? … : …` ternary | 98 | 16 |
| Count-bearing copy (`${n} items`, `item(s)`) | 34 | 11 |

The toast row is the point. House Style requires every failure toast to offer a
Copy Error action — an error the user can't copy is an error they can't report —
and it was **~20% adopted**, because the rule lives in a checklist while the
ergonomic path (`showFailureToast` from `@raycast/utils`, which has no copy
action) points the other way. `raycast-ios-apps` alone had 51 failure toasts and
zero copy actions.

This package makes the compliant thing the easy thing.

## Install

```bash
npm install @chrismessina/raycast-kit
```

## `showError(error, options)`

A failure toast with the Copy Error action already attached.

```ts
import { showError } from "@chrismessina/raycast-kit";

try {
  await loadDevices();
} catch (error) {
  await showError(error, { title: "Couldn't Load Devices" });
}
```

With a retry and request context on the clipboard:

```ts
await showError(error, {
  title: "Search Failed",
  action: { title: "Try Again", onAction: () => revalidate() },
  copyContext: `GET ${url} → ${response.status}`,
});
```

- **Copy Error is always primary**; your `action` becomes secondary.
- **The clipboard gets more than the toast shows** — title, message, your
  `copyContext`, and the stack frames when the thrown value had a stack.
- **Aborts are swallowed by default.** A user typing the next keystroke cancels
  the in-flight request; that is not a failure and shouldn't toast. Pass
  `ignoreAbort: false` to opt out.
- Returns the `Toast` (so you can mutate it later), or `undefined` for an ignored abort.

## `getErrorMessage(error: unknown)`

The one canonical unwrap. Replaces the `instanceof Error` ternary, and handles
what that ternary gets wrong.

```ts
getErrorMessage(new Error("Boom"))        // "Boom"
getErrorMessage("just a string")          // "just a string"
getErrorMessage({ message: "from API" })  // "from API"
getErrorMessage({ error: { message: "rate limited" } }) // "rate limited"
getErrorMessage({ a: 1 })                 // '{"a":1}'  — never "[object Object]"
getErrorMessage(new TypeError(""))        // "TypeError"  — never an empty toast
getErrorMessage(null)                     // "An unknown error occurred."
```

`String(error)` on a plain object yields `"[object Object]"`, which is the useless
message users actually report. This never does that.

**Credentials are redacted, and output is capped.** `showError` puts this text in a
toast *and* on the clipboard, so it can end up in a screenshot or pasted into a
GitHub issue. A thrown SDK error routinely carries an `authorization` header or an
`x-api-key` — a realistic Anthropic 401 payload was putting a live `sk-ant-…` key
into both before this was added. Bearer tokens, labeled secrets, provider-shaped
keys (`sk-…`, `ghp_…`, `xoxb-…`), and email addresses are masked; output is clamped
to 800 characters, because a 50 KB response body is not a toast. `redactSecrets` is
exported if you need it directly. This mirrors the redaction in
[`raycast-logger`](https://github.com/chrismessina/raycast-logger) — deliberately,
since both packages protect the same secrets from the same payloads.

**It cannot throw.** Every property read goes through a guarded accessor: a hostile
value (`{ get message() { throw … } }`, a Proxy that traps every read) returns the
generic message rather than replacing the user's real failure with an unrelated one.

## `isAbortError(error: unknown)`

```ts
try {
  await fetch(url, { signal });
} catch (error) {
  if (!isAbortError(error)) {
    await showError(error, { title: "Search Failed" });
  }
}
```

Recognizes `AbortError`, `TimeoutError`, and `code: "ABORT_ERR"` — verified
against what Node's real `fetch` throws on an aborted `AbortController`, not just
a synthetic error.

## `countOf(count, singular, options?)`

Count copy that agrees across zero, one, and many. House Style prohibits
`"${n} item(s)"` and always-plural `"${n} items"` (which says *"1 items"*) in
anything the user reads.

```ts
countOf(0, "device")                         // "0 devices"
countOf(0, "device", { zero: "No devices" }) // "No devices"
countOf(1, "device")                         // "1 device"
countOf(7, "device")                         // "7 devices"
countOf(2, "match")                          // "2 matches"
countOf(2, "city")                           // "2 cities"
countOf(2, "person")                         // "2 people"
countOf(1234, "item")                        // "1,234 items"
```

`plural(count, singular, pluralForm?)` is exported separately when you need only
the noun.

**On the `-f` and `-o` classes:** these use allow-lists, not regex rules, because
English splits them with no reliable pattern — `leaf`→`leaves` but `chef`→`chefs`,
`roof`→`roofs`, `belief`→`beliefs`; `potato`→`potatoes` but `cello`→`cellos`,
`avocado`→`avocados`. A naive `-f$`/`-o$` rule produces *"cheves"*, *"rooves"*,
*"believes"*, and *"celloes"* — and a helper that mangles ordinary words is worse
than the ternary it replaces. Anything outside the lists takes a plain `-s`; pass
an explicit plural for the rest.

## Importing without `@raycast/api`

`@raycast/api` has no loadable runtime outside Raycast, so the pure helpers are
available on subpaths — useful in tests, scripts, or non-Raycast consumers:

```ts
import { getErrorMessage, isAbortError } from "@chrismessina/raycast-kit/errors";
import { countOf, plural } from "@chrismessina/raycast-kit/plural";
```

The root export includes `showError` and therefore requires the Raycast runtime.

## Development

```bash
npm install
npm run build      # tsc → dist/
npm test           # node --test (47 tests)
npm run typecheck  # tsc --noEmit
```

## Scope

Deliberately narrow. The audit also considered date formatting, text truncation,
and number formatting and **rejected all three**: eight `formatDate`
implementations across the fleet had eight different signatures — they shared a
name, not a behavior — and consolidating them would have meant inventing a
superset nobody wanted. `truncate` looked fleet-wide at 79 uses until 40 of them
turned out to be in one extension.

Generic helpers belong in [`@raycast/utils`](https://developers.raycast.com/utilities/getting-started),
which 19 of 24 extensions already import. This package holds only what encodes a
*house-style rule* that would otherwise depend on memory.

Empty-state components (`List.EmptyView`, 55 uses / 15 repos) are the strongest
v0.2.0 candidate — they need JSX, and the collapsed-newline rule is worth encoding
in a component.

## License

MIT
