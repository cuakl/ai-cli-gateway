export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString();
}

export function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}
