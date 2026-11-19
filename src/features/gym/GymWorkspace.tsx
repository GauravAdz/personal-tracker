import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  ActiveSessionConflictError,
  getAppSettings,
  getExercises,
  listRoutines,
  type ResolvedExercise,
  saveBodyWeight,
  type SessionSnapshot,
} from '../../data/repositories'
import { EXERCISE_CATALOG } from '../../data/seed'
import { bodyWeightInputSchema } from '../../data/validation'
import type {
  AppSettings,
  CatalogExercise,
  ExerciseRestriction,
  IANATimeZone,
  ID,
  Routine,
  SetLog,
} from '../../domain/models'
import { auditRoutineRestrictions } from '../../domain/restrictions'
import {
  getDefaultTimeZone,
  getLocalDate,
  toUTCISOString,
} from '../../domain/time'
import {
  addExerciseToActiveSession,
  cancelWorkoutSession,
  finishWorkoutSession,
  getActiveSessionSnapshot,
  listSessionHistory,
  loadPreviousCompletedWorkingSetsMap,
  reorderSessionExercise,
  type SessionHistorySummary,
  skipSessionExercise,
  startWorkoutFromRoutine,
} from '../../services/workout'
import { RoutineEditor } from '../routines/RoutineEditor'
import { PreparationFlow } from './PreparationFlow'
import { RestTimer } from './RestTimer'
import { SetLogger } from './SetLogger'

export interface GymWorkspaceProps {
  database?: PersonalTrackerDB
  catalog?: readonly CatalogExercise[]
  now?: () => Date
  timeZone?: IANATimeZone
}

