import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type * as Models from '../domain/models'
import * as schemas from './validation'

const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const timestamp = '2026-10-27T08:30:00.000Z'
const later = '2026-10-27T09:30:00.000Z'
const exerciseId = 'fedb:Bench_Press'
const mutable = { createdAt: timestamp, updatedAt: later }
const calendar = { localDate: '2026-10-27', timeZone: 'Europe/Vienna' }

const catalog: Models.CatalogExercise = {
  id: exerciseId,
  sourceId: 'Bench_Press',
  name: 'Bench press',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: 'barbell',
  instructions: ['User-supplied instructions.'],
  category: 'strength',
  imagePaths: ['exercises/Bench_Press/0.jpg'],
}
const override: Models.ExerciseOverride = {
  exerciseId,
  favorite: false,
  updatedAt: timestamp,
}
const restriction: Models.ExerciseRestriction = {
  exerciseId,
  status: 'caution',
  note: 'User note',
  updatedAt: timestamp,
}
const preference: Models.MusclePreference = {
  muscleGroup: 'chest',
  priority: 'normal',
  updatedAt: timestamp,
}
const item: Models.RoutineExercise = {
  id,
  exerciseId,
  order: 0,
  workingSets: 3,
  repMin: 8,
  repMax: 12,
  restSeconds: 90,
}
const routine: Models.Routine = {
  id,
  name: 'Routine',
  items: [item],
  ...mutable,
}
const session: Models.WorkoutSession = {
  id,
  routineId: null,
  status: 'active',
  startedAt: timestamp,
}
const sessionExercise: Models.SessionExercise = {
  id,
  sessionId: otherId,
  exerciseId,
  exerciseNameSnapshot: 'Bench press',
  equipmentSnapshot: null,
  order: 0,
  targetSets: 3,
  targetRepMin: 8,
  targetRepMax: 12,
  restSeconds: 90,
}
const setLog: Models.SetLog = {
  id,
  sessionId: otherId,
  sessionExerciseId: id,
  ordinal: 1,
  kind: 'working',
  externalLoadKg: null,
  reps: 8,
  completedAt: timestamp,
}
const bodyWeight: Models.BodyWeightEntry = {
  id,
  weightKg: 75.25,
  occurredAt: timestamp,
  ...calendar,
}
const habit: Models.HabitDefinition = {
  id,
  name: 'Daily routine',
  slots: [{ id, label: 'Morning', localTime: '08:00' }],
  archived: false,
  ...mutable,
}
const habitLog: Models.HabitLog = {
  id,
  habitId: otherId,
  slotId: id,
  ...calendar,
  status: 'done',
  occurredAt: timestamp,
}
const settings: Models.AppSettings = {
  id: 'singleton',
  preferredMassUnit: 'kg',
  catalogVersion: 'v1',
}

const records = [
  {
    name: 'catalog exercise',
    schema: schemas.catalogExerciseSchema,
    valid: catalog,
    invalid: { ...catalog, id: 'fedb:Other' },
  },
  {
    name: 'exercise override',
    schema: schemas.exerciseOverrideSchema,
    valid: override,
    invalid: { ...override, customName: ' ' },
  },
  {
    name: 'exercise restriction',
    schema: schemas.exerciseRestrictionSchema,
    valid: restriction,
    invalid: { ...restriction, status: 'unknown' },
  },
  {
    name: 'muscle preference',
    schema: schemas.musclePreferenceSchema,
    valid: preference,
    invalid: { ...preference, muscleGroup: '' },
  },
  {
    name: 'routine exercise',
    schema: schemas.routineExerciseSchema,
    valid: item,
    invalid: { ...item, repMin: 13 },
  },
  {
    name: 'routine',
    schema: schemas.routineSchema,
    valid: routine,
    invalid: { ...routine, updatedAt: '2026-10-26T00:00:00.000Z' },
  },
  {
    name: 'workout session',
    schema: schemas.workoutSessionSchema,
    valid: session,
    invalid: { ...session, status: 'completed' },
  },
  {
    name: 'session exercise',
    schema: schemas.sessionExerciseSchema,
    valid: sessionExercise,
    invalid: { ...sessionExercise, targetRepMin: 13 },
  },
  {
    name: 'set log',
    schema: schemas.setLogSchema,
    valid: setLog,
    invalid: { ...setLog, reps: 0 },
  },
  {
    name: 'body weight',
    schema: schemas.bodyWeightEntrySchema,
    valid: bodyWeight,
    invalid: { ...bodyWeight, weightKg: 0 },
  },
  {
    name: 'habit definition',
    schema: schemas.habitDefinitionSchema,
    valid: habit,
    invalid: { ...habit, slots: [] },
  },
  {
    name: 'habit log',
    schema: schemas.habitLogSchema,
    valid: habitLog,
    invalid: { ...habitLog, status: 'pending' },
  },
  {
    name: 'settings',
    schema: schemas.appSettingsSchema,
    valid: settings,
    invalid: { ...settings, preferredMassUnit: 'lb' },
  },
]

