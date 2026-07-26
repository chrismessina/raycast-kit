# raycast-kit v0.1.0 — first-adoption field report

**Adopter:** `chrismessina/raycast-claude-artifacts` (macOS-only, no network calls,
reads a local JSON index written by a Claude Code hook).
**Date:** 2026-07-25
**Adopted:** `showError` (root), `getErrorMessage` (`/errors` subpath).
**Not adopted:** `countOf` / `plural` — no count-bearing copy in this extension yet;
`isAbortError` / `failToast` / `buildClipboardText` — no async cancellation or
multi-step toast flows.

The kit did what it says. `showError` replaced 18 lines of hand-assembled toast with
5 and **closed a real gap in the process** — the hand-rolled version copied a raw
error string to the clipboard with no redaction. That is the strongest argument for
the package and it should be the headline, not a footnote: the value isn't the line
count, it's that the compliant thing became the default thing.

Everything below is friction encountered on the way in, ranked by how much time it
cost and how likely the next adopter is to hit it.

---

## 1. The subpath export is the kit's best feature and it is nearly invisible

**Severity: high — this is the one change worth making.**

### What happened

`getErrorMessage` was imported from the **root** into a pure-logic module
(`src/utils/index-file.ts` — the index parser: forgiving JSON, upsert de-dupe,
recency sort). That module had been dependency-free (`fs`/`os`/`path` only) and was
covered by 11 headless fixtures run with `tsx` under a fake `$HOME` — missing file,
empty file, malformed JSON, truncated JSON, non-array `artifacts`, bare array,
duplicate ids, junk rows, and so on.

The root import broke **all 11 at once**:

```
Error: Cannot find module '@raycast/api'
Require stack:
- node_modules/@chrismessina/raycast-kit/dist/toast.js
- node_modules/@chrismessina/raycast-kit/dist/index.js
- src/utils/index-file.ts
```

Root re-exports `showError` → `toast.js` → `@raycast/api`, which ships **types only**
(`package.json` has `types` and no `main`) and is injected by the Raycast host at
runtime. So the root export is unloadable in plain Node, and importing it anywhere
transitively poisons that module's testability.

The diagnosis was straightforward, but the **conclusion drawn was wrong**: a local
3-line `getErrorMessage` copy was written, with a comment explaining that the kit
"can't" be used in pure-logic modules. That was only discovered to be false when
opening the kit's README for this writeup — §*Importing without `@raycast/api`*
(line 167) documents `@chrismessina/raycast-kit/errors` precisely for this case. The
correct fix was one import path, and the code now reads:

```ts
import { getErrorMessage } from "@chrismessina/raycast-kit/errors";
```

### Why this is a docs problem, not a user problem

The layering rule the kit already implements — **UI layer takes the root; pure logic
takes a subpath** — is genuinely good design. It is also the **ninth of eleven**
README sections (line 167), sitting after every API reference and immediately before
*Development*. By the time a reader reaches it they have already decided how to
import; the decision it governs was made eight sections earlier, at *Install*.

