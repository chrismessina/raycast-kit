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

import { getErrorMessage, isAbortError } from "./errors";

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
   * Overrides the message derived from `error`. Rarely needed — prefer letting
   * `getErrorMessage` unwrap the real thing so the user copies the true cause.
   */
  message?: string;
  /**
   * An extra action shown alongside Copy Error — typically "Try Again".
   * Copy Error stays primary; this becomes the secondary action.
   */
  action?: Toast.ActionOptions;
  /**
   * Extra context appended to what lands on the clipboard (not shown in the toast).
   * Use for the request URL, status code, or command name — the things you'd ask
   * for in a bug report anyway.
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

  const errorMessage = message ?? getErrorMessage(error);

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
  if (error instanceof Error && error.stack) {
    const frames = error.stack.split("\n").slice(1).join("\n").trimEnd();
    if (frames) {
      parts.push(frames);
    }
  }

  return parts.join("\n\n");
}