describe('entity contracts', () => {
  it.each(records)(
    'parses a valid $name without changing facts',
    ({ schema, valid }) => {
      expect(schema.parse(valid)).toEqual(valid)
      expect(schema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid)
    },
  )
  it.each(records)('rejects an invalid $name', ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false)
  })
  it.each(records)(
    'rejects unknown fields in $name instead of silently stripping them',
    ({ schema, valid }) => {
      expect(schema.safeParse({ ...valid, unexpected: true }).success).toBe(
        false,
      )
    },
  )

  it('keeps schema outputs exactly aligned with the domain contracts', () => {
    expectTypeOf<
      z.output<typeof schemas.catalogExerciseSchema>
    >().toEqualTypeOf<Models.CatalogExercise>()
    expectTypeOf<
      z.output<typeof schemas.exerciseOverrideSchema>
    >().toEqualTypeOf<Models.ExerciseOverride>()
    expectTypeOf<
      z.output<typeof schemas.exerciseRestrictionSchema>
    >().toEqualTypeOf<Models.ExerciseRestriction>()
    expectTypeOf<
      z.output<typeof schemas.musclePreferenceSchema>
    >().toEqualTypeOf<Models.MusclePreference>()
    expectTypeOf<
      z.output<typeof schemas.routineExerciseSchema>
    >().toEqualTypeOf<Models.RoutineExercise>()
    expectTypeOf<
      z.output<typeof schemas.routineSchema>
    >().toEqualTypeOf<Models.Routine>()
    expectTypeOf<
      z.output<typeof schemas.workoutSessionSchema>
    >().toEqualTypeOf<Models.WorkoutSession>()
    expectTypeOf<
      z.output<typeof schemas.sessionExerciseSchema>
    >().toEqualTypeOf<Models.SessionExercise>()
    expectTypeOf<
      z.output<typeof schemas.setLogSchema>
    >().toEqualTypeOf<Models.SetLog>()
    expectTypeOf<
      z.output<typeof schemas.bodyWeightEntrySchema>
    >().toEqualTypeOf<Models.BodyWeightEntry>()
    expectTypeOf<
      z.output<typeof schemas.habitSlotSchema>
    >().toEqualTypeOf<Models.HabitSlot>()
    expectTypeOf<
      z.output<typeof schemas.habitDefinitionSchema>
    >().toEqualTypeOf<Models.HabitDefinition>()
    expectTypeOf<
      z.output<typeof schemas.habitLogSchema>
    >().toEqualTypeOf<Models.HabitLog>()
    expectTypeOf<
      z.output<typeof schemas.appSettingsSchema>
    >().toEqualTypeOf<Models.AppSettings>()
  })
})

