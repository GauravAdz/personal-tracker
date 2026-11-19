import type { ID, SetLog } from './models'

export type ProgressionStatus =
  | 'eligible_to_increase'
  | 'repeat_load_or_adjust_reps'
  | 'review_exercise'
  | 'no_suggestion'

export interface ProgressionSetObservation {
  kind?: SetLog['kind']
  externalLoadKg: number | null
  reps: number
  repsInReserve?: number
  feedback?: SetLog['feedback']
  exerciseId?: ID
  equipment?: string | null
}

export interface ProgressionEvaluationInput {
  targetSets: number
  targetRepMin: number
  targetRepMax: number
  exerciseId?: ID
  equipment?: string | null
  previousExerciseId?: ID
  previousEquipment?: string | null
  previousTargetSets?: number
  previousSets: readonly ProgressionSetObservation[]
  currentSets?: readonly ProgressionSetObservation[]
  currentFeedback?: SetLog['feedback']
  currentRepsInReserve?: number
}

export interface ProgressionResult {
  status: ProgressionStatus
  reason: string
  referenceLoadKg: number | null
}

const PROGRESSION_BADGE_LABELS: Record<ProgressionStatus, string> = {
  eligible_to_increase: 'Eligible to increase load',
  repeat_load_or_adjust_reps: 'Repeat load or adjust reps',
  review_exercise: 'Review exercise',
  no_suggestion: 'No suggestion',
}

/** Formats a progression status as a human-readable badge label. */
export function formatProgressionBadgeLabel(status: ProgressionStatus): string {
  return PROGRESSION_BADGE_LABELS[status]
}

function isValidTargetRange(
  targetSets: number,
  targetRepMin: number,
  targetRepMax: number,
): boolean {
  return (
    Number.isInteger(targetSets) &&
    targetSets >= 1 &&
    Number.isInteger(targetRepMin) &&
    targetRepMin >= 1 &&
    Number.isInteger(targetRepMax) &&
    targetRepMax >= targetRepMin
  )
}

function isValidRir(rir: number | undefined): boolean {
  return rir === undefined || (Number.isFinite(rir) && rir >= 0 && rir <= 10)
}

function isValidSetObservation(set: ProgressionSetObservation): boolean {
  const validReps = Number.isInteger(set.reps) && set.reps >= 1
  const validLoad =
    set.externalLoadKg === null ||
    (Number.isFinite(set.externalLoadKg) && set.externalLoadKg >= 0)
  return validReps && validLoad && isValidRir(set.repsInReserve)
}

/**
 * Deterministically evaluates double-progression eligibility from the previous
 * completed session's working sets, target rep bounds, and current feedback/RIR.
 * Never assigns an exact next load or infers injury-safe substitutions.
 */
