import { useEffect, useRef, useState } from 'react'
import { db, type PersonalTrackerDB } from '../../data/db'
import type { ID, UTCISOString } from '../../domain/models'
import {
  adjustRestTimerDeadline,
  formatCountdownMMSS,
  getRemainingRestSeconds,
} from '../../domain/time'
import {
  clearRestTimerForSession,
  setRestTimerDeadlineForSession,
  startRestTimerForSession,
} from '../../services/workout'

export interface WakeLockSentinelLike {
  released?: boolean
  release: () => Promise<void>
}

export interface WakeLockAdapter {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

export type WakeLockStatus = 'unsupported' | 'off' | 'active' | 'denied'

export interface RestTimerProps {
  sessionId: ID
  restTimer?: { sessionId: ID; endsAt: UTCISOString }
  defaultRestSeconds?: number
  database?: PersonalTrackerDB
  now?: () => Date
  wakeLockApi?: WakeLockAdapter | null
  onChanged?: () => void | Promise<void>
}

export function RestTimer({
  sessionId,
  restTimer,
  defaultRestSeconds = 90,
  database = db,
  now = () => new Date(),
  wakeLockApi,
  onChanged,
}: RestTimerProps) {
  const resolvedWakeLock: WakeLockAdapter | null =
    wakeLockApi === undefined
      ? ((
          globalThis.navigator as Navigator & {
            wakeLock?: WakeLockAdapter
          }
        )?.wakeLock ?? null)
      : wakeLockApi

  const [, setTick] = useState(0)
  const [pausedRemainingSeconds, setPausedRemainingSeconds] = useState<
    number | null
  >(null)
  const [localTimerState, setLocalTimerState] = useState<{
    propEndsAt: UTCISOString | undefined
    currentEndsAt: UTCISOString | undefined
  }>({
    propEndsAt:
      restTimer?.sessionId === sessionId ? restTimer.endsAt : undefined,
    currentEndsAt:
      restTimer?.sessionId === sessionId ? restTimer.endsAt : undefined,
  })
  const [isBusy, setIsBusy] = useState(false)

  const [wakeLockDesired, setWakeLockDesired] = useState(false)
  const [wakeLockStatus, setWakeLockStatus] = useState<WakeLockStatus>(() =>
    resolvedWakeLock && typeof resolvedWakeLock.request === 'function'
      ? 'off'
      : 'unsupported',
  )
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)

  const propEndsAt =
    restTimer?.sessionId === sessionId ? restTimer.endsAt : undefined
  const activeEndsAt =
    localTimerState.propEndsAt !== propEndsAt
      ? propEndsAt
      : localTimerState.currentEndsAt

  const remainingSeconds =
    pausedRemainingSeconds !== null
      ? pausedRemainingSeconds
      : activeEndsAt
        ? getRemainingRestSeconds(activeEndsAt, now())
        : 0

  const isRunning =
    pausedRemainingSeconds === null &&
    activeEndsAt !== undefined &&
    remainingSeconds > 0
  const isCompleted =
    pausedRemainingSeconds === null &&
    activeEndsAt !== undefined &&
    remainingSeconds === 0
  const isPaused = pausedRemainingSeconds !== null

