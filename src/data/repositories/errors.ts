import type { ID, LocalDate, WorkoutSession } from '../../domain/models'

export class ActiveSessionConflictError extends Error {
  readonly code = 'ACTIVE_SESSION_CONFLICT' as const
  readonly existingSession: WorkoutSession
  readonly redirectToSessionId: ID

  constructor(existingSession: WorkoutSession) {
    super(`An active workout session (${existingSession.id}) already exists.`)
    this.name = 'ActiveSessionConflictError'
    this.existingSession = existingSession
    this.redirectToSessionId = existingSession.id
  }
}

export class ParentReferenceError extends Error {
  readonly code = 'PARENT_REFERENCE_INVALID' as const
  readonly entity: string
  readonly parentField: string
  readonly parentId: string

  constructor(
    entity: string,
    parentField: string,
    parentId: string,
    message?: string,
  ) {
    super(
      message ??
        `${entity} references a missing or invalid ${parentField} (${parentId}).`,
    )
    this.name = 'ParentReferenceError'
    this.entity = entity
    this.parentField = parentField
    this.parentId = parentId
  }
}

export class DuplicateSetOrdinalError extends Error {
  readonly code = 'DUPLICATE_SET_ORDINAL' as const
  readonly sessionExerciseId: ID
  readonly ordinal: number

  constructor(sessionExerciseId: ID, ordinal: number) {
    super(
      `Set ordinal ${ordinal} already exists for session exercise ${sessionExerciseId}.`,
    )
    this.name = 'DuplicateSetOrdinalError'
    this.sessionExerciseId = sessionExerciseId
    this.ordinal = ordinal
  }
}

export class DuplicateHabitSlotLogError extends Error {
  readonly code = 'DUPLICATE_HABIT_SLOT_LOG' as const
  readonly habitId: ID
  readonly localDate: LocalDate
  readonly slotId: ID

  constructor(habitId: ID, localDate: LocalDate, slotId: ID) {
    super(
      `Habit log already exists for habit ${habitId} on ${localDate} (slot ${slotId}).`,
    )
    this.name = 'DuplicateHabitSlotLogError'
    this.habitId = habitId
    this.localDate = localDate
    this.slotId = slotId
  }
}

export class RecordNotFoundError extends Error {
  readonly code = 'RECORD_NOT_FOUND' as const
  readonly entity: string
  readonly id: string

  constructor(entity: string, id: string) {
    super(`${entity} (${id}) was not found.`)
    this.name = 'RecordNotFoundError'
    this.entity = entity
    this.id = id
  }
}

export class InvalidSessionStateError extends Error {
  readonly code = 'INVALID_SESSION_STATE' as const
  readonly sessionId: ID
  readonly status: WorkoutSession['status']

  constructor(
    sessionId: ID,
    status: WorkoutSession['status'],
    message?: string,
  ) {
    super(
      message ??
        `Workout session ${sessionId} is ${status} and cannot perform this transition.`,
    )
    this.name = 'InvalidSessionStateError'
    this.sessionId = sessionId
    this.status = status
  }
}

export class ExcludedExerciseError extends Error {
  readonly code = 'EXCLUDED_EXERCISE' as const
  readonly exerciseId: ID
  readonly note?: string

  constructor(exerciseId: ID, note?: string) {
    super(
      `Exercise "${exerciseId}" is marked excluded and cannot enter a new workout without first removing or replacing it.`,
    )
    this.name = 'ExcludedExerciseError'
    this.exerciseId = exerciseId
    this.note = note
  }
}
