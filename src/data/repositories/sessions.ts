import { createId } from '../../domain/id'
import type {
  ID,
  SessionExercise,
  SetLog,
  UTCISOString,
  WorkoutSession,
} from '../../domain/models'
import { toUTCISOString } from '../../domain/time'
import { db, PersonalTrackerDB } from '../db'
import {
  exerciseIdSchema,
  idSchema,
  sessionExerciseSchema,
  type SetLogInput,
  setLogSchema,
  workoutSessionSchema,
} from '../validation'
import {
  ActiveSessionConflictError,
  DuplicateSetOrdinalError,
  ExcludedExerciseError,
  InvalidSessionStateError,
  ParentReferenceError,
  RecordNotFoundError,
} from './errors'

export interface CatalogExerciseSnapshot {
  name: string
  equipment: string | null
}

export type CatalogSnapshotLookup =
  | ReadonlyMap<ID, CatalogExerciseSnapshot>
  | Record<ID, CatalogExerciseSnapshot>
  | ((exerciseId: ID) => CatalogExerciseSnapshot | undefined)

export interface SessionExerciseDraft {
  id?: ID
  exerciseId: ID
  exerciseNameSnapshot: string
  equipmentSnapshot: string | null
  order: number
  targetSets: number
  targetRepMin: number
  targetRepMax: number
  restSeconds: number
}

export interface StartSessionOptions {
  id?: ID
  startedAt?: UTCISOString
  note?: string
  exercises?: SessionExerciseDraft[]
  catalogLookup?: CatalogSnapshotLookup
  onActiveConflict?: 'reject' | 'redirect'
  database?: PersonalTrackerDB
}

export interface StartSessionResult {
  session: WorkoutSession
  exercises: SessionExercise[]
  redirected: boolean
}

export interface SessionSnapshot {
  session: WorkoutSession
  exercises: SessionExercise[]
  setLogs: SetLog[]
}

export type AppendSetInput = Omit<SetLogInput, 'ordinal'> & {
  id?: ID
  ordinal?: number
}

export interface CompleteSessionOptions {
  endedAt?: UTCISOString
  note?: string
}

function resolveCatalogSnapshot(
  lookup: CatalogSnapshotLookup | undefined,
  exerciseId: ID,
): CatalogExerciseSnapshot | undefined {
  if (!lookup) {
    return {
      name: exerciseId.replace(/^fedb:/, '').replaceAll('_', ' '),
      equipment: null,
    }
  }
  if (typeof lookup === 'function') {
    return lookup(exerciseId)
  }
  if (lookup instanceof Map) {
    return lookup.get(exerciseId)
  }
  return (lookup as Record<ID, CatalogExerciseSnapshot | undefined>)[exerciseId]
}

function sortSessionExercises(
  exercises: readonly SessionExercise[],
): SessionExercise[] {
  return [...exercises].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id),
  )
}

function sortSetLogs(
  setLogs: readonly SetLog[],
  exerciseOrderById: ReadonlyMap<ID, number>,
): SetLog[] {
  return [...setLogs].sort(
    (left, right) =>
      (exerciseOrderById.get(left.sessionExerciseId) ?? 0) -
        (exerciseOrderById.get(right.sessionExerciseId) ?? 0) ||
      left.ordinal - right.ordinal ||
      left.id.localeCompare(right.id),
  )
}

export async function getActiveSession(
  database: PersonalTrackerDB = db,
): Promise<WorkoutSession | undefined> {
  const activeSessions = await database.sessions
    .where('status')
    .equals('active')
    .toArray()
  return activeSessions.sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.id.localeCompare(right.id),
  )[0]
}

