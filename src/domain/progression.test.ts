import { describe, expect, it } from 'vitest'
import {
  evaluateProgression,
  formatProgressionBadgeLabel,
  type ProgressionEvaluationInput,
  type ProgressionStatus,
} from './progression'

interface ProgressionTestCase {
  name: string
  input: ProgressionEvaluationInput
  expectedStatus: ProgressionStatus
  expectedReferenceLoadKg: number | null
  expectedReasonIncludes: string
}

describe('progression domain engine (T13)', () => {
  const cases: ProgressionTestCase[] = [
    {
      name: 'all working sets hit repMax with consistent external load and non-zero RIR -> eligible_to_increase',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        exerciseId: 'fedb:Barbell_Bench_Press',
        equipment: 'barbell',
        previousSets: [
          {
            kind: 'working',
            externalLoadKg: 80,
            reps: 12,
            repsInReserve: 2,
            feedback: 'normal',
          },
          {
            kind: 'working',
            externalLoadKg: 80,
            reps: 12,
            repsInReserve: 1,
            feedback: 'hard',
          },
          {
            kind: 'working',
            externalLoadKg: 80,
            reps: 12,
            repsInReserve: 1,
            feedback: 'hard',
          },
        ],
      },
      expectedStatus: 'eligible_to_increase',
      expectedReferenceLoadKg: 80,
      expectedReasonIncludes: 'All 3 sets met 12 reps at 80 kg',
    },
    {
      name: 'all working sets exceed repMax with omitted feedback and RIR -> eligible_to_increase',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { externalLoadKg: 60, reps: 13 },
          { externalLoadKg: 60, reps: 12 },
          { externalLoadKg: 60, reps: 12 },
        ],
      },
      expectedStatus: 'eligible_to_increase',
      expectedReferenceLoadKg: 60,
      expectedReasonIncludes: 'All 3 sets met 12 reps at 60 kg',
    },
    {
      name: 'ignores warmup sets when evaluating comparable working sets',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 10,
        previousSets: [
          {
            kind: 'warmup',
            externalLoadKg: 40,
            reps: 5,
            feedback: 'discomfort',
          },
          { kind: 'working', externalLoadKg: 75, reps: 10, repsInReserve: 2 },
          { kind: 'working', externalLoadKg: 75, reps: 10, repsInReserve: 1 },
        ],
      },
      expectedStatus: 'eligible_to_increase',
      expectedReferenceLoadKg: 75,
      expectedReasonIncludes: 'All 2 sets met 10 reps at 75 kg',
    },
    {
      name: 'mixed reps below repMax (12, 11, 10) -> repeat_load_or_adjust_reps',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12, repsInReserve: 1 },
          { kind: 'working', externalLoadKg: 80, reps: 11, repsInReserve: 1 },
          { kind: 'working', externalLoadKg: 80, reps: 10, repsInReserve: 1 },
        ],
      },
      expectedStatus: 'repeat_load_or_adjust_reps',
      expectedReferenceLoadKg: 80,
      expectedReasonIncludes: '1 of 3 sets met 12 reps (12, 11, 10 at 80 kg)',
    },
    {
      name: 'all working sets below repMax -> repeat_load_or_adjust_reps',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 50, reps: 8 },
          { kind: 'working', externalLoadKg: 50, reps: 8 },
          { kind: 'working', externalLoadKg: 50, reps: 7 },
        ],
      },
      expectedStatus: 'repeat_load_or_adjust_reps',
      expectedReferenceLoadKg: 50,
      expectedReasonIncludes: '0 of 3 sets met 12 reps (8, 8, 7 at 50 kg)',
    },
    {
      name: 'all sets hit repMax but previous set has 0 RIR -> repeat_load_or_adjust_reps',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12, repsInReserve: 1 },
          { kind: 'working', externalLoadKg: 80, reps: 12, repsInReserve: 0 },
          { kind: 'working', externalLoadKg: 80, reps: 12, repsInReserve: 1 },
        ],
      },
      expectedStatus: 'repeat_load_or_adjust_reps',
      expectedReferenceLoadKg: 80,
      expectedReasonIncludes: '0 RIR was reported',
    },
    {
      name: 'all sets hit repMax but currentRepsInReserve is 0 -> repeat_load_or_adjust_reps',
      input: {
        targetSets: 2,
        targetRepMin: 6,
        targetRepMax: 8,
        previousSets: [
          { kind: 'working', externalLoadKg: 90, reps: 8, repsInReserve: 2 },
          { kind: 'working', externalLoadKg: 90, reps: 8, repsInReserve: 2 },
        ],
        currentRepsInReserve: 0,
      },
      expectedStatus: 'repeat_load_or_adjust_reps',
      expectedReferenceLoadKg: 90,
      expectedReasonIncludes: '0 RIR was reported',
    },
    {
      name: 'all sets hit repMax but a current working set has 0 RIR -> repeat_load_or_adjust_reps',
      input: {
        targetSets: 2,
        targetRepMin: 6,
        targetRepMax: 8,
        previousSets: [
          { kind: 'working', externalLoadKg: 90, reps: 8, repsInReserve: 2 },
          { kind: 'working', externalLoadKg: 90, reps: 8, repsInReserve: 1 },
        ],
        currentSets: [
          { kind: 'working', externalLoadKg: 90, reps: 8, repsInReserve: 0 },
        ],
      },
      expectedStatus: 'repeat_load_or_adjust_reps',
      expectedReferenceLoadKg: 90,
      expectedReasonIncludes: '0 RIR was reported',
    },
    {
      name: 'discomfort reported in previous working sets -> review_exercise with null load recommendation',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12, feedback: 'normal' },
          {
            kind: 'working',
            externalLoadKg: 80,
            reps: 12,
            feedback: 'discomfort',
          },
          { kind: 'working', externalLoadKg: 80, reps: 12, feedback: 'normal' },
        ],
      },
      expectedStatus: 'review_exercise',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'Discomfort reported on previous working sets',
    },
    {
      name: 'discomfort reported via currentFeedback -> review_exercise',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
        ],
        currentFeedback: 'discomfort',
      },
      expectedStatus: 'review_exercise',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'Discomfort reported — review exercise',
    },
    {
      name: 'discomfort reported in currentSets -> review_exercise',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [],
        currentSets: [
          {
            kind: 'working',
            externalLoadKg: 40,
            reps: 8,
            feedback: 'discomfort',
          },
        ],
      },
      expectedStatus: 'review_exercise',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'Discomfort reported — review exercise',
    },
    {
      name: 'inconsistent external loads across previous working sets -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 75, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'inconsistent external loads',
    },
    {
      name: 'missing previous history -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'no previous completed working sets',
    },
    {
      name: 'only warmup sets in previous history -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [{ kind: 'warmup', externalLoadKg: 40, reps: 12 }],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'no previous completed working sets',
    },
    {
      name: 'all bodyweight / null external loads -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: null, reps: 12 },
          { kind: 'working', externalLoadKg: null, reps: 12 },
          { kind: 'working', externalLoadKg: null, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'bodyweight / null load sets',
    },
    {
      name: 'mix of null and numeric external loads -> no_suggestion',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: null, reps: 12 },
          { kind: 'working', externalLoadKg: 10, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'mix of bodyweight and external load',
    },
    {
      name: 'non-comparable working set count vs targetSets -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes:
        'non-comparable set count (2 previous working sets vs target of 3)',
    },
    {
      name: 'non-comparable previousTargetSets vs targetSets -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 8,
        targetRepMax: 12,
        previousTargetSets: 4,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'non-comparable target set count (4 vs 3)',
    },
    {
      name: 'exercise ID mismatch -> no_suggestion',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 12,
        exerciseId: 'fedb:Barbell_Bench_Press',
        previousExerciseId: 'fedb:Incline_Dumbbell_Press',
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'different exercise',
    },
    {
      name: 'per-set exercise ID mismatch -> no_suggestion',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 12,
        exerciseId: 'fedb:Barbell_Bench_Press',
        previousSets: [
          {
            kind: 'working',
            externalLoadKg: 80,
            reps: 12,
            exerciseId: 'fedb:Dumbbell_Bench_Press',
          },
          {
            kind: 'working',
            externalLoadKg: 80,
            reps: 12,
            exerciseId: 'fedb:Barbell_Bench_Press',
          },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'different exercise',
    },
    {
      name: 'equipment mismatch -> no_suggestion',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 12,
        equipment: 'barbell',
        previousEquipment: 'dumbbell',
        previousSets: [
          { kind: 'working', externalLoadKg: 30, reps: 12 },
          { kind: 'working', externalLoadKg: 30, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'equipment changed',
    },
    {
      name: 'invalid target range (repMax < repMin) -> no_suggestion',
      input: {
        targetSets: 3,
        targetRepMin: 12,
        targetRepMax: 8,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'invalid target set or rep range',
    },
    {
      name: 'invalid currentRepsInReserve -> no_suggestion',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: 80, reps: 12 },
          { kind: 'working', externalLoadKg: 80, reps: 12 },
        ],
        currentRepsInReserve: Number.NaN,
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'invalid RIR value',
    },
    {
      name: 'invalid previous set data (negative load) -> no_suggestion',
      input: {
        targetSets: 2,
        targetRepMin: 8,
        targetRepMax: 12,
        previousSets: [
          { kind: 'working', externalLoadKg: -5, reps: 12 },
          { kind: 'working', externalLoadKg: -5, reps: 12 },
        ],
      },
      expectedStatus: 'no_suggestion',
      expectedReferenceLoadKg: null,
      expectedReasonIncludes: 'invalid previous set data',
    },
  ]

  it.each(cases)(
    '$name',
    ({
      input,
      expectedStatus,
      expectedReferenceLoadKg,
      expectedReasonIncludes,
    }) => {
      const result = evaluateProgression(input)
      expect(result.status).toBe(expectedStatus)
      expect(result.referenceLoadKg).toBe(expectedReferenceLoadKg)
      expect(result.reason).toContain(expectedReasonIncludes)
    },
  )

  it.each<[ProgressionStatus, string]>([
    ['eligible_to_increase', 'Eligible to increase load'],
    ['repeat_load_or_adjust_reps', 'Repeat load or adjust reps'],
    ['review_exercise', 'Review exercise'],
    ['no_suggestion', 'No suggestion'],
  ])('formatProgressionBadgeLabel(%s) returns %s', (status, expectedLabel) => {
    expect(formatProgressionBadgeLabel(status)).toBe(expectedLabel)
  })
})
