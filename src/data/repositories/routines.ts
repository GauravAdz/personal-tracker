import { createId } from '../../domain/id'
import type {
  ID,
  Routine,
  RoutineExercise,
  UTCISOString,
} from '../../domain/models'
import { toUTCISOString } from '../../domain/time'
import { db, PersonalTrackerDB } from '../db'
import { idSchema, routineSchema } from '../validation'
import { ParentReferenceError, RecordNotFoundError } from './errors'

export const MAX_ROUTINE_NAME_LENGTH = 120

export interface SaveRoutineOptions {
  knownExerciseIds?: ReadonlySet<ID>
  database?: PersonalTrackerDB
}

export interface DuplicateRoutineOptions {
  newId?: ID
  newName?: string
  timestamp?: UTCISOString
  createItemId?: () => ID
  database?: PersonalTrackerDB
}

function normalizeRoutine(routine: Routine): Routine {
  return {
    ...routine,
    items: [...routine.items].sort((left, right) => left.order - right.order),
  }
}

function resolveSaveOptions(
  optionsOrDb?: SaveRoutineOptions | PersonalTrackerDB,
): { knownExerciseIds?: ReadonlySet<ID>; database: PersonalTrackerDB } {
  if (optionsOrDb instanceof PersonalTrackerDB) {
    return { database: optionsOrDb }
  }
  return {
    knownExerciseIds: optionsOrDb?.knownExerciseIds,
    database: optionsOrDb?.database ?? db,
  }
}

export function reorderRoutineItems(
  items: readonly RoutineExercise[],
  fromIndex: number,
  toIndex: number,
): RoutineExercise[] {
  const sorted = [...items].sort((left, right) => left.order - right.order)
  if (
    fromIndex < 0 ||
    fromIndex >= sorted.length ||
    toIndex < 0 ||
    toIndex >= sorted.length
  ) {
    throw new RangeError('Routine item reorder index is out of bounds.')
  }
  const copy = [...sorted]
  const [moved] = copy.splice(fromIndex, 1)
  copy.splice(toIndex, 0, moved!)
  return copy.map((item, index) => ({
    ...item,
    order: index,
  }))
}

export async function saveRoutine(
  routine: Routine,
  optionsOrDb?: SaveRoutineOptions | PersonalTrackerDB,
): Promise<Routine> {
  const { knownExerciseIds, database } = resolveSaveOptions(optionsOrDb)
  if (routine.name.length > MAX_ROUTINE_NAME_LENGTH) {
    throw new RangeError(
      `Routine name cannot exceed ${MAX_ROUTINE_NAME_LENGTH} characters.`,
    )
  }
  const parsed = normalizeRoutine(routineSchema.parse(routine))

  if (knownExerciseIds) {
    for (const item of parsed.items) {
      if (!knownExerciseIds.has(item.exerciseId)) {
        throw new ParentReferenceError(
          'RoutineExercise',
          'exerciseId',
          item.exerciseId,
        )
      }
    }
  }

  await database.transaction('rw', database.routines, async () => {
    await database.routines.put(parsed)
  })
  return parsed
}

export async function getRoutineById(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<Routine | undefined> {
  const validId = idSchema.parse(id)
  const routine = await database.routines.get(validId)
  return routine ? normalizeRoutine(routine) : undefined
}

export async function listRoutines(
  database: PersonalTrackerDB = db,
): Promise<Routine[]> {
  const routines = await database.routines.toArray()
  return routines
    .map(normalizeRoutine)
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
}

export async function duplicateRoutine(
  id: ID,
  options?: DuplicateRoutineOptions,
  database: PersonalTrackerDB = options?.database ?? db,
): Promise<Routine> {
  const validId = idSchema.parse(id)
  const itemIdFactory = options?.createItemId ?? createId

  return database.transaction('rw', database.routines, async () => {
    const existing = await database.routines.get(validId)
    if (!existing) {
      throw new RecordNotFoundError('Routine', validId)
    }

    const sortedItems = [...existing.items].sort(
      (left, right) => left.order - right.order,
    )
    const timestamp = options?.timestamp ?? toUTCISOString(new Date())
    const defaultCopyName = `${existing.name} (Copy)`.slice(
      0,
      MAX_ROUTINE_NAME_LENGTH,
    )
    const nextName = options?.newName ?? defaultCopyName
    if (nextName.length > MAX_ROUTINE_NAME_LENGTH) {
      throw new RangeError(
        `Routine name cannot exceed ${MAX_ROUTINE_NAME_LENGTH} characters.`,
      )
    }

    const duplicated = normalizeRoutine(
      routineSchema.parse({
        id: options?.newId ?? createId(),
        name: nextName,
        items: sortedItems.map((item, index) => ({
          ...item,
          id: itemIdFactory(),
          order: index,
        })),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )

    await database.routines.put(duplicated)
    return duplicated
  })
}

export async function deleteRoutine(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  const validId = idSchema.parse(id)
  await database.transaction('rw', database.routines, async () => {
    await database.routines.delete(validId)
  })
}

export function createRoutineRepository(database: PersonalTrackerDB = db) {
  return {
    listRoutines: () => listRoutines(database),
    getRoutineById: (id: ID) => getRoutineById(id, database),
    saveRoutine: (routine: Routine, options?: SaveRoutineOptions) =>
      saveRoutine(routine, { ...options, database }),
    duplicateRoutine: (id: ID, options?: DuplicateRoutineOptions) =>
      duplicateRoutine(id, options, database),
    deleteRoutine: (id: ID) => deleteRoutine(id, database),
  }
}