export async function getSessionSnapshot(
  sessionId: ID,
  database: PersonalTrackerDB = db,
): Promise<SessionSnapshot | undefined> {
  const validId = idSchema.parse(sessionId)
  return database.transaction(
    'r',
    [database.sessions, database.sessionExercises, database.setLogs],
    async () => {
      const session = await database.sessions.get(validId)
      if (!session) return undefined
      const exercises = sortSessionExercises(
        await database.sessionExercises
          .where('sessionId')
          .equals(validId)
          .toArray(),
      )
      const orderById = new Map(
        exercises.map((exercise) => [exercise.id, exercise.order]),
      )
      const setLogs = sortSetLogs(
        await database.setLogs.where('sessionId').equals(validId).toArray(),
        orderById,
      )
      return { session, exercises, setLogs }
    },
  )
}

export async function getActiveSessionSnapshot(
  database: PersonalTrackerDB = db,
): Promise<SessionSnapshot | undefined> {
  return database.transaction(
    'r',
    [database.sessions, database.sessionExercises, database.setLogs],
    async () => {
      const active = await getActiveSession(database)
      if (!active) return undefined
      return getSessionSnapshot(active.id, database)
    },
  )
}

export async function startSession(
  routineId: ID | null,
  options?: StartSessionOptions,
  database: PersonalTrackerDB = options?.database ?? db,
): Promise<StartSessionResult> {
  const validRoutineId = routineId === null ? null : idSchema.parse(routineId)

  return database.transaction(
    'rw',
    [
      database.routines,
      database.restrictions,
      database.sessions,
      database.sessionExercises,
    ],
    async () => {
      const activeSessions = await database.sessions
        .where('status')
        .equals('active')
        .toArray()

      if (activeSessions.length > 0) {
        const existingSession = activeSessions.sort(
          (left, right) =>
            left.startedAt.localeCompare(right.startedAt) ||
            left.id.localeCompare(right.id),
        )[0]!

        if (options?.onActiveConflict === 'redirect') {
          const existingExercises = sortSessionExercises(
            await database.sessionExercises
              .where('sessionId')
              .equals(existingSession.id)
              .toArray(),
          )
          return {
            session: existingSession,
            exercises: existingExercises,
            redirected: true,
          }
        }

        throw new ActiveSessionConflictError(existingSession)
      }

      const routine =
        validRoutineId === null
          ? undefined
          : await database.routines.get(validRoutineId)

      if (validRoutineId !== null && !routine) {
        throw new ParentReferenceError(
          'WorkoutSession',
          'routineId',
          validRoutineId,
        )
      }

      const session = workoutSessionSchema.parse({
        id: options?.id ?? createId(),
        routineId: validRoutineId,
        status: 'active',
        startedAt: options?.startedAt ?? toUTCISOString(new Date()),
        ...(options?.note !== undefined ? { note: options.note } : {}),
      })

      await database.sessions.add(session)

      const rawExercises: SessionExerciseDraft[] =
        options?.exercises ??
        (routine
          ? [...routine.items]
              .sort((left, right) => left.order - right.order)
              .map((item) => {
                const snapshot = resolveCatalogSnapshot(
                  options?.catalogLookup,
                  item.exerciseId,
                )
                if (!snapshot) {
                  throw new ParentReferenceError(
                    'SessionExercise',
                    'exerciseId',
                    item.exerciseId,
                  )
                }
                return {
                  exerciseId: item.exerciseId,
                  exerciseNameSnapshot: snapshot.name,
                  equipmentSnapshot: snapshot.equipment,
                  order: item.order,
                  targetSets: item.workingSets,
                  targetRepMin: item.repMin,
                  targetRepMax: item.repMax,
                  restSeconds: item.restSeconds,
                }
              })
          : [])

      const seenOrders = new Set<number>()
      const createdExercises: SessionExercise[] = []

      for (const draft of rawExercises) {
        const restriction = await database.restrictions.get(draft.exerciseId)
        if (restriction?.status === 'excluded') {
          throw new ExcludedExerciseError(draft.exerciseId, restriction.note)
        }

        if (options?.catalogLookup) {
          const snapshot = resolveCatalogSnapshot(
            options.catalogLookup,
            draft.exerciseId,
          )
          if (!snapshot) {
            throw new ParentReferenceError(
              'SessionExercise',
              'exerciseId',
              draft.exerciseId,
            )
          }
        }

        if (seenOrders.has(draft.order)) {
          throw new Error('Session exercise order must be unique.')
        }
        seenOrders.add(draft.order)

        const parsedExercise = sessionExerciseSchema.parse({
          ...draft,
          id: draft.id ?? createId(),
          sessionId: session.id,
        })

        await database.sessionExercises.add(parsedExercise)
        createdExercises.push(parsedExercise)
      }

      return {
        session,
        exercises: sortSessionExercises(createdExercises),
        redirected: false,
      }
    },
  )
}

