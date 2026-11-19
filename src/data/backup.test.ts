import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BackupRestoreConfirmationError,
  type BackupSnapshot,
  BackupValidationError,
  createBackupFilename,
  exportSnapshot,
  restoreSnapshotValidated,
  SUPPORTED_BACKUP_SCHEMA_VERSION,
  validateSnapshot,
} from './backup'
import { createDatabase, type PersonalTrackerDB } from './db'
import {
  appendSet,
  finishSession,
  saveAppSettings,
  saveBodyWeight,
  saveExerciseOverride,
  saveExerciseRestriction,
  saveHabitDefinition,
  saveMusclePreference,
  saveRoutine,
  startSession,
  upsertHabitLog,
} from './repositories'

const routineId = '11111111-1111-4111-8111-111111111111'
const routineItemId = '11111111-1111-4111-8111-111111111112'
const sessionId = '22222222-2222-4222-8222-222222222221'
const secondSessionId = '22222222-2222-4222-8222-222222222222'
const sessionExerciseId = '33333333-3333-4333-8333-333333333331'
const setLogId = '44444444-4444-4444-8444-444444444441'
const secondSetLogId = '44444444-4444-4444-8444-444444444442'
const bodyWeightId = '55555555-5555-4555-8555-555555555551'
const habitId = '66666666-6666-4666-8666-666666666661'
const morningSlotId = '66666666-6666-4666-8666-666666666662'
const habitLogId = '77777777-7777-4777-8777-777777777771'
const secondHabitLogId = '77777777-7777-4777-8777-777777777772'
const orphanUuid = '99999999-9999-4999-8999-999999999999'

const t0 = '2026-10-26T08:00:00.000Z'
const t1 = '2026-10-26T08:15:00.000Z'
const t2 = '2026-10-26T08:45:00.000Z'
const t3 = '2026-10-26T12:00:00.000Z'

const fullConfirmation = {
  currentSnapshotDownloaded: true,
  safetyBackupAcknowledged: true,
  replaceAllConfirmed: true,
} as const

async function seedFullDatabase(database: PersonalTrackerDB): Promise<void> {
  await saveRoutine(
    {
      id: routineId,
      name: 'Full Body A',
      items: [
        {
          id: routineItemId,
          exerciseId: 'fedb:Barbell_Squat',
          order: 0,
          workingSets: 3,
          repMin: 5,
          repMax: 8,
          restSeconds: 150,
        },
      ],
      createdAt: t0,
      updatedAt: t0,
    },
    database,
  )

  await startSession(
    routineId,
    {
      id: sessionId,
      startedAt: t1,
      exercises: [
        {
          id: sessionExerciseId,
          exerciseId: 'fedb:Barbell_Squat',
          exerciseNameSnapshot: 'Legacy Squat Label',
          equipmentSnapshot: 'barbell',
          order: 0,
          targetSets: 3,
          targetRepMin: 5,
          targetRepMax: 8,
          restSeconds: 150,
        },
      ],
    },
    database,
  )

  await appendSet(
    {
      id: setLogId,
      sessionId,
      sessionExerciseId,
      ordinal: 1,
      kind: 'working',
      externalLoadKg: 100,
      reps: 6,
      repsInReserve: 2,
      feedback: 'normal',
      completedAt: t1,
    },
    database,
  )

  await finishSession(
    sessionId,
    { endedAt: t2, note: 'Solid session' },
    database,
  )

  await saveExerciseOverride(
    {
      exerciseId: 'fedb:Barbell_Squat',
      favorite: true,
      customName: 'High-Bar Squat',
      userNotes: 'Keep torso upright',
      updatedAt: t2,
    },
    database,
  )

  await saveExerciseRestriction(
    {
      exerciseId: 'fedb:Upright_Row',
      status: 'caution',
      note: 'User-entered shoulder note',
      updatedAt: t2,
    },
    database,
  )

  await saveMusclePreference(
    {
      muscleGroup: 'quadriceps',
      priority: 'priority',
      updatedAt: t2,
    },
    database,
  )

  await saveBodyWeight(
    {
      id: bodyWeightId,
      weightKg: 79.4,
      occurredAt: t0,
      localDate: '2026-10-26',
      timeZone: 'Europe/Vienna',
      note: 'Morning weigh-in',
    },
    database,
  )

  await saveHabitDefinition(
    {
      id: habitId,
      name: 'Topical routine',
      slots: [{ id: morningSlotId, label: 'Morning', localTime: '08:00' }],
      quantityLabel: 'ml',
      archived: false,
      createdAt: t0,
      updatedAt: t0,
    },
    database,
  )

  await upsertHabitLog(
    {
      id: habitLogId,
      habitId,
      slotId: morningSlotId,
      localDate: '2026-10-26',
      timeZone: 'Europe/Vienna',
      status: 'done',
      occurredAt: t0,
      quantity: 1,
    },
    database,
  )

  await saveAppSettings(
    {
      id: 'singleton',
      preferredMassUnit: 'kg',
      catalogVersion: 'fedb-commit-v1',
    },
    database,
  )
}

