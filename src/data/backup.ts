import { z } from 'zod'
import type {
  AppSettings,
  BodyWeightEntry,
  ExerciseOverride,
  ExerciseRestriction,
  HabitDefinition,
  HabitLog,
  MusclePreference,
  Routine,
  SessionExercise,
  SetLog,
  UTCISOString,
  WorkoutSession,
} from '../domain/models'
import { toUTCISOString } from '../domain/time'
import { db, DB_SCHEMA_VERSION, PersonalTrackerDB } from './db'
import { SEEDED_CATALOG_VERSION } from './seed'
import {
  appSettingsSchema,
  bodyWeightEntrySchema,
  exerciseOverrideSchema,
  exerciseRestrictionSchema,
  habitDefinitionSchema,
  habitLogSchema,
  musclePreferenceSchema,
  nonBlankTextSchema,
  routineSchema,
  sessionExerciseSchema,
  setLogSchema,
  utcISOStringSchema,
  workoutSessionSchema,
} from './validation'

export const BACKUP_FORMAT = 'personal-tracker-backup' as const
export const SUPPORTED_BACKUP_SCHEMA_VERSION = DB_SCHEMA_VERSION
export const DEFAULT_CATALOG_VERSION = SEEDED_CATALOG_VERSION
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

export type BackupErrorCode =
  | 'BACKUP_EMPTY'
  | 'BACKUP_TOO_LARGE'
  | 'INVALID_JSON'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_SCHEMA'
  | 'DUPLICATE_KEY'
  | 'DUPLICATE_INDEX_KEY'
  | 'MULTIPLE_ACTIVE_SESSIONS'
  | 'ORPHAN_REFERENCE'

export class BackupValidationError extends Error {
  readonly code: BackupErrorCode
  readonly details?: string[]

  constructor(code: BackupErrorCode, message: string, details?: string[]) {
    super(message)
    this.name = 'BackupValidationError'
    this.code = code
    this.details = details
  }
}

export class BackupRestoreConfirmationError extends Error {
  readonly code = 'RESTORE_CONFIRMATION_REQUIRED' as const

  constructor(message: string) {
    super(message)
    this.name = 'BackupRestoreConfirmationError'
  }
}

export interface BackupData {
  routines: Routine[]
  sessions: WorkoutSession[]
  sessionExercises: SessionExercise[]
  setLogs: SetLog[]
  exerciseOverrides: ExerciseOverride[]
  restrictions: ExerciseRestriction[]
  musclePreferences: MusclePreference[]
  bodyWeights: BodyWeightEntry[]
  habits: HabitDefinition[]
  habitLogs: HabitLog[]
  settings: AppSettings[]
}

export interface BackupSnapshot {
  format: typeof BACKUP_FORMAT
  schemaVersion: typeof SUPPORTED_BACKUP_SCHEMA_VERSION
  exportedAt: UTCISOString
  catalogVersion: string
  data: BackupData
}

export interface BackupTableCounts {
  routines: number
  sessions: number
  sessionExercises: number
  setLogs: number
  exerciseOverrides: number
  restrictions: number
  musclePreferences: number
  bodyWeights: number
  habits: number
  habitLogs: number
  settings: number
}

export interface BackupPreview {
  schemaVersion: number
  catalogVersion: string
  exportedAt: UTCISOString
  counts: BackupTableCounts
  totalRecords: number
  dateRange: {
    earliest: UTCISOString | null
    latest: UTCISOString | null
  }
  replacesExistingData: boolean
  existingRecordCount: number
}

export interface ValidatedBackupResult {
  snapshot: BackupSnapshot
  preview: BackupPreview
}

export interface ValidateSnapshotOptions {
  maxBytes?: number
  database?: PersonalTrackerDB
}

export interface ExportSnapshotOptions {
  exportedAt?: UTCISOString
  catalogVersion?: string
  updateLastExportedAt?: boolean
}

export interface RestoreConfirmation {
  replaceAllConfirmed: boolean
  currentSnapshotDownloaded: boolean
  safetyBackupAcknowledged: boolean
}

export interface RestoreSnapshotOptions {
  database?: PersonalTrackerDB
  onBeforeWriteTable?: (tableName: keyof BackupData) => void | Promise<void>
}

export const backupDataSchema = z.strictObject({
  routines: z.array(routineSchema),
  sessions: z.array(workoutSessionSchema),
  sessionExercises: z.array(sessionExerciseSchema),
  setLogs: z.array(setLogSchema),
  exerciseOverrides: z.array(exerciseOverrideSchema),
  restrictions: z.array(exerciseRestrictionSchema),
  musclePreferences: z.array(musclePreferenceSchema),
  bodyWeights: z.array(bodyWeightEntrySchema),
  habits: z.array(habitDefinitionSchema),
  habitLogs: z.array(habitLogSchema),
  settings: z.array(appSettingsSchema).max(1),
})

