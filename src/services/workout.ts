import { db, type PersonalTrackerDB } from '../data/db'
import {
  addSessionExercise,
  appendSet,
  type AppendSetInput,
  cancelSession,
  type CompleteSessionOptions,
  ExcludedExerciseError,
  finishSession,
  getActiveSessionSnapshot,
  getAppSettings,
  getExercises,
  getLastCompletedWorkingSets,
  getSessionSnapshot,
  InvalidSessionStateError,
  listRoutines,
  ParentReferenceError,
  RecordNotFoundError,
  saveAppSettings,
  type SessionExerciseDraft,
  type SessionSnapshot,
  startSession,
  type StartSessionOptions,
  type StartSessionResult,
  updateSet,
} from '../data/repositories'
import { EXERCISE_CATALOG, SEEDED_CATALOG_VERSION } from '../data/seed'
import {
  appSettingsSchema,
  idSchema,
  sessionExerciseSchema,
  setLogSchema,
} from '../data/validation'
import type {
  AppSettings,
  CatalogExercise,
  ID,
  SessionExercise,
  SetLog,
  UTCISOString,
  WorkoutSession,
} from '../domain/models'
import { calculateRestTimerDeadline } from '../domain/time'

export interface SessionHistorySummary {
  session: WorkoutSession
  routineName: string | null
  exerciseCount: number
  exerciseNames: string[]
  workingSetCount: number
  warmupSetCount: number
  totalSetCount: number
  totalVolumeKg: number
}

export interface StartWorkoutOptions extends Omit<
  StartSessionOptions,
  'catalogLookup'
> {
  catalog?: readonly CatalogExercise[]
}

export async function startWorkoutFromRoutine(
  routineId: ID | null,
  options?: StartWorkoutOptions,
  database: PersonalTrackerDB = options?.database ?? db,
): Promise<StartSessionResult> {
  const catalog = options?.catalog ?? EXERCISE_CATALOG
  const resolvedExercises = await getExercises(
    { catalog, includeExcluded: true },
    database,
  )
  const catalogLookup = new Map(
    resolvedExercises.map((exercise) => [
      exercise.id,
      {
        name: exercise.displayName,
        equipment: exercise.equipment,
      },
    ]),
  )

  return startSession(
    routineId,
    {
      ...options,
      catalogLookup,
    },
    database,
  )
}

export async function addExerciseToActiveSession(
  sessionId: ID,
  exerciseId: ID,
  targets?: {
    targetSets?: number
    targetRepMin?: number
    targetRepMax?: number
    restSeconds?: number
    catalog?: readonly CatalogExercise[]
  },
  database: PersonalTrackerDB = db,
): Promise<SessionExercise> {
  const validSessionId = idSchema.parse(sessionId)
  const catalog = targets?.catalog ?? EXERCISE_CATALOG
  const resolvedList = await getExercises(
    { catalog, includeExcluded: true },
    database,
  )
  const resolved = resolvedList.find((item) => item.id === exerciseId)
  if (!resolved) {
    throw new ParentReferenceError('SessionExercise', 'exerciseId', exerciseId)
  }
  if (resolved.restriction?.status === 'excluded') {
    throw new ExcludedExerciseError(exerciseId, resolved.restriction.note)
  }

  const existingSnapshot = await getSessionSnapshot(validSessionId, database)
  if (!existingSnapshot) {
    throw new RecordNotFoundError('WorkoutSession', validSessionId)
  }
  const nextOrder =
    existingSnapshot.exercises.length === 0
      ? 0
      : Math.max(...existingSnapshot.exercises.map((item) => item.order)) + 1

  const draft: SessionExerciseDraft & { sessionId: ID } = {
    sessionId: validSessionId,
    exerciseId: resolved.id,
    exerciseNameSnapshot: resolved.displayName,
    equipmentSnapshot: resolved.equipment,
    order: nextOrder,
    targetSets: targets?.targetSets ?? 3,
    targetRepMin: targets?.targetRepMin ?? 8,
    targetRepMax: targets?.targetRepMax ?? 12,
    restSeconds: targets?.restSeconds ?? 120,
  }

  return addSessionExercise(draft, database)
}