export async function addSessionExercise(
  draft: SessionExerciseDraft & { sessionId: ID },
  database: PersonalTrackerDB = db,
): Promise<SessionExercise> {
  const validSessionId = idSchema.parse(draft.sessionId)
  return database.transaction(
    'rw',
    [database.sessions, database.restrictions, database.sessionExercises],
    async () => {
      const session = await database.sessions.get(validSessionId)
      if (!session) {
        throw new ParentReferenceError(
          'SessionExercise',
          'sessionId',
          validSessionId,
        )
      }
      if (session.status !== 'active') {
        throw new InvalidSessionStateError(
          session.id,
          session.status,
          'Cannot add exercises to a non-active workout session.',
        )
      }

      const restriction = await database.restrictions.get(draft.exerciseId)
      if (restriction?.status === 'excluded') {
        throw new ExcludedExerciseError(draft.exerciseId, restriction.note)
      }

      const existingAtOrder = await database.sessionExercises
        .where('[sessionId+order]')
        .equals([validSessionId, draft.order])
        .first()
      if (existingAtOrder) {
        throw new Error('Session exercise order must be unique.')
      }

      const parsed = sessionExerciseSchema.parse({
        ...draft,
        id: draft.id ?? createId(),
      })

      await database.sessionExercises.add(parsed)
      return parsed
    },
  )
}

export async function appendSet(
  input: AppendSetInput,
  database: PersonalTrackerDB = db,
): Promise<SetLog> {
  const validSessionId = idSchema.parse(input.sessionId)
  const validSessionExerciseId = idSchema.parse(input.sessionExerciseId)

  return database.transaction(
    'rw',
    [database.sessions, database.sessionExercises, database.setLogs],
    async () => {
      const session = await database.sessions.get(validSessionId)
      if (!session) {
        throw new ParentReferenceError('SetLog', 'sessionId', validSessionId)
      }
      if (session.status !== 'active') {
        throw new InvalidSessionStateError(
          session.id,
          session.status,
          'Sets can only be appended to an active workout session.',
        )
      }

      const sessionExercise = await database.sessionExercises.get(
        validSessionExerciseId,
      )
      if (!sessionExercise) {
        throw new ParentReferenceError(
          'SetLog',
          'sessionExerciseId',
          validSessionExerciseId,
        )
      }
      if (sessionExercise.sessionId !== validSessionId) {
        throw new ParentReferenceError(
          'SetLog',
          'sessionExerciseId',
          validSessionExerciseId,
          `Session exercise ${validSessionExerciseId} belongs to session ${sessionExercise.sessionId}, not ${validSessionId}.`,
        )
      }

      const existingSets = await database.setLogs
        .where('sessionExerciseId')
        .equals(validSessionExerciseId)
        .sortBy('ordinal')

      const ordinal = input.ordinal ?? (existingSets.at(-1)?.ordinal ?? 0) + 1

      if (ordinal > 0 && Number.isInteger(ordinal)) {
        const duplicate = await database.setLogs
          .where('[sessionExerciseId+ordinal]')
          .equals([validSessionExerciseId, ordinal])
          .first()
        if (duplicate) {
          throw new DuplicateSetOrdinalError(validSessionExerciseId, ordinal)
        }
      }

      const record = setLogSchema.parse({
        ...input,
        id: input.id ?? createId(),
        sessionId: validSessionId,
        sessionExerciseId: validSessionExerciseId,
        ordinal,
      })

      await database.setLogs.add(record)
      return record
    },
  )
}

