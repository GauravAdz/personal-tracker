import { createId } from '../../domain/id'
import type { BodyWeightEntry, ID, LocalDate } from '../../domain/models'
import { db, PersonalTrackerDB } from '../db'
import {
  bodyWeightEntrySchema,
  type BodyWeightInput,
  idSchema,
  localDateSchema,
} from '../validation'
import { RecordNotFoundError } from './errors'

export const MAX_BODY_WEIGHT_NOTE_LENGTH = 300

export type SaveBodyWeightInput = BodyWeightInput & {
  id?: ID
}

export async function saveBodyWeight(
  input: SaveBodyWeightInput,
  database: PersonalTrackerDB = db,
): Promise<BodyWeightEntry> {
  const entry = bodyWeightEntrySchema.parse({
    ...input,
    id: input.id ?? createId(),
  })
  if (
    entry.note !== undefined &&
    entry.note.length > MAX_BODY_WEIGHT_NOTE_LENGTH
  ) {
    throw new RangeError(
      `Body-weight note must be at most ${MAX_BODY_WEIGHT_NOTE_LENGTH} characters.`,
    )
  }

  await database.transaction('rw', database.bodyWeights, async () => {
    await database.bodyWeights.put(entry)
  })
  return entry
}

export async function getBodyWeightById(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<BodyWeightEntry | undefined> {
  const validId = idSchema.parse(id)
  return database.bodyWeights.get(validId)
}

export async function listBodyWeights(
  database: PersonalTrackerDB = db,
): Promise<BodyWeightEntry[]> {
  const entries = await database.bodyWeights.toArray()
  return entries.sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) ||
      left.id.localeCompare(right.id),
  )
}

export async function listBodyWeightsForDateRange(
  startLocalDate: LocalDate,
  endLocalDate: LocalDate,
  database: PersonalTrackerDB = db,
): Promise<BodyWeightEntry[]> {
  const validStart = localDateSchema.parse(startLocalDate)
  const validEnd = localDateSchema.parse(endLocalDate)
  if (validEnd < validStart) {
    throw new RangeError('End localDate must not precede start localDate.')
  }

  const entries = await database.bodyWeights
    .where('localDate')
    .between(validStart, validEnd, true, true)
    .toArray()

  return entries.sort(
    (left, right) =>
      left.localDate.localeCompare(right.localDate) ||
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  )
}

export async function deleteBodyWeight(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  const validId = idSchema.parse(id)
  await database.transaction('rw', database.bodyWeights, async () => {
    const existing = await database.bodyWeights.get(validId)
    if (!existing) {
      throw new RecordNotFoundError('BodyWeightEntry', validId)
    }
    await database.bodyWeights.delete(validId)
  })
}

export function createBodyWeightRepository(database: PersonalTrackerDB = db) {
  return {
    saveBodyWeight: (input: SaveBodyWeightInput) =>
      saveBodyWeight(input, database),
    getBodyWeightById: (id: ID) => getBodyWeightById(id, database),
    listBodyWeights: () => listBodyWeights(database),
    listBodyWeightsForDateRange: (
      startLocalDate: LocalDate,
      endLocalDate: LocalDate,
    ) => listBodyWeightsForDateRange(startLocalDate, endLocalDate, database),
    deleteBodyWeight: (id: ID) => deleteBodyWeight(id, database),
  }
}
