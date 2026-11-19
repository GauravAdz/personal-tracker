import { describe, expect, it, vi } from 'vitest'
import { catalogExerciseId, createId } from './id'

describe('record identity', () => {
  it('generates distinct UUIDv4 user IDs', () => {
    const first = createId()
    const second = createId()
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(second).not.toBe(first)
  })

  it('fails explicitly when secure UUID generation is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      expect(() => createId()).toThrow('Secure UUID generation is unavailable')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('namespaces the upstream ID deterministically without deriving it from a display name', () => {
    expect(catalogExerciseId('Alternate_Incline_Dumbbell_Curl')).toBe(
      'fedb:Alternate_Incline_Dumbbell_Curl',
    )
  })

  it.each([
    '',
    ' ',
    'Bench Press',
    'fedb:Bench_Press',
    '../Bench_Press',
    'https://example.com',
    'Bench_Press\n',
  ])('rejects invalid source ID %s', (sourceId) => {
    expect(() => catalogExerciseId(sourceId)).toThrow(
      'Invalid catalog source ID',
    )
  })
})
