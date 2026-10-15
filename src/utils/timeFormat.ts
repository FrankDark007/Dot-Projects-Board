/**
 * @file src/utils/timeFormat.ts
 * @description Deterministic relative time and timestamp formatting with tabular numeral discipline.
 */

export function formatRelativeAge(
  isoTimestamp: string | null | undefined,
  referenceNowIso: string
): string {
  if (!isoTimestamp) return 'Never recorded';
  const targetMs = Date.parse(isoTimestamp);
  const nowMs = Date.parse(referenceNowIso);
  if (Number.isNaN(targetMs) || Number.isNaN(nowMs)) return 'Invalid timestamp';

  const diffSec = Math.max(0, Math.floor((nowMs - targetMs) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const remMin = diffMin % 60;
    return remMin > 0 ? `${diffHr}h ${remMin}m ago` : `${diffHr}h ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function formatUtcShort(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return '—';
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return '—';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const sec = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec} UTC`;
}
