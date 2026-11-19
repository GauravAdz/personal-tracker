import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  getExercises,
  type ResolvedExercise,
} from '../../data/repositories/exercises'
import {
  deleteRoutine,
  duplicateRoutine,
  listRoutines,
  MAX_ROUTINE_NAME_LENGTH,
  reorderRoutineItems,
  saveRoutine,
} from '../../data/repositories/routines'
import { EXERCISE_CATALOG } from '../../data/seed'
import { routineInputSchema } from '../../data/validation'
import { createId } from '../../domain/id'
import type {
  CatalogExercise,
  ExerciseRestriction,
  ID,
  Routine,
  RoutineExercise,
} from '../../domain/models'
import {
  auditRoutineRestrictions,
  formatRestrictionBadgeLabel,
} from '../../domain/restrictions'

const DEFAULT_WORKING_SETS = 3
const DEFAULT_REP_MIN = 8
const DEFAULT_REP_MAX = 12
const DEFAULT_REST_SECONDS = 120

interface DraftRoutineItem {
  id: ID
  exerciseId: ID
  workingSets: string
  repMin: string
  repMax: string
  restSeconds: string
}

export interface RoutineEditorProps {
  database?: PersonalTrackerDB
  catalog?: readonly CatalogExercise[]
  now?: () => Date
  onRoutinesChanged?: () => void | Promise<void>
}

function toDraftItems(items: readonly RoutineExercise[]): DraftRoutineItem[] {
  return [...items]
    .sort((left, right) => left.order - right.order)
    .map((item) => ({
      id: item.id,
      exerciseId: item.exerciseId,
      workingSets: String(item.workingSets),
      repMin: String(item.repMin),
      repMax: String(item.repMax),
      restSeconds: String(item.restSeconds),
    }))
}

