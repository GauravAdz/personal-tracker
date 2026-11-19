import { createId } from '../../domain/id'
import type {
  HabitDefinition,
  HabitLog,
  ID,
  LocalDate,
  UTCISOString,
} from '../../domain/models'
import { db, PersonalTrackerDB } from '../db'
import {
  habitDefinitionSchema,
  type HabitLogInput,
  habitLogInputSchema,
  habitLogSchema,
  idSchema,
  localDateSchema,
  utcISOStringSchema,
} from '../validation'
import {
  DuplicateHabitSlotLogError,
  ParentReferenceError,
  RecordNotFoundError,
} from './errors'

export const MAX_HABIT_NAME_LENGTH = 120
export const MAX_HABIT_SLOT_LABEL_LENGTH = 60
export const MAX_HABIT_QUANTITY_LABEL_LENGTH = 60

export type UpsertHabitLogInput = HabitLogInput & {
  id?: ID
}

function assertHabitTextBounds(habit: HabitDefinition): void {
  if (habit.name.length > MAX_HABIT_NAME_LENGTH) {
    throw new RangeError(
      `Habit name must be at most ${MAX_HABIT_NAME_LENGTH} characters.`,
    )
  }
  if (
    habit.quantityLabel !== undefined &&
    habit.quantityLabel.length > MAX_HABIT_QUANTITY_LABEL_LENGTH
  ) {
    throw new RangeError(
      `Quantity label must be at most ${MAX_HABIT_QUANTITY_LABEL_LENGTH} characters.`,
    )
  }
  for (const slot of habit.slots) {
    if (slot.label.length > MAX_HABIT_SLOT_LABEL_LENGTH) {
      throw new RangeError(
        `Slot label must be at most ${MAX_HABIT_SLOT_LABEL_LENGTH} characters.`,
      )
    }
  }
}

export async function saveHabitDefinition(
  habit: HabitDefinition,
  database: PersonalTrackerDB = db,
): Promise<HabitDefinition> {
  const parsed = habitDefinitionSchema.parse(habit)
  assertHabitTextBounds(parsed)

  await database.transaction(
    'rw',
    [database.habits, database.habitLogs],
    async () => {
      const slotIds = new Set(parsed.slots.map((slot) => slot.id))
      const existingLogs = await database.habitLogs
        .where('habitId')
        .equals(parsed.id)
        .toArray()
      if (existingLogs.some((log) => !slotIds.has(log.slotId))) {
        throw new Error(
          'Cannot remove a slot that already has logged history. Keep the slot or archive the habit instead.',
        )
      }
      await database.habits.put(parsed)
    },
  )
  return parsed
}

export async function archiveHabitDefinition(
  id: ID,
  archived: boolean,
  updatedAt: UTCISOString,
  database: PersonalTrackerDB = db,
): Promise<HabitDefinition> {
  const validId = idSchema.parse(id)
  const validUpdatedAt = utcISOStringSchema.parse(updatedAt)

  return database.transaction('rw', database.habits, async () => {
    const existing = await database.habits.get(validId)
    if (!existing) {
      throw new RecordNotFoundError('HabitDefinition', validId)
    }
    const updated = habitDefinitionSchema.parse({
      ...existing,
      archived,
      updatedAt: validUpdatedAt,
    })
    await database.habits.put(updated)
    return updated
  })
}

export async function getHabitDefinitionById(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<HabitDefinition | undefined> {
  const validId = idSchema.parse(id)
  return database.habits.get(validId)
}

export async function listHabitDefinitions(
  options?: { includeArchived?: boolean },
  database: PersonalTrackerDB = db,
): Promise<HabitDefinition[]> {
  const allHabits = await database.habits.toArray()
  const filtered = options?.includeArchived
    ? allHabits
    : allHabits.filter((habit) => !habit.archived)
  return filtered.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  )
}

async function assertHabitAndSlotExist(
  habitId: ID,
  slotId: ID,
  database: PersonalTrackerDB,
): Promise<void> {
  const habit = await database.habits.get(habitId)
  if (!habit) {
    throw new ParentReferenceError('HabitLog', 'habitId', habitId)
  }
  if (!habit.slots.some((slot) => slot.id === slotId)) {
    throw new ParentReferenceError(
      'HabitLog',
      'slotId',
      slotId,
      `Habit slot ${slotId} does not exist on habit ${habitId}.`,
    )
  }
}

