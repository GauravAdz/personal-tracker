export type ID = string
export type UTCISOString = string
export type LocalDate = string
export type IANATimeZone = string

export interface CatalogExercise {
  id: ID
  sourceId: string
  name: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
  equipment: string | null
  instructions: string[]
  category: string
  imagePaths: string[]
}

export interface ExerciseOverride {
  exerciseId: ID
  favorite: boolean
  userNotes?: string
  customName?: string
  updatedAt: UTCISOString
}

export interface ExerciseRestriction {
  exerciseId: ID
  status: 'allowed' | 'caution' | 'excluded'
  note?: string
  updatedAt: UTCISOString
}

export interface MusclePreference {
  muscleGroup: string
  priority: 'priority' | 'normal' | 'deprioritized'
  updatedAt: UTCISOString
}

export interface RoutineExercise {
  id: ID
  exerciseId: ID
  order: number
  workingSets: number
  repMin: number
  repMax: number
  restSeconds: number
}

export interface Routine {
  id: ID
  name: string
  items: RoutineExercise[]
  createdAt: UTCISOString
  updatedAt: UTCISOString
}

export interface WorkoutSession {
  id: ID
  routineId: ID | null
  status: 'active' | 'completed' | 'cancelled'
  startedAt: UTCISOString
  endedAt?: UTCISOString
  note?: string
}

export interface SessionExercise {
  id: ID
  sessionId: ID
  exerciseId: ID
  exerciseNameSnapshot: string
  equipmentSnapshot: string | null
  order: number
  targetSets: number
  targetRepMin: number
  targetRepMax: number
  restSeconds: number
}

export interface SetLog {
  id: ID
  sessionId: ID
  sessionExerciseId: ID
  ordinal: number
  kind: 'warmup' | 'working'
  externalLoadKg: number | null
  reps: number
  repsInReserve?: number
  feedback?: 'easy' | 'normal' | 'hard' | 'discomfort'
  completedAt: UTCISOString
}

export interface BodyWeightEntry {
  id: ID
  weightKg: number
  occurredAt: UTCISOString
  localDate: LocalDate
  timeZone: IANATimeZone
  note?: string
}

export interface HabitSlot {
  id: ID
  label: string
  localTime?: string
}

export interface HabitDefinition {
  id: ID
  name: string
  slots: HabitSlot[]
  quantityLabel?: string
  archived: boolean
  createdAt: UTCISOString
  updatedAt: UTCISOString
}

export interface HabitLog {
  id: ID
  habitId: ID
  slotId: ID
  localDate: LocalDate
  timeZone: IANATimeZone
  status: 'done' | 'skipped'
  occurredAt: UTCISOString
  quantity?: number
}

export interface PreparationStep {
  id: ID
  phase: 'warmup' | 'cooldown'
  label: string
  durationSeconds: number
  note?: string
}

export interface PreparationPreferences {
  steps: PreparationStep[]
}

export interface AppSettings {
  id: 'singleton'
  preferredMassUnit: 'kg'
  lastExportedAt?: UTCISOString
  restTimer?: { sessionId: ID; endsAt: UTCISOString }
  promptWeightBeforeWorkout?: boolean
  preparationPreferences?: PreparationPreferences
  catalogVersion: string
}
