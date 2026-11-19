import type {
  CatalogExercise,
  ExerciseOverride,
  ExerciseRestriction,
  ID,
  MusclePreference,
  UTCISOString,
} from '../../domain/models'
import { doesExerciseMatchMusclePriority } from '../../domain/restrictions'
import { toUTCISOString } from '../../domain/time'
import { db, PersonalTrackerDB } from '../db'
import { EXERCISE_CATALOG } from '../seed'
import {
  catalogExerciseSchema,
  exerciseIdSchema,
  exerciseOverrideSchema,
  exerciseRestrictionSchema,
  musclePreferenceSchema,
} from '../validation'
import { ParentReferenceError } from './errors'

export const MAX_EXERCISE_NOTE_LENGTH = 1000
export const MAX_RESTRICTION_NOTE_LENGTH = 500

export interface ExerciseFilterMetadata {
  primaryMuscles: string[]
  equipmentOptions: string[]
  hasBodyweight: boolean
}

export interface UpsertExerciseOverrideInput {
  exerciseId: ID
  favorite?: boolean
  userNotes?: string
  customName?: string
  updatedAt?: UTCISOString
}

export interface ResolvedExercise extends CatalogExercise {
  displayName: string
  favorite: boolean
  userNotes?: string
  customName?: string
  restriction?: ExerciseRestriction
}

export interface ExerciseFilterOptions {
  catalog?: readonly CatalogExercise[]
  query?: string
  primaryMuscle?: string
  equipment?: string | null
  favoritesOnly?: boolean
  includeExcluded?: boolean
  musclePriority?: MusclePreference['priority']
}

export interface CatalogBoundOptions {
  knownCatalogIds?: ReadonlySet<ID>
  database?: PersonalTrackerDB
}

function resolveCatalogBoundOptions(
  optionsOrDb?: CatalogBoundOptions | PersonalTrackerDB,
): { knownCatalogIds?: ReadonlySet<ID>; database: PersonalTrackerDB } {
  if (optionsOrDb instanceof PersonalTrackerDB) {
    return { database: optionsOrDb }
  }
  return {
    knownCatalogIds: optionsOrDb?.knownCatalogIds,
    database: optionsOrDb?.database ?? db,
  }
}

function mergeCatalogExercise(
  exercise: CatalogExercise,
  override: ExerciseOverride | undefined,
  restriction: ExerciseRestriction | undefined,
): ResolvedExercise {
  const parsedCatalog = catalogExerciseSchema.parse(exercise)
  return {
    ...parsedCatalog,
    displayName: override?.customName ?? parsedCatalog.name,
    favorite: override?.favorite ?? false,
    ...(override?.userNotes !== undefined
      ? { userNotes: override.userNotes }
      : {}),
    ...(override?.customName !== undefined
      ? { customName: override.customName }
      : {}),
    ...(restriction !== undefined ? { restriction } : {}),
  }
}

export function listExerciseFilterMetadata(
  catalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
): ExerciseFilterMetadata {
  const muscles = new Set<string>()
  const equipment = new Set<string>()
  let hasBodyweight = false

  for (const exercise of catalog) {
    for (const muscle of exercise.primaryMuscles) {
      muscles.add(muscle)
    }
    if (exercise.equipment === null) {
      hasBodyweight = true
    } else {
      equipment.add(exercise.equipment)
    }
  }

  return {
    primaryMuscles: [...muscles].sort((left, right) =>
      left.localeCompare(right),
    ),
    equipmentOptions: [...equipment].sort((left, right) =>
      left.localeCompare(right),
    ),
    hasBodyweight,
  }
}