export function evaluateProgression(
  input: ProgressionEvaluationInput,
): ProgressionResult {
  const {
    targetSets,
    targetRepMin,
    targetRepMax,
    exerciseId,
    equipment,
    previousExerciseId,
    previousEquipment,
    previousTargetSets,
    previousSets,
    currentSets,
    currentFeedback,
    currentRepsInReserve,
  } = input

  if (!isValidTargetRange(targetSets, targetRepMin, targetRepMax)) {
    return {
      status: 'no_suggestion',
      reason: 'Missing comparison: invalid target set or rep range.',
      referenceLoadKg: null,
    }
  }

  if (
    currentFeedback === 'discomfort' ||
    currentSets?.some((set) => set.feedback === 'discomfort')
  ) {
    return {
      status: 'review_exercise',
      reason:
        'Discomfort reported — review exercise before progressing; no load recommendation.',
      referenceLoadKg: null,
    }
  }

  if (!isValidRir(currentRepsInReserve)) {
    return {
      status: 'no_suggestion',
      reason: 'Missing comparison: invalid RIR value.',
      referenceLoadKg: null,
    }
  }

  if (
    exerciseId !== undefined &&
    ((previousExerciseId !== undefined && previousExerciseId !== exerciseId) ||
      previousSets.some(
        (set) => set.exerciseId !== undefined && set.exerciseId !== exerciseId,
      ))
  ) {
    return {
      status: 'no_suggestion',
      reason:
        'Missing comparison: previous sets belong to a different exercise.',
      referenceLoadKg: null,
    }
  }

  if (
    equipment !== undefined &&
    ((previousEquipment !== undefined && previousEquipment !== equipment) ||
      previousSets.some(
        (set) => set.equipment !== undefined && set.equipment !== equipment,
      ))
  ) {
    return {
      status: 'no_suggestion',
      reason: 'Missing comparison: equipment changed since previous session.',
      referenceLoadKg: null,
    }
  }

  const workingSets = previousSets.filter(
    (set) => set.kind === undefined || set.kind === 'working',
  )

  if (workingSets.length === 0) {
    return {
      status: 'no_suggestion',
      reason:
        'Missing comparison: no previous completed working sets recorded.',
      referenceLoadKg: null,
    }
  }

  if (workingSets.some((set) => set.feedback === 'discomfort')) {
    return {
      status: 'review_exercise',
      reason:
        'Discomfort reported on previous working sets — review exercise; no load recommendation.',
      referenceLoadKg: null,
    }
  }

  if (!workingSets.every(isValidSetObservation)) {
    return {
      status: 'no_suggestion',
      reason: 'Missing comparison: invalid previous set data.',
      referenceLoadKg: null,
    }
  }

  if (previousTargetSets !== undefined && previousTargetSets !== targetSets) {
    return {
      status: 'no_suggestion',
      reason: `Missing comparison: non-comparable target set count (${previousTargetSets} vs ${targetSets}).`,
      referenceLoadKg: null,
    }
  }

  if (workingSets.length !== targetSets) {
    return {
      status: 'no_suggestion',
      reason: `Missing comparison: non-comparable set count (${workingSets.length} previous working ${workingSets.length === 1 ? 'set' : 'sets'} vs target of ${targetSets}).`,
      referenceLoadKg: null,
    }
  }

  if (workingSets.every((set) => set.externalLoadKg === null)) {
    return {
      status: 'no_suggestion',
      reason:
        'Missing comparison: bodyweight / null load sets have no external load recorded.',
      referenceLoadKg: null,
    }
  }

  if (workingSets.some((set) => set.externalLoadKg === null)) {
    return {
      status: 'no_suggestion',
      reason:
        'Missing comparison: inconsistent loads (mix of bodyweight and external load).',
      referenceLoadKg: null,
    }
  }

  const referenceLoadKg = workingSets[0]!.externalLoadKg as number
  if (workingSets.some((set) => set.externalLoadKg !== referenceLoadKg)) {
    return {
      status: 'no_suggestion',
      reason:
        'Missing comparison: inconsistent external loads across previous working sets.',
      referenceLoadKg: null,
    }
  }

  const allMetRepMax = workingSets.every((set) => set.reps >= targetRepMax)
  const hasZeroRir =
    workingSets.some(
      (set) => set.repsInReserve !== undefined && set.repsInReserve <= 0,
    ) ||
    (currentRepsInReserve !== undefined && currentRepsInReserve <= 0) ||
    (currentSets?.some(
      (set) =>
        (set.kind === undefined || set.kind === 'working') &&
        set.repsInReserve !== undefined &&
        set.repsInReserve <= 0,
    ) ??
      false)

  if (allMetRepMax && !hasZeroRir) {
    return {
      status: 'eligible_to_increase',
      reason: `All ${workingSets.length} sets met ${targetRepMax} reps at ${referenceLoadKg} kg — eligible to increase load.`,
      referenceLoadKg,
    }
  }

  if (allMetRepMax && hasZeroRir) {
    return {
      status: 'repeat_load_or_adjust_reps',
      reason: `All ${workingSets.length} sets met ${targetRepMax} reps at ${referenceLoadKg} kg, but 0 RIR was reported — repeat ${referenceLoadKg} kg or adjust reps.`,
      referenceLoadKg,
    }
  }

  const metCount = workingSets.filter((set) => set.reps >= targetRepMax).length
  const repsList = workingSets.map((set) => set.reps).join(', ')
  return {
    status: 'repeat_load_or_adjust_reps',
    reason: `${metCount} of ${workingSets.length} sets met ${targetRepMax} reps (${repsList} at ${referenceLoadKg} kg) — repeat ${referenceLoadKg} kg or build toward ${targetRepMin}–${targetRepMax} reps.`,
    referenceLoadKg,
  }
}
