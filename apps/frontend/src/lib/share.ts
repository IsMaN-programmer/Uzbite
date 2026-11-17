export interface SharePayload { title: string; text?: string; url: string }
export interface SharePlatform {
  share?: (data: SharePayload) => Promise<void>;
  canShare?: (data: SharePayload) => boolean;
  writeText?: (text: string) => Promise<void>;
  copySelection?: (text: string) => boolean;
}
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'manual';

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.execCommand) return false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(field);
  field.focus(); field.select(); field.setSelectionRange(0, text.length);
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* A visible, selectable link is the final fallback. */ }
  field.remove(); previousFocus?.focus({ preventScroll: true });
  if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
  return copied;
}

export function browserSharePlatform(): SharePlatform {
  if (typeof navigator === 'undefined') return {};
  return {
    share: typeof navigator.share === 'function' ? data => navigator.share(data) : undefined,
    canShare: typeof navigator.canShare === 'function' ? data => navigator.canShare(data) : undefined,
    writeText: navigator.clipboard?.writeText ? text => navigator.clipboard.writeText(text) : undefined,
    copySelection: legacyCopy,
  };
}

/** Clipboard API requires a secure context; selection copying also supports HTTP LAN previews. */
export async function copyShareLink(url: string, platform = browserSharePlatform()): Promise<boolean> {
  if (platform.writeText) {
    try { await platform.writeText(url); return true; } catch { /* Permissions may deny the Clipboard API. */ }
  }
  try { return platform.copySelection?.(url) ?? false; } catch { return false; }
}

export async function shareLink(payload: SharePayload, platform = browserSharePlatform()): Promise<ShareResult> {
  if (platform.share) {
    try {
      if (!platform.canShare || platform.canShare(payload)) { await platform.share(payload); return 'shared'; }
    } catch (error: unknown) {
      // Cancelling the native chooser must not unexpectedly copy anything.
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    }
  }
  return await copyShareLink(payload.url, platform) ? 'copied' : 'manual';
}
