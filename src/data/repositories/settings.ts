import type { AppSettings, PreparationPreferences } from '../../domain/models'
import { db, PersonalTrackerDB } from '../db'
import { SEEDED_CATALOG_VERSION } from '../seed'
import { appSettingsSchema, preparationPreferencesSchema } from '../validation'
import { ParentReferenceError } from './errors'

export const MAX_PREPARATION_LABEL_LENGTH = 100
export const MAX_PREPARATION_NOTE_LENGTH = 300

export async function getAppSettings(
  database: PersonalTrackerDB = db,
): Promise<AppSettings | undefined> {
  return database.settings.get('singleton')
}

export async function saveAppSettings(
  settings: AppSettings,
  database: PersonalTrackerDB = db,
): Promise<AppSettings> {
  const parsed = appSettingsSchema.parse(settings)

  return database.transaction(
    'rw',
    [database.sessions, database.settings],
    async () => {
      if (parsed.restTimer) {
        const session = await database.sessions.get(parsed.restTimer.sessionId)
        if (!session || session.status !== 'active') {
          throw new ParentReferenceError(
            'AppSettings',
            'restTimer.sessionId',
            parsed.restTimer.sessionId,
            `Rest timer references missing or non-active session ${parsed.restTimer.sessionId}.`,
          )
        }
      }

      await database.settings.put(parsed)
      return parsed
    },
  )
}

export async function setPromptWeightBeforeWorkout(
  enabled: boolean,
  database: PersonalTrackerDB = db,
): Promise<AppSettings> {
  return database.transaction(
    'rw',
    [database.sessions, database.settings],
    async () => {
      const existing = await database.settings.get('singleton')
      const next = appSettingsSchema.parse({
        id: 'singleton',
        preferredMassUnit: 'kg',
        catalogVersion: existing?.catalogVersion ?? SEEDED_CATALOG_VERSION,
        ...(existing?.lastExportedAt !== undefined
          ? { lastExportedAt: existing.lastExportedAt }
          : {}),
        ...(existing?.restTimer !== undefined
          ? { restTimer: existing.restTimer }
          : {}),
        ...(existing?.preparationPreferences !== undefined
          ? { preparationPreferences: existing.preparationPreferences }
          : {}),
        promptWeightBeforeWorkout: enabled,
      })
      await database.settings.put(next)
      return next
    },
  )
}

export async function savePreparationPreferences(
  preferences: PreparationPreferences,
  database: PersonalTrackerDB = db,
): Promise<AppSettings> {
  const parsedPrefs = preparationPreferencesSchema.parse(preferences)
  for (const step of parsedPrefs.steps) {
    if (step.label.length > MAX_PREPARATION_LABEL_LENGTH) {
      throw new RangeError(
        `Preparation step label must be at most ${MAX_PREPARATION_LABEL_LENGTH} characters.`,
      )
    }
    if (
      step.note !== undefined &&
      step.note.length > MAX_PREPARATION_NOTE_LENGTH
    ) {
      throw new RangeError(
        `Preparation step note must be at most ${MAX_PREPARATION_NOTE_LENGTH} characters.`,
      )
    }
  }

  return database.transaction(
    'rw',
    [database.sessions, database.settings],
    async () => {
      const existing = await database.settings.get('singleton')
      const next = appSettingsSchema.parse({
        id: 'singleton',
        preferredMassUnit: 'kg',
        catalogVersion: existing?.catalogVersion ?? SEEDED_CATALOG_VERSION,
        ...(existing?.lastExportedAt !== undefined
          ? { lastExportedAt: existing.lastExportedAt }
          : {}),
        ...(existing?.restTimer !== undefined
          ? { restTimer: existing.restTimer }
          : {}),
        ...(existing?.promptWeightBeforeWorkout !== undefined
          ? { promptWeightBeforeWorkout: existing.promptWeightBeforeWorkout }
          : {}),
        preparationPreferences: parsedPrefs,
      })
      await database.settings.put(next)
      return next
    },
  )
}

export function createSettingsRepository(database: PersonalTrackerDB = db) {
  return {
    getAppSettings: () => getAppSettings(database),
    saveAppSettings: (settings: AppSettings) =>
      saveAppSettings(settings, database),
    setPromptWeightBeforeWorkout: (enabled: boolean) =>
      setPromptWeightBeforeWorkout(enabled, database),
    savePreparationPreferences: (preferences: PreparationPreferences) =>
      savePreparationPreferences(preferences, database),
  }
}