describe('Backup export, validation, preview, and transactional restore', () => {
  let sourceDb: PersonalTrackerDB
  let targetDb: PersonalTrackerDB

  beforeEach(() => {
    sourceDb = createDatabase(`backup-source-${crypto.randomUUID()}`)
    targetDb = createDatabase(`backup-target-${crypto.randomUUID()}`)
  })

  afterEach(async () => {
    await sourceDb.delete()
    await targetDb.delete()
  })

  it('exports a versioned snapshot and round-trips all 11 tables preserving IDs and historical snapshots', async () => {
    await seedFullDatabase(sourceDb)

    const snapshot = await exportSnapshot({ exportedAt: t3 }, sourceDb)
    expect(snapshot.format).toBe(BACKUP_FORMAT)
    expect(snapshot.schemaVersion).toBe(SUPPORTED_BACKUP_SCHEMA_VERSION)
    expect(snapshot.exportedAt).toBe(t3)
    expect(snapshot.catalogVersion).toBe('fedb-commit-v1')
    expect(snapshot.data.settings[0]?.lastExportedAt).toBe(t3)
    expect(createBackupFilename(t3)).toBe(
      'personal-tracker-backup-2026-10-26T12-00-00Z.json',
    )

    const serialized = JSON.stringify(snapshot)
    const blob = new Blob([serialized], { type: 'application/json' })
    const validated = await validateSnapshot(blob, { database: targetDb })

    expect(validated.preview.totalRecords).toBe(11)
    expect(validated.preview.replacesExistingData).toBe(false)
    expect(validated.preview.existingRecordCount).toBe(0)
    expect(validated.preview.dateRange).toEqual({
      earliest: t0,
      latest: t3,
    })

    // Simulate restoring into an environment with a newer catalog version;
    // historical exerciseNameSnapshot must remain untouched.
    const snapshotWithOlderCatalog: BackupSnapshot = {
      ...validated.snapshot,
      catalogVersion: 'fedb-older-commit',
    }

    const restorePreview = await restoreSnapshotValidated(
      snapshotWithOlderCatalog,
      fullConfirmation,
      targetDb,
    )
    expect(restorePreview.totalRecords).toBe(11)

    const targetExport = await exportSnapshot(
      { exportedAt: t3, updateLastExportedAt: false },
      targetDb,
    )
    expect(targetExport.data).toEqual(snapshot.data)
    expect(targetExport.data.sessionExercises[0]?.exerciseNameSnapshot).toBe(
      'Legacy Squat Label',
    )
  })

  it('replaces all existing records during restore without merging or leaving stale rows', async () => {
    await seedFullDatabase(sourceDb)
    const cleanSnapshot = await exportSnapshot({ exportedAt: t3 }, sourceDb)

    // Seed targetDb with an extra body-weight entry that is not in cleanSnapshot.
    await saveBodyWeight(
      {
        id: orphanUuid,
        weightKg: 85,
        occurredAt: t1,
        localDate: '2026-10-26',
        timeZone: 'Europe/Vienna',
      },
      targetDb,
    )

    const { preview } = await validateSnapshot(JSON.stringify(cleanSnapshot), {
      database: targetDb,
    })
    expect(preview.replacesExistingData).toBe(true)
    expect(preview.existingRecordCount).toBe(1)

    await restoreSnapshotValidated(cleanSnapshot, fullConfirmation, targetDb)

    expect(await targetDb.bodyWeights.get(orphanUuid)).toBeUndefined()
    expect(await targetDb.bodyWeights.get(bodyWeightId)).toBeDefined()
  })

  it('rejects corrupt, empty, oversized, unknown-format, and future-version backups without mutating DB', async () => {
    await seedFullDatabase(targetDb)
    const beforeSnapshot = await exportSnapshot(
      { exportedAt: t3, updateLastExportedAt: false },
      targetDb,
    )

    await expect(
      validateSnapshot('', { database: targetDb }),
    ).rejects.toMatchObject({
      code: 'BACKUP_EMPTY',
    })

    await expect(
      validateSnapshot(new Blob(['   ']), { database: targetDb }),
    ).rejects.toMatchObject({
      code: 'BACKUP_EMPTY',
    })

    await expect(
      validateSnapshot(JSON.stringify(beforeSnapshot), {
        maxBytes: 32,
        database: targetDb,
      }),
    ).rejects.toMatchObject({
      code: 'BACKUP_TOO_LARGE',
    })

    await expect(
      validateSnapshot('{corrupt json', { database: targetDb }),
    ).rejects.toMatchObject({
      code: 'INVALID_JSON',
    })

    await expect(
      validateSnapshot(
        JSON.stringify({ ...beforeSnapshot, format: 'other-app' }),
        { database: targetDb },
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    })

    await expect(
      validateSnapshot(
        JSON.stringify({ ...beforeSnapshot, schemaVersion: 2 }),
        { database: targetDb },
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
    })

    await expect(
      validateSnapshot(
        JSON.stringify({ ...beforeSnapshot, extraTopLevelField: true }),
        { database: targetDb },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_SCHEMA',
    })

    const afterSnapshot = await exportSnapshot(
      { exportedAt: t3, updateLastExportedAt: false },
      targetDb,
    )
    expect(afterSnapshot.data).toEqual(beforeSnapshot.data)
  })

  it('rejects duplicate IDs, multiple active sessions, duplicate compound indexes, and orphan references', async () => {
    await seedFullDatabase(sourceDb)
    const valid = await exportSnapshot(
      { exportedAt: t3, updateLastExportedAt: false },
      sourceDb,
    )

    // 1. Duplicate primary key
    const duplicateRoutineId: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        routines: [valid.data.routines[0]!, valid.data.routines[0]!],
      },
    }
    await expect(validateSnapshot(duplicateRoutineId)).rejects.toMatchObject({
      code: 'DUPLICATE_KEY',
    })

    // 2. Multiple active sessions
    const twoActiveSessions: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        sessions: [
          {
            id: sessionId,
            routineId: null,
            status: 'active',
            startedAt: t0,
          },
          {
            id: secondSessionId,
            routineId: null,
            status: 'active',
            startedAt: t1,
          },
        ],
      },
    }
    await expect(validateSnapshot(twoActiveSessions)).rejects.toMatchObject({
      code: 'MULTIPLE_ACTIVE_SESSIONS',
    })

    // 3. Duplicate [sessionExerciseId+ordinal] on setLogs
    const duplicateSetOrdinal: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        setLogs: [
          valid.data.setLogs[0]!,
          {
            ...valid.data.setLogs[0]!,
            id: secondSetLogId,
          },
        ],
      },
    }
    await expect(validateSnapshot(duplicateSetOrdinal)).rejects.toMatchObject({
      code: 'DUPLICATE_INDEX_KEY',
    })

    // 4. Duplicate [habitId+localDate+slotId] on habitLogs
    const duplicateHabitSlot: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        habitLogs: [
          valid.data.habitLogs[0]!,
          {
            ...valid.data.habitLogs[0]!,
            id: secondHabitLogId,
          },
        ],
      },
    }
    await expect(validateSnapshot(duplicateHabitSlot)).rejects.toMatchObject({
      code: 'DUPLICATE_INDEX_KEY',
    })

    // 5. Orphan SessionExercise referencing missing session
    const orphanSessionExercise: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        sessionExercises: [
          {
            ...valid.data.sessionExercises[0]!,
            sessionId: orphanUuid,
          },
        ],
      },
    }
    await expect(validateSnapshot(orphanSessionExercise)).rejects.toMatchObject(
      {
        code: 'ORPHAN_REFERENCE',
      },
    )

    // 6. Orphan SetLog referencing missing sessionExercise
    const orphanSetLog: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        setLogs: [
          {
            ...valid.data.setLogs[0]!,
            sessionExerciseId: orphanUuid,
          },
        ],
      },
    }
    await expect(validateSnapshot(orphanSetLog)).rejects.toMatchObject({
      code: 'ORPHAN_REFERENCE',
    })

    // 7. Orphan HabitLog referencing missing slotId on habit
    const orphanHabitSlot: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        habitLogs: [
          {
            ...valid.data.habitLogs[0]!,
            slotId: orphanUuid,
          },
        ],
      },
    }
    await expect(validateSnapshot(orphanHabitSlot)).rejects.toMatchObject({
      code: 'ORPHAN_REFERENCE',
    })

    // 8. Settings restTimer referencing completed session
    const invalidRestTimer: BackupSnapshot = {
      ...valid,
      data: {
        ...valid.data,
        settings: [
          {
            ...valid.data.settings[0]!,
            restTimer: { sessionId, endsAt: t3 },
          },
        ],
      },
    }
    await expect(validateSnapshot(invalidRestTimer)).rejects.toMatchObject({
      code: 'ORPHAN_REFERENCE',
    })
  })

  it('requires explicit pre-restore download, safety acknowledgement, and replace confirmation', async () => {
    await seedFullDatabase(sourceDb)
    const snapshot = await exportSnapshot({ exportedAt: t3 }, sourceDb)

    await expect(
      restoreSnapshotValidated(
        snapshot,
        {
          currentSnapshotDownloaded: false,
          safetyBackupAcknowledged: true,
          replaceAllConfirmed: true,
        },
        targetDb,
      ),
    ).rejects.toThrow(BackupRestoreConfirmationError)

    await expect(
      restoreSnapshotValidated(
        snapshot,
        {
          currentSnapshotDownloaded: true,
          safetyBackupAcknowledged: false,
          replaceAllConfirmed: true,
        },
        targetDb,
      ),
    ).rejects.toThrow(BackupRestoreConfirmationError)

    await expect(
      restoreSnapshotValidated(
        snapshot,
        {
          currentSnapshotDownloaded: true,
          safetyBackupAcknowledged: true,
          replaceAllConfirmed: false,
        },
        targetDb,
      ),
    ).rejects.toThrow(BackupRestoreConfirmationError)
  })

  it('rolls back all 11 tables when a restore transaction is interrupted mid-flight', async () => {
    await seedFullDatabase(targetDb)
    const originalSnapshot = await exportSnapshot(
      { exportedAt: t3, updateLastExportedAt: false },
      targetDb,
    )

    // Create a distinct valid replacement backup in sourceDb.
    await saveBodyWeight(
      {
        id: orphanUuid,
        weightKg: 91.5,
        occurredAt: t2,
        localDate: '2026-10-26',
        timeZone: 'Europe/Vienna',
      },
      sourceDb,
    )
    const replacementSnapshot = await exportSnapshot(
      { exportedAt: t3 },
      sourceDb,
    )

    await expect(
      restoreSnapshotValidated(replacementSnapshot, fullConfirmation, {
        database: targetDb,
        onBeforeWriteTable: (tableName) => {
          if (tableName === 'settings') {
            throw new BackupValidationError(
              'INVALID_SCHEMA',
              'Simulated failure after clearing and writing 10 tables.',
            )
          }
        },
      }),
    ).rejects.toThrow('Simulated failure after clearing and writing 10 tables.')

    // Verify every original table record in targetDb was rolled back intact.
    const afterFailedRestore = await exportSnapshot(
      { exportedAt: t3, updateLastExportedAt: false },
      targetDb,
    )
    expect(afterFailedRestore.data).toEqual(originalSnapshot.data)
    expect(await targetDb.bodyWeights.get(orphanUuid)).toBeUndefined()
  })
})