export async function updateSet(
  setLog: SetLog,
  database: PersonalTrackerDB = db,
): Promise<SetLog> {
  const parsed = setLogSchema.parse(setLog)

  return database.transaction(
    'rw',
    [database.sessions, database.sessionExercises, database.setLogs],
    async () => {
      const existing = await database.setLogs.get(parsed.id)
      if (!existing) {
        throw new RecordNotFoundError('SetLog', parsed.id)
      }

      const session = await database.sessions.get(parsed.sessionId)
      if (!session) {
        throw new ParentReferenceError('SetLog', 'sessionId', parsed.sessionId)
      }

      const sessionExercise = await database.sessionExercises.get(
        parsed.sessionExerciseId,
      )
      if (!sessionExercise) {
        throw new ParentReferenceError(
          'SetLog',
          'sessionExerciseId',
          parsed.sessionExerciseId,
        )
      }
      if (sessionExercise.sessionId !== parsed.sessionId) {
        throw new ParentReferenceError(
          'SetLog',
          'sessionExerciseId',
          parsed.sessionExerciseId,
          `Session exercise ${parsed.sessionExerciseId} belongs to session ${sessionExercise.sessionId}, not ${parsed.sessionId}.`,
        )
      }

      const duplicate = await database.setLogs
        .where('[sessionExerciseId+ordinal]')
        .equals([parsed.sessionExerciseId, parsed.ordinal])
        .first()
      if (duplicate && duplicate.id !== parsed.id) {
        throw new DuplicateSetOrdinalError(
          parsed.sessionExerciseId,
          parsed.ordinal,
        )
      }

      await database.setLogs.put(parsed)
      return parsed
    },
  )
}

export async function deleteSet(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  const validId = idSchema.parse(id)
  await database.transaction('rw', database.setLogs, async () => {
    const existing = await database.setLogs.get(validId)
    if (!existing) {
      throw new RecordNotFoundError('SetLog', validId)
    }
    await database.setLogs.delete(validId)
  })
}

async function completeSessionWithStatus(
  id: ID,
  status: 'completed' | 'cancelled',
  options: CompleteSessionOptions | undefined,
  database: PersonalTrackerDB,
): Promise<WorkoutSession> {
  const validId = idSchema.parse(id)
  return database.transaction(
    'rw',
    [database.sessions, database.settings],
    async () => {
      const existing = await database.sessions.get(validId)
      if (!existing) {
        throw new RecordNotFoundError('WorkoutSession', validId)
      }
      if (existing.status !== 'active') {
        throw new InvalidSessionStateError(
          validId,
          existing.status,
          `Workout session ${validId} is already ${existing.status}.`,
        )
      }

      const updated = workoutSessionSchema.parse({
        ...existing,
        status,
        endedAt: options?.endedAt ?? toUTCISOString(new Date()),
        ...(options?.note !== undefined ? { note: options.note } : {}),
      })

      await database.sessions.put(updated)

      const settings = await database.settings.get('singleton')
      if (settings?.restTimer?.sessionId === validId) {
        const nextSettings = { ...settings }
        delete nextSettings.restTimer
        await database.settings.put(nextSettings)
      }

      return updated
    },
  )
}

export async function finishSession(
  id: ID,
  options?: CompleteSessionOptions,
  database: PersonalTrackerDB = db,
): Promise<WorkoutSession> {
  return completeSessionWithStatus(id, 'completed', options, database)
}

