export interface ReelVisibility { id: string; ratio: number; distance: number }
export interface NetworkHint { saveData?: boolean; effectiveType?: string }

/** One owner selects the current reel, preventing two partially visible videos from playing. */
export function selectVisibleReel(candidates: ReelVisibility[]): string | null {
  const visible = candidates.filter(item => Number.isFinite(item.ratio) && item.ratio >= 0.15);
  visible.sort((left, right) => right.ratio - left.ratio || left.distance - right.distance);
  return visible[0]?.id ?? null;
}

export function allowsNextVideoPreload(connection?: NetworkHint): boolean {
  return !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}

/** Autoplay permission and an interrupted play request are distinct from a broken media file. */
export function playbackFailure(error: unknown): 'permission' | 'interrupted' | 'unsupported' | 'unknown' {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError') return 'permission';
  if (name === 'AbortError') return 'interrupted';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'unknown';
}