export async function upsertHabitLog(
  input: UpsertHabitLogInput,
  database: PersonalTrackerDB = db,
): Promise<HabitLog> {
  const { id, ...rest } = input
  const parsedInput = habitLogInputSchema.parse(rest)
  const validOptionalId = id === undefined ? undefined : idSchema.parse(id)

  return database.transaction(
    'rw',
    [database.habits, database.habitLogs],
    async () => {
      await assertHabitAndSlotExist(
        parsedInput.habitId,
        parsedInput.slotId,
        database,
      )

      const existing = await database.habitLogs
        .where('[habitId+localDate+slotId]')
        .equals([
          parsedInput.habitId,
          parsedInput.localDate,
          parsedInput.slotId,
        ])
        .first()

      if (existing) {
        const updated = habitLogSchema.parse({
          ...parsedInput,
          id: existing.id,
        })
        await database.habitLogs.put(updated)
        return updated
      }

      const created = habitLogSchema.parse({
        ...parsedInput,
        id: validOptionalId ?? createId(),
      })
      await database.habitLogs.add(created)
      return created
    },
  )
}

export async function insertHabitLog(
  log: HabitLog,
  database: PersonalTrackerDB = db,
): Promise<HabitLog> {
  const parsed = habitLogSchema.parse(log)

  return database.transaction(
    'rw',
    [database.habits, database.habitLogs],
    async () => {
      await assertHabitAndSlotExist(parsed.habitId, parsed.slotId, database)

      const existing = await database.habitLogs
        .where('[habitId+localDate+slotId]')
        .equals([parsed.habitId, parsed.localDate, parsed.slotId])
        .first()

      if (existing) {
        throw new DuplicateHabitSlotLogError(
          parsed.habitId,
          parsed.localDate,
          parsed.slotId,
        )
      }

      await database.habitLogs.add(parsed)
      return parsed
    },
  )
}

export async function listHabitLogsForDay(
  localDate: LocalDate,
  database: PersonalTrackerDB = db,
): Promise<HabitLog[]> {
  const validDate = localDateSchema.parse(localDate)
  const logs = await database.habitLogs
    .where('localDate')
    .equals(validDate)
    .toArray()
  return logs.sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.habitId.localeCompare(right.habitId) ||
      left.slotId.localeCompare(right.slotId) ||
      left.id.localeCompare(right.id),
  )
}

export async function listHabitLogsForHabit(
  habitId: ID,
  database: PersonalTrackerDB = db,
): Promise<HabitLog[]> {
  const validHabitId = idSchema.parse(habitId)
  const logs = await database.habitLogs
    .where('habitId')
    .equals(validHabitId)
    .toArray()
  return logs.sort(
    (left, right) =>
      right.localDate.localeCompare(left.localDate) ||
      right.occurredAt.localeCompare(left.occurredAt) ||
      left.id.localeCompare(right.id),
  )
}

export async function deleteHabitLog(
  id: ID,
  database: PersonalTrackerDB = db,
): Promise<void> {
  const validId = idSchema.parse(id)
  await database.transaction('rw', database.habitLogs, async () => {
    const existing = await database.habitLogs.get(validId)
    if (!existing) {
      throw new RecordNotFoundError('HabitLog', validId)
    }
    await database.habitLogs.delete(validId)
  })
}

export function createHabitRepository(database: PersonalTrackerDB = db) {
  return {
    saveHabitDefinition: (habit: HabitDefinition) =>
      saveHabitDefinition(habit, database),
    archiveHabitDefinition: (
      id: ID,
      archived: boolean,
      updatedAt: UTCISOString,
    ) => archiveHabitDefinition(id, archived, updatedAt, database),
    getHabitDefinitionById: (id: ID) => getHabitDefinitionById(id, database),
    listHabitDefinitions: (options?: { includeArchived?: boolean }) =>
      listHabitDefinitions(options, database),
    upsertHabitLog: (input: UpsertHabitLogInput) =>
      upsertHabitLog(input, database),
    insertHabitLog: (log: HabitLog) => insertHabitLog(log, database),
    listHabitLogsForDay: (localDate: LocalDate) =>
      listHabitLogsForDay(localDate, database),
    listHabitLogsForHabit: (habitId: ID) =>
      listHabitLogsForHabit(habitId, database),
    deleteHabitLog: (id: ID) => deleteHabitLog(id, database),
  }
}