export async function reorderSessionExercise(
  sessionId: ID,
  sessionExerciseId: ID,
  direction: 'up' | 'down',
  database: PersonalTrackerDB = db,
): Promise<SessionExercise[]> {
  const validSessionId = idSchema.parse(sessionId)
  const validSessionExerciseId = idSchema.parse(sessionExerciseId)

  return database.transaction(
    'rw',
    [database.sessions, database.sessionExercises],
    async () => {
      const session = await database.sessions.get(validSessionId)
      if (!session) {
        throw new RecordNotFoundError('WorkoutSession', validSessionId)
      }
      if (session.status !== 'active') {
        throw new InvalidSessionStateError(
          session.id,
          session.status,
          'Cannot reorder exercises in a non-active workout session.',
        )
      }

      const exercises = (
        await database.sessionExercises
          .where('sessionId')
          .equals(validSessionId)
          .toArray()
      ).sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id),
      )

      const currentIndex = exercises.findIndex(
        (item) => item.id === validSessionExerciseId,
      )
      if (currentIndex === -1) {
        throw new RecordNotFoundError('SessionExercise', validSessionExerciseId)
      }

      const targetIndex =
        direction === 'up' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= exercises.length) {
        return exercises
      }

      const reordered = [...exercises]
      const [moved] = reordered.splice(currentIndex, 1)
      reordered.splice(targetIndex, 0, moved!)

      const normalized = reordered.map((item, index) =>
        sessionExerciseSchema.parse({
          ...item,
          order: index,
        }),
      )

      await database.sessionExercises.bulkPut(normalized)
      return normalized
    },
  )
}

export async function skipSessionExercise(
  sessionId: ID,
  sessionExerciseId: ID,
  database: PersonalTrackerDB = db,
): Promise<SessionSnapshot> {
  const validSessionId = idSchema.parse(sessionId)
  const validSessionExerciseId = idSchema.parse(sessionExerciseId)

  await database.transaction(
    'rw',
    [database.sessions, database.sessionExercises, database.setLogs],
    async () => {
      const session = await database.sessions.get(validSessionId)
      if (!session) {
        throw new RecordNotFoundError('WorkoutSession', validSessionId)
      }
      if (session.status !== 'active') {
        throw new InvalidSessionStateError(
          session.id,
          session.status,
          'Cannot skip exercises in a non-active workout session.',
        )
      }

      const exercises = (
        await database.sessionExercises
          .where('sessionId')
          .equals(validSessionId)
          .toArray()
      ).sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id),
      )

      const target = exercises.find(
        (item) => item.id === validSessionExerciseId,
      )
      if (!target) {
        throw new RecordNotFoundError('SessionExercise', validSessionExerciseId)
      }

      const loggedSetsForTarget = await database.setLogs
        .where('sessionExerciseId')
        .equals(validSessionExerciseId)
        .count()

      if (loggedSetsForTarget === 0) {
        await database.sessionExercises.delete(validSessionExerciseId)
        const remaining = exercises
          .filter((item) => item.id !== validSessionExerciseId)
          .map((item, index) =>
            sessionExerciseSchema.parse({
              ...item,
              order: index,
            }),
          )
        if (remaining.length > 0) {
          await database.sessionExercises.bulkPut(remaining)
        }
      } else {
        const remaining = exercises.filter(
          (item) => item.id !== validSessionExerciseId,
        )
        const movedToEnd = [...remaining, target].map((item, index) =>
          sessionExerciseSchema.parse({
            ...item,
            order: index,
          }),
        )
        await database.sessionExercises.bulkPut(movedToEnd)
      }

      const skipTag = `Skipped: ${target.exerciseNameSnapshot}`
      const nextNote = session.note ? `${session.note} | ${skipTag}` : skipTag
      await database.sessions.put({
        ...session,
        note: nextNote,
      })
    },
  )

  const snapshot = await getSessionSnapshot(validSessionId, database)
  return snapshot!
}

