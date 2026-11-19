import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import {
  deleteBodyWeight,
  getAppSettings,
  listBodyWeights,
  MAX_BODY_WEIGHT_NOTE_LENGTH,
  saveBodyWeight,
  setPromptWeightBeforeWorkout,
} from '../../data/repositories'
import {
  bodyWeightEntrySchema,
  bodyWeightInputSchema,
} from '../../data/validation'
import {
  type BodyWeightTrendSummary,
  computeBodyWeightTrend,
  formatWeightDeltaKg,
  formatWeightKg,
} from '../../domain/analytics'
import type { BodyWeightEntry, IANATimeZone, ID } from '../../domain/models'
import {
  getDefaultTimeZone,
  getLocalDate,
  toUTCISOString,
} from '../../domain/time'

export interface BodyWeightTrackerProps {
  database?: PersonalTrackerDB
  now?: () => Date
  timeZone?: IANATimeZone
}

function parseStrictWeightKg(raw: string): number {
  const trimmed = raw.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

function formatEntryTime(occurredAt: string, timeZone: IANATimeZone): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(occurredAt))
    return `${formatted} (${timeZone})`
  } catch {
    return occurredAt
  }
}

function BodyWeightTrendChart({ trend }: { trend: BodyWeightTrendSummary }) {
  const width = 320
  const height = 132
  const padLeft = 24
  const padRight = 24
  const padTop = 18
  const padBottom = 28
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const minVal = trend.minKg ?? 0
  const maxVal = trend.maxKg ?? 0
  const span = maxVal - minVal

  const points = trend.days.map((day, index) => {
    const x =
      padLeft +
      (trend.days.length > 1
        ? (index / (trend.days.length - 1)) * plotWidth
        : plotWidth / 2)
    if (day.weightKg === null) {
      return { day, x, y: null }
    }
    const normalizedY = span === 0 ? 0.5 : (day.weightKg - minVal) / span
    const y = padTop + (1 - normalizedY) * plotHeight
    return { day, x, y }
  })

  const availablePoints = points.filter(
    (
      point,
    ): point is { day: (typeof points)[number]['day']; x: number; y: number } =>
      point.y !== null,
  )

  const polylinePoints = availablePoints
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ')

  return (
    <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold">
          7-calendar-day trend ({trend.windowStartDate} to {trend.windowEndDate}
          )
        </span>
        <span className="rounded border border-[var(--line)] px-2 py-0.5 font-medium">
          {trend.availabilityLabel}
        </span>
      </div>

      {trend.availableDaysCount === 0 ? (
        <p className="rounded border border-[var(--line)] bg-[var(--raised)] p-3 text-xs text-muted">
          No body-weight check-ins recorded in the last 7 calendar days. Missing
          days are not counted as zero.
        </p>
      ) : (
        <svg
          role="img"
          aria-label={trend.textSummary}
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full max-w-md"
        >
          <title>{trend.textSummary}</title>
          <line
            x1={padLeft}
            y1={height - padBottom}
            x2={width - padRight}
            y2={height - padBottom}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
          {availablePoints.length >= 2 && (
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polylinePoints}
            />
          )}
          {points.map(({ day, x, y }) => (
            <g key={day.localDate}>
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                opacity={0.7}
              >
                {day.localDate.slice(5)}
              </text>
              {y !== null && (
                <>
                  <circle cx={x} cy={y} r={4} fill="var(--accent)" />
                  <text
                    x={x}
                    y={Math.max(11, y - 8)}
                    textAnchor="middle"
                    fontSize={9}
                    fill="currentColor"
                  >
                    {Number(day.weightKg!.toFixed(1))}
                  </text>
                </>
              )}
            </g>
          ))}
        </svg>
      )}

      <p
        aria-label="7-day body-weight text summary"
        className="text-xs text-muted"
      >
        {trend.textSummary}
      </p>
    </div>
  )
}