function parseStrictInteger(value: string): number {
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

export function RoutineEditor({
  database = db,
  catalog = EXERCISE_CATALOG,
  now = () => new Date(),
  onRoutinesChanged,
}: RoutineEditorProps) {
  const routineNameInputId = useId()
  const pickerFilterInputId = useId()
  const pickerSelectId = useId()

  const knownExerciseIds = useMemo(
    () => new Set(catalog.map((exercise) => exercise.id)),
    [catalog],
  )

  const [routines, setRoutines] = useState<Routine[]>([])
  const [pickerExercises, setPickerExercises] = useState<ResolvedExercise[]>([])
  const [allExercisesById, setAllExercisesById] = useState<
    ReadonlyMap<ID, ResolvedExercise>
  >(() => new Map())

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null)
  const [routineName, setRoutineName] = useState('')
  const [draftItems, setDraftItems] = useState<DraftRoutineItem[]>([])
  const [pickerQuery, setPickerQuery] = useState('')
  const [selectedPickerExerciseId, setSelectedPickerExerciseId] =
    useState<ID>('')

  const reloadData = useCallback(async () => {
    try {
      const [loadedRoutines, availableForPicker, allResolved] =
        await Promise.all([
          listRoutines(database),
          getExercises({ catalog, includeExcluded: false }, database),
          getExercises({ catalog, includeExcluded: true }, database),
        ])
      setRoutines(loadedRoutines)
      setPickerExercises(availableForPicker)
      setAllExercisesById(
        new Map(allResolved.map((exercise) => [exercise.id, exercise])),
      )
      setSelectedPickerExerciseId((current) => {
        if (
          current &&
          availableForPicker.some((exercise) => exercise.id === current)
        ) {
          return current
        }
        return availableForPicker[0]?.id ?? ''
      })
      setErrorMessage(null)
    } catch {
      setErrorMessage('Could not load routines from local storage.')
    } finally {
      setIsLoading(false)
    }
  }, [catalog, database])

  useEffect(() => {
    let active = true
    void Promise.all([
      listRoutines(database),
      getExercises({ catalog, includeExcluded: false }, database),
      getExercises({ catalog, includeExcluded: true }, database),
    ])
      .then(([loadedRoutines, availableForPicker, allResolved]) => {
        if (!active) return
        setRoutines(loadedRoutines)
        setPickerExercises(availableForPicker)
        setAllExercisesById(
          new Map(allResolved.map((exercise) => [exercise.id, exercise])),
        )
        setSelectedPickerExerciseId(availableForPicker[0]?.id ?? '')
        setErrorMessage(null)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setErrorMessage('Could not load routines from local storage.')
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [catalog, database])

  const filteredPickerExercises = useMemo(() => {
    const normalized = pickerQuery.trim().toLowerCase()
    if (!normalized) return pickerExercises
    return pickerExercises.filter(
      (exercise) =>
        exercise.displayName.toLowerCase().includes(normalized) ||
        exercise.name.toLowerCase().includes(normalized) ||
        exercise.primaryMuscles.some((muscle) =>
          muscle.toLowerCase().includes(normalized),
        ),
    )
  }, [pickerExercises, pickerQuery])

  const effectivePickerExerciseId = useMemo(() => {
    if (
      selectedPickerExerciseId &&
      filteredPickerExercises.some(
        (exercise) => exercise.id === selectedPickerExerciseId,
      )
    ) {
      return selectedPickerExerciseId
    }
    return filteredPickerExercises[0]?.id ?? ''
  }, [filteredPickerExercises, selectedPickerExerciseId])

  const restrictionsByExerciseId = useMemo(() => {
    const map = new Map<ID, ExerciseRestriction>()
    for (const [id, exercise] of allExercisesById.entries()) {
      if (exercise.restriction) {
        map.set(id, exercise.restriction)
      }
    }
    return map
  }, [allExercisesById])

  const selectedPickerExercise = effectivePickerExerciseId
    ? allExercisesById.get(effectivePickerExerciseId)
    : undefined

  const resolveExerciseName = (exerciseId: ID): string =>
    allExercisesById.get(exerciseId)?.displayName ??
    catalog.find((item) => item.id === exerciseId)?.name ??
    exerciseId.replace(/^fedb:/, '').replaceAll('_', ' ')

  const resetForm = () => {
    setEditingRoutine(null)
    setRoutineName('')
    setDraftItems([])
    setPickerQuery('')
    setErrorMessage(null)
  }

  const handleStartEdit = (routine: Routine) => {
    setEditingRoutine(routine)
    setRoutineName(routine.name)
    setDraftItems(toDraftItems(routine.items))
    setErrorMessage(null)
    setStatusMessage(null)
  }

  const handleAddExerciseItem = () => {
    if (!effectivePickerExerciseId) return
    setErrorMessage(null)
    setStatusMessage(null)
    setDraftItems((prev) => [
      ...prev,
      {
        id: createId(),
        exerciseId: effectivePickerExerciseId,
        workingSets: String(DEFAULT_WORKING_SETS),
        repMin: String(DEFAULT_REP_MIN),
        repMax: String(DEFAULT_REP_MAX),
        restSeconds: String(DEFAULT_REST_SECONDS),
      },
    ])
  }

  const handleUpdateDraftItem = (
    itemId: ID,
    field: 'workingSets' | 'repMin' | 'repMax' | 'restSeconds',
    value: string,
  ) => {
    setDraftItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item,
      ),
    )
  }

  const handleRemoveDraftItem = (itemId: ID) => {
    setDraftItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  const handleReplaceDraftItemExercise = (itemId: ID) => {
    if (!effectivePickerExerciseId) return
    setDraftItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, exerciseId: effectivePickerExerciseId }
          : item,
      ),
    )
  }

  const handleMoveDraftItem = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= draftItems.length) return

    const placeholderNumeric: RoutineExercise[] = draftItems.map(
      (item, idx) => ({
        id: item.id,
        exerciseId: item.exerciseId,
        order: idx,
        workingSets: 1,
        repMin: 1,
        repMax: 1,
        restSeconds: 0,
      }),
    )
    const reorderedIds = reorderRoutineItems(
      placeholderNumeric,
      index,
      targetIndex,
    ).map((item) => item.id)
    const byId = new Map(draftItems.map((item) => [item.id, item]))
    setDraftItems(reorderedIds.map((id) => byId.get(id)!))
  }

  const handleSaveRoutine = async () => {
    setErrorMessage(null)
    setStatusMessage(null)

    const trimmedName = routineName.trim()
    if (trimmedName.length === 0) {
      setErrorMessage('Routine name must not be blank.')
      return
    }
    if (trimmedName.length > MAX_ROUTINE_NAME_LENGTH) {
      setErrorMessage(
        `Routine name cannot exceed ${MAX_ROUTINE_NAME_LENGTH} characters.`,
      )
      return
    }

    const candidateItems: RoutineExercise[] = draftItems.map((item, index) => ({
      id: item.id,
      exerciseId: item.exerciseId,
      order: index,
      workingSets: parseStrictInteger(item.workingSets),
      repMin: parseStrictInteger(item.repMin),
      repMax: parseStrictInteger(item.repMax),
      restSeconds: parseStrictInteger(item.restSeconds),
    }))

    const validation = routineInputSchema.safeParse({
      name: trimmedName,
      items: candidateItems,
    })

    if (!validation.success) {
      const firstIssue = validation.error.issues[0]
      setErrorMessage(
        firstIssue?.message ??
          'Routine contains invalid set counts, rep bounds, or rest duration.',
      )
      return
    }

    setIsSaving(true)
    try {
      const timestamp = now().toISOString()
      const record: Routine = {
        id: editingRoutine?.id ?? createId(),
        name: validation.data.name,
        items: validation.data.items,
        createdAt: editingRoutine?.createdAt ?? timestamp,
        updatedAt:
          editingRoutine && timestamp < editingRoutine.createdAt
            ? editingRoutine.createdAt
            : timestamp,
      }

      const saved = await saveRoutine(record, {
        knownExerciseIds,
        database,
      })
      await reloadData()
      await onRoutinesChanged?.()
      resetForm()
      setStatusMessage(
        editingRoutine
          ? `Updated routine "${saved.name}".`
          : `Created routine "${saved.name}".`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not save routine.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDuplicateRoutine = async (routine: Routine) => {
    setIsSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const copy = await duplicateRoutine(
        routine.id,
        { timestamp: now().toISOString() },
        database,
      )
      await reloadData()
      await onRoutinesChanged?.()
      setStatusMessage(`Duplicated "${routine.name}" as "${copy.name}".`)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not duplicate routine.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteRoutine = async (routine: Routine) => {
    setIsSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await deleteRoutine(routine.id, database)
      if (editingRoutine?.id === routine.id) {
        resetForm()
      }
      await reloadData()
      await onRoutinesChanged?.()
      setStatusMessage(
        `Deleted routine "${routine.name}". Past workout sessions remain in history.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not delete routine.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleSeedDemoRoutine = async () => {
    if (pickerExercises.length === 0) return
    setIsSaving(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const timestamp = now().toISOString()
      const demoExercises = pickerExercises.slice(0, 3)
      const demoRoutine: Routine = {
        id: createId(),
        name: '[Demo] Full-Body Starter Template',
        items: demoExercises.map((exercise, index) => ({
          id: createId(),
          exerciseId: exercise.id,
          order: index,
          workingSets: DEFAULT_WORKING_SETS,
          repMin: DEFAULT_REP_MIN,
          repMax: DEFAULT_REP_MAX,
          restSeconds: DEFAULT_REST_SECONDS,
        })),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await saveRoutine(demoRoutine, { knownExerciseIds, database })
      await reloadData()
      await onRoutinesChanged?.()
      setStatusMessage(
        'Loaded "[Demo] Full-Body Starter Template". You can edit or delete it anytime.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not seed demo starter routine.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section
      aria-label="Routine editor and templates"
      className="mt-6 space-y-6 border-t border-[var(--line)] pt-6"
    >
      <div
        role="region"
        aria-label={editingRoutine ? 'Edit routine' : 'Create routine'}
        className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">
            {editingRoutine
              ? `Edit routine: ${editingRoutine.name}`
              : 'Create routine'}
          </h2>
          {editingRoutine && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium"
            >
              Cancel editing
            </button>
          )}
        </div>

        <div>
          <label
            htmlFor={routineNameInputId}
            className="block text-sm font-medium"
          >
            Routine name
          </label>
          <input
            id={routineNameInputId}
            type="text"
            maxLength={MAX_ROUTINE_NAME_LENGTH}
            value={routineName}
            onChange={(event) => setRoutineName(event.target.value)}
            placeholder="e.g. Upper A, Push Day, Full Body"
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold">Add exercise to routine</h3>
          <p className="text-xs text-muted">
            Default values ({DEFAULT_WORKING_SETS} sets × {DEFAULT_REP_MIN}–
            {DEFAULT_REP_MAX} reps, {DEFAULT_REST_SECONDS}s rest) are editable
            conveniences, not training prescriptions.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={pickerFilterInputId}
                className="block text-xs font-medium"
              >
                Filter exercise picker
              </label>
              <input
                id={pickerFilterInputId}
                type="search"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder="Filter by name or muscle…"
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor={pickerSelectId}
                className="block text-xs font-medium"
              >
                Exercise to add
              </label>
              <select
                id={pickerSelectId}
                value={effectivePickerExerciseId}
                onChange={(event) =>
                  setSelectedPickerExerciseId(event.target.value)
                }
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
              >
                {filteredPickerExercises.length === 0 ? (
                  <option value="">No matching exercises</option>
                ) : (
                  filteredPickerExercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.displayName} (
                      {exercise.primaryMuscles.join(', ')})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {selectedPickerExercise?.restriction?.status === 'caution' && (
            <p className="rounded border border-[var(--line)] bg-[var(--raised)] p-2 text-xs">
              <strong>Caution:</strong>{' '}
              {selectedPickerExercise.restriction.note ??
                'User marked this exercise with caution.'}
            </p>
          )}

          <div>
            <button
              type="button"
              disabled={!effectivePickerExerciseId || isSaving}
              onClick={handleAddExerciseItem}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
            >
              Add exercise to routine
            </button>
          </div>
        </div>

        {draftItems.length === 0 ? (
          <p className="text-sm text-muted">
            No exercises added to this routine yet. You can save an empty draft
            or add exercises above.
          </p>
        ) : (
          <ol aria-label="Routine exercises" className="space-y-3">
            {draftItems.map((item, index) => {
              const displayName = resolveExerciseName(item.exerciseId)
              const positionLabel = `#${index + 1} ${displayName}`
              const itemRestriction = restrictionsByExerciseId.get(
                item.exerciseId,
              )
              return (
                <li
                  key={item.id}
                  className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {positionLabel}
                      </span>
                      {itemRestriction && (
                        <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs font-semibold">
                          {formatRestrictionBadgeLabel(itemRestriction)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {itemRestriction?.status === 'excluded' &&
                        effectivePickerExerciseId && (
                          <button
                            type="button"
                            aria-label={`Replace ${positionLabel} with selected exercise`}
                            onClick={() =>
                              handleReplaceDraftItemExercise(item.id)
                            }
                            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
                          >
                            Replace with picker selection
                          </button>
                        )}
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Move up ${positionLabel}`}
                        onClick={() => handleMoveDraftItem(index, -1)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={index === draftItems.length - 1}
                        aria-label={`Move down ${positionLabel}`}
                        onClick={() => handleMoveDraftItem(index, 1)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${positionLabel}`}
                        onClick={() => handleRemoveDraftItem(item.id)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {itemRestriction?.status === 'excluded' && (
                    <p role="alert" className="text-xs font-medium">
                      This exercise is currently marked Excluded. Replace or
                      remove it before starting a workout with this routine.
                      {itemRestriction.note
                        ? ` Note: ${itemRestriction.note}`
                        : ''}
                    </p>
                  )}

                  {itemRestriction?.status === 'caution' && (
                    <p className="text-xs text-muted">
                      <strong>Caution note:</strong>{' '}
                      {itemRestriction.note ??
                        'User-marked caution (no note entered).'}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="block text-xs font-medium">
                      Working sets ({positionLabel})
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={item.workingSets}
                        onChange={(event) =>
                          handleUpdateDraftItem(
                            item.id,
                            'workingSets',
                            event.target.value,
                          )
                        }
                        className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-medium">
                      Min reps ({positionLabel})
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={item.repMin}
                        onChange={(event) =>
                          handleUpdateDraftItem(
                            item.id,
                            'repMin',
                            event.target.value,
                          )
                        }
                        className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-medium">
                      Max reps ({positionLabel})
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={item.repMax}
                        onChange={(event) =>
                          handleUpdateDraftItem(
                            item.id,
                            'repMax',
                            event.target.value,
                          )
                        }
                        className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-medium">
                      Rest seconds ({positionLabel})
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={item.restSeconds}
                        onChange={(event) =>
                          handleUpdateDraftItem(
                            item.id,
                            'restSeconds',
                            event.target.value,
                          )
                        }
                        className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <div>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveRoutine()}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-5 py-2.5 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            {editingRoutine ? 'Save routine changes' : 'Save routine'}
          </button>
        </div>
      </div>

      {statusMessage && (
        <p
          role="status"
          className="rounded-lg border border-[var(--accent)] bg-[var(--selected)] p-3 text-sm"
        >
          {statusMessage}
        </p>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 text-sm font-medium"
        >
          {errorMessage}
        </p>
      )}

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Saved routines</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading routines…</p>
        ) : routines.length === 0 ? (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-6 text-sm">
            <p className="font-medium">No routines saved yet.</p>
            <p className="mt-1 text-muted">
              Create your own routine above, or load a clearly labeled demo
              starter template to explore the editor.
            </p>
            {pickerExercises.length > 0 && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSeedDemoRoutine()}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold"
              >
                Load demo starter routine
              </button>
            )}
          </div>
        ) : (
          <ul aria-label="Saved routines list" className="space-y-3">
            {routines.map((routine) => {
              const audit = auditRoutineRestrictions(
                routine.items,
                restrictionsByExerciseId,
              )
              return (
                <li
                  key={routine.id}
                  className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">
                        {routine.name}
                      </h3>
                      <p className="mt-1 text-xs text-muted">
                        {routine.items.length}{' '}
                        {routine.items.length === 1 ? 'exercise' : 'exercises'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isSaving}
                        aria-label={`Edit ${routine.name}`}
                        onClick={() => handleStartEdit(routine)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        aria-label={`Duplicate ${routine.name}`}
                        onClick={() => void handleDuplicateRoutine(routine)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        aria-label={`Delete ${routine.name}`}
                        onClick={() => void handleDeleteRoutine(routine)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {!audit.canStartRoutine && (
                    <div
                      role="alert"
                      aria-label={`Excluded exercise warning for ${routine.name}`}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-xs font-medium"
                    >
                      Routine blocked from starting: contains excluded
                      exercise(s):{' '}
                      {audit.excludedItems
                        .map((item) => resolveExerciseName(item.exerciseId))
                        .join(', ')}
                      . Edit this routine to replace or remove excluded items
                      before starting a workout.
                    </div>
                  )}

                  {routine.items.length > 0 && (
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                      {routine.items.map((item) => {
                        const itemRestriction = restrictionsByExerciseId.get(
                          item.exerciseId,
                        )
                        return (
                          <li key={item.id}>
                            <span className="font-medium text-[var(--ink)]">
                              {resolveExerciseName(item.exerciseId)}
                            </span>{' '}
                            — {item.workingSets} × {item.repMin}–{item.repMax}{' '}
                            reps ({item.restSeconds}s rest)
                            {itemRestriction?.status === 'excluded' && (
                              <span className="ml-2 font-semibold text-[var(--ink)]">
                                [Excluded
                                {itemRestriction.note
                                  ? `: ${itemRestriction.note}`
                                  : ''}
                                ]
                              </span>
                            )}
                            {itemRestriction?.status === 'caution' && (
                              <span className="ml-2 font-medium text-[var(--ink)]">
                                [Caution
                                {itemRestriction.note
                                  ? `: ${itemRestriction.note}`
                                  : ''}
                                ]
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
