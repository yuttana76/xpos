export function elapsedMinutes(isoString: string, now: number = Date.now()): number {
  const diffMs = now - new Date(isoString).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}