export async function setRestTimerDeadlineForSession(
  sessionId: ID,
  endsAt: UTCISOString,
  database: PersonalTrackerDB = db,
): Promise<AppSettings> {
  const validSessionId = idSchema.parse(sessionId)
  const existing = await getAppSettings(database)
  return saveAppSettings(
    {
      id: 'singleton',
      preferredMassUnit: 'kg',
      catalogVersion: existing?.catalogVersion ?? SEEDED_CATALOG_VERSION,
      ...(existing?.lastExportedAt !== undefined
        ? { lastExportedAt: existing.lastExportedAt }
        : {}),
      ...(existing?.promptWeightBeforeWorkout !== undefined
        ? { promptWeightBeforeWorkout: existing.promptWeightBeforeWorkout }
        : {}),
      ...(existing?.preparationPreferences !== undefined
        ? { preparationPreferences: existing.preparationPreferences }
        : {}),
      restTimer: {
        sessionId: validSessionId,
        endsAt,
      },
    },
    database,
  )
}

export async function clearRestTimerForSession(
  sessionId?: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  await database.transaction('rw', database.settings, async () => {
    const existing = await database.settings.get('singleton')
    if (!existing?.restTimer) return
    if (sessionId !== undefined && existing.restTimer.sessionId !== sessionId) {
      return
    }
    const nextSettings = { ...existing }
    delete nextSettings.restTimer
    await database.settings.put(appSettingsSchema.parse(nextSettings))
  })
}

export async function startRestTimerForSession(
  sessionId: ID,
  durationSeconds: number,
  startedAt: Date | UTCISOString | number = new Date(),
  database: PersonalTrackerDB = db,
): Promise<AppSettings | undefined> {
  const validSessionId = idSchema.parse(sessionId)
  if (durationSeconds <= 0) {
    await clearRestTimerForSession(validSessionId, database)
    return getAppSettings(database)
  }
  const endsAt = calculateRestTimerDeadline(startedAt, durationSeconds)
  return setRestTimerDeadlineForSession(validSessionId, endsAt, database)
}

export async function logWorkoutSet(
  input: AppendSetInput,
  database: PersonalTrackerDB = db,
): Promise<SetLog> {
  return database.transaction(
    'rw',
    [
      database.sessions,
      database.sessionExercises,
      database.setLogs,
      database.settings,
    ],
    async () => {
      const created = await appendSet(input, database)
      const sessionExercise = await database.sessionExercises.get(
        created.sessionExerciseId,
      )
      if (sessionExercise && sessionExercise.restSeconds > 0) {
        const endsAt = calculateRestTimerDeadline(
          created.completedAt,
          sessionExercise.restSeconds,
        )
        await setRestTimerDeadlineForSession(
          created.sessionId,
          endsAt,
          database,
        )
      }
      return created
    },
  )
}

export async function editWorkoutSet(
  setLog: SetLog,
  database: PersonalTrackerDB = db,
): Promise<SetLog> {
  return updateSet(setLog, database)
}

export async function undoWorkoutSet(
  setId: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  const validSetId = idSchema.parse(setId)

  await database.transaction(
    'rw',
    [
      database.sessions,
      database.sessionExercises,
      database.setLogs,
      database.settings,
    ],
    async () => {
      const existing = await database.setLogs.get(validSetId)
      if (!existing) {
        throw new RecordNotFoundError('SetLog', validSetId)
      }

      const session = await database.sessions.get(existing.sessionId)
      if (!session) {
        throw new ParentReferenceError(
          'SetLog',
          'sessionId',
          existing.sessionId,
        )
      }
      if (session.status !== 'active') {
        throw new InvalidSessionStateError(
          session.id,
          session.status,
          'Cannot undo a set on a non-active workout session.',
        )
      }

      await database.setLogs.delete(validSetId)

      const remainingSets = (
        await database.setLogs
          .where('sessionExerciseId')
          .equals(existing.sessionExerciseId)
          .toArray()
      ).sort((left, right) => left.ordinal - right.ordinal)

      // Re-index remaining sets sequentially 1..N so ordinals stay contiguous.
      for (let index = 0; index < remainingSets.length; index += 1) {
        const current = remainingSets[index]!
        const nextOrdinal = index + 1
        if (current.ordinal !== nextOrdinal) {
          await database.setLogs.put(
            setLogSchema.parse({
              ...current,
              ordinal: nextOrdinal,
            }),
          )
        }
      }

      await clearRestTimerForSession(existing.sessionId, database)
    },
  )
}

