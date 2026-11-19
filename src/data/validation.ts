import { z } from 'zod'
import { isCatalogSourceId } from '../domain/id'
import { isIANATimeZone, isLocalDate, isUTCISOString } from '../domain/time'

export const idSchema = z.uuidv4()
export const catalogSourceIdSchema = z
  .string()
  .refine(isCatalogSourceId, 'Invalid catalog source ID.')
export const exerciseIdSchema = z
  .string()
  .refine(
    (value) => value.startsWith('fedb:') && isCatalogSourceId(value.slice(5)),
    'Expected a namespaced catalog ID.',
  )
export const utcISOStringSchema = z
  .string()
  .refine(
    isUTCISOString,
    'Expected a valid UTC ISO timestamp with milliseconds.',
  )
export const localDateSchema = z
  .string()
  .refine(isLocalDate, 'Expected a valid YYYY-MM-DD date.')
export const timeZoneSchema = z
  .string()
  .refine(isIANATimeZone, 'Expected an IANA time zone.')
export const localTimeSchema = z
  .string()
  .length(5)
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM in 24-hour time.')
export const nonBlankTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'Must not be blank.')
export const positiveIntegerSchema = z.int().min(1)
export const nonnegativeIntegerSchema = z.int().min(0)
// Broad input sanity bounds, not targets or medical guidance.
export const bodyWeightKgSchema = z.number().positive().max(1000)
export const externalLoadKgSchema = z
  .number()
  .nonnegative()
  .max(1000)
  .nullable()
export const quantitySchema = z.number().nonnegative()

export const localImagePathSchema = z.string().refine((value) => {
  if (value.trim() !== value || !/^\/?[A-Za-z0-9_./-]+$/.test(value))
    return false
  const path = value.startsWith('/') ? value.slice(1) : value
  return path
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}, 'Expected a local asset path without traversal, URL syntax or encoding.')

const mutableTimestamps = {
  createdAt: utcISOStringSchema,
  updatedAt: utcISOStringSchema,
}
const calendarFields = {
  localDate: localDateSchema,
  timeZone: timeZoneSchema,
}
const timestampsOrdered = (value: { createdAt: string; updatedAt: string }) =>
  value.updatedAt >= value.createdAt

export const catalogExerciseSchema = z
  .strictObject({
    id: exerciseIdSchema,
    sourceId: catalogSourceIdSchema,
    name: nonBlankTextSchema,
    primaryMuscles: z.array(nonBlankTextSchema),
    secondaryMuscles: z.array(nonBlankTextSchema),
    equipment: nonBlankTextSchema.nullable(),
    instructions: z.array(nonBlankTextSchema),
    category: nonBlankTextSchema,
    imagePaths: z.array(localImagePathSchema),
  })
  .refine((value) => value.id === `fedb:${value.sourceId}`, {
    path: ['id'],
    message: 'Catalog ID must match its source ID.',
  })

export const exerciseOverrideSchema = z.strictObject({
  exerciseId: exerciseIdSchema,
  favorite: z.boolean(),
  userNotes: z.string().optional(),
  customName: nonBlankTextSchema.optional(),
  updatedAt: utcISOStringSchema,
})

export const exerciseRestrictionSchema = z.strictObject({
  exerciseId: exerciseIdSchema,
  status: z.enum(['allowed', 'caution', 'excluded']),
  note: z.string().optional(),
  updatedAt: utcISOStringSchema,
})

export const musclePreferenceSchema = z.strictObject({
  muscleGroup: nonBlankTextSchema,
  priority: z.enum(['priority', 'normal', 'deprioritized']),
  updatedAt: utcISOStringSchema,
})

export const routineExerciseSchema = z
  .strictObject({
    id: idSchema,
    exerciseId: exerciseIdSchema,
    order: nonnegativeIntegerSchema,
    workingSets: positiveIntegerSchema,
    repMin: positiveIntegerSchema,
    repMax: positiveIntegerSchema,
    restSeconds: nonnegativeIntegerSchema,
  })
  .refine((value) => value.repMax >= value.repMin, {
    path: ['repMax'],
    message: 'Maximum reps must be at least minimum reps.',
  })

export const routineInputSchema = z
  .strictObject({
    name: nonBlankTextSchema,
    items: z.array(routineExerciseSchema),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const orders = new Set<number>()
    value.items.forEach((item, index) => {
      if (ids.has(item.id))
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: 'Routine item IDs must be unique.',
        })
      if (orders.has(item.order))
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'order'],
          message: 'Routine item order must be unique.',
        })
      ids.add(item.id)
      orders.add(item.order)
    })
  })

export const routineSchema = routineInputSchema
  .safeExtend({
    id: idSchema,
    ...mutableTimestamps,
  })
  .refine(timestampsOrdered, {
    path: ['updatedAt'],
    message: 'Update time cannot precede creation time.',
  })