export function GymWorkspace({
  database = db,
  catalog = EXERCISE_CATALOG,
  now = () => new Date(),
  timeZone,
}: GymWorkspaceProps) {
  const addExerciseSelectId = useId()
  const sessionNoteInputId = useId()
  const preWorkoutWeightInputId = useId()
  const activeTimeZone = useMemo(
    () => timeZone ?? getDefaultTimeZone(),
    [timeZone],
  )

  const [activeSnapshot, setActiveSnapshot] = useState<SessionSnapshot | null>(
    null,
  )
  const [appSettings, setAppSettings] = useState<AppSettings | undefined>(
    undefined,
  )
  const [routines, setRoutines] = useState<Routine[]>([])
  const [history, setHistory] = useState<SessionHistorySummary[]>([])
  const [availableExercises, setAvailableExercises] = useState<
    ResolvedExercise[]
  >([])
  const [allExercisesById, setAllExercisesById] = useState<
    ReadonlyMap<ID, ResolvedExercise>
  >(() => new Map())
  const [previousWorkingSetsByExerciseId, setPreviousWorkingSetsByExerciseId] =
    useState<ReadonlyMap<ID, SetLog[]>>(() => new Map())

  const [selectedAddExerciseId, setSelectedAddExerciseId] = useState<ID>('')
  const [sessionNoteDraft, setSessionNoteDraft] = useState<string>('')
  const [pendingAction, setPendingAction] = useState<
    'finish' | 'cancel' | null
  >(null)
  const [pendingStart, setPendingStart] = useState<{
    routineId: ID | null
  } | null>(null)
  const [preWorkoutWeightDraft, setPreWorkoutWeightDraft] = useState('')
  const [preWorkoutWeightError, setPreWorkoutWeightError] = useState<
    string | null
  >(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reloadWorkspace = useCallback(async () => {
    try {
      const [
        snapshot,
        loadedRoutines,
        loadedHistory,
        pickerList,
        allResolved,
        loadedSettings,
      ] = await Promise.all([
        getActiveSessionSnapshot(database),
        listRoutines(database),
        listSessionHistory(database),
        getExercises({ catalog, includeExcluded: false }, database),
        getExercises({ catalog, includeExcluded: true }, database),
        getAppSettings(database),
      ])
      const previousMap = snapshot
        ? await loadPreviousCompletedWorkingSetsMap(
            snapshot.exercises.map((item) => item.exerciseId),
            snapshot.session.id,
            database,
          )
        : new Map<ID, SetLog[]>()
      setActiveSnapshot(snapshot ?? null)
      setAppSettings(loadedSettings)
      setPreviousWorkingSetsByExerciseId(previousMap)
      if (snapshot?.session.note !== undefined) {
        setSessionNoteDraft(snapshot.session.note)
      }
      setRoutines(loadedRoutines)
      setHistory(loadedHistory)
      setAvailableExercises(pickerList)
      setAllExercisesById(new Map(allResolved.map((item) => [item.id, item])))
      setSelectedAddExerciseId((current) => {
        if (current && pickerList.some((item) => item.id === current)) {
          return current
        }
        return pickerList[0]?.id ?? ''
      })
      setErrorMessage(null)
    } catch {
      setErrorMessage('Could not load workout session state.')
    } finally {
      setIsLoading(false)
    }
  }, [catalog, database])

  useEffect(() => {
    let active = true
    void Promise.all([
      getActiveSessionSnapshot(database),
      listRoutines(database),
      listSessionHistory(database),
      getExercises({ catalog, includeExcluded: false }, database),
      getExercises({ catalog, includeExcluded: true }, database),
      getAppSettings(database),
    ])
      .then(
        async ([
          snapshot,
          loadedRoutines,
          loadedHistory,
          pickerList,
          allResolved,
          loadedSettings,
        ]) => {
          const previousMap = snapshot
            ? await loadPreviousCompletedWorkingSetsMap(
                snapshot.exercises.map((item) => item.exerciseId),
                snapshot.session.id,
                database,
              )
            : new Map<ID, SetLog[]>()
          if (!active) return
          setActiveSnapshot(snapshot ?? null)
          setAppSettings(loadedSettings)
          setPreviousWorkingSetsByExerciseId(previousMap)
          setSessionNoteDraft(snapshot?.session.note ?? '')
          setRoutines(loadedRoutines)
          setHistory(loadedHistory)
          setAvailableExercises(pickerList)
          setAllExercisesById(
            new Map(allResolved.map((item) => [item.id, item])),
          )
          setSelectedAddExerciseId(pickerList[0]?.id ?? '')
          setErrorMessage(null)
          setIsLoading(false)
        },
      )
      .catch(() => {
        if (!active) return
        setErrorMessage('Could not load workout session state.')
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [catalog, database])

  const restrictionsByExerciseId = useMemo(() => {
    const map = new Map<ID, ExerciseRestriction>()
    for (const [id, exercise] of allExercisesById.entries()) {
      if (exercise.restriction) {
        map.set(id, exercise.restriction)
      }
    }
    return map
  }, [allExercisesById])

  const activeRoutineName = useMemo(() => {
    if (!activeSnapshot?.session.routineId) return null
    return (
      routines.find((item) => item.id === activeSnapshot.session.routineId)
        ?.name ?? 'Deleted routine template'
    )
  }, [activeSnapshot, routines])

  const setsBySessionExerciseId = useMemo(() => {
    const grouped = new Map<ID, SetLog[]>()
    if (!activeSnapshot) return grouped
    for (const setLog of activeSnapshot.setLogs) {
      const list = grouped.get(setLog.sessionExerciseId) ?? []
      list.push(setLog)
      grouped.set(setLog.sessionExerciseId, list)
    }
    return grouped
  }, [activeSnapshot])

  const handleRequestStartWorkout = (routineId: ID | null) => {
    if (appSettings?.promptWeightBeforeWorkout) {
      setPendingStart({ routineId })
      setPreWorkoutWeightDraft('')
      setPreWorkoutWeightError(null)
      setErrorMessage(null)
      setStatusMessage(null)
      return
    }
    void handleStartWorkout(routineId)
  }

  const handleSaveWeightAndStart = async () => {
    if (!pendingStart) return
    setPreWorkoutWeightError(null)
    const trimmed = preWorkoutWeightDraft.trim()
    const parsedWeight = /^-?\d+(?:\.\d+)?$/.test(trimmed)
      ? Number(trimmed)
      : Number.NaN
    const occurredAt = toUTCISOString(now())
    const validation = bodyWeightInputSchema.safeParse({
      weightKg: parsedWeight,
      occurredAt,
      localDate: getLocalDate(occurredAt, activeTimeZone),
      timeZone: activeTimeZone,
    })
    if (!validation.success) {
      setPreWorkoutWeightError(
        validation.error.issues[0]?.message ??
          'Enter a positive finite body weight in kg, or skip.',
      )
      return
    }

    setIsBusy(true)
    try {
      await saveBodyWeight(validation.data, database)
      const targetRoutineId = pendingStart.routineId
      setPendingStart(null)
      setPreWorkoutWeightDraft('')
      await handleStartWorkout(targetRoutineId)
    } catch (error) {
      setPreWorkoutWeightError(
        error instanceof Error
          ? error.message
          : 'Could not save body-weight check-in.',
      )
      setIsBusy(false)
    }
  }

  const handleSkipWeightAndStart = async () => {
    if (!pendingStart) return
    const targetRoutineId = pendingStart.routineId
    setPendingStart(null)
    setPreWorkoutWeightDraft('')
    setPreWorkoutWeightError(null)
    await handleStartWorkout(targetRoutineId)
  }

  const handleStartWorkout = async (routineId: ID | null) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    setPendingAction(null)
    try {
      const started = await startWorkoutFromRoutine(
        routineId,
        {
          startedAt: now().toISOString(),
          catalog,
        },
        database,
      )
      setSessionNoteDraft(started.session.note ?? '')
      await reloadWorkspace()
      setStatusMessage(
        routineId
          ? 'Workout started from routine snapshot. Template edits will not affect this active session.'
          : 'Started empty workout session.',
      )
    } catch (error) {
      if (error instanceof ActiveSessionConflictError) {
        await reloadWorkspace()
        setErrorMessage(
          'A workout session is already active. Resume, finish, or cancel the current workout before starting another.',
        )
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Could not start workout session.',
        )
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handleAddExerciseToSession = async () => {
    if (!activeSnapshot || !selectedAddExerciseId) return
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const added = await addExerciseToActiveSession(
        activeSnapshot.session.id,
        selectedAddExerciseId,
        { catalog },
        database,
      )
      await reloadWorkspace()
      setStatusMessage(`Added ${added.exerciseNameSnapshot} to active workout.`)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not add exercise to active session.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleReorderExercise = async (
    sessionExerciseId: ID,
    direction: 'up' | 'down',
  ) => {
    if (!activeSnapshot) return
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await reorderSessionExercise(
        activeSnapshot.session.id,
        sessionExerciseId,
        direction,
        database,
      )
      await reloadWorkspace()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not reorder session exercise.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleSkipExercise = async (
    sessionExerciseId: ID,
    exerciseName: string,
  ) => {
    if (!activeSnapshot) return
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const updatedSnapshot = await skipSessionExercise(
        activeSnapshot.session.id,
        sessionExerciseId,
        database,
      )
      setSessionNoteDraft(updatedSnapshot.session.note ?? '')
      await reloadWorkspace()
      setStatusMessage(`Skipped ${exerciseName} in active workout.`)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not skip session exercise.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleConfirmFinish = async () => {
    if (!activeSnapshot) return
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await finishWorkoutSession(
        activeSnapshot.session.id,
        {
          endedAt: now().toISOString(),
          ...(sessionNoteDraft.trim() !== ''
            ? { note: sessionNoteDraft.trim() }
            : {}),
        },
        database,
      )
      setPendingAction(null)
      setSessionNoteDraft('')
      await reloadWorkspace()
      setStatusMessage('Workout completed and saved to session history.')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not finish workout session.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleConfirmCancel = async () => {
    if (!activeSnapshot) return
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await cancelWorkoutSession(
        activeSnapshot.session.id,
        {
          endedAt: now().toISOString(),
          ...(sessionNoteDraft.trim() !== ''
            ? { note: sessionNoteDraft.trim() }
            : {}),
        },
        database,
      )
      setPendingAction(null)
      setSessionNoteDraft('')
      await reloadWorkspace()
      setStatusMessage(
        'Workout cancelled. All logged sets and exercises remain preserved in session history.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not cancel workout session.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="mt-6 space-y-8">
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

      {isLoading ? (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm text-muted">
          Loading workout workspace…
        </p>
      ) : activeSnapshot ? (
        <section
          aria-label="Active workout session"
          className="space-y-4 rounded-lg border-2 border-[var(--accent)] bg-[var(--raised)] p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-block rounded bg-[var(--selected)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">
                Active workout (Gym Mode)
              </span>
              <h2 className="mt-1 text-xl font-semibold">
                {activeRoutineName ?? 'Ad-hoc workout'}
              </h2>
              <p className="mt-1 text-xs text-muted">
                Started {activeSnapshot.session.startedAt} ·{' '}
                {activeSnapshot.exercises.length}{' '}
                {activeSnapshot.exercises.length === 1
                  ? 'exercise'
                  : 'exercises'}{' '}
                · {activeSnapshot.setLogs.length}{' '}
                {activeSnapshot.setLogs.length === 1 ? 'set' : 'sets'} logged
              </p>
            </div>
          </div>

          <RestTimer
            sessionId={activeSnapshot.session.id}
            restTimer={appSettings?.restTimer}
            defaultRestSeconds={activeSnapshot.exercises[0]?.restSeconds ?? 90}
            database={database}
            now={now}
            onChanged={() => reloadWorkspace()}
          />

          <PreparationFlow
            {...(appSettings?.preparationPreferences !== undefined
              ? { preferences: appSettings.preparationPreferences }
              : {})}
            database={database}
            now={now}
            onPreferencesChanged={() => reloadWorkspace()}
          />

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
            <div className="min-w-48 flex-1">
              <label
                htmlFor={addExerciseSelectId}
                className="block text-xs font-medium"
              >
                Add exercise to active session
              </label>
              <select
                id={addExerciseSelectId}
                value={selectedAddExerciseId}
                onChange={(event) =>
                  setSelectedAddExerciseId(event.target.value)
                }
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
              >
                {availableExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.displayName}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={!selectedAddExerciseId || isBusy}
              onClick={() => void handleAddExerciseToSession()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Add exercise to session
            </button>
          </div>

          {activeSnapshot.exercises.length === 0 ? (
            <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-muted">
              No exercises in this session yet. Add an exercise above, or finish
              or cancel this empty session below.
            </p>
          ) : (
            <ol aria-label="Active session exercises" className="space-y-3">
              {activeSnapshot.exercises.map((exercise, index) => {
                const positionLabel = `#${index + 1} ${exercise.exerciseNameSnapshot}`
                const setsForExercise =
                  setsBySessionExerciseId.get(exercise.id) ?? []
                const loggedCount = setsForExercise.length
                return (
                  <li
                    key={exercise.id}
                    className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold">
                          {positionLabel}
                        </h3>
                        <p className="text-xs text-muted">
                          Target: {exercise.targetSets} ×{' '}
                          {exercise.targetRepMin}–{exercise.targetRepMax} reps (
                          {exercise.restSeconds}s rest) · Equipment:{' '}
                          {exercise.equipmentSnapshot ?? 'Bodyweight (none)'} ·{' '}
                          {loggedCount} {loggedCount === 1 ? 'set' : 'sets'}{' '}
                          logged
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={index === 0 || isBusy}
                          aria-label={`Move up ${positionLabel}`}
                          onClick={() =>
                            void handleReorderExercise(exercise.id, 'up')
                          }
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          disabled={
                            index === activeSnapshot.exercises.length - 1 ||
                            isBusy
                          }
                          aria-label={`Move down ${positionLabel}`}
                          onClick={() =>
                            void handleReorderExercise(exercise.id, 'down')
                          }
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={`Skip ${positionLabel}`}
                          onClick={() =>
                            void handleSkipExercise(
                              exercise.id,
                              exercise.exerciseNameSnapshot,
                            )
                          }
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                        >
                          Skip exercise
                        </button>
                      </div>
                    </div>

                    <SetLogger
                      sessionId={activeSnapshot.session.id}
                      sessionExercise={exercise}
                      positionNumber={index + 1}
                      loggedSets={setsForExercise}
                      previousWorkingSets={
                        previousWorkingSetsByExerciseId.get(
                          exercise.exerciseId,
                        ) ?? []
                      }
                      database={database}
                      now={now}
                      onChanged={() => reloadWorkspace()}
                    />
                  </li>
                )
              })}
            </ol>
          )}

          <div className="space-y-3 border-t border-[var(--line)] pt-4">
            <div>
              <label
                htmlFor={sessionNoteInputId}
                className="block text-xs font-medium"
              >
                Session note (optional)
              </label>
              <input
                id={sessionNoteInputId}
                type="text"
                maxLength={500}
                value={sessionNoteDraft}
                onChange={(event) => setSessionNoteDraft(event.target.value)}
                placeholder="Optional workout note…"
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            </div>

            {pendingAction === null && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setPendingAction('finish')}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)]"
                >
                  Finish workout
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setPendingAction('cancel')}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium"
                >
                  Cancel workout
                </button>
              </div>
            )}

            {pendingAction === 'finish' && (
              <div
                role="region"
                aria-label="Confirm finishing workout"
                className="space-y-2 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-3 text-sm"
              >
                <p className="font-medium">
                  Finish this workout session and save it to your completed
                  history?
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleConfirmFinish()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 font-semibold text-[var(--accent)]"
                  >
                    Confirm finish workout
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setPendingAction(null)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 font-medium"
                  >
                    Keep workout active
                  </button>
                </div>
              </div>
            )}

            {pendingAction === 'cancel' && (
              <div
                role="region"
                aria-label="Confirm cancelling workout"
                className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
              >
                <p className="font-medium">
                  Cancel this active workout? Any sets already logged will be
                  kept in your session history and will not be deleted.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleConfirmCancel()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--raised)] px-4 py-2 font-semibold"
                  >
                    Confirm cancel workout
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setPendingAction(null)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 font-medium"
                  >
                    Keep workout active
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section
          aria-label="Start a workout"
          className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Start a workout</h2>
              <p className="mt-1 text-sm text-muted">
                Start from one of your saved routine templates or launch an
                empty ad-hoc session.
              </p>
            </div>
            <button
              type="button"
              disabled={isBusy || isLoading}
              onClick={() => handleRequestStartWorkout(null)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold"
            >
              Start empty workout
            </button>
          </div>

          {pendingStart !== null && (
            <div
              role="region"
              aria-label="Pre-workout body-weight check-in"
              className="space-y-3 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4 text-sm"
            >
              <div>
                <h3 className="text-base font-semibold">
                  Optional body-weight check-in
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Log your current body weight before starting, or skip
                  immediately.
                </p>
              </div>

              <div className="max-w-xs">
                <label
                  htmlFor={preWorkoutWeightInputId}
                  className="block text-xs font-medium"
                >
                  Pre-workout weight (kg)
                </label>
                <input
                  id={preWorkoutWeightInputId}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={preWorkoutWeightDraft}
                  placeholder="e.g., 78.4"
                  onChange={(event) =>
                    setPreWorkoutWeightDraft(event.target.value)
                  }
                  className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
                />
              </div>

              {preWorkoutWeightError && (
                <p role="alert" className="text-xs font-medium">
                  {preWorkoutWeightError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleSaveWeightAndStart()}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                >
                  Save weight &amp; start workout
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleSkipWeightAndStart()}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  Skip &amp; start workout
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setPendingStart(null)
                    setPreWorkoutWeightDraft('')
                    setPreWorkoutWeightError(null)
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {routines.length > 0 && (
            <ul aria-label="Startable routines" className="space-y-2">
              {routines.map((routine) => {
                const audit = auditRoutineRestrictions(
                  routine.items,
                  restrictionsByExerciseId,
                )
                return (
                  <li
                    key={routine.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
                  >
                    <div>
                      <span className="font-semibold">{routine.name}</span>
                      <span className="ml-2 text-xs text-muted">
                        ({routine.items.length}{' '}
                        {routine.items.length === 1 ? 'exercise' : 'exercises'})
                      </span>
                      {!audit.canStartRoutine && (
                        <p className="mt-1 text-xs font-medium">
                          Contains excluded exercise — edit routine below before
                          starting.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!audit.canStartRoutine || isBusy}
                      aria-label={`Start ${routine.name}`}
                      onClick={() => handleRequestStartWorkout(routine.id)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-40"
                    >
                      Start workout
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section
        aria-label="Workout session history"
        className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
      >
        <h2 className="text-xl font-semibold">Session history</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading session history…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">
            No completed or cancelled workouts recorded yet.
          </p>
        ) : (
          <ul aria-label="Session history list" className="space-y-3">
            {history.map((entry) => (
              <li
                key={entry.session.id}
                className="space-y-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {entry.routineName ?? 'Ad-hoc workout'}
                  </span>
                  <span className="rounded border border-[var(--line)] px-2 py-0.5 text-xs font-medium">
                    {entry.session.status === 'completed'
                      ? 'Completed'
                      : 'Cancelled'}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Started {entry.session.startedAt}
                  {entry.session.endedAt
                    ? ` · Ended ${entry.session.endedAt}`
                    : ''}
                </p>
                <p className="text-xs">
                  Exercises:{' '}
                  {entry.exerciseNames.length > 0
                    ? entry.exerciseNames.join(', ')
                    : 'Empty session (0 exercises)'}
                </p>
                <p className="text-xs text-muted">
                  Sets logged: {entry.workingSetCount} working,{' '}
                  {entry.warmupSetCount} warm-up ({entry.totalSetCount} total)
                </p>
                {entry.session.note && (
                  <p className="text-xs text-muted">
                    Note: {entry.session.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <RoutineEditor
        database={database}
        catalog={catalog}
        now={now}
        onRoutinesChanged={() => reloadWorkspace()}
      />
    </div>
  )
}