export async function getExercises(
  filters?: ExerciseFilterOptions,
  database: PersonalTrackerDB = db,
): Promise<ResolvedExercise[]> {
  const catalog = filters?.catalog ?? EXERCISE_CATALOG
  if (catalog.length === 0) return []

  return database.transaction(
    'r',
    [
      database.exerciseOverrides,
      database.restrictions,
      database.musclePreferences,
    ],
    async () => {
      const [overrides, restrictions, preferences] = await Promise.all([
        database.exerciseOverrides.toArray(),
        database.restrictions.toArray(),
        database.musclePreferences.toArray(),
      ])

      const overrideMap = new Map(
        overrides.map((item) => [item.exerciseId, item]),
      )
      const restrictionMap = new Map(
        restrictions.map((item) => [item.exerciseId, item]),
      )
      const preferenceMap = new Map(
        preferences.map((item) => [item.muscleGroup.toLowerCase(), item]),
      )

      const normalizedQuery = filters?.query?.trim().toLowerCase()
      const normalizedMuscle = filters?.primaryMuscle?.trim().toLowerCase()
      const normalizedEquipment =
        filters?.equipment === undefined || filters.equipment === null
          ? filters?.equipment
          : filters.equipment.trim().toLowerCase()

      return catalog
        .map((exercise) =>
          mergeCatalogExercise(
            exercise,
            overrideMap.get(exercise.id),
            restrictionMap.get(exercise.id),
          ),
        )
        .filter((exercise) => {
          if (
            filters?.includeExcluded === false &&
            exercise.restriction?.status === 'excluded'
          ) {
            return false
          }
          if (filters?.favoritesOnly && !exercise.favorite) {
            return false
          }
          if (normalizedQuery) {
            const matchesName = exercise.name
              .toLowerCase()
              .includes(normalizedQuery)
            const matchesDisplay = exercise.displayName
              .toLowerCase()
              .includes(normalizedQuery)
            if (!matchesName && !matchesDisplay) return false
          }
          if (normalizedMuscle) {
            const hasPrimary = exercise.primaryMuscles.some(
              (muscle) => muscle.toLowerCase() === normalizedMuscle,
            )
            if (!hasPrimary) return false
          }
          if (
            filters?.musclePriority &&
            !doesExerciseMatchMusclePriority(
              exercise,
              filters.musclePriority,
              preferenceMap,
            )
          ) {
            return false
          }
          if (normalizedEquipment !== undefined) {
            if (normalizedEquipment === null) {
              if (exercise.equipment !== null) return false
            } else if (
              exercise.equipment?.toLowerCase() !== normalizedEquipment
            ) {
              return false
            }
          }
          return true
        })
        .sort(
          (left, right) =>
            left.displayName.localeCompare(right.displayName) ||
            left.id.localeCompare(right.id),
        )
    },
  )
}

export async function getExerciseById(
  id: ID,
  catalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
  database: PersonalTrackerDB = db,
): Promise<ResolvedExercise | undefined> {
  const validId = exerciseIdSchema.parse(id)
  const catalogMatch = catalog.find((item) => item.id === validId)
  if (!catalogMatch) return undefined

  return database.transaction(
    'r',
    [database.exerciseOverrides, database.restrictions],
    async () => {
      const [override, restriction] = await Promise.all([
        database.exerciseOverrides.get(validId),
        database.restrictions.get(validId),
      ])
      return mergeCatalogExercise(catalogMatch, override, restriction)
    },
  )
}

export async function saveExerciseOverride(
  override: ExerciseOverride,
  optionsOrDb?: CatalogBoundOptions | PersonalTrackerDB,
): Promise<ExerciseOverride> {
  const { knownCatalogIds, database } = resolveCatalogBoundOptions(optionsOrDb)
  if (
    override.userNotes !== undefined &&
    override.userNotes.length > MAX_EXERCISE_NOTE_LENGTH
  ) {
    throw new RangeError(
      `Exercise note cannot exceed ${MAX_EXERCISE_NOTE_LENGTH} characters.`,
    )
  }
  const parsed = exerciseOverrideSchema.parse(override)

  if (knownCatalogIds && !knownCatalogIds.has(parsed.exerciseId)) {
    throw new ParentReferenceError(
      'ExerciseOverride',
      'exerciseId',
      parsed.exerciseId,
    )
  }

  await database.transaction('rw', database.exerciseOverrides, async () => {
    await database.exerciseOverrides.put(parsed)
  })
  return parsed
}

export async function upsertExerciseOverride(
  input: UpsertExerciseOverrideInput,
  optionsOrDb?: CatalogBoundOptions | PersonalTrackerDB,
): Promise<ExerciseOverride> {
  const { knownCatalogIds, database } = resolveCatalogBoundOptions(optionsOrDb)
  const validExerciseId = exerciseIdSchema.parse(input.exerciseId)

  if (knownCatalogIds && !knownCatalogIds.has(validExerciseId)) {
    throw new ParentReferenceError(
      'ExerciseOverride',
      'exerciseId',
      validExerciseId,
    )
  }

  if (
    input.userNotes !== undefined &&
    input.userNotes.length > MAX_EXERCISE_NOTE_LENGTH
  ) {
    throw new RangeError(
      `Exercise note cannot exceed ${MAX_EXERCISE_NOTE_LENGTH} characters.`,
    )
  }

  return database.transaction('rw', database.exerciseOverrides, async () => {
    const existing = await database.exerciseOverrides.get(validExerciseId)
    const nextNotes =
      input.userNotes !== undefined ? input.userNotes : existing?.userNotes
    const nextCustomName =
      input.customName !== undefined ? input.customName : existing?.customName

    const merged: ExerciseOverride = exerciseOverrideSchema.parse({
      exerciseId: validExerciseId,
      favorite: input.favorite ?? existing?.favorite ?? false,
      ...(nextNotes !== undefined ? { userNotes: nextNotes } : {}),
      ...(nextCustomName !== undefined ? { customName: nextCustomName } : {}),
      updatedAt: input.updatedAt ?? toUTCISOString(new Date()),
    })

    await database.exerciseOverrides.put(merged)
    return merged
  })
}

