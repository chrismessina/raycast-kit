/**
 * Failure toasts that always carry a "Copy Error" action.
 *
 * House Style requires every `Toast.Style.Failure` to offer a Copy Error action,
 * because an error the user can't copy is an error they can't report. The fleet
 * audit on 2026-07-25 found 124 failure toasts across 20 extensions but only 26
 * Copy-Error actions in 9 — roughly 20% compliance, because the rule lives in a
 * checklist and the ergonomic path (`showFailureToast` from `@raycast/utils`,
 * which has no copy action) points the other way.
 *
 * `showError` makes the compliant thing the easy thing.
 */

import { Clipboard, Toast, showToast } from "@raycast/api";

import { getErrorMessage, isAbortError, redactSecrets } from "./errors";

/** Title of the always-present copy action. Fixed so it's greppable fleet-wide. */
export const COPY_ERROR_TITLE = "Copy Error";

export interface ShowErrorOptions {
  /**
   * Toast title — what failed, in the imperative past tense.
   * Keep it short; the message carries the detail.
   * @example "Couldn't Load Devices"
   */
  title: string;
  /**
   * Replaces the message derived from `error` — **in the toast AND on the clipboard.**
   * Pass `undefined` to use the derived message (supported and intended, so a
   * conditional override reads naturally as a ternary).
   *
   * Default to omitting it, so the user copies the true cause. The legitimate case is
   * a raw message that names a *syscall* rather than anything actionable — e.g.
   * `ENOENT: no such file or directory, realpath '/Users/…'`. Override the display,
   * and put the diagnostic detail in `copyContext` so the bug report keeps it:
   *
   * ```ts
   * const missing = getErrorMessage(error).includes("ENOENT");
   * await showError(error, {
   *   title: missing ? "Folder Not Found" : "Could Not Reveal in Finder",
   *   message: missing ? "The folder has been moved, renamed, or deleted." : undefined,
   *   copyContext: path,
   * });
   * ```
   *
   * **Note the trade-off:** overriding does NOT keep the original message on the
   * clipboard. A thrown `Error` still contributes its stack frames, but a non-thrown
   * or non-`Error` value leaves no trace of the raw text — so put anything you need
   * for debugging in `copyContext`.
   */
  message?: string;
  /**
   * An extra action shown alongside Copy Error — typically "Try Again".
   * Copy Error stays primary; this becomes the secondary action.
   */
  action?: Toast.ActionOptions;
   /**
   * Extra context appended to what lands on the clipboard (**not** shown in the toast).
   *
   * This is how you keep a toast to one short line while the bug report still gets the
   * detail. Anything you'd have to ask for in a follow-up belongs here:
   *
   * - a **filesystem path** (`/Users/…/Artifacts`) — the most useful case for a local
   *   extension, and the thing a "Folder Not Found" toast must not spell out
   * - a request URL + status (`GET https://api.example.com/x → 429`)
   * - the command or item id the failure happened on
   * - the version of an external binary you shelled out to
   *
   * Redacted like everything else on the clipboard, so a token in a query string
   * won't survive.
   */
  copyContext?: string;
  /**
   * When `true` (the default), an aborted/cancelled operation shows no toast and
   * resolves to `undefined`. A user typing the next keystroke is not a failure.
   */
  ignoreAbort?: boolean;
}

/**
 * Show a failure toast with a Copy Error action already attached.
 *
 * @returns the `Toast`, or `undefined` when the error was an ignored abort.
 *
 * @example
 * try {
 *   await loadDevices();
 * } catch (error) {
 *   await showError(error, { title: "Couldn't Load Devices" });
 * }
 *
 * @example  // with a retry and request context on the clipboard
 * await showError(error, {
 *   title: "Search Failed",
 *   action: { title: "Try Again", onAction: () => revalidate() },
 *   copyContext: `GET ${url} → ${response.status}`,
 * });
 */