export async function cancelSession(
  id: ID,
  options?: CompleteSessionOptions,
  database: PersonalTrackerDB = db,
): Promise<WorkoutSession> {
  return completeSessionWithStatus(id, 'cancelled', options, database)
}

export async function getLastCompletedWorkingSets(
  exerciseId: ID,
  beforeSessionId?: ID | null,
  database: PersonalTrackerDB = db,
): Promise<SetLog[]> {
  const validExerciseId = exerciseIdSchema.parse(exerciseId)
  const validBeforeSessionId =
    beforeSessionId === undefined || beforeSessionId === null
      ? null
      : idSchema.parse(beforeSessionId)

  return database.transaction(
    'r',
    [database.sessions, database.sessionExercises, database.setLogs],
    async () => {
      const beforeSession =
        validBeforeSessionId === null
          ? undefined
          : await database.sessions.get(validBeforeSessionId)

      const matchingExercises = await database.sessionExercises
        .where('exerciseId')
        .equals(validExerciseId)
        .toArray()

      if (matchingExercises.length === 0) {
        return []
      }

      const exercisesBySessionId = new Map<ID, SessionExercise[]>()
      for (const exercise of matchingExercises) {
        if (exercise.sessionId === validBeforeSessionId) continue
        const list = exercisesBySessionId.get(exercise.sessionId) ?? []
        list.push(exercise)
        exercisesBySessionId.set(exercise.sessionId, list)
      }

      const candidateSessions = (
        await database.sessions.bulkGet([...exercisesBySessionId.keys()])
      ).filter((session): session is WorkoutSession => {
        if (!session || session.status !== 'completed') return false
        if (
          beforeSession &&
          (session.endedAt ?? session.startedAt) > beforeSession.startedAt
        ) {
          return false
        }
        return true
      })

      candidateSessions.sort(
        (left, right) =>
          (right.endedAt ?? right.startedAt).localeCompare(
            left.endedAt ?? left.startedAt,
          ) ||
          right.startedAt.localeCompare(left.startedAt) ||
          right.id.localeCompare(left.id),
      )

      for (const session of candidateSessions) {
        const sessionExercises = sortSessionExercises(
          exercisesBySessionId.get(session.id) ?? [],
        )
        const orderById = new Map(
          sessionExercises.map((exercise) => [exercise.id, exercise.order]),
        )
        const workingSets: SetLog[] = []

        for (const sessionExercise of sessionExercises) {
          const sets = await database.setLogs
            .where('sessionExerciseId')
            .equals(sessionExercise.id)
            .toArray()
          for (const set of sets) {
            if (set.kind === 'working') {
              workingSets.push(set)
            }
          }
        }

        if (workingSets.length > 0) {
          return sortSetLogs(workingSets, orderById)
        }
      }

      return []
    },
  )
}

export function createSessionRepository(database: PersonalTrackerDB = db) {
  return {
    getActiveSession: () => getActiveSession(database),
    getSessionSnapshot: (sessionId: ID) =>
      getSessionSnapshot(sessionId, database),
    getActiveSessionSnapshot: () => getActiveSessionSnapshot(database),
    startSession: (routineId: ID | null, options?: StartSessionOptions) =>
      startSession(routineId, options, database),
    addSessionExercise: (draft: SessionExerciseDraft & { sessionId: ID }) =>
      addSessionExercise(draft, database),
    appendSet: (input: AppendSetInput) => appendSet(input, database),
    updateSet: (setLog: SetLog) => updateSet(setLog, database),
    deleteSet: (id: ID) => deleteSet(id, database),
    finishSession: (id: ID, options?: CompleteSessionOptions) =>
      finishSession(id, options, database),
    cancelSession: (id: ID, options?: CompleteSessionOptions) =>
      cancelSession(id, options, database),
    getLastCompletedWorkingSets: (
      exerciseId: ID,
      beforeSessionId?: ID | null,
    ) => getLastCompletedWorkingSets(exerciseId, beforeSessionId, database),
  }
}
