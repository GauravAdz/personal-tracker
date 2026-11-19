import { useId, useRef, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import { DuplicateSetOrdinalError } from '../../data/repositories'
import { setLogInputSchema } from '../../data/validation'
import type { ID, SessionExercise, SetLog } from '../../domain/models'
import {
  evaluateProgression,
  formatProgressionBadgeLabel,
} from '../../domain/progression'
import {
  editWorkoutSet,
  logWorkoutSet,
  undoWorkoutSet,
} from '../../services/workout'

export interface SetLoggerProps {
  sessionId: ID
  sessionExercise: SessionExercise
  positionNumber: number
  loggedSets: readonly SetLog[]
  previousWorkingSets: readonly SetLog[]
  database?: PersonalTrackerDB
  now?: () => Date
  onChanged?: () => void | Promise<void>
}

function formatLoadValue(loadKg: number | null): string {
  return loadKg === null ? 'Bodyweight' : `${loadKg} kg`
}

function formatPreviousWorkingSets(sets: readonly SetLog[]): string {
  if (sets.length === 0) return '—'
  return sets
    .map((set) => `${formatLoadValue(set.externalLoadKg)} × ${set.reps}`)
    .join(', ')
}

function getInitialLoadDraft(
  sessionExercise: SessionExercise,
  loggedSets: readonly SetLog[],
  previousWorkingSets: readonly SetLog[],
): string {
  const lastLogged = loggedSets.at(-1)
  if (lastLogged) {
    return lastLogged.externalLoadKg === null
      ? ''
      : String(lastLogged.externalLoadKg)
  }
  const firstPrevious = previousWorkingSets[0]
  if (firstPrevious) {
    return firstPrevious.externalLoadKg === null
      ? ''
      : String(firstPrevious.externalLoadKg)
  }
  return sessionExercise.equipmentSnapshot === null ? '' : '20'
}

function parseOptionalLoadKg(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

function parseStrictInteger(raw: string): number {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

function parseOptionalRir(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

export function SetLogger({
  sessionId,
  sessionExercise,
  positionNumber,
  loggedSets,
  previousWorkingSets,
  database = db,
  now = () => new Date(),
  onChanged,
}: SetLoggerProps) {
  const kindInputId = useId()
  const loadInputId = useId()
  const repsInputId = useId()
  const rirInputId = useId()
  const feedbackInputId = useId()

  const positionLabel = `#${positionNumber} ${sessionExercise.exerciseNameSnapshot}`
  const sortedSets = [...loggedSets].sort(
    (left, right) => left.ordinal - right.ordinal,
  )
  const nextOrdinal = (sortedSets.at(-1)?.ordinal ?? 0) + 1
  const workingCount = sortedSets.filter((set) => set.kind === 'working').length
  const warmupCount = sortedSets.filter((set) => set.kind === 'warmup').length

  const [kindDraft, setKindDraft] = useState<'working' | 'warmup'>('working')
  const [loadDraft, setLoadDraft] = useState<string>(() =>
    getInitialLoadDraft(sessionExercise, sortedSets, previousWorkingSets),
  )
  const [repsDraft, setRepsDraft] = useState<string>(() =>
    String(sessionExercise.targetRepMin),
  )
  const [rirDraft, setRirDraft] = useState<string>('')
  const [feedbackDraft, setFeedbackDraft] = useState<string>('')

  const parsedDraftRir = parseOptionalRir(rirDraft)
  const validDraftRir =
    parsedDraftRir !== undefined &&
    Number.isFinite(parsedDraftRir) &&
    parsedDraftRir >= 0 &&
    parsedDraftRir <= 10
      ? parsedDraftRir
      : undefined
  const currentFeedback =
    feedbackDraft !== ''
      ? (feedbackDraft as NonNullable<SetLog['feedback']>)
      : undefined

  const progression = evaluateProgression({
    targetSets: sessionExercise.targetSets,
    targetRepMin: sessionExercise.targetRepMin,
    targetRepMax: sessionExercise.targetRepMax,
    exerciseId: sessionExercise.exerciseId,
    equipment: sessionExercise.equipmentSnapshot,
    previousSets: previousWorkingSets,
    currentSets: sortedSets,
    ...(currentFeedback !== undefined ? { currentFeedback } : {}),
    ...(validDraftRir !== undefined
      ? { currentRepsInReserve: validDraftRir }
      : {}),
  })

  const [editingSetId, setEditingSetId] = useState<ID | null>(null)
  const [editKind, setEditKind] = useState<'working' | 'warmup'>('working')
  const [editLoad, setEditLoad] = useState<string>('')
  const [editReps, setEditReps] = useState<string>('')
  const [editRir, setEditRir] = useState<string>('')
  const [editFeedback, setEditFeedback] = useState<string>('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // Synchronous ref guard prevents rapid double-tap from submitting the same ordinal twice.
  const inFlightOrdinalRef = useRef<number | null>(null)

  const handleLogNextSet = async () => {
    if (inFlightOrdinalRef.current === nextOrdinal || isSubmitting) {
      return
    }
    inFlightOrdinalRef.current = nextOrdinal
    setErrorMessage(null)
    setStatusMessage(null)

    const parsedLoad = parseOptionalLoadKg(loadDraft)
    const parsedReps = parseStrictInteger(repsDraft)
    const parsedRir = parseOptionalRir(rirDraft)

    const candidate = {
      sessionId,
      sessionExerciseId: sessionExercise.id,
      ordinal: nextOrdinal,
      kind: kindDraft,
      externalLoadKg: parsedLoad,
      reps: parsedReps,
      ...(parsedRir !== undefined ? { repsInReserve: parsedRir } : {}),
      ...(feedbackDraft !== ''
        ? {
            feedback: feedbackDraft as
              'easy' | 'normal' | 'hard' | 'discomfort',
          }
        : {}),
      completedAt: now().toISOString(),
    }

    const validation = setLogInputSchema.safeParse(candidate)
    if (!validation.success) {
      inFlightOrdinalRef.current = null
      const issue = validation.error.issues[0]
      setErrorMessage(
        issue?.message ?? 'Enter valid finite load and completed reps (>= 1).',
      )
      return
    }

    setIsSubmitting(true)
    try {
      const created = await logWorkoutSet(validation.data, database)
      await onChanged?.()
      setStatusMessage(
        `Logged Set #${created.ordinal} (${created.kind === 'working' ? 'Working' : 'Warm-up'}: ${formatLoadValue(created.externalLoadKg)} × ${created.reps} reps).`,
      )
    } catch (error) {
      if (error instanceof DuplicateSetOrdinalError) {
        // Ignore duplicate tap if already committed at this ordinal.
        await onChanged?.()
      } else {
        setErrorMessage(
          error instanceof Error ? error.message : 'Could not log set.',
        )
      }
    } finally {
      inFlightOrdinalRef.current = null
      setIsSubmitting(false)
    }
  }

  const handleStartEditSet = (set: SetLog) => {
    setEditingSetId(set.id)
    setEditKind(set.kind)
    setEditLoad(set.externalLoadKg === null ? '' : String(set.externalLoadKg))
    setEditReps(String(set.reps))
    setEditRir(set.repsInReserve === undefined ? '' : String(set.repsInReserve))
    setEditFeedback(set.feedback ?? '')
    setErrorMessage(null)
    setStatusMessage(null)
  }

  const handleSaveEditSet = async (set: SetLog) => {
    setErrorMessage(null)
    setStatusMessage(null)

    const parsedLoad = parseOptionalLoadKg(editLoad)
    const parsedReps = parseStrictInteger(editReps)
    const parsedRir = parseOptionalRir(editRir)

    const candidate = {
      sessionId: set.sessionId,
      sessionExerciseId: set.sessionExerciseId,
      ordinal: set.ordinal,
      kind: editKind,
      externalLoadKg: parsedLoad,
      reps: parsedReps,
      ...(parsedRir !== undefined ? { repsInReserve: parsedRir } : {}),
      ...(editFeedback !== ''
        ? {
            feedback: editFeedback as 'easy' | 'normal' | 'hard' | 'discomfort',
          }
        : {}),
      completedAt: set.completedAt,
    }

    const validation = setLogInputSchema.safeParse(candidate)
    if (!validation.success) {
      const issue = validation.error.issues[0]
      setErrorMessage(
        issue?.message ?? 'Enter valid finite load and completed reps (>= 1).',
      )
      return
    }

    setIsSubmitting(true)
    try {
      const updated = await editWorkoutSet(
        {
          ...validation.data,
          id: set.id,
        },
        database,
      )
      setEditingSetId(null)
      await onChanged?.()
      setStatusMessage(
        `Updated Set #${updated.ordinal} (${formatLoadValue(updated.externalLoadKg)} × ${updated.reps} reps).`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not update set.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUndoSet = async (set: SetLog) => {
    setIsSubmitting(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await undoWorkoutSet(set.id, database)
      if (editingSetId === set.id) {
        setEditingSetId(null)
      }
      await onChanged?.()
      setStatusMessage(`Undid Set #${set.ordinal} for ${positionLabel}.`)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not undo set.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      role="region"
      aria-label={`Set logger for ${positionLabel}`}
      className="mt-3 space-y-3 border-t border-[var(--line)] pt-3 text-sm"
    >
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 text-xs sm:grid-cols-2">
        <div>
          <span className="font-semibold">Planned target:</span>{' '}
          {sessionExercise.targetSets} working sets ×{' '}
          {sessionExercise.targetRepMin}–{sessionExercise.targetRepMax} reps (
          {sessionExercise.restSeconds}s rest)
        </div>
        <div>
          <span className="font-semibold">Previous:</span>{' '}
          <span>{formatPreviousWorkingSets(previousWorkingSets)}</span>
        </div>
      </div>

      <div
        aria-label={`Progression suggestion for ${positionLabel}`}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-xs"
      >
        <span className="font-semibold">Progression:</span>
        <span
          data-progression-status={progression.status}
          className={
            progression.status === 'eligible_to_increase'
              ? 'rounded border border-[var(--accent)] bg-[var(--selected)] px-2 py-0.5 font-semibold text-[var(--accent)]'
              : progression.status === 'review_exercise'
                ? 'rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 font-semibold'
                : 'rounded border border-[var(--line)] px-2 py-0.5 font-medium'
          }
        >
          {formatProgressionBadgeLabel(progression.status)}
        </span>
        <span className="text-muted">{progression.reason}</span>
      </div>

      <div>
        <h4 className="text-xs font-semibold">
          Completed sets ({workingCount} working, {warmupCount} warm-up)
        </h4>
        {sortedSets.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            No sets completed yet for {positionLabel}.
          </p>
        ) : (
          <ol
            aria-label={`Completed sets for ${positionLabel}`}
            className="mt-2 space-y-2"
          >
            {sortedSets.map((set) => {
              const isEditing = editingSetId === set.id
              return (
                <li
                  key={set.id}
                  className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3"
                >
                  {!isEditing ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold">
                          Set #{set.ordinal}
                        </span>{' '}
                        <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-xs">
                          {set.kind === 'working' ? 'Working' : 'Warm-up'}
                        </span>{' '}
                        — {formatLoadValue(set.externalLoadKg)} × {set.reps}{' '}
                        reps
                        {set.repsInReserve !== undefined
                          ? ` · RIR ${set.repsInReserve}`
                          : ''}
                        {set.feedback ? ` · ${set.feedback}` : ''}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isSubmitting}
                          aria-label={`Edit set #${set.ordinal} for ${positionLabel}`}
                          onClick={() => handleStartEditSet(set)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          aria-label={`Undo set #${set.ordinal} for ${positionLabel}`}
                          onClick={() => void handleUndoSet(set)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-medium"
                        >
                          Undo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold">
                        Editing Set #{set.ordinal} ({positionLabel})
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <label className="block text-xs font-medium">
                          Edit kind (Set #{set.ordinal})
                          <select
                            value={editKind}
                            onChange={(event) =>
                              setEditKind(
                                event.target.value as 'working' | 'warmup',
                              )
                            }
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                          >
                            <option value="working">Working</option>
                            <option value="warmup">Warm-up</option>
                          </select>
                        </label>

                        <label className="block text-xs font-medium">
                          Edit load kg (Set #{set.ordinal})
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            value={editLoad}
                            placeholder="Blank = bodyweight"
                            onChange={(event) =>
                              setEditLoad(event.target.value)
                            }
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                          />
                        </label>

                        <label className="block text-xs font-medium">
                          Edit reps (Set #{set.ordinal})
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            value={editReps}
                            onChange={(event) =>
                              setEditReps(event.target.value)
                            }
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                          />
                        </label>

                        <label className="block text-xs font-medium">
                          Edit RIR (Set #{set.ordinal})
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={10}
                            step="any"
                            value={editRir}
                            placeholder="Optional"
                            onChange={(event) => setEditRir(event.target.value)}
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                          />
                        </label>

                        <label className="block text-xs font-medium">
                          Edit feedback (Set #{set.ordinal})
                          <select
                            value={editFeedback}
                            onChange={(event) =>
                              setEditFeedback(event.target.value)
                            }
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                          >
                            <option value="">None</option>
                            <option value="easy">Easy</option>
                            <option value="normal">Normal</option>
                            <option value="hard">Hard</option>
                            <option value="discomfort">Discomfort</option>
                          </select>
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isSubmitting}
                          aria-label={`Save set #${set.ordinal} for ${positionLabel}`}
                          onClick={() => void handleSaveEditSet(set)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
                        >
                          Save changes
                        </button>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setEditingSetId(null)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                        >
                          Cancel edit
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3">
        <p className="text-xs font-semibold">
          Next set #{nextOrdinal} — Planned prefill (confirm actual values to
          log)
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div>
            <label htmlFor={kindInputId} className="block text-xs font-medium">
              Set kind ({positionLabel})
            </label>
            <select
              id={kindInputId}
              value={kindDraft}
              onChange={(event) =>
                setKindDraft(event.target.value as 'working' | 'warmup')
              }
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              <option value="working">Working</option>
              <option value="warmup">Warm-up</option>
            </select>
          </div>

          <div>
            <label htmlFor={loadInputId} className="block text-xs font-medium">
              Load kg ({positionLabel})
            </label>
            <input
              id={loadInputId}
              type="number"
              inputMode="decimal"
              step="any"
              value={loadDraft}
              placeholder="Blank = bodyweight"
              onChange={(event) => setLoadDraft(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label htmlFor={repsInputId} className="block text-xs font-medium">
              Actual reps ({positionLabel})
            </label>
            <input
              id={repsInputId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={repsDraft}
              onChange={(event) => setRepsDraft(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label htmlFor={rirInputId} className="block text-xs font-medium">
              RIR 0–10 ({positionLabel})
            </label>
            <input
              id={rirInputId}
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step="any"
              value={rirDraft}
              placeholder="Optional"
              onChange={(event) => setRirDraft(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor={feedbackInputId}
              className="block text-xs font-medium"
            >
              Feedback ({positionLabel})
            </label>
            <select
              id={feedbackInputId}
              value={feedbackDraft}
              onChange={(event) => setFeedbackDraft(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            >
              <option value="">None</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
              <option value="discomfort">Discomfort</option>
            </select>
          </div>
        </div>

        <div>
          <button
            type="button"
            disabled={isSubmitting}
            aria-label={`Log set for ${positionLabel}`}
            onClick={() => void handleLogNextSet()}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            Log set #{nextOrdinal}
          </button>
        </div>
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
