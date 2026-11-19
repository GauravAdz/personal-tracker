import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AppSettings,
  CatalogExercise,
  HabitDefinition,
  Routine,
  SessionExercise,
} from '../../domain/models'
import {
  createDatabase,
  DB_SCHEMA_VERSION,
  PersonalTrackerDB,
  V1_STORE_DEFINITIONS,
} from '../db'
import {
  ActiveSessionConflictError,
  addSessionExercise,
  appendSet,
  cancelSession,
  createRepositories,
  deleteBodyWeight,
  deleteExerciseRestriction,
  deleteHabitLog,
  deleteRoutine,
  deleteSet,
  DuplicateHabitSlotLogError,
  DuplicateSetOrdinalError,
  finishSession,
  getActiveSession,
  getActiveSessionSnapshot,
  getAppSettings,
  getBodyWeightById,
  getExerciseById,
  getExercises,
  getHabitDefinitionById,
  getLastCompletedWorkingSets,
  getRoutineById,
  getSessionSnapshot,
  insertHabitLog,
  InvalidSessionStateError,
  listBodyWeights,
  listBodyWeightsForDateRange,
  listExerciseOverrides,
  listExerciseRestrictions,
  listHabitDefinitions,
  listHabitLogsForDay,
  listMusclePreferences,
  listRoutines,
  ParentReferenceError,
  RecordNotFoundError,
  saveAppSettings,
  saveBodyWeight,
  saveExerciseOverride,
  saveExerciseRestriction,
  saveHabitDefinition,
  saveMusclePreference,
  saveRoutine,
  startSession,
  updateSet,
  upsertHabitLog,
} from './index'

const routineId = '11111111-1111-4111-8111-111111111111'
const itemOneId = '11111111-1111-4111-8111-111111111112'
const itemTwoId = '11111111-1111-4111-8111-111111111113'
const sessionOneId = '22222222-2222-4222-8222-222222222221'
const sessionTwoId = '22222222-2222-4222-8222-222222222222'
const sessionExOneId = '33333333-3333-4333-8333-333333333331'
const sessionExTwoId = '33333333-3333-4333-8333-333333333332'
const setOneId = '44444444-4444-4444-8444-444444444441'
const setTwoId = '44444444-4444-4444-8444-444444444442'
const habitId = '55555555-5555-4555-8555-555555555551'
const morningSlotId = '55555555-5555-4555-8555-555555555552'
const eveningSlotId = '55555555-5555-4555-8555-555555555553'
const missingUuid = '99999999-9999-4999-8999-999999999999'

const t0 = '2026-10-27T07:00:00.000Z'
const t1 = '2026-10-27T07:10:00.000Z'
const t2 = '2026-10-27T07:20:00.000Z'
const t3 = '2026-10-27T08:00:00.000Z'

const benchExercise: CatalogExercise = {
  id: 'fedb:Barbell_Bench_Press',
  sourceId: 'Barbell_Bench_Press',
  name: 'Barbell Bench Press',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps', 'shoulders'],
  equipment: 'barbell',
  instructions: ['Lower bar with control.', 'Press back to lockout.'],
  category: 'strength',
  imagePaths: ['exercises/Barbell_Bench_Press/0.jpg'],
}

const rowExercise: CatalogExercise = {
  id: 'fedb:Dumbbell_Row',
  sourceId: 'Dumbbell_Row',
  name: 'Dumbbell Row',
  primaryMuscles: ['lats'],
  secondaryMuscles: ['biceps'],
  equipment: 'dumbbell',
  instructions: ['Brace torso.', 'Pull elbow toward hip.'],
  category: 'strength',
  imagePaths: ['exercises/Dumbbell_Row/0.jpg'],
}

const pullupExercise: CatalogExercise = {
  id: 'fedb:Pull_Up',
  sourceId: 'Pull_Up',
  name: 'Pull Up',
  primaryMuscles: ['lats'],
  secondaryMuscles: ['biceps'],
  equipment: null,
  instructions: ['Hang from bar.', 'Pull chin above bar.'],
  category: 'strength',
  imagePaths: [],
}

const sampleCatalog: readonly CatalogExercise[] = [
  benchExercise,
  rowExercise,
  pullupExercise,
]

