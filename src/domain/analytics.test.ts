import { describe, expect, it } from 'vitest'
import {
  computeBodyWeightTrend,
  formatWeightDeltaKg,
  formatWeightKg,
} from './analytics'
import type { BodyWeightEntry } from './models'

function makeEntry(
  overrides: Partial<BodyWeightEntry> & {
    id: string
    weightKg: number
    occurredAt: string
    localDate: string
  },
): BodyWeightEntry {
  return {
    timeZone: 'Europe/Vienna',
    ...overrides,
  }
}

describe('body-weight 7-calendar-day analytics (T15)', () => {
  it('handles empty state cleanly without treating missing days as zero', () => {
    const trend = computeBodyWeightTrend([], '2026-10-27')
    expect(trend.windowStartDate).toBe('2026-10-21')
    expect(trend.windowEndDate).toBe('2026-10-27')
    expect(trend.days).toHaveLength(7)
    expect(trend.availableDaysCount).toBe(0)
    expect(trend.availabilityLabel).toBe('0 of 7 days')
    expect(trend.averageKg).toBeNull()
    expect(trend.minKg).toBeNull()
    expect(trend.maxKg).toBeNull()
    expect(trend.currentEntry).toBeNull()
    expect(trend.previousEntry).toBeNull()
    expect(trend.deltaFromPreviousKg).toBeNull()
    expect(trend.textSummary).toContain('0 of 7 days recorded')
  })

  it('handles single-day state and collapses multiple same-day check-ins only for the trend', () => {
    const entries: BodyWeightEntry[] = [
      makeEntry({
        id: '11111111-1111-4111-8111-111111111111',
        weightKg: 80.5,
        occurredAt: '2026-10-27T06:30:00.000Z',
        localDate: '2026-10-27',
      }),
      makeEntry({
        id: '11111111-1111-4111-8111-111111111112',
        weightKg: 81.4,
        occurredAt: '2026-10-27T12:00:00.000Z',
        localDate: '2026-10-27',
      }),
      makeEntry({
        id: '11111111-1111-4111-8111-111111111113',
        weightKg: 80.9,
        occurredAt: '2026-10-27T20:15:00.000Z',
        localDate: '2026-10-27',
      }),
    ]

    const trend = computeBodyWeightTrend(entries, '2026-10-27')
    expect(trend.availableDaysCount).toBe(1)
    expect(trend.availabilityLabel).toBe('1 of 7 days')
    // Uses latest reading (20:15 -> 80.9 kg) and divides by 1 available day, never 7.
    expect(trend.averageKg).toBeCloseTo(80.9, 5)
    expect(trend.days[6]).toMatchObject({
      localDate: '2026-10-27',
      weightKg: 80.9,
      measurementCount: 3,
    })
    // Current vs previous still reflects individual check-ins (80.9 vs 81.4).
    expect(trend.currentEntry?.weightKg).toBe(80.9)
    expect(trend.previousEntry?.weightKg).toBe(81.4)
    expect(trend.deltaFromPreviousKg).toBe(-0.5)
    expect(trend.textSummary).toContain('1 of 7 days recorded')
    expect(trend.textSummary).toContain('Single-day reading')
  })

  it('averages only available days across gaps, excludes out-of-window entries from average, and spans DST/month boundaries', () => {
    const entries: BodyWeightEntry[] = [
      // Outside the 7-day window ending 2026-11-01 (window is 2026-10-26..2026-11-01)
      makeEntry({
        id: '22222222-2222-4222-8222-222222222220',
        weightKg: 70.0,
        occurredAt: '2026-10-25T07:00:00.000Z',
        localDate: '2026-10-25',
      }),
      // Day 1 of window (Oct 26) — two readings; latest is 80.0
      makeEntry({
        id: '22222222-2222-4222-8222-222222222221',
        weightKg: 82.0,
        occurredAt: '2026-10-26T06:00:00.000Z',
        localDate: '2026-10-26',
      }),
      makeEntry({
        id: '22222222-2222-4222-8222-222222222222',
        weightKg: 80.0,
        occurredAt: '2026-10-26T21:00:00.000Z',
        localDate: '2026-10-26',
      }),
      // Oct 27..28 missing (must not count as 0)
      // Oct 29 -> 79.0
      makeEntry({
        id: '22222222-2222-4222-8222-222222222223',
        weightKg: 79.0,
        occurredAt: '2026-10-29T07:30:00.000Z',
        localDate: '2026-10-29',
      }),
      // Nov 01 -> 78.0
      makeEntry({
        id: '22222222-2222-4222-8222-222222222224',
        weightKg: 78.0,
        occurredAt: '2026-11-01T07:30:00.000Z',
        localDate: '2026-11-01',
      }),
    ]

    const trend = computeBodyWeightTrend(entries, '2026-11-01')
    expect(trend.windowStartDate).toBe('2026-10-26')
    expect(trend.windowEndDate).toBe('2026-11-01')
    expect(trend.availableDaysCount).toBe(3)
    expect(trend.availabilityLabel).toBe('3 of 7 days')
    // (80.0 + 79.0 + 78.0) / 3 = 79.0
    expect(trend.averageKg).toBeCloseTo(79.0, 5)
    expect(trend.minKg).toBe(78.0)
    expect(trend.maxKg).toBe(80.0)
    expect(trend.days.map((d) => d.weightKg)).toEqual([
      80.0,
      null,
      null,
      79.0,
      null,
      null,
      78.0,
    ])
    expect(trend.textSummary).toContain('3 of 7 days recorded')
    expect(trend.textSummary).toContain('7-day average 79 kg')
  })

  it('retains currentEntry even when latest measurement predates the 7-day window', () => {
    const entries: BodyWeightEntry[] = [
      makeEntry({
        id: '33333333-3333-4333-8333-333333333331',
        weightKg: 76.5,
        occurredAt: '2026-10-01T07:00:00.000Z',
        localDate: '2026-10-01',
      }),
    ]

    const trend = computeBodyWeightTrend(entries, '2026-10-27')
    expect(trend.availableDaysCount).toBe(0)
    expect(trend.averageKg).toBeNull()
    expect(trend.currentEntry?.weightKg).toBe(76.5)
    expect(trend.previousEntry).toBeNull()
  })

  it('rejects invalid referenceLocalDate and formats weight values cleanly', () => {
    expect(() => computeBodyWeightTrend([], '2026-02-30')).toThrow(RangeError)
    expect(formatWeightKg(75.2500001)).toBe('75.25 kg')
    expect(formatWeightDeltaKg(0.4)).toBe('+0.4 kg')
    expect(formatWeightDeltaKg(-0.4)).toBe('-0.4 kg')
    expect(formatWeightDeltaKg(0)).toBe('0 kg')
  })
})