export function BodyWeightTracker({
  database = db,
  now = () => new Date(),
  timeZone,
}: BodyWeightTrackerProps) {
  const weightInputId = useId()
  const noteInputId = useId()
  const promptToggleId = useId()

  const activeTimeZone = useMemo(
    () => timeZone ?? getDefaultTimeZone(),
    [timeZone],
  )

  const [entries, setEntries] = useState<BodyWeightEntry[]>([])
  const [promptEnabled, setPromptEnabled] = useState(false)

  const [weightDraft, setWeightDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')

  const [editingEntryId, setEditingEntryId] = useState<ID | null>(null)
  const [editWeightDraft, setEditWeightDraft] = useState('')
  const [editNoteDraft, setEditNoteDraft] = useState('')

  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reloadData = useCallback(async () => {
    try {
      const [loadedEntries, loadedSettings] = await Promise.all([
        listBodyWeights(database),
        getAppSettings(database),
      ])
      setEntries(loadedEntries)
      setPromptEnabled(loadedSettings?.promptWeightBeforeWorkout ?? false)
      setErrorMessage(null)
    } catch {
      setErrorMessage('Could not load body-weight records.')
    } finally {
      setIsLoading(false)
    }
  }, [database])

  useEffect(() => {
    let active = true
    void Promise.all([listBodyWeights(database), getAppSettings(database)])
      .then(([loadedEntries, loadedSettings]) => {
        if (!active) return
        setEntries(loadedEntries)
        setPromptEnabled(loadedSettings?.promptWeightBeforeWorkout ?? false)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setErrorMessage('Could not load body-weight records.')
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [database])

  const referenceLocalDate = getLocalDate(toUTCISOString(now()), activeTimeZone)
  const trend = useMemo(
    () => computeBodyWeightTrend(entries, referenceLocalDate),
    [entries, referenceLocalDate],
  )

  const handleAddCheckIn = async () => {
    setErrorMessage(null)
    setStatusMessage(null)

    const occurredAt = toUTCISOString(now())
    const localDate = getLocalDate(occurredAt, activeTimeZone)
    const parsedWeight = parseStrictWeightKg(weightDraft)
    const trimmedNote = noteDraft.trim()

    const candidate = {
      weightKg: parsedWeight,
      occurredAt,
      localDate,
      timeZone: activeTimeZone,
      ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
    }

    const validation = bodyWeightInputSchema.safeParse(candidate)
    if (!validation.success) {
      const issue = validation.error.issues[0]
      setErrorMessage(
        issue?.message ?? 'Enter a positive finite body weight in kg.',
      )
      return
    }

    setIsBusy(true)
    try {
      const saved = await saveBodyWeight(validation.data, database)
      setWeightDraft('')
      setNoteDraft('')
      await reloadData()
      setStatusMessage(
        `Logged ${formatWeightKg(saved.weightKg)} for ${saved.localDate}.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not save body-weight check-in.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleStartEdit = (entry: BodyWeightEntry) => {
    setEditingEntryId(entry.id)
    setEditWeightDraft(String(entry.weightKg))
    setEditNoteDraft(entry.note ?? '')
    setErrorMessage(null)
    setStatusMessage(null)
  }

  const handleSaveEdit = async (entry: BodyWeightEntry) => {
    setErrorMessage(null)
    setStatusMessage(null)

    const parsedWeight = parseStrictWeightKg(editWeightDraft)
    const trimmedNote = editNoteDraft.trim()

    const candidate = {
      id: entry.id,
      weightKg: parsedWeight,
      occurredAt: entry.occurredAt,
      localDate: entry.localDate,
      timeZone: entry.timeZone,
      ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
    }

    const validation = bodyWeightEntrySchema.safeParse(candidate)
    if (!validation.success) {
      const issue = validation.error.issues[0]
      setErrorMessage(
        issue?.message ?? 'Enter a positive finite body weight in kg.',
      )
      return
    }

    setIsBusy(true)
    try {
      const updated = await saveBodyWeight(validation.data, database)
      setEditingEntryId(null)
      await reloadData()
      setStatusMessage(
        `Updated check-in on ${updated.localDate} to ${formatWeightKg(updated.weightKg)}.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not update body-weight check-in.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleDeleteEntry = async (entry: BodyWeightEntry) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await deleteBodyWeight(entry.id, database)
      if (editingEntryId === entry.id) {
        setEditingEntryId(null)
      }
      await reloadData()
      setStatusMessage(
        `Deleted ${formatWeightKg(entry.weightKg)} check-in from ${entry.localDate}.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not delete body-weight check-in.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleTogglePreWorkoutPrompt = async (enabled: boolean) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await setPromptWeightBeforeWorkout(enabled, database)
      setPromptEnabled(enabled)
      setStatusMessage(
        enabled
          ? 'Pre-workout weight check-in prompt enabled (always skippable).'
          : 'Pre-workout weight check-in prompt disabled.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not update workout prompt preference.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section
      aria-label="Body weight and 7-day trend"
      className="mt-6 space-y-4 rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4"
    >
      <div>
        <h2 className="text-xl font-semibold">Body weight &amp; trend</h2>
        <p className="mt-1 text-xs text-muted">
          Log positive weights in kg with local date and IANA time zone (
          {activeTimeZone}). Multiple daily entries are preserved individually
          and collapsed to each day&apos;s latest reading only for the 7-day
          trend.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <p className="text-xs text-muted">Current</p>
          <p className="mt-1 text-lg font-semibold">
            {trend.currentEntry
              ? formatWeightKg(trend.currentEntry.weightKg)
              : '—'}
          </p>
          <p className="text-xs text-muted">
            {trend.currentEntry
              ? `${trend.currentEntry.localDate}`
              : 'No check-ins yet'}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <p className="text-xs text-muted">Previous</p>
          <p className="mt-1 text-lg font-semibold">
            {trend.previousEntry
              ? formatWeightKg(trend.previousEntry.weightKg)
              : '—'}
          </p>
          <p className="text-xs text-muted">
            {trend.deltaFromPreviousKg !== null
              ? `Change: ${formatWeightDeltaKg(trend.deltaFromPreviousKg)}`
              : 'Need 2+ check-ins'}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <p className="text-xs text-muted">7-day average</p>
          <p className="mt-1 text-lg font-semibold">
            {trend.averageKg !== null ? formatWeightKg(trend.averageKg) : '—'}
          </p>
          <p className="text-xs text-muted">{trend.availabilityLabel}</p>
        </div>
      </div>

      <BodyWeightTrendChart trend={trend} />

      <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
        <h3 className="text-sm font-semibold">Add body-weight check-in</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_auto]">
          <div>
            <label
              htmlFor={weightInputId}
              className="block text-xs font-medium"
            >
              Weight (kg)
            </label>
            <input
              id={weightInputId}
              type="number"
              inputMode="decimal"
              step="any"
              value={weightDraft}
              placeholder="e.g., 78.4"
              onChange={(event) => setWeightDraft(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor={noteInputId} className="block text-xs font-medium">
              Optional note
            </label>
            <input
              id={noteInputId}
              type="text"
              maxLength={MAX_BODY_WEIGHT_NOTE_LENGTH}
              value={noteDraft}
              placeholder="e.g., Morning check-in"
              onChange={(event) => setNoteDraft(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleAddCheckIn()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
            >
              Log weight
            </button>
          </div>
        </div>

        <label
          htmlFor={promptToggleId}
          className="flex min-h-11 items-center gap-2 pt-1 text-xs font-medium"
        >
          <input
            id={promptToggleId}
            type="checkbox"
            checked={promptEnabled}
            disabled={isBusy}
            onChange={(event) =>
              void handleTogglePreWorkoutPrompt(event.target.checked)
            }
            className="h-4 w-4"
          />
          <span>Offer skippable weight check-in before starting a workout</span>
        </label>
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
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-medium"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => void reloadData()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
          >
            Retry
          </button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">
          Recorded check-ins ({entries.length})
        </h3>
        {isLoading ? (
          <p className="mt-2 text-sm text-muted">
            Loading body-weight check-ins…
          </p>
        ) : entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No body-weight check-ins logged yet.
          </p>
        ) : (
          <ul
            aria-label="Body-weight check-ins"
            className="mt-2 space-y-2 text-sm"
          >
            {entries.map((entry) => {
              const isEditing = editingEntryId === entry.id
              return (
                <li
                  key={entry.id}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
                >
                  {!isEditing ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold">
                          {formatWeightKg(entry.weightKg)}
                        </span>{' '}
                        <span className="text-xs text-muted">
                          · {entry.localDate} at{' '}
                          {formatEntryTime(entry.occurredAt, entry.timeZone)}
                        </span>
                        {entry.note && (
                          <p className="mt-0.5 text-xs text-muted">
                            Note: {entry.note}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={`Edit ${formatWeightKg(entry.weightKg)} on ${entry.localDate}`}
                          onClick={() => handleStartEdit(entry)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={`Delete ${formatWeightKg(entry.weightKg)} on ${entry.localDate}`}
                          onClick={() => void handleDeleteEntry(entry)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold">
                        Editing check-in from {entry.localDate}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="block text-xs font-medium">
                          Edit weight (kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            value={editWeightDraft}
                            onChange={(event) =>
                              setEditWeightDraft(event.target.value)
                            }
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-1.5 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium">
                          Edit note
                          <input
                            type="text"
                            maxLength={MAX_BODY_WEIGHT_NOTE_LENGTH}
                            value={editNoteDraft}
                            onChange={(event) =>
                              setEditNoteDraft(event.target.value)
                            }
                            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-1.5 text-sm"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSaveEdit(entry)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
                        >
                          Save changes
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setEditingEntryId(null)}
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
          </ul>
        )}
      </div>
    </section>
  )
}