export async function getExerciseOverride(
  exerciseId: ID,
  database: PersonalTrackerDB = db,
): Promise<ExerciseOverride | undefined> {
  const validId = exerciseIdSchema.parse(exerciseId)
  return database.exerciseOverrides.get(validId)
}

export async function listExerciseOverrides(
  database: PersonalTrackerDB = db,
): Promise<ExerciseOverride[]> {
  const overrides = await database.exerciseOverrides.toArray()
  return overrides.sort((left, right) =>
    left.exerciseId.localeCompare(right.exerciseId),
  )
}

export async function saveExerciseRestriction(
  restriction: ExerciseRestriction,
  optionsOrDb?: CatalogBoundOptions | PersonalTrackerDB,
): Promise<ExerciseRestriction> {
  const { knownCatalogIds, database } = resolveCatalogBoundOptions(optionsOrDb)
  if (
    restriction.note !== undefined &&
    restriction.note.length > MAX_RESTRICTION_NOTE_LENGTH
  ) {
    throw new RangeError(
      `Restriction note cannot exceed ${MAX_RESTRICTION_NOTE_LENGTH} characters.`,
    )
  }
  const parsed = exerciseRestrictionSchema.parse(restriction)

  if (knownCatalogIds && !knownCatalogIds.has(parsed.exerciseId)) {
    throw new ParentReferenceError(
      'ExerciseRestriction',
      'exerciseId',
      parsed.exerciseId,
    )
  }

  await database.transaction('rw', database.restrictions, async () => {
    await database.restrictions.put(parsed)
  })
  return parsed
}

export async function getExerciseRestriction(
  exerciseId: ID,
  database: PersonalTrackerDB = db,
): Promise<ExerciseRestriction | undefined> {
  const validId = exerciseIdSchema.parse(exerciseId)
  return database.restrictions.get(validId)
}

export async function listExerciseRestrictions(
  database: PersonalTrackerDB = db,
): Promise<ExerciseRestriction[]> {
  const restrictions = await database.restrictions.toArray()
  return restrictions.sort((left, right) =>
    left.exerciseId.localeCompare(right.exerciseId),
  )
}

export async function deleteExerciseRestriction(
  exerciseId: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  const validId = exerciseIdSchema.parse(exerciseId)
  await database.transaction('rw', database.restrictions, async () => {
    await database.restrictions.delete(validId)
  })
}

export async function saveMusclePreference(
  preference: MusclePreference,
  database: PersonalTrackerDB = db,
): Promise<MusclePreference> {
  const parsed = musclePreferenceSchema.parse(preference)
  await database.transaction('rw', database.musclePreferences, async () => {
    await database.musclePreferences.put(parsed)
  })
  return parsed
}

export async function listMusclePreferences(
  database: PersonalTrackerDB = db,
): Promise<MusclePreference[]> {
  const preferences = await database.musclePreferences.toArray()
  return preferences.sort((left, right) =>
    left.muscleGroup.localeCompare(right.muscleGroup),
  )
}

export function createExerciseRepository(
  database: PersonalTrackerDB = db,
  defaultCatalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
) {
  const knownCatalogIds =
    defaultCatalog.length > 0
      ? new Set(defaultCatalog.map((item) => item.id))
      : undefined

  return {
    getExercises: (filters?: ExerciseFilterOptions) =>
      getExercises(
        { catalog: filters?.catalog ?? defaultCatalog, ...filters },
        database,
      ),
    getExerciseById: (id: ID, catalog?: readonly CatalogExercise[]) =>
      getExerciseById(id, catalog ?? defaultCatalog, database),
    saveExerciseOverride: (
      override: ExerciseOverride,
      options?: CatalogBoundOptions,
    ) =>
      saveExerciseOverride(override, {
        knownCatalogIds: options?.knownCatalogIds ?? knownCatalogIds,
        database,
      }),
    upsertExerciseOverride: (
      input: UpsertExerciseOverrideInput,
      options?: CatalogBoundOptions,
    ) =>
      upsertExerciseOverride(input, {
        knownCatalogIds: options?.knownCatalogIds ?? knownCatalogIds,
        database,
      }),
    getExerciseOverride: (exerciseId: ID) =>
      getExerciseOverride(exerciseId, database),
    listExerciseOverrides: () => listExerciseOverrides(database),
    saveExerciseRestriction: (
      restriction: ExerciseRestriction,
      options?: CatalogBoundOptions,
    ) =>
      saveExerciseRestriction(restriction, {
        knownCatalogIds: options?.knownCatalogIds ?? knownCatalogIds,
        database,
      }),
    getExerciseRestriction: (exerciseId: ID) =>
      getExerciseRestriction(exerciseId, database),
    listExerciseRestrictions: () => listExerciseRestrictions(database),
    deleteExerciseRestriction: (exerciseId: ID) =>
      deleteExerciseRestriction(exerciseId, database),
    saveMusclePreference: (preference: MusclePreference) =>
      saveMusclePreference(preference, database),
    listMusclePreferences: () => listMusclePreferences(database),
  }
}