The heading compounds this: *"Importing without `@raycast/api`"* names a **scenario**
("I'm not using Raycast") rather than the **decision** every adopter makes ("which
entry point?"). A Raycast-extension author scanning the headings has no reason to
think it applies to them — they are, after all, importing *with* `@raycast/api`. The
section is really about module boundaries *inside* a Raycast extension, which its
title doesn't suggest.

And when it goes wrong, the error offers no route back to that section: it names
`@raycast/api` and `toast.js`, never the kit's own export map. So it reads like a
broken install rather than "you imported from the wrong entry point." An adopter who
hits it mid-task reaches for a workaround, not the README. (I did exactly that.)

### Suggested fixes, cheapest first

1. **Put the rule in the error's path, not just the README.** The failure surfaces as
   a module-resolution stack trace with no hint that a subpath exists. If the build
   can't help, at least make the README's *first* code sample show both entry points
   side by side, so the split is visible before anyone needs it:

   ```ts
   // UI layer — has the Raycast runtime
   import { showError } from "@chrismessina/raycast-kit";
   // Pure logic, tests, scripts — no @raycast/api
   import { getErrorMessage } from "@chrismessina/raycast-kit/errors";
   ```

2. **Name the section for the rule, not the exception.** *"Importing without
   `@raycast/api`"* describes a constraint; *"Which entry point to import from"*
   describes a decision every adopter makes. Consider promoting it above **Scope**.

3. **Say what breaks.** One sentence — *"importing the root into a module you test
   with plain `node`/`tsx` will fail to resolve `@raycast/api`"* — converts the
   abstract statement ("no loadable runtime outside Raycast") into the concrete
   symptom someone can search for.

4. **Consider `/toast` for symmetry.** Today the split is root-vs-subpath;
   `errors`/`plural` have subpaths, `toast` does not. Not required — but if the
   mental model is "one subpath per module, root is the convenience barrel," making
   that uniform removes the need to remember which helpers live where.

---

## 2. `showError`'s `message` override interacts with `getErrorMessage` in a way worth documenting

**Severity: low — behavior is right; the docs just don't cover this shape.**

The real call site:

```ts
const missing = getErrorMessage(error).includes("ENOENT");

await showError(error, {
  title: missing ? "Folder Not Found" : "Could Not Reveal in Finder",
  message: missing ? "The folder has been moved, renamed, or deleted." : undefined,
  copyContext: path,
});
```

The `ShowErrorOptions.message` doc says *"Rarely needed — prefer letting
`getErrorMessage` unwrap the real thing so the user copies the true cause."* Correct
as a default, but this is a legitimate non-rare case: a raw `ENOENT: no such file or
directory, realpath '/Users/…'` names a **syscall**, which tells a user nothing
actionable. The override replaces the *displayed* line while `copyContext` keeps the
real path on the clipboard — exactly the division of labor the API implies.

Two things that would have saved a round of checking:

- **Confirm in the docs that `message` overrides only the toast, never the clipboard
  text.** The current wording ("Overrides the message derived from `error`") is
  ambiguous about whether the copied payload changes too. Reading `buildClipboardText`
  settled it, but the JSDoc should.
- **Passing `message: undefined` explicitly** to mean "use the derived message" works
  and reads well in a ternary. Worth one line confirming that's supported and not an
  accident, since it's the natural shape whenever the override is conditional.

---

## 3. Smaller notes

- **`copyContext` is underrated.** The JSDoc frames it around HTTP context ("request
  URL, status code, command name"). Its best use here was a **filesystem path** — the
  thing a bug report needs, kept out of a toast that must stay one short line.
  Broadening the example would advertise it better.
- **Zero runtime deps, `@raycast/api` as a peer.** Exactly right for a Raycast
  extension — adding it to a Store submission needs no justification about bundle
  size. Worth stating in the README as a selling point.
- **`redactSecrets` is a real differentiator and reads as a footnote.** Every
  hand-rolled failure toast in the fleet (~80% of them, per the audit table in
  house-style) copies unredacted error text. That is a latent secret-leak in a
  screenshot or a pasted GitHub issue. This deserves to be in the pitch, above the
  line-count argument.

---

## What the adopting extension looks like now

- `src/actions/reveal-in-finder.tsx` — root import: `showError`, `getErrorMessage`.
  The only failure toast in the extension; carries Copy Error automatically.
- `src/utils/index-file.ts` — `/errors` subpath: `getErrorMessage` only. Stays
  loadable in plain Node; all 11 headless fixtures pass unchanged.

`tsc --noEmit` exit 0, `ray lint` clean, `ray build` succeeds, fixtures green.

**Would adopt again.** The friction was entirely "which entry point," and the kit had
already solved it — the answer was just one scroll further down than the workaround.