export const backupSnapshotSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal(SUPPORTED_BACKUP_SCHEMA_VERSION),
  exportedAt: utcISOStringSchema,
  catalogVersion: nonBlankTextSchema,
  data: backupDataSchema,
})

function assertUniqueKeys<T>(
  rows: readonly T[],
  tableLabel: string,
  getKey: (row: T) => string,
  errorCode: 'DUPLICATE_KEY' | 'DUPLICATE_INDEX_KEY' = 'DUPLICATE_KEY',
): Set<string> {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = getKey(row)
    if (seen.has(key)) {
      throw new BackupValidationError(
        errorCode,
        `Backup contains duplicate ${tableLabel} key "${key}".`,
      )
    }
    seen.add(key)
  }
  return seen
}

function assertSemanticIntegrity(snapshot: BackupSnapshot): void {
  const { data } = snapshot

  assertUniqueKeys(data.routines, 'routine id', (row) => row.id)
  const sessionIds = assertUniqueKeys(
    data.sessions,
    'session id',
    (row) => row.id,
  )
  assertUniqueKeys(data.sessionExercises, 'sessionExercise id', (row) => row.id)
  assertUniqueKeys(data.setLogs, 'setLog id', (row) => row.id)
  assertUniqueKeys(
    data.exerciseOverrides,
    'exerciseOverride exerciseId',
    (row) => row.exerciseId,
  )
  assertUniqueKeys(
    data.restrictions,
    'restriction exerciseId',
    (row) => row.exerciseId,
  )
  assertUniqueKeys(
    data.musclePreferences,
    'musclePreference muscleGroup',
    (row) => row.muscleGroup,
  )
  assertUniqueKeys(data.bodyWeights, 'bodyWeight id', (row) => row.id)
  assertUniqueKeys(data.habits, 'habit id', (row) => row.id)
  assertUniqueKeys(data.habitLogs, 'habitLog id', (row) => row.id)
  assertUniqueKeys(data.settings, 'settings id', (row) => row.id)

  const activeSessions = data.sessions.filter(
    (session) => session.status === 'active',
  )
  if (activeSessions.length > 1) {
    throw new BackupValidationError(
      'MULTIPLE_ACTIVE_SESSIONS',
      'Backup contains more than one active workout session.',
    )
  }

  assertUniqueKeys(
    data.sessionExercises,
    'sessionExercise [sessionId+order]',
    (row) => `${row.sessionId}:${row.order}`,
    'DUPLICATE_INDEX_KEY',
  )
  assertUniqueKeys(
    data.setLogs,
    'setLog [sessionExerciseId+ordinal]',
    (row) => `${row.sessionExerciseId}:${row.ordinal}`,
    'DUPLICATE_INDEX_KEY',
  )
  assertUniqueKeys(
    data.habitLogs,
    'habitLog [habitId+localDate+slotId]',
    (row) => `${row.habitId}:${row.localDate}:${row.slotId}`,
    'DUPLICATE_INDEX_KEY',
  )

  const sessionExerciseById = new Map<string, SessionExercise>()
  for (const sessionExercise of data.sessionExercises) {
    if (!sessionIds.has(sessionExercise.sessionId)) {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `SessionExercise "${sessionExercise.id}" references missing session "${sessionExercise.sessionId}".`,
      )
    }
    sessionExerciseById.set(sessionExercise.id, sessionExercise)
  }

  for (const setLog of data.setLogs) {
    if (!sessionIds.has(setLog.sessionId)) {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `SetLog "${setLog.id}" references missing session "${setLog.sessionId}".`,
      )
    }
    const parentExercise = sessionExerciseById.get(setLog.sessionExerciseId)
    if (!parentExercise) {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `SetLog "${setLog.id}" references missing sessionExercise "${setLog.sessionExerciseId}".`,
      )
    }
    if (parentExercise.sessionId !== setLog.sessionId) {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `SetLog "${setLog.id}" sessionId "${setLog.sessionId}" does not match sessionExercise sessionId "${parentExercise.sessionId}".`,
      )
    }
  }

  const habitById = new Map<string, HabitDefinition>(
    data.habits.map((habit) => [habit.id, habit]),
  )
  for (const habitLog of data.habitLogs) {
    const parentHabit = habitById.get(habitLog.habitId)
    if (!parentHabit) {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `HabitLog "${habitLog.id}" references missing habit "${habitLog.habitId}".`,
      )
    }
    if (!parentHabit.slots.some((slot) => slot.id === habitLog.slotId)) {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `HabitLog "${habitLog.id}" references missing slot "${habitLog.slotId}" on habit "${habitLog.habitId}".`,
      )
    }
  }

  const singletonSettings = data.settings[0]
  if (singletonSettings?.restTimer) {
    const timerSession = data.sessions.find(
      (session) => session.id === singletonSettings.restTimer?.sessionId,
    )
    if (!timerSession || timerSession.status !== 'active') {
      throw new BackupValidationError(
        'ORPHAN_REFERENCE',
        `Settings restTimer references missing or non-active session "${singletonSettings.restTimer.sessionId}".`,
      )
    }
  }
}