export const workoutSessionSchema = z
  .strictObject({
    id: idSchema,
    routineId: idSchema.nullable(),
    status: z.enum(['active', 'completed', 'cancelled']),
    startedAt: utcISOStringSchema,
    endedAt: utcISOStringSchema.optional(),
    note: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.status === 'active' && value.endedAt !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'An active session cannot have an end time.',
      })
    }
    if (value.status !== 'active' && value.endedAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'A finished or cancelled session requires an end time.',
      })
    }
    if (value.endedAt !== undefined && value.endedAt < value.startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'End time cannot precede start time.',
      })
    }
  })

export const sessionExerciseSchema = z
  .strictObject({
    id: idSchema,
    sessionId: idSchema,
    exerciseId: exerciseIdSchema,
    exerciseNameSnapshot: nonBlankTextSchema,
    equipmentSnapshot: nonBlankTextSchema.nullable(),
    order: nonnegativeIntegerSchema,
    targetSets: positiveIntegerSchema,
    targetRepMin: positiveIntegerSchema,
    targetRepMax: positiveIntegerSchema,
    restSeconds: nonnegativeIntegerSchema,
  })
  .refine((value) => value.targetRepMax >= value.targetRepMin, {
    path: ['targetRepMax'],
    message: 'Maximum target reps must be at least minimum target reps.',
  })

export const setLogInputSchema = z.strictObject({
  sessionId: idSchema,
  sessionExerciseId: idSchema,
  ordinal: positiveIntegerSchema,
  kind: z.enum(['warmup', 'working']),
  externalLoadKg: externalLoadKgSchema,
  reps: positiveIntegerSchema,
  repsInReserve: z.number().min(0).max(10).optional(),
  feedback: z.enum(['easy', 'normal', 'hard', 'discomfort']).optional(),
  completedAt: utcISOStringSchema,
})
export const setLogSchema = setLogInputSchema.extend({ id: idSchema })

export const bodyWeightInputSchema = z.strictObject({
  weightKg: bodyWeightKgSchema,
  occurredAt: utcISOStringSchema,
  ...calendarFields,
  note: z.string().optional(),
})
export const bodyWeightEntrySchema = bodyWeightInputSchema.extend({
  id: idSchema,
})

export const habitSlotSchema = z.strictObject({
  id: idSchema,
  label: nonBlankTextSchema,
  localTime: localTimeSchema.optional(),
})
export const habitDefinitionInputSchema = z
  .strictObject({
    name: nonBlankTextSchema,
    slots: z.array(habitSlotSchema).min(1),
    quantityLabel: nonBlankTextSchema.optional(),
    archived: z.boolean(),
  })
  .refine(
    (value) =>
      new Set(value.slots.map((slot) => slot.id)).size === value.slots.length,
    {
      path: ['slots'],
      message: 'Habit slot IDs must be unique.',
    },
  )
export const habitDefinitionSchema = habitDefinitionInputSchema
  .safeExtend({
    id: idSchema,
    ...mutableTimestamps,
  })
  .refine(timestampsOrdered, {
    path: ['updatedAt'],
    message: 'Update time cannot precede creation time.',
  })

export const habitLogInputSchema = z.strictObject({
  habitId: idSchema,
  slotId: idSchema,
  ...calendarFields,
  status: z.enum(['done', 'skipped']),
  occurredAt: utcISOStringSchema,
  quantity: quantitySchema.optional(),
})
export const habitLogSchema = habitLogInputSchema.extend({ id: idSchema })

export const preparationStepSchema = z.strictObject({
  id: idSchema,
  phase: z.enum(['warmup', 'cooldown']),
  label: nonBlankTextSchema,
  durationSeconds: nonnegativeIntegerSchema,
  note: z.string().optional(),
})
export const preparationPreferencesSchema = z
  .strictObject({
    steps: z.array(preparationStepSchema),
  })
  .refine(
    (value) =>
      new Set(value.steps.map((step) => step.id)).size === value.steps.length,
    {
      path: ['steps'],
      message: 'Preparation step IDs must be unique.',
    },
  )

export const appSettingsSchema = z.strictObject({
  id: z.literal('singleton'),
  preferredMassUnit: z.literal('kg'),
  lastExportedAt: utcISOStringSchema.optional(),
  restTimer: z
    .strictObject({ sessionId: idSchema, endsAt: utcISOStringSchema })
    .optional(),
  promptWeightBeforeWorkout: z.boolean().optional(),
  preparationPreferences: preparationPreferencesSchema.optional(),
  catalogVersion: nonBlankTextSchema,
})

export type RoutineInput = z.infer<typeof routineInputSchema>
export type SetLogInput = z.infer<typeof setLogInputSchema>
export type BodyWeightInput = z.infer<typeof bodyWeightInputSchema>
export type HabitDefinitionInput = z.infer<typeof habitDefinitionInputSchema>
export type HabitLogInput = z.infer<typeof habitLogInputSchema>
