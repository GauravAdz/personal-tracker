import Dexie, { type DexieOptions, type Table } from 'dexie'
import type {
  AppSettings,
  BodyWeightEntry,
  ExerciseOverride,
  ExerciseRestriction,
  HabitDefinition,
  HabitLog,
  ID,
  MusclePreference,
  Routine,
  SessionExercise,
  SetLog,
  WorkoutSession,
} from '../domain/models'

export const DB_NAME = 'personal-tracker'
export const DB_SCHEMA_VERSION = 1

export const V1_STORE_DEFINITIONS = {
  routines: 'id, updatedAt, name',
  sessions: 'id, status, startedAt, endedAt',
  sessionExercises: 'id, sessionId, [sessionId+order], exerciseId',
  setLogs:
    'id, sessionId, sessionExerciseId, &[sessionExerciseId+ordinal], completedAt',
  exerciseOverrides: 'exerciseId, updatedAt',
  restrictions: 'exerciseId, status',
  musclePreferences: 'muscleGroup, priority',
  bodyWeights: 'id, localDate, occurredAt',
  habits: 'id, updatedAt, archived',
  habitLogs: 'id, habitId, &[habitId+localDate+slotId], localDate, occurredAt',
  settings: 'id',
} as const

export class PersonalTrackerDB extends Dexie {
  routines!: Table<Routine, ID>
  sessions!: Table<WorkoutSession, ID>
  sessionExercises!: Table<SessionExercise, ID>
  setLogs!: Table<SetLog, ID>
  exerciseOverrides!: Table<ExerciseOverride, ID>
  restrictions!: Table<ExerciseRestriction, ID>
  musclePreferences!: Table<MusclePreference, string>
  bodyWeights!: Table<BodyWeightEntry, ID>
  habits!: Table<HabitDefinition, ID>
  habitLogs!: Table<HabitLog, ID>
  settings!: Table<AppSettings, AppSettings['id']>

  constructor(name = DB_NAME, options?: DexieOptions) {
    super(name, {
      ...(typeof globalThis.indexedDB !== 'undefined'
        ? { indexedDB: globalThis.indexedDB }
        : {}),
      ...(typeof globalThis.IDBKeyRange !== 'undefined'
        ? { IDBKeyRange: globalThis.IDBKeyRange }
        : {}),
      ...options,
    })
    this.version(DB_SCHEMA_VERSION).stores(V1_STORE_DEFINITIONS)
  }
}

export function createDatabase(
  name = DB_NAME,
  options?: DexieOptions,
): PersonalTrackerDB {
  return new PersonalTrackerDB(name, options)
}

export const db = createDatabase()