describe('shared input boundaries', () => {
  it.each([
    {
      name: 'routine',
      input: schemas.routineInputSchema,
      record: schemas.routineSchema,
      valid: { name: routine.name, items: routine.items },
      metadata: { id, ...mutable },
      invalid: { name: ' ' },
    },
    {
      name: 'set',
      input: schemas.setLogInputSchema,
      record: schemas.setLogSchema,
      valid: {
        sessionId: otherId,
        sessionExerciseId: id,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: null,
        reps: 8,
        completedAt: timestamp,
      },
      metadata: { id },
      invalid: { reps: 0 },
    },
    {
      name: 'weight',
      input: schemas.bodyWeightInputSchema,
      record: schemas.bodyWeightEntrySchema,
      valid: { weightKg: 75.25, occurredAt: timestamp, ...calendar },
      metadata: { id },
      invalid: { weightKg: NaN },
    },
    {
      name: 'habit',
      input: schemas.habitDefinitionInputSchema,
      record: schemas.habitDefinitionSchema,
      valid: { name: habit.name, slots: habit.slots, archived: false },
      metadata: { id, ...mutable },
      invalid: { slots: [] },
    },
    {
      name: 'habit log',
      input: schemas.habitLogInputSchema,
      record: schemas.habitLogSchema,
      valid: {
        habitId: otherId,
        slotId: id,
        ...calendar,
        status: 'done',
        occurredAt: timestamp,
      },
      metadata: { id },
      invalid: { quantity: Infinity },
    },
  ])(
    'uses the same $name constraints for form inputs and persisted rows',
    ({ input, record, valid, metadata, invalid }) => {
      expect(input.safeParse(valid).success).toBe(true)
      expect(record.safeParse({ ...valid, ...metadata }).success).toBe(true)
      expect(input.safeParse({ ...valid, ...invalid }).success).toBe(false)
      expect(
        record.safeParse({ ...valid, ...metadata, ...invalid }).success,
      ).toBe(false)
    },
  )

  it.each([NaN, Infinity, -Infinity, '10', '', null])(
    'rejects nonnumeric/non-finite value %s in measurements and counts',
    (value) => {
      for (const [schema, valid, field] of [
        [schemas.bodyWeightEntrySchema, bodyWeight, 'weightKg'],
        [schemas.habitLogSchema, habitLog, 'quantity'],
        [schemas.setLogSchema, setLog, 'reps'],
        [schemas.setLogSchema, setLog, 'ordinal'],
        [schemas.setLogSchema, setLog, 'repsInReserve'],
        [schemas.routineExerciseSchema, item, 'workingSets'],
        [schemas.routineExerciseSchema, item, 'repMin'],
        [schemas.routineExerciseSchema, item, 'repMax'],
        [schemas.routineExerciseSchema, item, 'restSeconds'],
        [schemas.routineExerciseSchema, item, 'order'],
        [schemas.sessionExerciseSchema, sessionExercise, 'targetSets'],
        [schemas.sessionExerciseSchema, sessionExercise, 'targetRepMin'],
        [schemas.sessionExerciseSchema, sessionExercise, 'targetRepMax'],
      ] as const) {
        expect(
          schema.safeParse({ ...valid, [field]: value }).success,
          field,
        ).toBe(false)
      }
    },
  )

  it.each([NaN, Infinity, -Infinity, -1, 1001, '20', ''])(
    'rejects invalid load %s',
    (externalLoadKg) => {
      expect(
        schemas.setLogSchema.safeParse({ ...setLog, externalLoadKg }).success,
      ).toBe(false)
    },
  )

  it('preserves null and zero loads distinctly; requires actual values', () => {
    expect(schemas.setLogSchema.parse(setLog).externalLoadKg).toBeNull()
    expect(
      schemas.setLogSchema.parse({ ...setLog, externalLoadKg: 0 })
        .externalLoadKg,
    ).toBe(0)
    expect(
      schemas.setLogSchema.parse({
        ...setLog,
        externalLoadKg: 12.5,
        repsInReserve: 0.5,
      }).externalLoadKg,
    ).toBe(12.5)
    expect(
      schemas.setLogSchema.safeParse({ ...setLog, externalLoadKg: undefined })
        .success,
    ).toBe(false)
    expect(
      schemas.setLogSchema.safeParse({ ...setLog, reps: undefined }).success,
    ).toBe(false)
    expect(
      schemas.setLogSchema.safeParse({ ...setLog, reps: 1.5 }).success,
    ).toBe(false)
    expect(
      schemas.setLogSchema.safeParse({ ...setLog, ordinal: 0 }).success,
    ).toBe(false)
    expect(
      schemas.setLogSchema.safeParse({ ...setLog, repsInReserve: 11 }).success,
    ).toBe(false)
    expect(
      schemas.setLogSchema.safeParse({ ...setLog, repsInReserve: -1 }).success,
    ).toBe(false)
  })

  it('bounds body mass without rounding decimals and allows nonnegative observed quantities', () => {
    expect(schemas.bodyWeightKgSchema.parse(75.125)).toBe(75.125)
    expect(schemas.bodyWeightKgSchema.parse(1000)).toBe(1000)
    expect(schemas.bodyWeightKgSchema.safeParse(1000.01).success).toBe(false)
    expect(schemas.bodyWeightKgSchema.safeParse(-1).success).toBe(false)
    expect(schemas.quantitySchema.parse(0)).toBe(0)
    expect(schemas.quantitySchema.parse(1.25)).toBe(1.25)
    expect(schemas.quantitySchema.safeParse(-1).success).toBe(false)
  })

  it('requires explicit restriction selection without an allowed default', () => {
    for (const status of ['allowed', 'caution', 'excluded']) {
      expect(
        schemas.exerciseRestrictionSchema.parse({ ...restriction, status })
          .status,
      ).toBe(status)
    }
    expect(
      schemas.exerciseRestrictionSchema.safeParse({
        ...restriction,
        status: undefined,
      }).success,
    ).toBe(false)
  })
})

