import type { IANATimeZone, LocalDate, UTCISOString } from './models'

export function isUTCISOString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

export function isLocalDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isUTCISOString(`${value}T00:00:00.000Z`)
  )
}

export function isIANATimeZone(value: string): boolean {
  // Intl also accepts numeric offsets in some engines; those are not IANA names.
  if (!value || value.trim() !== value || /^[+-]/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function toUTCISOString(date: Date): UTCISOString {
  if (!Number.isFinite(date.getTime()))
    throw new RangeError('Invalid event time.')
  const timestamp = date.toISOString()
  if (!isUTCISOString(timestamp))
    throw new RangeError('Event year must have four digits.')
  return timestamp
}

export function getLocalDate(
  timestamp: UTCISOString,
  timeZone: IANATimeZone,
): LocalDate {
  if (!isUTCISOString(timestamp))
    throw new RangeError('Expected a UTC ISO timestamp with milliseconds.')
  if (!isIANATimeZone(timeZone))
    throw new RangeError('Expected an IANA time zone.')

  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  }).formatToParts(new Date(timestamp))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value
  const date = `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`
  if (part('era') !== 'AD' || !isLocalDate(date)) {
    throw new RangeError('Local date is outside the supported calendar range.')
  }
  return date
}

export function getDefaultTimeZone(): IANATimeZone {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
  return resolved && isIANATimeZone(resolved) ? resolved : 'UTC'
}

export function shiftLocalDate(
  localDate: LocalDate,
  deltaDays: number,
): LocalDate {
  if (!isLocalDate(localDate)) {
    throw new RangeError('Expected a valid YYYY-MM-DD local date.')
  }
  if (!Number.isInteger(deltaDays)) {
    throw new RangeError('Day offset must be an integer.')
  }
  const [yearStr, monthStr, dayStr] = localDate.split('-')
  const shifted = new Date(
    Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr) + deltaDays),
  )
  const timestamp = toUTCISOString(shifted)
  return timestamp.slice(0, 10)
}

function toEpochMs(input: Date | UTCISOString | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError('Invalid event time.')
    return input
  }
  if (input instanceof Date) {
    const ms = input.getTime()
    if (!Number.isFinite(ms)) throw new RangeError('Invalid event time.')
    return ms
  }
  if (!isUTCISOString(input)) {
    throw new RangeError('Expected a UTC ISO timestamp with milliseconds.')
  }
  return new Date(input).getTime()
}

export function calculateRestTimerDeadline(
  startedAt: Date | UTCISOString | number,
  durationSeconds: number,
): UTCISOString {
  const startMs = toEpochMs(startedAt)
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    throw new RangeError('Rest duration must be a nonnegative integer.')
  }
  return toUTCISOString(new Date(startMs + durationSeconds * 1000))
}

export function getRemainingRestSeconds(
  endsAt: UTCISOString,
  now: Date | UTCISOString | number,
): number {
  const endMs = toEpochMs(endsAt)
  const nowMs = toEpochMs(now)
  const remainingMs = Math.max(0, endMs - nowMs)
  return Math.ceil(remainingMs / 1000)
}

export function adjustRestTimerDeadline(
  endsAt: UTCISOString,
  deltaSeconds: number,
  now: Date | UTCISOString | number,
): UTCISOString {
  const endMs = toEpochMs(endsAt)
  const nowMs = toEpochMs(now)
  if (!Number.isInteger(deltaSeconds)) {
    throw new RangeError('Rest timer adjustment must be an integer in seconds.')
  }
  const baseMs = Math.max(endMs, nowMs)
  const nextMs = Math.max(nowMs, baseMs + deltaSeconds * 1000)
  return toUTCISOString(new Date(nextMs))
}

export function formatCountdownMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(
      'Countdown seconds must be a finite nonnegative number.',
    )
  }
  const wholeSeconds = Math.floor(totalSeconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