function collectTimestamps(data: BackupData): UTCISOString[] {
  const timestamps: UTCISOString[] = []

  for (const routine of data.routines) {
    timestamps.push(routine.createdAt, routine.updatedAt)
  }
  for (const session of data.sessions) {
    timestamps.push(session.startedAt)
    if (session.endedAt) timestamps.push(session.endedAt)
  }
  for (const setLog of data.setLogs) {
    timestamps.push(setLog.completedAt)
  }
  for (const override of data.exerciseOverrides) {
    timestamps.push(override.updatedAt)
  }
  for (const restriction of data.restrictions) {
    timestamps.push(restriction.updatedAt)
  }
  for (const preference of data.musclePreferences) {
    timestamps.push(preference.updatedAt)
  }
  for (const bodyWeight of data.bodyWeights) {
    timestamps.push(bodyWeight.occurredAt)
  }
  for (const habit of data.habits) {
    timestamps.push(habit.createdAt, habit.updatedAt)
  }
  for (const habitLog of data.habitLogs) {
    timestamps.push(habitLog.occurredAt)
  }
  for (const setting of data.settings) {
    if (setting.lastExportedAt) timestamps.push(setting.lastExportedAt)
  }

  return timestamps.sort()
}

export async function countDatabaseRecords(
  database: PersonalTrackerDB = db,
): Promise<number> {
  const counts = await database.transaction('r', database.tables, async () =>
    Promise.all(database.tables.map((table) => table.count())),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}

export function buildBackupPreview(
  snapshot: BackupSnapshot,
  existingRecordCount = 0,
): BackupPreview {
  const { data } = snapshot
  const counts: BackupTableCounts = {
    routines: data.routines.length,
    sessions: data.sessions.length,
    sessionExercises: data.sessionExercises.length,
    setLogs: data.setLogs.length,
    exerciseOverrides: data.exerciseOverrides.length,
    restrictions: data.restrictions.length,
    musclePreferences: data.musclePreferences.length,
    bodyWeights: data.bodyWeights.length,
    habits: data.habits.length,
    habitLogs: data.habitLogs.length,
    settings: data.settings.length,
  }
  const totalRecords = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  )
  const sortedTimestamps = collectTimestamps(data)

  return {
    schemaVersion: snapshot.schemaVersion,
    catalogVersion: snapshot.catalogVersion,
    exportedAt: snapshot.exportedAt,
    counts,
    totalRecords,
    dateRange: {
      earliest: sortedTimestamps[0] ?? null,
      latest: sortedTimestamps.at(-1) ?? null,
    },
    replacesExistingData: existingRecordCount > 0,
    existingRecordCount,
  }
}

