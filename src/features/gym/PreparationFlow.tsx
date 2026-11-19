import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  MAX_PREPARATION_LABEL_LENGTH,
  MAX_PREPARATION_NOTE_LENGTH,
  savePreparationPreferences,
} from '../../data/repositories'
import { preparationStepSchema } from '../../data/validation'
import { createId } from '../../domain/id'
import type {
  ID,
  PreparationPreferences,
  PreparationStep,
  UTCISOString,
} from '../../domain/models'
import {
  calculateRestTimerDeadline,
  formatCountdownMMSS,
  getRemainingRestSeconds,
} from '../../domain/time'

const DEFAULT_PREPARATION_STEPS: readonly PreparationStep[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    phase: 'warmup',
    label: 'Cross-trainer / light cardio',
    durationSeconds: 300,
    note: 'Easy pace at your own comfortable setting.',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    phase: 'warmup',
    label: 'Dynamic mobility',
    durationSeconds: 180,
    note: 'Gentle controlled range of motion.',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    phase: 'warmup',
    label: 'Light exercise-specific warm-up',
    durationSeconds: 120,
    note: 'Light movement prep before working sets.',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    phase: 'cooldown',
    label: 'Gentle stretching / cooldown',
    durationSeconds: 180,
    note: 'Optional relaxed stretching and breathing.',
  },
]

export interface PreparationFlowProps {
  preferences?: PreparationPreferences
  database?: PersonalTrackerDB
  now?: () => Date
  onPreferencesChanged?: () => void | Promise<void>
}

interface ActiveStepTimer {
  stepId: ID
  label: string
  endsAt: UTCISOString | null
  pausedRemainingSeconds: number | null
}

