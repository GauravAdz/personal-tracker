import { useId, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  deleteExerciseRestriction,
  MAX_RESTRICTION_NOTE_LENGTH,
  saveExerciseRestriction,
  saveMusclePreference,
} from '../../data/repositories/exercises'
import type {
  ExerciseRestriction,
  ID,
  MusclePreference,
} from '../../domain/models'
import {
  type EffectiveMusclePriority,
  type EffectiveRestrictionStatus,
  formatRestrictionBadgeLabel,
  getEffectiveRestrictionStatus,
  getMusclePriority,
} from '../../domain/restrictions'

export interface RestrictionEditorProps {
  exerciseId: ID
  exerciseName: string
  restriction?: ExerciseRestriction
  knownCatalogIds?: ReadonlySet<ID>
  database?: PersonalTrackerDB
  now?: () => Date
  onSaved?: (status: EffectiveRestrictionStatus) => void | Promise<void>
}

export interface MusclePriorityEditorProps {
  muscleGroups: readonly string[]
  preferences: readonly MusclePreference[]
  database?: PersonalTrackerDB
  now?: () => Date
  onSaved?: () => void | Promise<void>
}

export function RestrictionEditor({
  exerciseId,
  exerciseName,
  restriction,
  knownCatalogIds,
  database = db,
  now = () => new Date(),
  onSaved,
}: RestrictionEditorProps) {
  const statusSelectId = useId()
  const noteInputId = useId()

  const [status, setStatus] = useState<EffectiveRestrictionStatus>(() =>
    getEffectiveRestrictionStatus(restriction),
  )
  const [note, setNote] = useState<string>(() => restriction?.note ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSaveRestriction = async () => {
    setIsSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      if (status === 'unreviewed') {
        await deleteExerciseRestriction(exerciseId, database)
        setNote('')
      } else {
        await saveExerciseRestriction(
          {
            exerciseId,
            status,
            ...(note.trim().length > 0 ? { note } : {}),
            updatedAt: now().toISOString(),
          },
          { knownCatalogIds, database },
        )
      }
      await onSaved?.(status)
      setStatusMessage(
        `Saved restriction for ${exerciseName}: ${
          status === 'unreviewed'
            ? 'Unreviewed (status not set)'
            : status === 'allowed'
              ? 'User-marked: Allowed'
              : status === 'caution'
                ? 'Caution'
                : 'Excluded'
        }.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not save exercise restriction.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      role="region"
      aria-label={`Personal restriction for ${exerciseName}`}
      className="space-y-3 border-t border-[var(--line)] pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Personal restriction status</h3>
        <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs font-medium">
          Current: {formatRestrictionBadgeLabel(restriction)}
        </span>
      </div>

      <p className="text-xs text-muted">
        Restrictions are user-managed. Unreviewed status does not imply medical
        approval or injury safety; this app provides no injury diagnoses or
        technique prescriptions.
      </p>

      <div>
        <label htmlFor={statusSelectId} className="block text-xs font-medium">
          Restriction status for {exerciseName}
        </label>
        <select
          id={statusSelectId}
          value={status}
          disabled={isSaving}
          onChange={(event) =>
            setStatus(event.target.value as EffectiveRestrictionStatus)
          }
          className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          <option value="unreviewed">Unreviewed (status not set)</option>
          <option value="allowed">Allowed (user-marked)</option>
          <option value="caution">Caution (show user note)</option>
          <option value="excluded">
            Excluded (hide from picker &amp; block workout start)
          </option>
        </select>
      </div>

      {status !== 'unreviewed' && (
        <div>
          <label htmlFor={noteInputId} className="block text-xs font-medium">
            Restriction note for {exerciseName} (user-entered)
          </label>
          <textarea
            id={noteInputId}
            rows={2}
            maxLength={MAX_RESTRICTION_NOTE_LENGTH}
            value={note}
            disabled={isSaving}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional personal reminder or treating professional's guidance…"
            className="mt-1 block w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
          />
          <span className="mt-1 block text-xs text-muted">
            {note.length} / {MAX_RESTRICTION_NOTE_LENGTH} characters
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void handleSaveRestriction()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
        >
          Save restriction
        </button>
      </div>

      {statusMessage && (
        <p role="status" className="text-xs font-medium text-[var(--accent)]">
          {statusMessage}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="text-xs font-medium">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

export function MusclePriorityEditor({
  muscleGroups,
  preferences,
  database = db,
  now = () => new Date(),
  onSaved,
}: MusclePriorityEditorProps) {
  const muscleSelectId = useId()
  const prioritySelectId = useId()

  const preferencesMap = new Map(
    preferences.map((pref) => [pref.muscleGroup.toLowerCase(), pref]),
  )

  const [selectedMuscle, setSelectedMuscle] = useState<string>(
    () => muscleGroups[0] ?? '',
  )
  const effectiveMuscle =
    selectedMuscle && muscleGroups.includes(selectedMuscle)
      ? selectedMuscle
      : (muscleGroups[0] ?? '')

  const [selectedPriority, setSelectedPriority] =
    useState<EffectiveMusclePriority>(() =>
      effectiveMuscle
        ? getMusclePriority(effectiveMuscle, preferencesMap)
        : 'normal',
    )
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const handleMuscleChange = (nextMuscle: string) => {
    setSelectedMuscle(nextMuscle)
    setSelectedPriority(getMusclePriority(nextMuscle, preferencesMap))
    setStatusMessage(null)
  }

  const handleSavePreference = async () => {
    if (!effectiveMuscle) return
    setIsSaving(true)
    setStatusMessage(null)
    try {
      await saveMusclePreference(
        {
          muscleGroup: effectiveMuscle,
          priority: selectedPriority,
          updatedAt: now().toISOString(),
        },
        database,
      )
      await onSaved?.()
      setStatusMessage(
        `Updated training priority for ${effectiveMuscle}: ${selectedPriority}.`,
      )
    } finally {
      setIsSaving(false)
    }
  }

  if (muscleGroups.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Muscle priority preferences"
      className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm"
    >
      <div>
        <h3 className="text-base font-semibold">
          Muscle-group training priorities
        </h3>
        <p className="mt-1 text-xs text-muted">
          Optional focus tags to filter the exercise library. These preferences
          inform search filters only and are not injury diagnoses.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={muscleSelectId} className="block text-xs font-medium">
            Muscle group
          </label>
          <select
            id={muscleSelectId}
            value={effectiveMuscle}
            onChange={(event) => handleMuscleChange(event.target.value)}
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {muscleGroups.map((muscle) => (
              <option key={muscle} value={muscle}>
                {muscle} ({getMusclePriority(muscle, preferencesMap)})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={prioritySelectId}
            className="block text-xs font-medium"
          >
            Priority level
          </label>
          <select
            id={prioritySelectId}
            value={selectedPriority}
            onChange={(event) =>
              setSelectedPriority(event.target.value as EffectiveMusclePriority)
            }
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="priority">Priority focus</option>
            <option value="normal">Normal</option>
            <option value="deprioritized">Deprioritized</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSavePreference()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            Save muscle priority
          </button>
        </div>
      </div>

      {statusMessage && (
        <p role="status" className="text-xs font-medium text-[var(--accent)]">
          {statusMessage}
        </p>
      )}
    </div>
  )
}
