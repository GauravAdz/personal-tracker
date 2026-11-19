import type {
  CatalogExercise,
  ExerciseRestriction,
  ID,
  MusclePreference,
  RoutineExercise,
} from './models'

export type EffectiveRestrictionStatus =
  ExerciseRestriction['status'] | 'unreviewed'

export type EffectiveMusclePriority = MusclePreference['priority']

export interface RoutineRestrictionAuditItem {
  routineItemId: ID
  exerciseId: ID
  order: number
  status: EffectiveRestrictionStatus
  note?: string
}

export interface RoutineRestrictionAudit {
  canStartRoutine: boolean
  excludedItems: RoutineRestrictionAuditItem[]
  cautionItems: RoutineRestrictionAuditItem[]
  items: RoutineRestrictionAuditItem[]
}

function lookupRestriction(
  exerciseId: ID,
  restrictionsByExerciseId:
    | ReadonlyMap<ID, ExerciseRestriction>
    | Record<ID, ExerciseRestriction | undefined>,
): ExerciseRestriction | undefined {
  if (restrictionsByExerciseId instanceof Map) {
    return restrictionsByExerciseId.get(exerciseId)
  }
  return (
    restrictionsByExerciseId as Record<ID, ExerciseRestriction | undefined>
  )[exerciseId]
}

function lookupMusclePreference(
  muscleGroup: string,
  preferencesByMuscle:
    | ReadonlyMap<string, MusclePreference>
    | Record<string, MusclePreference | undefined>,
): MusclePreference | undefined {
  const key = muscleGroup.trim().toLowerCase()
  if (preferencesByMuscle instanceof Map) {
    return preferencesByMuscle.get(key) ?? preferencesByMuscle.get(muscleGroup)
  }
  const record = preferencesByMuscle as Record<
    string,
    MusclePreference | undefined
  >
  return record[key] ?? record[muscleGroup]
}

export function getEffectiveRestrictionStatus(
  restriction: ExerciseRestriction | undefined,
): EffectiveRestrictionStatus {
  return restriction ? restriction.status : 'unreviewed'
}

export function formatRestrictionBadgeLabel(
  restriction: ExerciseRestriction | undefined,
): string {
  const status = getEffectiveRestrictionStatus(restriction)
  switch (status) {
    case 'excluded':
      return 'Excluded'
    case 'caution':
      return 'Caution'
    case 'allowed':
      return 'User-marked: Allowed'
    case 'unreviewed':
      return 'Unreviewed (status not set)'
  }
}

export function isExerciseSelectableInPicker(
  restriction: ExerciseRestriction | undefined,
  options?: { includeExcluded?: boolean },
): boolean {
  if (options?.includeExcluded) return true
  return getEffectiveRestrictionStatus(restriction) !== 'excluded'
}

export function auditRoutineRestrictions(
  routineItems: readonly RoutineExercise[],
  restrictionsByExerciseId:
    | ReadonlyMap<ID, ExerciseRestriction>
    | Record<ID, ExerciseRestriction | undefined>,
): RoutineRestrictionAudit {
  const sorted = [...routineItems].sort(
    (left, right) => left.order - right.order,
  )
  const items: RoutineRestrictionAuditItem[] = []
  const excludedItems: RoutineRestrictionAuditItem[] = []
  const cautionItems: RoutineRestrictionAuditItem[] = []

  for (const item of sorted) {
    const restriction = lookupRestriction(
      item.exerciseId,
      restrictionsByExerciseId,
    )
    const status = getEffectiveRestrictionStatus(restriction)
    const auditItem: RoutineRestrictionAuditItem = {
      routineItemId: item.id,
      exerciseId: item.exerciseId,
      order: item.order,
      status,
      ...(restriction?.note !== undefined && restriction.note.trim() !== ''
        ? { note: restriction.note }
        : {}),
    }
    items.push(auditItem)
    if (status === 'excluded') {
      excludedItems.push(auditItem)
    } else if (status === 'caution') {
      cautionItems.push(auditItem)
    }
  }

  return {
    canStartRoutine: excludedItems.length === 0,
    excludedItems,
    cautionItems,
    items,
  }
}

export function getMusclePriority(
  muscleGroup: string,
  preferencesByMuscle:
    | ReadonlyMap<string, MusclePreference>
    | Record<string, MusclePreference | undefined>,
): EffectiveMusclePriority {
  return (
    lookupMusclePreference(muscleGroup, preferencesByMuscle)?.priority ??
    'normal'
  )
}

export function doesExerciseMatchMusclePriority(
  exercise: Pick<CatalogExercise, 'primaryMuscles'>,
  targetPriority: EffectiveMusclePriority,
  preferencesByMuscle:
    | ReadonlyMap<string, MusclePreference>
    | Record<string, MusclePreference | undefined>,
): boolean {
  return exercise.primaryMuscles.some(
    (muscle) =>
      getMusclePriority(muscle, preferencesByMuscle) === targetPriority,
  )
}