function parseStrictNonNegativeInt(raw: string): number {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

export function PreparationFlow({
  preferences,
  database = db,
  now = () => new Date(),
  onPreferencesChanged,
}: PreparationFlowProps) {
  const phaseInputId = useId()
  const labelInputId = useId()
  const durationInputId = useId()
  const noteInputId = useId()

  const steps = useMemo(
    () =>
      preferences !== undefined
        ? preferences.steps
        : [...DEFAULT_PREPARATION_STEPS],
    [preferences],
  )

  const [isExpanded, setIsExpanded] = useState(false)
  const [isBypassed, setIsBypassed] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const [stepStates, setStepStates] = useState<
    Record<ID, 'done' | 'skipped' | undefined>
  >({})

  const [activeTimer, setActiveTimer] = useState<ActiveStepTimer | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0)

  const [phaseDraft, setPhaseDraft] = useState<'warmup' | 'cooldown'>('warmup')
  const [labelDraft, setLabelDraft] = useState('')
  const [durationDraft, setDurationDraft] = useState('120')
  const [noteDraft, setNoteDraft] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const syncRemainingFromWallClock = useCallback(() => {
    if (!activeTimer) {
      setRemainingSeconds(0)
      return
    }
    if (activeTimer.pausedRemainingSeconds !== null) {
      setRemainingSeconds(activeTimer.pausedRemainingSeconds)
      return
    }
    if (!activeTimer.endsAt) {
      setRemainingSeconds(0)
      return
    }
    const remaining = getRemainingRestSeconds(activeTimer.endsAt, now())
    setRemainingSeconds(remaining)
    if (remaining <= 0) {
      setActiveTimer(null)
    }
  }, [activeTimer, now])

  useEffect(() => {
    if (
      !activeTimer ||
      activeTimer.pausedRemainingSeconds !== null ||
      !activeTimer.endsAt
    ) {
      return
    }

    const tick = () => {
      const remaining = getRemainingRestSeconds(activeTimer.endsAt!, now())
      setRemainingSeconds(remaining)
      if (remaining <= 0) {
        setActiveTimer(null)
      }
    }

    const intervalId = window.setInterval(tick, 1000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick()
      }
    }
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [activeTimer, now])

  const warmupSteps = useMemo(
    () => steps.filter((step) => step.phase === 'warmup'),
    [steps],
  )
  const cooldownSteps = useMemo(
    () => steps.filter((step) => step.phase === 'cooldown'),
    [steps],
  )

  const warmupCompleted = warmupSteps.filter(
    (step) => stepStates[step.id] === 'done',
  ).length
  const cooldownCompleted = cooldownSteps.filter(
    (step) => stepStates[step.id] === 'done',
  ).length

  const handleStartStepTimer = (step: PreparationStep) => {
    if (step.durationSeconds <= 0) return
    const endsAt = calculateRestTimerDeadline(now(), step.durationSeconds)
    setActiveTimer({
      stepId: step.id,
      label: step.label,
      endsAt,
      pausedRemainingSeconds: null,
    })
    setRemainingSeconds(step.durationSeconds)
  }

  const handlePauseTimer = () => {
    if (!activeTimer || !activeTimer.endsAt) return
    const currentRemaining = getRemainingRestSeconds(activeTimer.endsAt, now())
    setActiveTimer({
      ...activeTimer,
      endsAt: null,
      pausedRemainingSeconds: currentRemaining,
    })
    setRemainingSeconds(currentRemaining)
  }

  const handleResumeTimer = () => {
    if (!activeTimer || activeTimer.pausedRemainingSeconds === null) return
    if (activeTimer.pausedRemainingSeconds <= 0) {
      setActiveTimer(null)
      setRemainingSeconds(0)
      return
    }
    const endsAt = calculateRestTimerDeadline(
      now(),
      activeTimer.pausedRemainingSeconds,
    )
    setActiveTimer({
      ...activeTimer,
      endsAt,
      pausedRemainingSeconds: null,
    })
  }

  const handleSkipTimer = () => {
    setActiveTimer(null)
    setRemainingSeconds(0)
  }

  const handleBypassAll = () => {
    setIsBypassed(true)
    setIsExpanded(false)
    setActiveTimer(null)
    setRemainingSeconds(0)
  }

  const handleSkipPhase = (phase: 'warmup' | 'cooldown') => {
    const targetSteps = phase === 'warmup' ? warmupSteps : cooldownSteps
    setStepStates((current) => {
      const next = { ...current }
      for (const step of targetSteps) {
        if (next[step.id] !== 'done') {
          next[step.id] = 'skipped'
        }
      }
      return next
    })
    if (
      activeTimer &&
      targetSteps.some((step) => step.id === activeTimer.stepId)
    ) {
      setActiveTimer(null)
      setRemainingSeconds(0)
    }
  }

  const persistSteps = async (nextSteps: PreparationStep[]) => {
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await savePreparationPreferences({ steps: nextSteps }, database)
      await onPreferencesChanged?.()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not save preparation checklist preferences.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddStep = async () => {
    setErrorMessage(null)
    const parsedDuration = parseStrictNonNegativeInt(durationDraft)
    const trimmedNote = noteDraft.trim()
    const candidate = {
      id: createId(),
      phase: phaseDraft,
      label: labelDraft.trim(),
      durationSeconds: parsedDuration,
      ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
    }

    const validation = preparationStepSchema.safeParse(candidate)
    if (!validation.success) {
      setErrorMessage(
        validation.error.issues[0]?.message ??
          'Enter a step label and a nonnegative integer duration in seconds.',
      )
      return
    }

    await persistSteps([...steps, validation.data])
    setLabelDraft('')
    setDurationDraft('120')
    setNoteDraft('')
  }

  const handleRemoveStep = async (stepId: ID) => {
    if (activeTimer?.stepId === stepId) {
      setActiveTimer(null)
      setRemainingSeconds(0)
    }
    await persistSteps(steps.filter((step) => step.id !== stepId))
  }

  const handleResetDefaults = async () => {
    await persistSteps([...DEFAULT_PREPARATION_STEPS])
  }

  const renderPhase = (
    title: string,
    phase: 'warmup' | 'cooldown',
    phaseSteps: readonly PreparationStep[],
  ) => (
    <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">{title}</h4>
        {phaseSteps.length > 0 && (
          <button
            type="button"
            onClick={() => handleSkipPhase(phase)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 text-xs font-medium"
          >
            Skip {phase === 'warmup' ? 'warm-up' : 'cooldown'}
          </button>
        )}
      </div>

      {phaseSteps.length === 0 ? (
        <p className="text-xs text-muted">
          No {phase === 'warmup' ? 'warm-up' : 'cooldown'} steps configured.
        </p>
      ) : (
        <ul aria-label={`${title} checklist`} className="space-y-2">
          {phaseSteps.map((step) => {
            const state = stepStates[step.id]
            return (
              <li
                key={step.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--line)] bg-[var(--surface)] p-2.5 text-xs"
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Complete ${step.label}`}
                    checked={state === 'done'}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setStepStates((current) => ({
                        ...current,
                        [step.id]: checked ? 'done' : undefined,
                      }))
                    }}
                    className="mt-0.5 h-4 w-4"
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{step.label}</span>
                      {step.durationSeconds > 0 && (
                        <span className="text-muted">
                          ({formatCountdownMMSS(step.durationSeconds)})
                        </span>
                      )}
                      {state && (
                        <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] font-medium">
                          {state === 'done' ? 'Done' : 'Skipped'}
                        </span>
                      )}
                    </div>
                    {step.note && (
                      <p className="mt-0.5 text-muted">{step.note}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {step.durationSeconds > 0 && (
                    <button
                      type="button"
                      aria-label={`Start timer for ${step.label}`}
                      onClick={() => handleStartStepTimer(step)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1 font-semibold text-[var(--accent)]"
                    >
                      Start timer
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Skip ${step.label}`}
                    onClick={() => {
                      setStepStates((current) => ({
                        ...current,
                        [step.id]: 'skipped',
                      }))
                      if (activeTimer?.stepId === step.id) {
                        handleSkipTimer()
                      }
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 font-medium"
                  >
                    Skip
                  </button>
                  {isEditing && (
                    <button
                      type="button"
                      disabled={isSaving}
                      aria-label={`Remove ${step.label}`}
                      onClick={() => void handleRemoveStep(step.id)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 font-medium"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  return (
    <div
      role="region"
      aria-label="Optional warm-up and cooldown"
      className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            Warm-up &amp; Cooldown (optional)
          </p>
          <p className="text-xs text-muted">
            {isBypassed
              ? 'Bypassed for this workout — does not block logging.'
              : `Warm-up ${warmupCompleted}/${warmupSteps.length} · Cooldown ${cooldownCompleted}/${cooldownSteps.length}`}
            {activeTimer &&
              ` · Active timer: ${formatCountdownMMSS(remainingSeconds)}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isBypassed ? (
            <>
              <button
                type="button"
                onClick={() => {
                  syncRemainingFromWallClock()
                  setIsExpanded((current) => !current)
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
              >
                {isExpanded ? 'Hide checklist' : 'Open checklist'}
              </button>
              <button
                type="button"
                onClick={handleBypassAll}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
              >
                Bypass all
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsBypassed(false)
                setIsExpanded(true)
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              Reopen warm-up / cooldown
            </button>
          )}
        </div>
      </div>

      {activeTimer && !isBypassed && (
        <div
          role="region"
          aria-label="Preparation step timer"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--accent)] bg-[var(--raised)] p-3 text-xs"
        >
          <div>
            <span className="font-semibold">{activeTimer.label}:</span>{' '}
            <span className="text-base font-bold tabular-nums">
              {formatCountdownMMSS(remainingSeconds)}
            </span>
            {activeTimer.pausedRemainingSeconds !== null && (
              <span className="ml-2 text-muted">(Paused)</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {activeTimer.pausedRemainingSeconds === null ? (
              <button
                type="button"
                onClick={handlePauseTimer}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 font-medium"
              >
                Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={handleResumeTimer}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1 font-semibold text-[var(--accent)]"
              >
                Resume
              </button>
            )}
            <button
              type="button"
              onClick={handleSkipTimer}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1 font-medium"
            >
              Skip timer
            </button>
          </div>
        </div>
      )}

      {isExpanded && !isBypassed && (
        <div className="space-y-3 border-t border-[var(--line)] pt-3">
          <p className="text-xs text-muted">
            General optional checklist — adjust or remove any activity based on
            your preferences or treating professional&apos;s guidance. No
            resistance or strain-safe prescriptions; timers never gate set
            logging.
          </p>

          {renderPhase('Warm-up', 'warmup', warmupSteps)}
          {renderPhase('Cooldown', 'cooldown', cooldownSteps)}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsEditing((current) => !current)
                setErrorMessage(null)
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              {isEditing ? 'Done editing checklist' : 'Edit checklist'}
            </button>
            {isEditing && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleResetDefaults()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
              >
                Reset defaults
              </button>
            )}
          </div>

          {isEditing && (
            <div
              role="region"
              aria-label="Add preparation step"
              className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 text-xs"
            >
              <p className="font-semibold">Add custom step</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <div>
                  <label htmlFor={phaseInputId} className="block font-medium">
                    Phase
                  </label>
                  <select
                    id={phaseInputId}
                    value={phaseDraft}
                    onChange={(event) =>
                      setPhaseDraft(event.target.value as 'warmup' | 'cooldown')
                    }
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                  >
                    <option value="warmup">Warm-up</option>
                    <option value="cooldown">Cooldown</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={labelInputId} className="block font-medium">
                    Step label
                  </label>
                  <input
                    id={labelInputId}
                    type="text"
                    maxLength={MAX_PREPARATION_LABEL_LENGTH}
                    value={labelDraft}
                    placeholder="e.g., Band pull-aparts"
                    onChange={(event) => setLabelDraft(event.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor={durationInputId}
                    className="block font-medium"
                  >
                    Duration (seconds)
                  </label>
                  <input
                    id={durationInputId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={durationDraft}
                    onChange={(event) => setDurationDraft(event.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor={noteInputId} className="block font-medium">
                    General note (optional)
                  </label>
                  <input
                    id={noteInputId}
                    type="text"
                    maxLength={MAX_PREPARATION_NOTE_LENGTH}
                    value={noteDraft}
                    placeholder="Optional cue"
                    onChange={(event) => setNoteDraft(event.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                  />
                </div>
              </div>

              {errorMessage && (
                <p role="alert" className="font-medium">
                  {errorMessage}
                </p>
              )}

              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleAddStep()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-1.5 font-semibold text-[var(--accent)] disabled:opacity-50"
              >
                Add step
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
