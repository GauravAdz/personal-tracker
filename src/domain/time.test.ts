import { describe, expect, it } from 'vitest'
import {
  adjustRestTimerDeadline,
  calculateRestTimerDeadline,
  formatCountdownMMSS,
  getDefaultTimeZone,
  getLocalDate,
  getRemainingRestSeconds,
  isIANATimeZone,
  isLocalDate,
  isUTCISOString,
  shiftLocalDate,
  toUTCISOString,
} from './time'

describe('UTC timestamps', () => {
  it('serializes an explicit instant without changing its time', () => {
    expect(toUTCISOString(new Date('2026-10-27T09:30:00+01:00'))).toBe(
      '2026-10-27T08:30:00.000Z',
    )
    expect(isUTCISOString('2024-02-29T12:00:00.123Z')).toBe(true)
  })

  it.each([
    '',
    '2026-10-27',
    '2026-10-27T12:00:00',
    '2026-10-27T12:00:00.000+00:00',
    '2026-10-27T12:00:00Z',
    '2026-02-29T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z',
    '2026-10-27T24:00:00.000Z',
    '2026-10-27T12:60:00.000Z',
    '2026-10-27T12:00:60.000Z',
  ])('rejects noncanonical or impossible timestamp %s', (value) => {
    expect(isUTCISOString(value)).toBe(false)
    expect(() => getLocalDate(value, 'Europe/Vienna')).toThrow(RangeError)
  })

  it('rejects invalid Dates and unsupported extended years', () => {
    expect(() => toUTCISOString(new Date(NaN))).toThrow(RangeError)
    expect(() =>
      toUTCISOString(new Date('+010000-01-01T00:00:00.000Z')),
    ).toThrow(RangeError)
  })
})

describe('local dates and IANA zones', () => {
  it.each(['2024-02-29', '2026-10-27', '2026-12-31'])(
    'accepts calendar date %s',
    (date) => {
      expect(isLocalDate(date)).toBe(true)
    },
  )
  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-1-01',
    '2026-01-00',
    'yesterday',
  ])('rejects invalid local date %s', (date) => {
    expect(isLocalDate(date)).toBe(false)
  })
  it.each([
    'Europe/Vienna',
    'America/Los_Angeles',
    'UTC',
    'Pacific/Kiritimati',
  ])('accepts IANA zone %s', (zone) => {
    expect(isIANATimeZone(zone)).toBe(true)
  })
  it.each(['', ' ', ' Europe/Vienna', 'Europe/Not_A_Zone', '+01:00', '-0800'])(
    'rejects invalid or numeric zone %s',
    (zone) => {
      expect(isIANATimeZone(zone)).toBe(false)
      expect(() => getLocalDate('2026-10-27T08:00:00.000Z', zone)).toThrow(
        RangeError,
      )
    },
  )
  it.each([
    ['2026-10-27T22:59:59.999Z', 'Europe/Vienna', '2026-10-27'],
    ['2026-10-27T23:00:00.000Z', 'Europe/Vienna', '2026-10-28'],
    ['2026-07-01T21:59:59.999Z', 'Europe/Vienna', '2026-07-01'],
    ['2026-07-01T22:00:00.000Z', 'Europe/Vienna', '2026-07-02'],
    ['2026-03-29T00:59:59.999Z', 'Europe/Vienna', '2026-03-29'],
    ['2026-03-29T01:00:00.000Z', 'Europe/Vienna', '2026-03-29'],
    ['2026-03-29T22:00:00.000Z', 'Europe/Vienna', '2026-03-30'],
    ['2026-10-25T00:30:00.000Z', 'Europe/Vienna', '2026-10-25'],
    ['2026-10-25T01:30:00.000Z', 'Europe/Vienna', '2026-10-25'],
    ['2026-10-25T22:30:00.000Z', 'Europe/Vienna', '2026-10-25'],
    ['2026-10-27T01:00:00.000Z', 'America/Los_Angeles', '2026-10-26'],
    ['2026-12-31T10:00:00.000Z', 'Pacific/Kiritimati', '2027-01-01'],
    ['2024-03-01T00:30:00.000Z', 'America/Los_Angeles', '2024-02-29'],
    ['2026-10-27T01:00:00.000Z', 'UTC', '2026-10-27'],
  ])(
    'groups %s in %s as %s across midnight, DST and travel',
    (timestamp, zone, expected) => {
      expect(getLocalDate(timestamp, zone)).toBe(expected)
    },
  )

  it('computes, adjusts, and formats wall-clock rest timer deadlines and rejects invalid inputs', () => {
    const start = '2026-10-27T10:00:00.000Z'
    const endsAt = calculateRestTimerDeadline(start, 90)
    expect(endsAt).toBe('2026-10-27T10:01:30.000Z')
    expect(getRemainingRestSeconds(endsAt, start)).toBe(90)
    expect(getRemainingRestSeconds(endsAt, '2026-10-27T10:01:29.100Z')).toBe(1)
    expect(getRemainingRestSeconds(endsAt, '2026-10-27T10:02:00.000Z')).toBe(0)

    expect(
      adjustRestTimerDeadline(endsAt, 15, '2026-10-27T10:00:30.000Z'),
    ).toBe('2026-10-27T10:01:45.000Z')
    expect(
      adjustRestTimerDeadline(endsAt, -120, '2026-10-27T10:00:30.000Z'),
    ).toBe('2026-10-27T10:00:30.000Z')

    expect(formatCountdownMMSS(125)).toBe('02:05')
    expect(formatCountdownMMSS(0)).toBe('00:00')

    expect(() => calculateRestTimerDeadline(start, -1)).toThrow(RangeError)
    expect(() => adjustRestTimerDeadline(endsAt, 1.5, start)).toThrow(
      RangeError,
    )
    expect(() => formatCountdownMMSS(-1)).toThrow(RangeError)
  })

  it('shifts calendar local dates across DST, leap day, and year boundaries and resolves default IANA zone', () => {
    expect(isIANATimeZone(getDefaultTimeZone())).toBe(true)
    expect(shiftLocalDate('2026-03-29', 1)).toBe('2026-03-30')
    expect(shiftLocalDate('2026-10-25', -1)).toBe('2026-10-24')
    expect(shiftLocalDate('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftLocalDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(() => shiftLocalDate('2026-02-30', 1)).toThrow(RangeError)
    expect(() => shiftLocalDate('2026-10-27', 0.5)).toThrow(RangeError)
  })
})
