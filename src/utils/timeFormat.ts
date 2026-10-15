/**
 * @file src/utils/timeFormat.ts
 * @description Deterministic relative time, UTC formatting, and strict timestamp sanity validation.
 * Rejects invalid or implausibly future timestamps so they are never treated as fresh.
 */

/**
 * Maximum tolerated positive clock skew (5 seconds) before a timestamp is flagged as
 * implausibly in the future and treated as uncertain.
 */
export const MAX_FUTURE_SKEW_MS = 5000;

export interface ParsedTimestampStatus {
  valid: boolean;
  isFuture: boolean;
  epochMs: number | null;
  ageSeconds: number | null;
  reason?: string;
}

/**
 * Parses an ISO timestamp and compares it against `referenceNowIso`.
 * If the timestamp is missing, malformed, or more than `MAX_FUTURE_SKEW_MS` in the future,
 * `valid` is false and `ageSeconds` is null (never clamped to 0s fresh!).
 */
export function evaluateTimestamp(
  isoTimestamp: string | null | undefined,
  referenceNowIso: string
): ParsedTimestampStatus {
  if (!isoTimestamp || typeof isoTimestamp !== 'string') {
    return {
      valid: false,
      isFuture: false,
      epochMs: null,
      ageSeconds: null,
      reason: 'Missing timestamp',
    };
  }

  const targetMs = Date.parse(isoTimestamp);
  const nowMs = Date.parse(referenceNowIso);

  if (Number.isNaN(targetMs) || Number.isNaN(nowMs)) {
    return {
      valid: false,
      isFuture: false,
      epochMs: null,
      ageSeconds: null,
      reason: `Malformed timestamp "${isoTimestamp}"`,
    };
  }

  const deltaMs = nowMs - targetMs;
  if (deltaMs < -MAX_FUTURE_SKEW_MS) {
    const futureSec = Math.ceil(Math.abs(deltaMs) / 1000);
    return {
      valid: false,
      isFuture: true,
      epochMs: targetMs,
      ageSeconds: null,
      reason: `Implausibly future timestamp (+${futureSec}s ahead of clock)`,
    };
  }

  const ageSeconds = Math.max(0, Math.floor(deltaMs / 1000));
  return {
    valid: true,
    isFuture: false,
    epochMs: targetMs,
    ageSeconds,
  };
}

export function formatRelativeAge(
  isoTimestamp: string | null | undefined,
  referenceNowIso: string
): string {
  if (!isoTimestamp) return 'Never recorded';
  const status = evaluateTimestamp(isoTimestamp, referenceNowIso);
  if (!status.valid) {
    if (status.isFuture) {
      return 'Uncertain (future clock skew)';
    }
    return 'Uncertain (invalid timestamp)';
  }

  const diffSec = status.ageSeconds!;
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
  if (Number.isNaN(d.getTime())) return 'Invalid timestamp';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const sec = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec} UTC`;
}
