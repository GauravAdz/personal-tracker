import type { CatalogExercise } from '../../domain/models'
import { db, type PersonalTrackerDB } from '../db'
import { EXERCISE_CATALOG } from '../seed'
import { createBodyWeightRepository } from './bodyWeight'
import { createExerciseRepository } from './exercises'
import { createHabitRepository } from './habits'
import { createRoutineRepository } from './routines'
import { createSessionRepository } from './sessions'
import { createSettingsRepository } from './settings'

export * from '../backup'
export * from '../seed'
export * from './bodyWeight'
export * from './errors'
export * from './exercises'
export * from './habits'
export * from './routines'
export * from './sessions'
export * from './settings'

export function createRepositories(
  database: PersonalTrackerDB = db,
  defaultCatalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
) {
  return {
    routines: createRoutineRepository(database),
    sessions: createSessionRepository(database),
    habits: createHabitRepository(database),
    bodyWeights: createBodyWeightRepository(database),
    exercises: createExerciseRepository(database, defaultCatalog),
    settings: createSettingsRepository(database),
  }
}