export function validateSnapshotObject(raw: unknown): BackupSnapshot {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BackupValidationError(
      'UNSUPPORTED_FORMAT',
      'Backup must be a JSON object.',
    )
  }

  const envelope = raw as Record<string, unknown>
  if (envelope.format !== BACKUP_FORMAT) {
    throw new BackupValidationError(
      'UNSUPPORTED_FORMAT',
      `Unsupported backup format. Expected "${BACKUP_FORMAT}".`,
    )
  }

  if (
    typeof envelope.schemaVersion !== 'number' ||
    !Number.isInteger(envelope.schemaVersion) ||
    envelope.schemaVersion !== SUPPORTED_BACKUP_SCHEMA_VERSION
  ) {
    throw new BackupValidationError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported backup schema version "${String(envelope.schemaVersion)}". Supported version is ${SUPPORTED_BACKUP_SCHEMA_VERSION}.`,
    )
  }

  const parsed = backupSnapshotSchema.safeParse(raw)
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
    )
    throw new BackupValidationError(
      'INVALID_SCHEMA',
      `Backup failed schema validation: ${details[0] ?? 'invalid data'}.`,
      details,
    )
  }

  assertSemanticIntegrity(parsed.data)
  return parsed.data
}

async function readRawBackupText(
  input: string | Blob | ArrayBuffer | Uint8Array,
  maxBytes: number,
): Promise<string> {
  if (typeof input === 'string') {
    const byteLength = new TextEncoder().encode(input).byteLength
    if (byteLength === 0 || input.trim().length === 0) {
      throw new BackupValidationError('BACKUP_EMPTY', 'Backup file is empty.')
    }
    if (byteLength > maxBytes) {
      throw new BackupValidationError(
        'BACKUP_TOO_LARGE',
        `Backup exceeds the maximum allowed size of ${maxBytes} bytes.`,
      )
    }
    return input
  }

  if (input instanceof Blob) {
    if (input.size === 0) {
      throw new BackupValidationError('BACKUP_EMPTY', 'Backup file is empty.')
    }
    if (input.size > maxBytes) {
      throw new BackupValidationError(
        'BACKUP_TOO_LARGE',
        `Backup exceeds the maximum allowed size of ${maxBytes} bytes.`,
      )
    }
    const text = await input.text()
    if (text.trim().length === 0) {
      throw new BackupValidationError('BACKUP_EMPTY', 'Backup file is empty.')
    }
    return text
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength === 0) {
    throw new BackupValidationError('BACKUP_EMPTY', 'Backup file is empty.')
  }
  if (bytes.byteLength > maxBytes) {
    throw new BackupValidationError(
      'BACKUP_TOO_LARGE',
      `Backup exceeds the maximum allowed size of ${maxBytes} bytes.`,
    )
  }
  const text = new TextDecoder().decode(bytes)
  if (text.trim().length === 0) {
    throw new BackupValidationError('BACKUP_EMPTY', 'Backup file is empty.')
  }
  return text
}

export async function validateSnapshot(
  input: string | Blob | ArrayBuffer | Uint8Array | unknown,
  options?: ValidateSnapshotOptions,
): Promise<ValidatedBackupResult> {
  const maxBytes = options?.maxBytes ?? MAX_BACKUP_BYTES
  const database = options?.database ?? db

  let parsedJson: unknown = input
  if (
    typeof input === 'string' ||
    input instanceof Blob ||
    input instanceof ArrayBuffer ||
    input instanceof Uint8Array
  ) {
    const rawText = await readRawBackupText(input, maxBytes)
    try {
      parsedJson = JSON.parse(rawText)
    } catch {
      throw new BackupValidationError(
        'INVALID_JSON',
        'Backup file is not valid JSON.',
      )
    }
  }

  const snapshot = validateSnapshotObject(parsedJson)
  const existingRecordCount = await countDatabaseRecords(database)
  const preview = buildBackupPreview(snapshot, existingRecordCount)

  return { snapshot, preview }
}

export function createBackupFilename(exportedAt: UTCISOString): string {
  const safeTimestamp = exportedAt
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '-')
  return `personal-tracker-backup-${safeTimestamp}.json`
}

export async function exportSnapshot(
  options?: ExportSnapshotOptions,
  database: PersonalTrackerDB = db,
): Promise<BackupSnapshot> {
  const exportedAt = options?.exportedAt ?? toUTCISOString(new Date())
  const shouldUpdateSettings = options?.updateLastExportedAt ?? true

  return database.transaction('rw', database.tables, async () => {
    const existingSettings = await database.settings.get('singleton')
    const catalogVersion =
      options?.catalogVersion ??
      existingSettings?.catalogVersion ??
      DEFAULT_CATALOG_VERSION

    if (shouldUpdateSettings) {
      const updatedSettings: AppSettings = appSettingsSchema.parse({
        id: 'singleton',
        preferredMassUnit: 'kg',
        catalogVersion,
        ...(existingSettings?.restTimer !== undefined
          ? { restTimer: existingSettings.restTimer }
          : {}),
        ...(existingSettings?.promptWeightBeforeWorkout !== undefined
          ? {
              promptWeightBeforeWorkout:
                existingSettings.promptWeightBeforeWorkout,
            }
          : {}),
        ...(existingSettings?.preparationPreferences !== undefined
          ? {
              preparationPreferences: existingSettings.preparationPreferences,
            }
          : {}),
        lastExportedAt: exportedAt,
      })
      await database.settings.put(updatedSettings)
    }

    const [
      routines,
      sessions,
      sessionExercises,
      setLogs,
      exerciseOverrides,
      restrictions,
      musclePreferences,
      bodyWeights,
      habits,
      habitLogs,
      settings,
    ] = await Promise.all([
      database.routines.toArray(),
      database.sessions.toArray(),
      database.sessionExercises.toArray(),
      database.setLogs.toArray(),
      database.exerciseOverrides.toArray(),
      database.restrictions.toArray(),
      database.musclePreferences.toArray(),
      database.bodyWeights.toArray(),
      database.habits.toArray(),
      database.habitLogs.toArray(),
      database.settings.toArray(),
    ])

    const snapshot: BackupSnapshot = {
      format: BACKUP_FORMAT,
      schemaVersion: SUPPORTED_BACKUP_SCHEMA_VERSION,
      exportedAt,
      catalogVersion,
      data: {
        routines: routines
          .map((routine) => ({
            ...routine,
            items: [...routine.items].sort(
              (left, right) => left.order - right.order,
            ),
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        sessions: sessions.sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        sessionExercises: sessionExercises.sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        setLogs: setLogs.sort((left, right) => left.id.localeCompare(right.id)),
        exerciseOverrides: exerciseOverrides.sort((left, right) =>
          left.exerciseId.localeCompare(right.exerciseId),
        ),
        restrictions: restrictions.sort((left, right) =>
          left.exerciseId.localeCompare(right.exerciseId),
        ),
        musclePreferences: musclePreferences.sort((left, right) =>
          left.muscleGroup.localeCompare(right.muscleGroup),
        ),
        bodyWeights: bodyWeights.sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        habits: habits.sort((left, right) => left.id.localeCompare(right.id)),
        habitLogs: habitLogs.sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        settings,
      },
    }

    return validateSnapshotObject(snapshot)
  })
}

export async function restoreSnapshotValidated(
  snapshot: BackupSnapshot,
  confirmation: RestoreConfirmation,
  optionsOrDb?: RestoreSnapshotOptions | PersonalTrackerDB,
): Promise<BackupPreview> {
  if (!confirmation.currentSnapshotDownloaded) {
    throw new BackupRestoreConfirmationError(
      'Download a backup of current data before restoring.',
    )
  }
  if (!confirmation.safetyBackupAcknowledged) {
    throw new BackupRestoreConfirmationError(
      'Acknowledge the current data safety backup before restoring.',
    )
  }
  if (!confirmation.replaceAllConfirmed) {
    throw new BackupRestoreConfirmationError(
      'Explicit replace-all confirmation is required before restoring.',
    )
  }

  const options: RestoreSnapshotOptions =
    optionsOrDb instanceof PersonalTrackerDB
      ? { database: optionsOrDb }
      : (optionsOrDb ?? {})
  const database = options.database ?? db

  const validated = validateSnapshotObject(snapshot)
  const existingRecordCount = await countDatabaseRecords(database)

  await database.transaction('rw', database.tables, async () => {
    await Promise.all(database.tables.map((table) => table.clear()))

    const writeStep = async <T>(
      tableName: keyof BackupData,
      rows: readonly T[],
      write: (items: T[]) => Promise<unknown>,
    ) => {
      await options.onBeforeWriteTable?.(tableName)
      if (rows.length > 0) {
        await write([...rows])
      }
    }

    await writeStep('routines', validated.data.routines, (rows) =>
      database.routines.bulkAdd(rows),
    )
    await writeStep('sessions', validated.data.sessions, (rows) =>
      database.sessions.bulkAdd(rows),
    )
    await writeStep(
      'sessionExercises',
      validated.data.sessionExercises,
      (rows) => database.sessionExercises.bulkAdd(rows),
    )
    await writeStep('setLogs', validated.data.setLogs, (rows) =>
      database.setLogs.bulkAdd(rows),
    )
    await writeStep(
      'exerciseOverrides',
      validated.data.exerciseOverrides,
      (rows) => database.exerciseOverrides.bulkAdd(rows),
    )
    await writeStep('restrictions', validated.data.restrictions, (rows) =>
      database.restrictions.bulkAdd(rows),
    )
    await writeStep(
      'musclePreferences',
      validated.data.musclePreferences,
      (rows) => database.musclePreferences.bulkAdd(rows),
    )
    await writeStep('bodyWeights', validated.data.bodyWeights, (rows) =>
      database.bodyWeights.bulkAdd(rows),
    )
    await writeStep('habits', validated.data.habits, (rows) =>
      database.habits.bulkAdd(rows),
    )
    await writeStep('habitLogs', validated.data.habitLogs, (rows) =>
      database.habitLogs.bulkAdd(rows),
    )
    await writeStep('settings', validated.data.settings, (rows) =>
      database.settings.bulkAdd(rows),
    )
  })

  return buildBackupPreview(validated, existingRecordCount)
}