export async function loadPreviousCompletedWorkingSetsMap(
  exerciseIds: readonly ID[],
  beforeSessionId: ID,
  database: PersonalTrackerDB = db,
): Promise<ReadonlyMap<ID, SetLog[]>> {
  const uniqueIds = [...new Set(exerciseIds)]
  const entries = await Promise.all(
    uniqueIds.map(async (exerciseId) => {
      const sets = await getLastCompletedWorkingSets(
        exerciseId,
        beforeSessionId,
        database,
      )
      return [exerciseId, sets] as const
    }),
  )
  return new Map(entries)
}

export async function finishWorkoutSession(
  sessionId: ID,
  options?: CompleteSessionOptions,
  database: PersonalTrackerDB = db,
): Promise<WorkoutSession> {
  return finishSession(sessionId, options, database)
}

export async function cancelWorkoutSession(
  sessionId: ID,
  options?: CompleteSessionOptions,
  database: PersonalTrackerDB = db,
): Promise<WorkoutSession> {
  return cancelSession(sessionId, options, database)
}

export async function listSessionHistory(
  database: PersonalTrackerDB = db,
): Promise<SessionHistorySummary[]> {
  return database.transaction(
    'r',
    [
      database.routines,
      database.sessions,
      database.sessionExercises,
      database.setLogs,
    ],
    async () => {
      const [routines, sessions, sessionExercises, setLogs] = await Promise.all(
        [
          listRoutines(database),
          database.sessions.toArray(),
          database.sessionExercises.toArray(),
          database.setLogs.toArray(),
        ],
      )

      const routineNameById = new Map(
        routines.map((routine) => [routine.id, routine.name]),
      )
      const exercisesBySessionId = new Map<ID, SessionExercise[]>()
      for (const exercise of sessionExercises) {
        const list = exercisesBySessionId.get(exercise.sessionId) ?? []
        list.push(exercise)
        exercisesBySessionId.set(exercise.sessionId, list)
      }

      const setsBySessionId = new Map<ID, typeof setLogs>()
      for (const setLog of setLogs) {
        const list = setsBySessionId.get(setLog.sessionId) ?? []
        list.push(setLog)
        setsBySessionId.set(setLog.sessionId, list)
      }

      return sessions
        .filter((session) => session.status !== 'active')
        .sort(
          (left, right) =>
            (right.endedAt ?? right.startedAt).localeCompare(
              left.endedAt ?? left.startedAt,
            ) ||
            right.startedAt.localeCompare(left.startedAt) ||
            left.id.localeCompare(right.id),
        )
        .map((session) => {
          const orderedExercises = (
            exercisesBySessionId.get(session.id) ?? []
          ).sort(
            (left, right) =>
              left.order - right.order || left.id.localeCompare(right.id),
          )
          const sets = setsBySessionId.get(session.id) ?? []
          let workingSetCount = 0
          let warmupSetCount = 0
          let totalVolumeKg = 0

          for (const setLog of sets) {
            if (setLog.kind === 'working') {
              workingSetCount += 1
              if (setLog.externalLoadKg !== null) {
                totalVolumeKg += setLog.externalLoadKg * setLog.reps
              }
            } else {
              warmupSetCount += 1
            }
          }

          return {
            session,
            routineName: session.routineId
              ? (routineNameById.get(session.routineId) ?? null)
              : null,
            exerciseCount: orderedExercises.length,
            exerciseNames: orderedExercises.map(
              (item) => item.exerciseNameSnapshot,
            ),
            workingSetCount,
            warmupSetCount,
            totalSetCount: sets.length,
            totalVolumeKg,
          }
        })
    },
  )
}

export { getActiveSessionSnapshot, getSessionSnapshot }
