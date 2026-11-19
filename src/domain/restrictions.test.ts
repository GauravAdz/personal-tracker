import { describe, expect, it } from 'vitest'
import type {
  ExerciseRestriction,
  MusclePreference,
  RoutineExercise,
} from './models'
import {
  auditRoutineRestrictions,
  doesExerciseMatchMusclePriority,
  formatRestrictionBadgeLabel,
  getEffectiveRestrictionStatus,
  getMusclePriority,
  isExerciseSelectableInPicker,
} from './restrictions'

const itemOneId = '11111111-1111-4111-8111-111111111111'
const itemTwoId = '11111111-1111-4111-8111-111111111112'
const itemThreeId = '11111111-1111-4111-8111-111111111113'
const timestamp = '2026-10-27T09:00:00.000Z'

describe('Exercise restrictions and muscle priority domain rules (T09)', () => {
  it('treats missing restriction as unreviewed and never labels unknown status as safe or allowed', () => {
    expect(getEffectiveRestrictionStatus(undefined)).toBe('unreviewed')
    expect(formatRestrictionBadgeLabel(undefined)).toBe(
      'Unreviewed (status not set)',
    )
    expect(formatRestrictionBadgeLabel(undefined).toLowerCase()).not.toContain(
      'safe',
    )
    expect(formatRestrictionBadgeLabel(undefined).toLowerCase()).not.toContain(
      'allowed',
    )

    const allowed: ExerciseRestriction = {
      exerciseId: 'fedb:Barbell_Bench_Press',
      status: 'allowed',
      updatedAt: timestamp,
    }
    const caution: ExerciseRestriction = {
      exerciseId: 'fedb:Standing_Military_Press',
      status: 'caution',
      note: 'Stop below 90 degrees if shoulder pinches',
      updatedAt: timestamp,
    }
    const excluded: ExerciseRestriction = {
      exerciseId: 'fedb:Dips_-_Chest_Version',
      status: 'excluded',
      note: 'Excluded by user',
      updatedAt: timestamp,
    }

    expect(formatRestrictionBadgeLabel(allowed)).toBe('User-marked: Allowed')
    expect(formatRestrictionBadgeLabel(caution)).toBe('Caution')
    expect(formatRestrictionBadgeLabel(excluded)).toBe('Excluded')

    expect(isExerciseSelectableInPicker(undefined)).toBe(true)
    expect(isExerciseSelectableInPicker(allowed)).toBe(true)
    expect(isExerciseSelectableInPicker(caution)).toBe(true)
    expect(isExerciseSelectableInPicker(excluded)).toBe(false)
    expect(
      isExerciseSelectableInPicker(excluded, { includeExcluded: true }),
    ).toBe(true)
  })

  it('audits routine items to block starting when an excluded item is present and surfaces caution notes', () => {
    const items: RoutineExercise[] = [
      {
        id: itemTwoId,
        exerciseId: 'fedb:Standing_Military_Press',
        order: 1,
        workingSets: 3,
        repMin: 8,
        repMax: 10,
        restSeconds: 120,
      },
      {
        id: itemOneId,
        exerciseId: 'fedb:Barbell_Bench_Press',
        order: 0,
        workingSets: 3,
        repMin: 6,
        repMax: 8,
        restSeconds: 120,
      },
      {
        id: itemThreeId,
        exerciseId: 'fedb:Dips_-_Chest_Version',
        order: 2,
        workingSets: 3,
        repMin: 8,
        repMax: 12,
        restSeconds: 90,
      },
    ]

    const restrictions = new Map<string, ExerciseRestriction>([
      [
        'fedb:Standing_Military_Press',
        {
          exerciseId: 'fedb:Standing_Military_Press',
          status: 'caution',
          note: 'Neutral grip preferred',
          updatedAt: timestamp,
        },
      ],
      [
        'fedb:Dips_-_Chest_Version',
        {
          exerciseId: 'fedb:Dips_-_Chest_Version',
          status: 'excluded',
          note: 'Anterior shoulder irritation',
          updatedAt: timestamp,
        },
      ],
    ])

    const audit = auditRoutineRestrictions(items, restrictions)
    expect(audit.canStartRoutine).toBe(false)
    expect(audit.excludedItems).toEqual([
      {
        routineItemId: itemThreeId,
        exerciseId: 'fedb:Dips_-_Chest_Version',
        order: 2,
        status: 'excluded',
        note: 'Anterior shoulder irritation',
      },
    ])
    expect(audit.cautionItems).toEqual([
      {
        routineItemId: itemTwoId,
        exerciseId: 'fedb:Standing_Military_Press',
        order: 1,
        status: 'caution',
        note: 'Neutral grip preferred',
      },
    ])
    expect(audit.items[0]?.status).toBe('unreviewed')

    // Removing the excluded restriction allows the routine to start while keeping caution note visible.
    restrictions.delete('fedb:Dips_-_Chest_Version')
    const passingAudit = auditRoutineRestrictions(items, restrictions)
    expect(passingAudit.canStartRoutine).toBe(true)
    expect(passingAudit.excludedItems).toHaveLength(0)
    expect(passingAudit.cautionItems).toHaveLength(1)
  })

  it('evaluates muscle-group priority preferences for filtering without inferring restrictions', () => {
    const preferences: Record<string, MusclePreference> = {
      chest: {
        muscleGroup: 'chest',
        priority: 'priority',
        updatedAt: timestamp,
      },
      calves: {
        muscleGroup: 'calves',
        priority: 'deprioritized',
        updatedAt: timestamp,
      },
    }

    expect(getMusclePriority('Chest', preferences)).toBe('priority')
    expect(getMusclePriority('lats', preferences)).toBe('normal')
    expect(getMusclePriority('calves', preferences)).toBe('deprioritized')

    expect(
      doesExerciseMatchMusclePriority(
        { primaryMuscles: ['chest'] },
        'priority',
        preferences,
      ),
    ).toBe(true)
    expect(
      doesExerciseMatchMusclePriority(
        { primaryMuscles: ['lats'] },
        'normal',
        preferences,
      ),
    ).toBe(true)
    expect(
      doesExerciseMatchMusclePriority(
        { primaryMuscles: ['chest'] },
        'deprioritized',
        preferences,
      ),
    ).toBe(false)
  })
})