export async function showError(error: unknown, options: ShowErrorOptions): Promise<Toast | undefined> {
  const { title, message, action, copyContext, ignoreAbort = true } = options;

  if (ignoreAbort && isAbortError(error)) {
    return undefined;
  }

  // A caller-supplied `message` is redacted too — it routinely interpolates error
  // text, and an unredacted toast is screenshot-able even though the clipboard path
  // is already safe.
  const errorMessage = message === undefined ? getErrorMessage(error) : redactSecrets(message);

  // What the user copies: the message, plus context, plus a stack when we have one.
  // Built once here rather than inside onAction so the closure can't capture a
  // later-mutated value.
  const clipboardText = buildClipboardText({ title, errorMessage, error, copyContext });

  const copyAction: Toast.ActionOptions = {
    title: COPY_ERROR_TITLE,
    onAction: () => {
      // Fire-and-forget: Toast.ActionOptions.onAction is sync `(toast) => void`,
      // so we cannot await here. Swallow rejection rather than raise an
      // unhandled rejection from inside a toast handler.
      void Clipboard.copy(clipboardText).catch(() => undefined);
    },
  };

  return showToast({
    style: Toast.Style.Failure,
    title,
    message: errorMessage,
    primaryAction: copyAction,
    ...(action ? { secondaryAction: action } : {}),
  });
}

/**
 * Turn an EXISTING toast into a compliant failure toast, in place.
 *
 * The progress-toast pattern — show an animated toast, then flip it to Success or
 * Failure when the work settles — cannot use `showError`, which creates a *new*
 * toast. Mutation sites are common in the fleet (3 of 4 failure paths in
 * `get-app-icon`, both stream handlers in the `claude` extension) and were exactly
 * the sites that had no Copy-Error action, because attaching one by hand takes six
 * extra lines every time.
 *
 * @returns `true` if the toast was turned into a failure, `false` for an ignored abort.
 *
 * @example
 * const toast = await showToast({ style: Toast.Style.Animated, title: "Exporting…" });
 * try {
 *   await exportIcons();
 *   toast.style = Toast.Style.Success;
 *   toast.title = "Exported";
 * } catch (error) {
 *   failToast(toast, error, { title: `Failed to export ${app.name}'s icons` });
 * }
 */
export function failToast(toast: Toast, error: unknown, options: ShowErrorOptions): boolean {
  const { title, message, action, copyContext, ignoreAbort = true } = options;

  if (ignoreAbort && isAbortError(error)) {
    return false;
  }

  // A caller-supplied `message` is redacted too — it routinely interpolates error
  // text, and an unredacted toast is screenshot-able even though the clipboard path
  // is already safe.
  const errorMessage = message === undefined ? getErrorMessage(error) : redactSecrets(message);
  const clipboardText = buildClipboardText({ title, errorMessage, error, copyContext });

  toast.style = Toast.Style.Failure;
  toast.title = title;
  toast.message = errorMessage;
  toast.primaryAction = {
    title: COPY_ERROR_TITLE,
    onAction: () => {
      void Clipboard.copy(clipboardText).catch(() => undefined);
    },
  };
  // Always ASSIGN, never conditionally skip: the toast being mutated is usually a
  // progress toast that already carries a secondaryAction (a "Cancel" for the work
  // that just failed). Leaving it attached offers the user an action that no longer
  // means anything. `Toast.secondaryAction` accepts `undefined`, so clearing is
  // supported.
  toast.secondaryAction = action;

  return true;
}

/**
 * Assemble the clipboard payload. Exported for testing; not part of the public
 * surface you'd normally reach for.
 */
export function buildClipboardText(input: {
  title: string;
  errorMessage: string;
  error?: unknown;
  copyContext?: string;
}): string {
  const { title, errorMessage, error, copyContext } = input;

  const parts: string[] = [];

  // Only prefix the title when it adds information the message doesn't already carry.
  parts.push(title && !errorMessage.includes(title) ? `${title}: ${errorMessage}` : errorMessage);

  if (copyContext?.trim()) {
    parts.push(copyContext.trim());
  }

  // A stack is the single most useful thing in a bug report — include it when the
  // thrown value actually had one, and drop the redundant first line (which is
  // just "Error: <message>").
  if (error instanceof Error) {
    let stack: unknown;
    try {
      stack = error.stack;
    } catch {
      stack = undefined;
    }
    if (typeof stack === "string") {
      const frames = stack.split("\n").slice(1).join("\n").trimEnd();
      if (frames) {
        parts.push(frames);
      }
    }
  }

  // Redact the WHOLE payload, not just the message. `copyContext` is caller-supplied
  // (a URL with a token in the query string is the obvious hazard) and a stack frame
  // can embed a credential-bearing path — neither passes through `getErrorMessage`,
  // so this is the only place they get scrubbed before reaching the clipboard.
  return redactSecrets(parts.join("\n\n"));
}
