import type { BodyWeightEntry, LocalDate } from './models'
import { isLocalDate, shiftLocalDate } from './time'

export const BODY_WEIGHT_TREND_WINDOW_DAYS = 7

export interface BodyWeightDayPoint {
  localDate: LocalDate
  latestEntry: BodyWeightEntry | null
  weightKg: number | null
  measurementCount: number
}

export interface BodyWeightTrendSummary {
  windowStartDate: LocalDate
  windowEndDate: LocalDate
  days: readonly BodyWeightDayPoint[]
  availableDaysCount: number
  availabilityLabel: string
  averageKg: number | null
  minKg: number | null
  maxKg: number | null
  currentEntry: BodyWeightEntry | null
  previousEntry: BodyWeightEntry | null
  deltaFromPreviousKg: number | null
  textSummary: string
}

export function formatWeightKg(weightKg: number): string {
  const rounded = Number(weightKg.toFixed(2))
  return `${rounded} kg`
}

export function formatWeightDeltaKg(deltaKg: number): string {
  const rounded = Number(deltaKg.toFixed(2))
  if (rounded > 0) return `+${rounded} kg`
  return `${rounded} kg`
}

function compareEntriesNewestFirst(
  left: BodyWeightEntry,
  right: BodyWeightEntry,
): number {
  return (
    right.occurredAt.localeCompare(left.occurredAt) ||
    right.id.localeCompare(left.id)
  )
}

/**
 * Computes a 7-calendar-day body-weight trend ending on `referenceLocalDate`.
 * - Multiple readings on the same `localDate` are collapsed ONLY for the trend
 *   by selecting the latest reading (`occurredAt`) for that calendar day.
 * - Missing calendar days are omitted from the denominator and never counted as zero.
 * - `currentEntry` and `previousEntry` reflect individual check-ins newest-first.
 */
export function computeBodyWeightTrend(
  entries: readonly BodyWeightEntry[],
  referenceLocalDate: LocalDate,
): BodyWeightTrendSummary {
  if (!isLocalDate(referenceLocalDate)) {
    throw new RangeError('Expected a valid YYYY-MM-DD reference local date.')
  }

  const sortedNewestFirst = [...entries].sort(compareEntriesNewestFirst)
  const currentEntry = sortedNewestFirst[0] ?? null
  const previousEntry = sortedNewestFirst[1] ?? null
  const deltaFromPreviousKg =
    currentEntry && previousEntry
      ? Number((currentEntry.weightKg - previousEntry.weightKg).toFixed(2))
      : null

  const windowStartDate = shiftLocalDate(
    referenceLocalDate,
    -(BODY_WEIGHT_TREND_WINDOW_DAYS - 1),
  )
  const windowEndDate = referenceLocalDate

  const entriesByDate = new Map<LocalDate, BodyWeightEntry[]>()
  for (const entry of sortedNewestFirst) {
    if (entry.localDate < windowStartDate || entry.localDate > windowEndDate) {
      continue
    }
    const list = entriesByDate.get(entry.localDate) ?? []
    list.push(entry)
    entriesByDate.set(entry.localDate, list)
  }

  const days: BodyWeightDayPoint[] = []
  for (
    let offset = -(BODY_WEIGHT_TREND_WINDOW_DAYS - 1);
    offset <= 0;
    offset += 1
  ) {
    const localDate = shiftLocalDate(referenceLocalDate, offset)
    const dayEntries = entriesByDate.get(localDate) ?? []
    // Entries were inserted from `sortedNewestFirst`, so index 0 is the latest reading.
    const latestEntry = dayEntries[0] ?? null
    days.push({
      localDate,
      latestEntry,
      weightKg: latestEntry ? latestEntry.weightKg : null,
      measurementCount: dayEntries.length,
    })
  }

  const availableDays = days.filter(
    (day): day is BodyWeightDayPoint & { weightKg: number } =>
      day.weightKg !== null,
  )
  const availableDaysCount = availableDays.length
  const availabilityLabel = `${availableDaysCount} of ${BODY_WEIGHT_TREND_WINDOW_DAYS} days`

  let averageKg: number | null = null
  let minKg: number | null = null
  let maxKg: number | null = null

  if (availableDaysCount > 0) {
    const sum = availableDays.reduce((acc, day) => acc + day.weightKg, 0)
    averageKg = sum / availableDaysCount
    minKg = Math.min(...availableDays.map((day) => day.weightKg))
    maxKg = Math.max(...availableDays.map((day) => day.weightKg))
  }

  let textSummary: string
  if (availableDaysCount === 0) {
    textSummary = `7-day body-weight trend (${windowStartDate} to ${windowEndDate}): 0 of 7 days recorded. No measurements in this window.`
  } else if (availableDaysCount === 1) {
    const onlyDay = availableDays[0]!
    textSummary = `7-day body-weight trend (${windowStartDate} to ${windowEndDate}): 1 of 7 days recorded (${onlyDay.localDate}: ${formatWeightKg(onlyDay.weightKg)}). Single-day reading; average ${formatWeightKg(averageKg!)}.`
  } else {
    const dailyList = availableDays
      .map((day) => `${day.localDate} ${formatWeightKg(day.weightKg)}`)
      .join(', ')
    textSummary = `7-day body-weight trend (${windowStartDate} to ${windowEndDate}): ${availabilityLabel} recorded. 7-day average ${formatWeightKg(averageKg!)} (range ${formatWeightKg(minKg!)} to ${formatWeightKg(maxKg!)}). Daily latest readings: ${dailyList}.`
  }

  return {
    windowStartDate,
    windowEndDate,
    days,
    availableDaysCount,
    availabilityLabel,
    averageKg,
    minKg,
    maxKg,
    currentEntry,
    previousEntry,
    deltaFromPreviousKg,
    textSummary,
  }
}
