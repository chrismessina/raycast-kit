/**
 * @chrismessina/raycast-kit
 *
 * House-style primitives for Raycast extensions. Each export exists because the
 * fleet audit (2026-07-25, 24 self-authored extensions, ~85k LOC) found the same
 * pattern hand-written many times over — and, in the toast case, hand-written
 * *wrong* four times out of five.
 *
 * Zero runtime dependencies. `@raycast/api` is a peer.
 */

export { getErrorMessage, isAbortError, redactSecrets } from "./errors";
export { showError, buildClipboardText, COPY_ERROR_TITLE, type ShowErrorOptions } from "./toast";
export { countOf, plural, type CountOptions } from "./plural";