const sampleRoutine: Routine = {
  id: routineId,
  name: 'Upper A',
  // Intentionally unsorted to verify repository sorting by explicit order.
  items: [
    {
      id: itemTwoId,
      exerciseId: rowExercise.id,
      order: 10,
      workingSets: 3,
      repMin: 8,
      repMax: 12,
      restSeconds: 90,
    },
    {
      id: itemOneId,
      exerciseId: benchExercise.id,
      order: 0,
      workingSets: 4,
      repMin: 6,
      repMax: 8,
      restSeconds: 120,
    },
  ],
  createdAt: t0,
  updatedAt: t1,
}

const sampleHabit: HabitDefinition = {
  id: habitId,
  name: 'Daily topical check-in',
  slots: [
    { id: morningSlotId, label: 'Morning', localTime: '08:00' },
    { id: eveningSlotId, label: 'Evening', localTime: '20:00' },
  ],
  quantityLabel: 'ml',
  archived: false,
  createdAt: t0,
  updatedAt: t0,
}

describe('Dexie v1 schema and repositories', () => {
  let testDb: PersonalTrackerDB
  let dbName: string

  beforeEach(() => {
    dbName = `personal-tracker-test-${crypto.randomUUID()}`
    testDb = createDatabase(dbName)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  describe('Dexie v1 schema, indexes, and migrations', () => {
    it('defines all v1 tables, primary keys, and compound/unique indexes', async () => {
      await testDb.open()
      expect(testDb.verno).toBe(DB_SCHEMA_VERSION)

      const tableNames = testDb.tables.map((table) => table.name).sort()
      expect(tableNames).toEqual(Object.keys(V1_STORE_DEFINITIONS).sort())

      const setLogsSpec = testDb.setLogs.schema
      expect(setLogsSpec.primKey.name).toBe('id')
      const setOrdinalIndex = setLogsSpec.indexes.find(
        (idx) => idx.name === '[sessionExerciseId+ordinal]',
      )
      expect(setOrdinalIndex?.unique).toBe(true)
      expect(setOrdinalIndex?.compound).toBe(true)

      const habitLogsSpec = testDb.habitLogs.schema
      expect(habitLogsSpec.primKey.name).toBe('id')
      const habitSlotIndex = habitLogsSpec.indexes.find(
        (idx) => idx.name === '[habitId+localDate+slotId]',
      )
      expect(habitSlotIndex?.unique).toBe(true)
      expect(habitSlotIndex?.compound).toBe(true)

      const sessionExercisesSpec = testDb.sessionExercises.schema
      const sessionOrderIndex = sessionExercisesSpec.indexes.find(
        (idx) => idx.name === '[sessionId+order]',
      )
      expect(sessionOrderIndex?.compound).toBe(true)
    })

    it('enforces unique compound indexes at the IndexedDB store level', async () => {
      await testDb.setLogs.add({
        id: setOneId,
        sessionId: sessionOneId,
        sessionExerciseId: sessionExOneId,
        ordinal: 1,
        kind: 'working',
        externalLoadKg: 60,
        reps: 8,
        completedAt: t1,
      })

      await expect(
        testDb.setLogs.add({
          id: setTwoId,
          sessionId: sessionOneId,
          sessionExerciseId: sessionExOneId,
          ordinal: 1,
          kind: 'working',
          externalLoadKg: 65,
          reps: 8,
          completedAt: t2,
        }),
      ).rejects.toThrow()

      await testDb.habitLogs.add({
        id: setOneId,
        habitId,
        slotId: morningSlotId,
        localDate: '2026-10-27',
        timeZone: 'Europe/Vienna',
        status: 'done',
        occurredAt: t1,
      })

      await expect(
        testDb.habitLogs.add({
          id: setTwoId,
          habitId,
          slotId: morningSlotId,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
          status: 'skipped',
          occurredAt: t2,
        }),
      ).rejects.toThrow()
    })

    it('preserves existing v1 records across database reopen and version upgrade', async () => {
      await saveRoutine(sampleRoutine, testDb)
      await saveBodyWeight(
        {
          id: setOneId,
          weightKg: 78.4,
          occurredAt: t0,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
        },
        testDb,
      )
      testDb.close()

      const upgradedDb = new Dexie(dbName)
      upgradedDb.version(1).stores(V1_STORE_DEFINITIONS)
      upgradedDb.version(2).stores({
        ...V1_STORE_DEFINITIONS,
        routines: 'id, updatedAt, createdAt, name',
      })

      await upgradedDb.open()
      expect(upgradedDb.verno).toBe(2)
      const routines = await upgradedDb
        .table<Routine, string>('routines')
        .toArray()
      expect(routines).toHaveLength(1)
      expect(routines[0]?.id).toBe(routineId)
      expect(routines[0]?.items.map((item) => item.id)).toEqual([
        itemOneId,
        itemTwoId,
      ])
      upgradedDb.close()
    })
  })

  describe('Routines repository', () => {
    it('saves, loads, and lists routines with items sorted by explicit order', async () => {
      const saved = await saveRoutine(sampleRoutine, {
        knownExerciseIds: new Set([benchExercise.id, rowExercise.id]),
        database: testDb,
      })
      expect(saved.items.map((item) => item.id)).toEqual([itemOneId, itemTwoId])

      const loaded = await getRoutineById(routineId, testDb)
      expect(loaded?.items.map((item) => item.order)).toEqual([0, 10])

      const secondRoutine: Routine = {
        ...sampleRoutine,
        id: sessionOneId,
        name: 'Lower A',
        updatedAt: t2,
      }
      await saveRoutine(secondRoutine, testDb)

      const all = await listRoutines(testDb)
      expect(all.map((routine) => routine.id)).toEqual([
        sessionOneId,
        routineId,
      ])
    })

    it('rejects routine items referencing unknown catalog exercises when catalog set is supplied', async () => {
      await expect(
        saveRoutine(sampleRoutine, {
          knownExerciseIds: new Set([benchExercise.id]),
          database: testDb,
        }),
      ).rejects.toThrow(ParentReferenceError)
      expect(await testDb.routines.count()).toBe(0)
    })

    it('deletes a routine template without deleting workout sessions or set history', async () => {
      await saveRoutine(sampleRoutine, testDb)
      const started = await startSession(
        routineId,
        {
          id: sessionOneId,
          startedAt: t1,
          catalogLookup: new Map([
            [
              benchExercise.id,
              { name: benchExercise.name, equipment: benchExercise.equipment },
            ],
            [
              rowExercise.id,
              { name: rowExercise.name, equipment: rowExercise.equipment },
            ],
          ]),
        },
        testDb,
      )
      const firstExercise = started.exercises[0]!
      await appendSet(
        {
          id: setOneId,
          sessionId: sessionOneId,
          sessionExerciseId: firstExercise.id,
          ordinal: 1,
          kind: 'working',
          externalLoadKg: 80,
          reps: 8,
          completedAt: t2,
        },
        testDb,
      )

      await deleteRoutine(routineId, testDb)
      expect(await getRoutineById(routineId, testDb)).toBeUndefined()

      const snapshot = await getSessionSnapshot(sessionOneId, testDb)
      expect(snapshot?.session.id).toBe(sessionOneId)
      expect(snapshot?.exercises).toHaveLength(2)
      expect(snapshot?.exercises[0]?.exerciseNameSnapshot).toBe(
        'Barbell Bench Press',
      )
      expect(snapshot?.setLogs).toHaveLength(1)
    })
  })

  describe('Workout sessions and active-session invariant', () => {
    it('starts a routine session transactionally with sorted SessionExercise snapshots', async () => {
      await saveRoutine(sampleRoutine, testDb)
      const result = await startSession(
        routineId,
        {
          id: sessionOneId,
          startedAt: t1,
          catalogLookup: {
            [benchExercise.id]: {
              name: benchExercise.name,
              equipment: benchExercise.equipment,
            },
            [rowExercise.id]: {
              name: rowExercise.name,
              equipment: rowExercise.equipment,
            },
          },
        },
        testDb,
      )

      expect(result.redirected).toBe(false)
      expect(result.session.status).toBe('active')
      expect(result.exercises.map((ex) => ex.exerciseNameSnapshot)).toEqual([
        'Barbell Bench Press',
        'Dumbbell Row',
      ])
      expect(result.exercises.map((ex) => ex.equipmentSnapshot)).toEqual([
        'barbell',
        'dumbbell',
      ])

      const active = await getActiveSession(testDb)
      expect(active?.id).toBe(sessionOneId)
      const activeSnapshot = await getActiveSessionSnapshot(testDb)
      expect(activeSnapshot?.exercises).toHaveLength(2)
    })

    it('rejects starting a second session when one is active (including simultaneous calls)', async () => {
      const [firstOutcome, secondOutcome] = await Promise.allSettled([
        startSession(null, { id: sessionOneId, startedAt: t0 }, testDb),
        startSession(null, { id: sessionTwoId, startedAt: t1 }, testDb),
      ])

      const fulfilled = [firstOutcome, secondOutcome].filter(
        (
          outcome,
        ): outcome is PromiseFulfilledResult<
          Awaited<ReturnType<typeof startSession>>
        > => outcome.status === 'fulfilled',
      )
      const rejected = [firstOutcome, secondOutcome].filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      )

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBeInstanceOf(ActiveSessionConflictError)
      const conflictError = rejected[0]?.reason as ActiveSessionConflictError
      expect(conflictError.redirectToSessionId).toBe(
        fulfilled[0]?.value.session.id,
      )

      expect(await testDb.sessions.count()).toBe(1)
    })

    it('redirects to the existing active session when onActiveConflict is redirect', async () => {
      const [first, second] = await Promise.all([
        startSession(
          null,
          {
            id: sessionOneId,
            startedAt: t0,
            exercises: [
              {
                id: sessionExOneId,
                exerciseId: benchExercise.id,
                exerciseNameSnapshot: benchExercise.name,
                equipmentSnapshot: benchExercise.equipment,
                order: 0,
                targetSets: 3,
                targetRepMin: 8,
                targetRepMax: 10,
                restSeconds: 120,
              },
            ],
            onActiveConflict: 'redirect',
          },
          testDb,
        ),
        startSession(
          null,
          {
            id: sessionTwoId,
            startedAt: t1,
            onActiveConflict: 'redirect',
          },
          testDb,
        ),
      ])

      expect(first.redirected).toBe(false)
      expect(second.redirected).toBe(true)
      expect(second.session.id).toBe(sessionOneId)
      expect(second.exercises.map((ex) => ex.id)).toEqual([sessionExOneId])
      expect(await testDb.sessions.count()).toBe(1)
    })

    it('rolls back session and earlier sessionExercises when a transaction fails mid-start', async () => {
      await saveRoutine(sampleRoutine, testDb)

      // Lookup succeeds for first routine item (Bench Press) and fails on second (Dumbbell Row).
      await expect(
        startSession(
          routineId,
          {
            id: sessionOneId,
            startedAt: t1,
            catalogLookup: (exerciseId) =>
              exerciseId === benchExercise.id
                ? {
                    name: benchExercise.name,
                    equipment: benchExercise.equipment,
                  }
                : undefined,
          },
          testDb,
        ),
      ).rejects.toThrow(ParentReferenceError)

      expect(await testDb.sessions.count()).toBe(0)
      expect(await testDb.sessionExercises.count()).toBe(0)

      // Also test rollback when second explicit SessionExercise fails after first SessionExercise is added.
      await expect(
        startSession(
          null,
          {
            id: sessionOneId,
            startedAt: t1,
            exercises: [
              {
                id: sessionExOneId,
                exerciseId: benchExercise.id,
                exerciseNameSnapshot: benchExercise.name,
                equipmentSnapshot: benchExercise.equipment,
                order: 0,
                targetSets: 3,
                targetRepMin: 8,
                targetRepMax: 10,
                restSeconds: 90,
              },
              {
                // Duplicate SessionExercise ID triggers IndexedDB ConstraintError after first item is added.
                id: sessionExOneId,
                exerciseId: rowExercise.id,
                exerciseNameSnapshot: rowExercise.name,
                equipmentSnapshot: rowExercise.equipment,
                order: 1,
                targetSets: 3,
                targetRepMin: 8,
                targetRepMax: 12,
                restSeconds: 90,
              },
            ],
          },
          testDb,
        ),
      ).rejects.toThrow()

      expect(await testDb.sessions.count()).toBe(0)
      expect(await testDb.sessionExercises.count()).toBe(0)
    })

    it('validates routineId parent reference and finishes/cancels sessions while clearing active rest timer', async () => {
      await expect(
        startSession(missingUuid, { startedAt: t0 }, testDb),
      ).rejects.toThrow(ParentReferenceError)

      await startSession(
        null,
        {
          id: sessionOneId,
          startedAt: t0,
          exercises: [
            {
              id: sessionExOneId,
              exerciseId: benchExercise.id,
              exerciseNameSnapshot: benchExercise.name,
              equipmentSnapshot: benchExercise.equipment,
              order: 0,
              targetSets: 3,
              targetRepMin: 8,
              targetRepMax: 10,
              restSeconds: 90,
            },
          ],
        },
        testDb,
      )

      const settingsWithTimer: AppSettings = {
        id: 'singleton',
        preferredMassUnit: 'kg',
        catalogVersion: 'fedb-v1',
        restTimer: { sessionId: sessionOneId, endsAt: t2 },
      }
      await saveAppSettings(settingsWithTimer, testDb)

      // Invalid end time before start time rolls back without mutating session or timer.
      await expect(
        finishSession(
          sessionOneId,
          { endedAt: '2026-10-27T06:00:00.000Z' },
          testDb,
        ),
      ).rejects.toThrow()
      expect((await getActiveSession(testDb))?.id).toBe(sessionOneId)
      expect((await getAppSettings(testDb))?.restTimer?.sessionId).toBe(
        sessionOneId,
      )

      const cancelled = await cancelSession(
        sessionOneId,
        { endedAt: t2, note: 'Stopped early' },
        testDb,
      )
      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.endedAt).toBe(t2)
      expect(await getActiveSession(testDb)).toBeUndefined()
      expect((await getAppSettings(testDb))?.restTimer).toBeUndefined()

      // Cannot finish an already cancelled session.
      await expect(
        finishSession(sessionOneId, { endedAt: t3 }, testDb),
      ).rejects.toThrow(InvalidSessionStateError)
    })
  })

  describe('Set logging, duplicate ordinal prevention, and parent-reference validation', () => {
    beforeEach(async () => {
      await startSession(
        null,
        {
          id: sessionOneId,
          startedAt: t0,
          exercises: [
            {
              id: sessionExOneId,
              exerciseId: benchExercise.id,
              exerciseNameSnapshot: benchExercise.name,
              equipmentSnapshot: benchExercise.equipment,
              order: 0,
              targetSets: 3,
              targetRepMin: 6,
              targetRepMax: 8,
              restSeconds: 120,
            },
            {
              id: sessionExTwoId,
              exerciseId: rowExercise.id,
              exerciseNameSnapshot: rowExercise.name,
              equipmentSnapshot: rowExercise.equipment,
              order: 1,
              targetSets: 3,
              targetRepMin: 8,
              targetRepMax: 12,
              restSeconds: 90,
            },
          ],
        },
        testDb,
      )
    })

    it('rejects duplicate ordinal on rapid double append and preserves single row', async () => {
      const payload = {
        sessionId: sessionOneId,
        sessionExerciseId: sessionExOneId,
        ordinal: 1,
        kind: 'working' as const,
        externalLoadKg: 80,
        reps: 8,
        completedAt: t1,
      }

      const [first, second] = await Promise.allSettled([
        appendSet({ ...payload, id: setOneId }, testDb),
        appendSet({ ...payload, id: setTwoId }, testDb),
      ])

      const fulfilled = [first, second].filter(
        (item) => item.status === 'fulfilled',
      )
      const rejected = [first, second].filter(
        (item): item is PromiseRejectedResult => item.status === 'rejected',
      )

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBeInstanceOf(DuplicateSetOrdinalError)

      const sets = await testDb.setLogs.toArray()
      expect(sets).toHaveLength(1)
      expect(sets[0]?.ordinal).toBe(1)
    })

    it('assigns sequential ordinals when ordinal is omitted across concurrent appends', async () => {
      const [first, second] = await Promise.all([
        appendSet(
          {
            id: setOneId,
            sessionId: sessionOneId,
            sessionExerciseId: sessionExOneId,
            kind: 'warmup',
            externalLoadKg: 40,
            reps: 10,
            completedAt: t1,
          },
          testDb,
        ),
        appendSet(
          {
            id: setTwoId,
            sessionId: sessionOneId,
            sessionExerciseId: sessionExOneId,
            kind: 'working',
            externalLoadKg: 80,
            reps: 8,
            completedAt: t2,
          },
          testDb,
        ),
      ])

      expect([first.ordinal, second.ordinal].sort()).toEqual([1, 2])
      expect(await testDb.setLogs.count()).toBe(2)
    })

    it('validates session and sessionExercise parent references on appendSet and updateSet', async () => {
      // Missing session
      await expect(
        appendSet(
          {
            sessionId: missingUuid,
            sessionExerciseId: sessionExOneId,
            ordinal: 1,
            kind: 'working',
            externalLoadKg: 80,
            reps: 8,
            completedAt: t1,
          },
          testDb,
        ),
      ).rejects.toThrow(ParentReferenceError)

      // Missing sessionExercise
      await expect(
        appendSet(
          {
            sessionId: sessionOneId,
            sessionExerciseId: missingUuid,
            ordinal: 1,
            kind: 'working',
            externalLoadKg: 80,
            reps: 8,
            completedAt: t1,
          },
          testDb,
        ),
      ).rejects.toThrow(ParentReferenceError)

      // Mismatched sessionId vs sessionExercise.sessionId
      await finishSession(sessionOneId, { endedAt: t1 }, testDb)
      await startSession(null, { id: sessionTwoId, startedAt: t2 }, testDb)
      await expect(
        appendSet(
          {
            sessionId: sessionTwoId,
            sessionExerciseId: sessionExOneId,
            ordinal: 1,
            kind: 'working',
            externalLoadKg: 80,
            reps: 8,
            completedAt: t2,
          },
          testDb,
        ),
      ).rejects.toThrow(ParentReferenceError)

      // Appending to completed sessionOneId fails with InvalidSessionStateError
      await expect(
        appendSet(
          {
            sessionId: sessionOneId,
            sessionExerciseId: sessionExOneId,
            ordinal: 1,
            kind: 'working',
            externalLoadKg: 80,
            reps: 8,
            completedAt: t2,
          },
          testDb,
        ),
      ).rejects.toThrow(InvalidSessionStateError)

      expect(await testDb.setLogs.count()).toBe(0)
    })

    it('updates and deletes sets while preventing ordinal collisions', async () => {
      const first = await appendSet(
        {
          id: setOneId,
          sessionId: sessionOneId,
          sessionExerciseId: sessionExOneId,
          ordinal: 1,
          kind: 'working',
          externalLoadKg: 80,
          reps: 8,
          completedAt: t1,
        },
        testDb,
      )
      const second = await appendSet(
        {
          id: setTwoId,
          sessionId: sessionOneId,
          sessionExerciseId: sessionExOneId,
          ordinal: 2,
          kind: 'working',
          externalLoadKg: 80,
          reps: 7,
          completedAt: t2,
        },
        testDb,
      )

      const updated = await updateSet(
        { ...second, reps: 8, feedback: 'normal', repsInReserve: 2 },
        testDb,
      )
      expect(updated.reps).toBe(8)
      expect(updated.repsInReserve).toBe(2)

      // Colliding ordinal 2 -> 1 rejected without mutating row
      await expect(
        updateSet({ ...second, ordinal: first.ordinal }, testDb),
      ).rejects.toThrow(DuplicateSetOrdinalError)

      await deleteSet(first.id, testDb)
      expect(await testDb.setLogs.count()).toBe(1)
      await expect(deleteSet(first.id, testDb)).rejects.toThrow(
        RecordNotFoundError,
      )
    })

    it('returns working sets from the most recent completed session for an exercise', async () => {
      // Session 1: 1 warmup + 2 working sets on bench press, then completed.
      await appendSet(
        {
          sessionId: sessionOneId,
          sessionExerciseId: sessionExOneId,
          ordinal: 1,
          kind: 'warmup',
          externalLoadKg: 50,
          reps: 10,
          completedAt: t1,
        },
        testDb,
      )
      await appendSet(
        {
          id: setOneId,
          sessionId: sessionOneId,
          sessionExerciseId: sessionExOneId,
          ordinal: 2,
          kind: 'working',
          externalLoadKg: 80,
          reps: 8,
          completedAt: t1,
        },
        testDb,
      )
      await appendSet(
        {
          id: setTwoId,
          sessionId: sessionOneId,
          sessionExerciseId: sessionExOneId,
          ordinal: 3,
          kind: 'working',
          externalLoadKg: 80,
          reps: 8,
          completedAt: t2,
        },
        testDb,
      )
      await finishSession(sessionOneId, { endedAt: t2 }, testDb)

      // Session 2: active session with a new set; getLastCompletedWorkingSets(..., sessionTwoId) ignores Session 2.
      await startSession(null, { id: sessionTwoId, startedAt: t3 }, testDb)
      const secondSessionExercise: SessionExercise = await addSessionExercise(
        {
          sessionId: sessionTwoId,
          exerciseId: benchExercise.id,
          exerciseNameSnapshot: benchExercise.name,
          equipmentSnapshot: benchExercise.equipment,
          order: 0,
          targetSets: 3,
          targetRepMin: 6,
          targetRepMax: 8,
          restSeconds: 120,
        },
        testDb,
      )
      await appendSet(
        {
          sessionId: sessionTwoId,
          sessionExerciseId: secondSessionExercise.id,
          ordinal: 1,
          kind: 'working',
          externalLoadKg: 82.5,
          reps: 6,
          completedAt: t3,
        },
        testDb,
      )

      const previousWorkingSets = await getLastCompletedWorkingSets(
        benchExercise.id,
        sessionTwoId,
        testDb,
      )
      expect(previousWorkingSets.map((set) => set.id)).toEqual([
        setOneId,
        setTwoId,
      ])
    })
  })

  describe('Habits and habit logs repository', () => {
    it('upserts habit logs per (habitId, localDate, slotId) without duplicating rows', async () => {
      await saveHabitDefinition(sampleHabit, testDb)

      const firstTap = await upsertHabitLog(
        {
          id: setOneId,
          habitId,
          slotId: morningSlotId,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
          status: 'done',
          occurredAt: t0,
          quantity: 1,
        },
        testDb,
      )
      expect(firstTap.id).toBe(setOneId)

      // Repeated tap / toggle on the same day and slot updates the existing row ID.
      const secondTap = await upsertHabitLog(
        {
          id: setTwoId,
          habitId,
          slotId: morningSlotId,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
          status: 'skipped',
          occurredAt: t1,
        },
        testDb,
      )
      expect(secondTap.id).toBe(setOneId)
      expect(secondTap.status).toBe('skipped')

      // Evening slot on the same day is independent.
      const eveningLog = await upsertHabitLog(
        {
          habitId,
          slotId: eveningSlotId,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
          status: 'done',
          occurredAt: t2,
        },
        testDb,
      )
      expect(eveningLog.id).not.toBe(setOneId)

      const dayLogs = await listHabitLogsForDay('2026-10-27', testDb)
      expect(dayLogs).toHaveLength(2)
      expect(dayLogs.map((log) => [log.slotId, log.status])).toEqual([
        [morningSlotId, 'skipped'],
        [eveningSlotId, 'done'],
      ])

      await deleteHabitLog(firstTap.id, testDb)
      expect(await listHabitLogsForDay('2026-10-27', testDb)).toHaveLength(1)
    })

    it('rejects habit logs for missing habits, unknown slots, or strict duplicate inserts', async () => {
      await expect(
        upsertHabitLog(
          {
            habitId: missingUuid,
            slotId: morningSlotId,
            localDate: '2026-10-27',
            timeZone: 'Europe/Vienna',
            status: 'done',
            occurredAt: t0,
          },
          testDb,
        ),
      ).rejects.toThrow(ParentReferenceError)

      await saveHabitDefinition(sampleHabit, testDb)
      expect((await getHabitDefinitionById(habitId, testDb))?.name).toBe(
        sampleHabit.name,
      )

      await expect(
        upsertHabitLog(
          {
            habitId,
            slotId: missingUuid,
            localDate: '2026-10-27',
            timeZone: 'Europe/Vienna',
            status: 'done',
            occurredAt: t0,
          },
          testDb,
        ),
      ).rejects.toThrow(ParentReferenceError)

      await insertHabitLog(
        {
          id: setOneId,
          habitId,
          slotId: morningSlotId,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
          status: 'done',
          occurredAt: t0,
        },
        testDb,
      )

      await expect(
        insertHabitLog(
          {
            id: setTwoId,
            habitId,
            slotId: morningSlotId,
            localDate: '2026-10-27',
            timeZone: 'Europe/Vienna',
            status: 'done',
            occurredAt: t1,
          },
          testDb,
        ),
      ).rejects.toThrow(DuplicateHabitSlotLogError)

      // Archiving a habit hides it from default list while keeping historical logs.
      await saveHabitDefinition(
        { ...sampleHabit, archived: true, updatedAt: t2 },
        testDb,
      )
      expect(await listHabitDefinitions(undefined, testDb)).toHaveLength(0)
      expect(
        await listHabitDefinitions({ includeArchived: true }, testDb),
      ).toHaveLength(1)
      expect(await listHabitLogsForDay('2026-10-27', testDb)).toHaveLength(1)
    })
  })

  describe('Body-weight, exercise overrides/restrictions, and settings repositories', () => {
    it('saves, queries by localDate range, and deletes body-weight entries', async () => {
      const first = await saveBodyWeight(
        {
          id: setOneId,
          weightKg: 78.2,
          occurredAt: t0,
          localDate: '2026-10-26',
          timeZone: 'Europe/Vienna',
        },
        testDb,
      )
      await saveBodyWeight(
        {
          id: setTwoId,
          weightKg: 77.9,
          occurredAt: t1,
          localDate: '2026-10-27',
          timeZone: 'Europe/Vienna',
          note: 'Post-warmup',
        },
        testDb,
      )

      expect((await getBodyWeightById(first.id, testDb))?.weightKg).toBe(78.2)
      expect((await listBodyWeights(testDb)).map((entry) => entry.id)).toEqual([
        setTwoId,
        setOneId,
      ])

      const range = await listBodyWeightsForDateRange(
        '2026-10-27',
        '2026-10-27',
        testDb,
      )
      expect(range.map((entry) => entry.id)).toEqual([setTwoId])

      await expect(
        listBodyWeightsForDateRange('2026-10-28', '2026-10-27', testDb),
      ).rejects.toThrow(RangeError)

      await deleteBodyWeight(first.id, testDb)
      expect(await listBodyWeights(testDb)).toHaveLength(1)
    })

    it('collates static catalog with user overrides and explicit restrictions without inferring safety', async () => {
      const knownCatalogIds = new Set(sampleCatalog.map((item) => item.id))

      await saveExerciseOverride(
        {
          exerciseId: benchExercise.id,
          favorite: true,
          customName: 'Paused Bench Press',
          userNotes: 'Grip ring finger on mark',
          updatedAt: t0,
        },
        { knownCatalogIds, database: testDb },
      )
      await saveExerciseRestriction(
        {
          exerciseId: rowExercise.id,
          status: 'excluded',
          note: 'Avoid heavy unilateral loading right now',
          updatedAt: t0,
        },
        { knownCatalogIds, database: testDb },
      )
      await saveMusclePreference(
        {
          muscleGroup: 'chest',
          priority: 'priority',
          updatedAt: t0,
        },
        testDb,
      )

      expect(await listExerciseOverrides(testDb)).toHaveLength(1)
      expect(await listExerciseRestrictions(testDb)).toHaveLength(1)
      expect(await listMusclePreferences(testDb)).toHaveLength(1)

      const bench = await getExerciseById(
        benchExercise.id,
        sampleCatalog,
        testDb,
      )
      expect(bench?.displayName).toBe('Paused Bench Press')
      expect(bench?.favorite).toBe(true)
      // Unknown restriction status remains undefined, never silently marked 'allowed'.
      expect(bench?.restriction).toBeUndefined()

      const defaultPickerList = await getExercises(
        { catalog: sampleCatalog, includeExcluded: false },
        testDb,
      )
      expect(defaultPickerList.map((item) => item.id)).toEqual([
        benchExercise.id,
        pullupExercise.id,
      ])

      const bodyweightOnly = await getExercises(
        { catalog: sampleCatalog, equipment: null },
        testDb,
      )
      expect(bodyweightOnly.map((item) => item.id)).toEqual([pullupExercise.id])

      await expect(
        saveExerciseRestriction(
          {
            exerciseId: 'fedb:Unknown_Exercise',
            status: 'caution',
            updatedAt: t0,
          },
          { knownCatalogIds, database: testDb },
        ),
      ).rejects.toThrow(ParentReferenceError)

      await deleteExerciseRestriction(rowExercise.id, testDb)
      expect(await listExerciseRestrictions(testDb)).toHaveLength(0)
    })

    it('rejects AppSettings restTimer referencing a missing session and supports bound repository factory', async () => {
      const repos = createRepositories(testDb, sampleCatalog)

      await expect(
        repos.settings.saveAppSettings({
          id: 'singleton',
          preferredMassUnit: 'kg',
          catalogVersion: 'fedb-v1',
          restTimer: { sessionId: missingUuid, endsAt: t2 },
        }),
      ).rejects.toThrow(ParentReferenceError)

      const saved = await repos.settings.saveAppSettings({
        id: 'singleton',
        preferredMassUnit: 'kg',
        catalogVersion: 'fedb-v1',
      })
      expect(saved.catalogVersion).toBe('fedb-v1')
      expect(await repos.exercises.getExercises()).toHaveLength(3)
    })
  })
})
