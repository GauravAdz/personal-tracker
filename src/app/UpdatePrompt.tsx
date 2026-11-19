import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { db, type PersonalTrackerDB } from '../data/db'
import { getActiveSession } from '../data/repositories/sessions'

export interface UpdatePromptProps {
  database?: PersonalTrackerDB
  needRefreshOverride?: boolean
  offlineReadyOverride?: boolean
  hasActiveWorkoutOverride?: boolean
  onAcceptUpdate?: () => void | Promise<void>
}

export function UpdatePrompt({
  database = db,
  needRefreshOverride,
  offlineReadyOverride,
  hasActiveWorkoutOverride,
  onAcceptUpdate,
}: UpdatePromptProps) {
  const {
    offlineReady: [swOfflineReady, setSwOfflineReady],
    needRefresh: [swNeedRefresh, setSwNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const [eventNeedRefresh, setEventNeedRefresh] = useState(false)
  const [dismissedUpdate, setDismissedUpdate] = useState(false)
  const [dismissedOffline, setDismissedOffline] = useState(false)
  const [hasActiveWorkout, setHasActiveWorkout] = useState<boolean>(
    hasActiveWorkoutOverride ?? false,
  )

  const showUpdatePrompt =
    !dismissedUpdate &&
    (needRefreshOverride ?? (swNeedRefresh || eventNeedRefresh))
  const showOfflineReady =
    !dismissedOffline &&
    !showUpdatePrompt &&
    (offlineReadyOverride ?? swOfflineReady)

  useEffect(() => {
    const handleUpdateEvent = () => {
      setDismissedUpdate(false)
      setEventNeedRefresh(true)
    }
    window.addEventListener(
      'personal-tracker:sw-update-available',
      handleUpdateEvent,
    )
    return () => {
      window.removeEventListener(
        'personal-tracker:sw-update-available',
        handleUpdateEvent,
      )
    }
  }, [])

  useEffect(() => {
    if (hasActiveWorkoutOverride !== undefined || !showUpdatePrompt) return
    let active = true
    void getActiveSession(database)
      .then((session) => {
        if (!active) return
        setHasActiveWorkout(session !== undefined)
      })
      .catch(() => {
        if (!active) return
        setHasActiveWorkout(false)
      })
    return () => {
      active = false
    }
  }, [database, hasActiveWorkoutOverride, showUpdatePrompt])

  if (!showUpdatePrompt && !showOfflineReady) {
    return null
  }

  const activeWorkoutProtected = hasActiveWorkoutOverride ?? hasActiveWorkout

  const handleReloadToUpdate = async () => {
    if (onAcceptUpdate) {
      await onAcceptUpdate()
      return
    }
    await updateServiceWorker(true)
  }

  const handlePostponeUpdate = () => {
    setDismissedUpdate(true)
    setDismissedOffline(true)
    setEventNeedRefresh(false)
    setSwNeedRefresh(false)
    setSwOfflineReady(false)
  }

  const handleDismissOffline = () => {
    setDismissedOffline(true)
    setSwOfflineReady(false)
  }

  return (
    <aside
      aria-label="Application update status"
      className="border-b border-[var(--line)] bg-[var(--raised)] py-3"
    >
      <div className="shell-width flex flex-wrap items-center justify-between gap-3 text-sm">
        {showUpdatePrompt ? (
          <>
            <div className="space-y-1">
              <p className="font-semibold">
                Update available: a new version of Personal Tracker is ready.
              </p>
              <p className="text-muted">
                {activeWorkoutProtected
                  ? 'Active workout in progress — the app will not reload automatically. Finish your workout or reload only when ready.'
                  : 'Reload when convenient to activate the updated version.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReloadToUpdate()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-3 py-2 font-semibold text-[var(--accent)]"
              >
                Reload to update
              </button>
              <button
                type="button"
                onClick={handlePostponeUpdate}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 font-medium"
              >
                Postpone
              </button>
            </div>
          </>
        ) : (
          <>
            <p role="status">
              Offline ready: app shell cached for offline use.
            </p>
            <button
              type="button"
              onClick={handleDismissOffline}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 font-medium"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