  // Display refresh interval and visibility/focus recalculation; wall-clock endsAt is authority.
  useEffect(() => {
    if (!activeEndsAt || pausedRemainingSeconds !== null) return

    const refreshFromWallClock = () => {
      setTick((prev) => prev + 1)
    }

    const currentRemaining = getRemainingRestSeconds(activeEndsAt, now())
    const intervalId =
      currentRemaining > 0
        ? window.setInterval(() => {
            const nextRemaining = getRemainingRestSeconds(activeEndsAt, now())
            setTick((prev) => prev + 1)
            if (nextRemaining <= 0) {
              window.clearInterval(intervalId)
            }
          }, 250)
        : undefined

    document.addEventListener('visibilitychange', refreshFromWallClock)
    window.addEventListener('focus', refreshFromWallClock)

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
      }
      document.removeEventListener('visibilitychange', refreshFromWallClock)
      window.removeEventListener('focus', refreshFromWallClock)
    }
  }, [activeEndsAt, now, pausedRemainingSeconds])

  // Reacquire Wake Lock on visibility return and release on unmount / leaving Gym Mode.
  useEffect(() => {
    if (
      !wakeLockDesired ||
      !resolvedWakeLock ||
      typeof resolvedWakeLock.request !== 'function'
    ) {
      return
    }

    let cancelled = false

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || cancelled) return
      void resolvedWakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) {
            void sentinel.release().catch(() => undefined)
            return
          }
          sentinelRef.current = sentinel
          setWakeLockStatus('active')
        })
        .catch(() => {
          if (!cancelled) {
            setWakeLockStatus('denied')
          }
        })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [resolvedWakeLock, wakeLockDesired])

  useEffect(() => {
    return () => {
      if (sentinelRef.current) {
        void sentinelRef.current.release().catch(() => undefined)
        sentinelRef.current = null
      }
    }
  }, [])

  const handleToggleWakeLock = async () => {
    if (!resolvedWakeLock || typeof resolvedWakeLock.request !== 'function') {
      setWakeLockStatus('unsupported')
      return
    }

    if (wakeLockDesired) {
      setWakeLockDesired(false)
      if (sentinelRef.current) {
        await sentinelRef.current.release().catch(() => undefined)
        sentinelRef.current = null
      }
      setWakeLockStatus('off')
      return
    }

    setWakeLockDesired(true)
    try {
      const sentinel = await resolvedWakeLock.request('screen')
      sentinelRef.current = sentinel
      setWakeLockStatus('active')
    } catch {
      sentinelRef.current = null
      setWakeLockStatus('denied')
    }
  }

  const handlePause = async () => {
    if (!activeEndsAt) return
    const snapshotSeconds = getRemainingRestSeconds(activeEndsAt, now())
    setIsBusy(true)
    try {
      setPausedRemainingSeconds(snapshotSeconds)
      await clearRestTimerForSession(sessionId, database)
      setLocalTimerState({ propEndsAt, currentEndsAt: undefined })
      await onChanged?.()
    } finally {
      setIsBusy(false)
    }
  }

  const handleResume = async () => {
    if (pausedRemainingSeconds === null) return
    setIsBusy(true)
    try {
      const resumeSeconds = pausedRemainingSeconds
      setPausedRemainingSeconds(null)
      const updated = await startRestTimerForSession(
        sessionId,
        resumeSeconds,
        now(),
        database,
      )
      setLocalTimerState({
        propEndsAt,
        currentEndsAt: updated?.restTimer?.endsAt,
      })
      await onChanged?.()
    } finally {
      setIsBusy(false)
    }
  }

  const handleAdjust = async (deltaSeconds: number) => {
    if (pausedRemainingSeconds !== null) {
      setPausedRemainingSeconds(
        Math.max(0, pausedRemainingSeconds + deltaSeconds),
      )
      return
    }
    if (!activeEndsAt) return
    setIsBusy(true)
    try {
      const nextEndsAt = adjustRestTimerDeadline(
        activeEndsAt,
        deltaSeconds,
        now(),
      )
      await setRestTimerDeadlineForSession(sessionId, nextEndsAt, database)
      setLocalTimerState({ propEndsAt, currentEndsAt: nextEndsAt })
      await onChanged?.()
    } finally {
      setIsBusy(false)
    }
  }

  const handleSkip = async () => {
    setIsBusy(true)
    try {
      setPausedRemainingSeconds(null)
      await clearRestTimerForSession(sessionId, database)
      setLocalTimerState({ propEndsAt, currentEndsAt: undefined })
      await onChanged?.()
    } finally {
      setIsBusy(false)
    }
  }

  const handleRestart = async () => {
    setIsBusy(true)
    try {
      setPausedRemainingSeconds(null)
      const updated = await startRestTimerForSession(
        sessionId,
        defaultRestSeconds,
        now(),
        database,
      )
      setLocalTimerState({
        propEndsAt,
        currentEndsAt: updated?.restTimer?.endsAt,
      })
      await onChanged?.()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div
      role="region"
      aria-label="Rest countdown timer"
      className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Rest timer</p>
          <p className="text-xs text-muted">
            {isRunning && `Counting down to ${activeEndsAt}`}
            {isPaused && 'Timer paused'}
            {isCompleted && 'Rest complete — ready for next set'}
            {!isRunning &&
              !isPaused &&
              !isCompleted &&
              'Starts automatically when you log a set, or start manually'}
          </p>
        </div>

        <div
          aria-live="polite"
          aria-label="Remaining rest time"
          className="text-2xl font-bold tabular-nums"
        >
          {formatCountdownMMSS(remainingSeconds)}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isRunning && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handlePause()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold"
          >
            Pause rest
          </button>
        )}

        {isPaused && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleResume()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
          >
            Resume rest
          </button>
        )}

        {(isRunning || isPaused || isCompleted) && (
          <>
            <button
              type="button"
              disabled={isBusy}
              aria-label="Adjust rest timer -15 seconds"
              onClick={() => void handleAdjust(-15)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              -15s
            </button>
            <button
              type="button"
              disabled={isBusy}
              aria-label="Adjust rest timer +15 seconds"
              onClick={() => void handleAdjust(15)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              +15s
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleSkip()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
            >
              Skip rest
            </button>
          </>
        )}

        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleRestart()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium"
        >
          Restart ({defaultRestSeconds}s)
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3 text-xs">
        <div className="space-y-0.5">
          <p className="font-medium">
            Screen Wake Lock:{' '}
            {wakeLockStatus === 'active' && 'Active while Gym Mode is visible'}
            {wakeLockStatus === 'off' && 'Off'}
            {wakeLockStatus === 'denied' &&
              'Unavailable / declined (timer still tracks wall clock)'}
            {wakeLockStatus === 'unsupported' &&
              'Not supported in this browser'}
          </p>
          <p className="text-muted">
            Countdown refreshes from wall-clock UTC time on reopen; background
            push notifications are not guaranteed.
          </p>
        </div>

        {wakeLockStatus !== 'unsupported' && (
          <button
            type="button"
            aria-pressed={wakeLockStatus === 'active'}
            onClick={() => void handleToggleWakeLock()}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              wakeLockStatus === 'active'
                ? 'border-[var(--accent)] bg-[var(--selected)] text-[var(--accent)]'
                : 'border-[var(--line)]'
            }`}
          >
            {wakeLockStatus === 'active'
              ? 'Keep screen awake: On'
              : 'Keep screen awake'}
          </button>
        )}
      </div>
    </div>
  )
}