describe('nested record invariants', () => {
  it('permits repeated exercises with distinct item IDs and orders, and empty draft routines', () => {
    expect(
      schemas.routineSchema.parse({
        ...routine,
        items: [item, { ...item, id: otherId, order: 2 }],
      }).items,
    ).toHaveLength(2)
    expect(
      schemas.routineSchema.parse({ ...routine, items: [] }).items,
    ).toEqual([])
  })
  it.each([[{ ...item, id: otherId }], [{ ...item, order: 1 }]])(
    'rejects duplicate routine order or item ID',
    (duplicate) => {
      expect(
        schemas.routineSchema.safeParse({
          ...routine,
          items: [item, duplicate],
        }).success,
      ).toBe(false)
    },
  )
  it('accepts boundary targets and rejects negative/fractional counts', () => {
    expect(
      schemas.routineExerciseSchema.safeParse({
        ...item,
        repMin: 1,
        repMax: 1,
        workingSets: 1,
        restSeconds: 0,
      }).success,
    ).toBe(true)
    for (const field of [
      'order',
      'workingSets',
      'repMin',
      'repMax',
      'restSeconds',
    ]) {
      for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(
          schemas.routineExerciseSchema.safeParse({ ...item, [field]: value })
            .success,
        ).toBe(false)
      }
    }
    expect(
      schemas.sessionExerciseSchema.safeParse({
        ...sessionExercise,
        targetRepMin: 1,
        targetRepMax: 1,
        targetSets: 1,
        restSeconds: 0,
      }).success,
    ).toBe(true)
  })

  it.each(['completed', 'cancelled'])(
    'requires a valid end time for a %s session',
    (status) => {
      expect(
        schemas.workoutSessionSchema.safeParse({
          ...session,
          status,
          endedAt: later,
        }).success,
      ).toBe(true)
      expect(
        schemas.workoutSessionSchema.safeParse({ ...session, status }).success,
      ).toBe(false)
      expect(
        schemas.workoutSessionSchema.safeParse({
          ...session,
          status,
          endedAt: '2026-10-26T00:00:00.000Z',
        }).success,
      ).toBe(false)
    },
  )
  it('rejects ended active sessions', () => {
    expect(
      schemas.workoutSessionSchema.safeParse({ ...session, endedAt: later })
        .success,
    ).toBe(false)
  })

  it('requires nonempty uniquely identified habit slots and ordered mutable timestamps', () => {
    expect(
      schemas.habitDefinitionSchema.safeParse({
        ...habit,
        slots: [
          { id, label: 'AM' },
          { id: otherId, label: 'PM', localTime: '23:59' },
        ],
      }).success,
    ).toBe(true)
    expect(
      schemas.habitDefinitionSchema.safeParse({
        ...habit,
        slots: [...habit.slots, ...habit.slots],
      }).success,
    ).toBe(false)
    expect(
      schemas.habitDefinitionSchema.safeParse({
        ...habit,
        slots: [{ id, label: ' ' }],
      }).success,
    ).toBe(false)
    expect(
      schemas.habitDefinitionSchema.safeParse({
        ...habit,
        updatedAt: '2026-10-26T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })
  it.each(['24:00', '12:60', '8:00', '08:00Z', '08:00:00', '', '08:00\n'])(
    'rejects invalid optional local time %s',
    (localTime) => {
      expect(
        schemas.habitSlotSchema.safeParse({ id, label: 'AM', localTime })
          .success,
      ).toBe(false)
    },
  )

  it('preserves a historical calendar day without consulting the current device zone', () => {
    const historical = {
      ...habitLog,
      localDate: '2026-10-25',
      timeZone: 'America/Los_Angeles',
    }
    expect(schemas.habitLogSchema.parse(historical)).toEqual(historical)
    expect(
      schemas.bodyWeightEntrySchema.parse({
        ...bodyWeight,
        timeZone: 'Pacific/Kiritimati',
      }).localDate,
    ).toBe(calendar.localDate)
  })
  it('validates optional settings timestamps and timer references', () => {
    const value = {
      ...settings,
      lastExportedAt: timestamp,
      restTimer: { sessionId: id, endsAt: later },
    }
    expect(schemas.appSettingsSchema.parse(value)).toEqual(value)
    expect(
      schemas.appSettingsSchema.safeParse({
        ...value,
        restTimer: { sessionId: 'bad-id', endsAt: later },
      }).success,
    ).toBe(false)
    expect(
      schemas.appSettingsSchema.safeParse({
        ...value,
        lastExportedAt: 'yesterday',
      }).success,
    ).toBe(false)
    expect(
      schemas.appSettingsSchema.safeParse({
        ...value,
        restTimer: { sessionId: id, endsAt: 'tomorrow' },
      }).success,
    ).toBe(false)
  })
})

describe('untrusted identifiers, dates and assets', () => {
  it.each([
    '',
    'routine-name',
    'fedb:Bench_Press',
    '11111111-1111-4111-1111-111111111111',
    '11111111-1111-1111-8111-111111111111',
  ])('rejects invalid user UUIDv4 %s', (value) => {
    expect(schemas.idSchema.safeParse(value).success).toBe(false)
    expect(
      schemas.bodyWeightEntrySchema.safeParse({ ...bodyWeight, id: value })
        .success,
    ).toBe(false)
  })
  it('distinguishes catalog references from user IDs', () => {
    expect(schemas.exerciseIdSchema.parse(exerciseId)).toBe(exerciseId)
    expect(
      schemas.exerciseOverrideSchema.safeParse({ ...override, exerciseId: id })
        .success,
    ).toBe(false)
    expect(schemas.exerciseIdSchema.safeParse('fedb:').success).toBe(false)
    expect(
      schemas.exerciseIdSchema.safeParse('fedb:Bench_Press\n').success,
    ).toBe(false)
    expect(
      schemas.catalogExerciseSchema.safeParse({
        ...catalog,
        id: 'fedb:Bench_Press\n',
        sourceId: 'Bench_Press\n',
      }).success,
    ).toBe(false)
  })
  it.each([
    '2026-02-29T08:30:00.000Z',
    '2026-10-27T08:30:00+02:00',
    'not a date',
  ])('rejects malformed stored timestamp %s', (occurredAt) => {
    expect(
      schemas.bodyWeightEntrySchema.safeParse({ ...bodyWeight, occurredAt })
        .success,
    ).toBe(false)
  })
  it('rejects malformed calendar fields', () => {
    expect(
      schemas.habitLogSchema.safeParse({ ...habitLog, localDate: '2026-02-30' })
        .success,
    ).toBe(false)
    expect(
      schemas.habitLogSchema.safeParse({ ...habitLog, timeZone: '+02:00' })
        .success,
    ).toBe(false)
  })
  it.each(['exercises/Bench_Press/0.jpg', '/exercises/Bench_Press/1.webp'])(
    'accepts local asset %s',
    (path) => {
      expect(schemas.localImagePathSchema.parse(path)).toBe(path)
    },
  )
  it.each([
    'https://example.com/image.jpg',
    'exercises/image.jpg\n',
    '//example.com/image.jpg',
    'data:image/png;base64,abc',
    'javascript:alert(1)',
    '../image.jpg',
    '/exercises/../secret',
    '/exercises/%2e%2e/secret',
    'exercises\\image.jpg',
    'exercises/image.jpg?remote=x',
    '/exercises/./0.jpg',
    '',
  ])('rejects unsafe asset %s', (path) => {
    expect(
      schemas.catalogExerciseSchema.safeParse({
        ...catalog,
        imagePaths: [path],
      }).success,
    ).toBe(false)
  })
})
