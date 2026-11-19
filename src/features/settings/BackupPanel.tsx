import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react'
import {
  BackupValidationError,
  countDatabaseRecords,
  createBackupFilename,
  exportSnapshot,
  restoreSnapshotValidated,
  type ValidatedBackupResult,
  validateSnapshot,
} from '../../data/backup'
import { db, type PersonalTrackerDB } from '../../data/db'
import { getAppSettings } from '../../data/repositories/settings'
import type { UTCISOString } from '../../domain/models'

const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000

export type DownloadBackupHandler = (
  filename: string,
  jsonContent: string,
) => void

export type StoragePersistenceAdapter = {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

export type StoragePersistenceState =
  'checking' | 'granted' | 'not-granted' | 'denied' | 'unsupported'

export interface BackupPanelProps {
  database?: PersonalTrackerDB
  now?: () => Date
  onDownloadFile?: DownloadBackupHandler
  storageManager?: StoragePersistenceAdapter | null
}

function triggerBrowserJsonDownload(
  filename: string,
  jsonContent: string,
): void {
  const blob = new Blob([jsonContent], { type: 'application/json' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
  }
}

function isExportStale(
  lastExportedAt: UTCISOString | undefined,
  currentDate: Date,
): boolean {
  if (!lastExportedAt) return true
  const exportedTime = new Date(lastExportedAt).getTime()
  return currentDate.getTime() - exportedTime > EXPORT_REMINDER_MS
}

export function BackupPanel({
  database = db,
  now = () => new Date(),
  onDownloadFile = triggerBrowserJsonDownload,
  storageManager,
}: BackupPanelProps) {
  const fileInputId = useId()
  const resolvedStorage: StoragePersistenceAdapter | null =
    storageManager === undefined
      ? (globalThis.navigator?.storage ?? null)
      : storageManager
  const [storagePersistence, setStoragePersistence] =
    useState<StoragePersistenceState>(() =>
      typeof resolvedStorage?.persisted === 'function' &&
      typeof resolvedStorage?.persist === 'function'
        ? 'checking'
        : 'unsupported',
    )
  const [lastExportedAt, setLastExportedAt] = useState<
    UTCISOString | undefined
  >(undefined)
  const [localRecordCount, setLocalRecordCount] = useState<number>(0)
  const [isLoadingMeta, setIsLoadingMeta] = useState<boolean>(true)
  const [isBusy, setIsBusy] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [validatedBackup, setValidatedBackup] =
    useState<ValidatedBackupResult | null>(null)
  const [currentSnapshotDownloaded, setCurrentSnapshotDownloaded] =
    useState<boolean>(false)
  const [safetyBackupAcknowledged, setSafetyBackupAcknowledged] =
    useState<boolean>(false)
  const [replaceAllConfirmed, setReplaceAllConfirmed] = useState<boolean>(false)

  const refreshMetadata = useCallback(async () => {
    try {
      const [settings, count] = await Promise.all([
        getAppSettings(database),
        countDatabaseRecords(database),
      ])
      setLastExportedAt(settings?.lastExportedAt)
      setLocalRecordCount(count)
    } catch {
      setErrorMessage('Could not read local backup metadata.')
    } finally {
      setIsLoadingMeta(false)
    }
  }, [database])

  useEffect(() => {
    let active = true
    void Promise.all([getAppSettings(database), countDatabaseRecords(database)])
      .then(([settings, count]) => {
        if (!active) return
        setLastExportedAt(settings?.lastExportedAt)
        setLocalRecordCount(count)
        setIsLoadingMeta(false)
      })
      .catch(() => {
        if (!active) return
        setErrorMessage('Could not read local backup metadata.')
        setIsLoadingMeta(false)
      })
    return () => {
      active = false
    }
  }, [database])

  useEffect(() => {
    if (
      typeof resolvedStorage?.persisted !== 'function' ||
      typeof resolvedStorage?.persist !== 'function'
    ) {
      return
    }
    let active = true
    void resolvedStorage
      .persisted()
      .then((persisted) => {
        if (!active) return
        setStoragePersistence(persisted ? 'granted' : 'not-granted')
      })
      .catch(() => {
        if (!active) return
        setStoragePersistence('unsupported')
      })
    return () => {
      active = false
    }
  }, [resolvedStorage])

  const handleRequestPersistentStorage = async () => {
    if (typeof resolvedStorage?.persist !== 'function') {
      setStoragePersistence('unsupported')
      return
    }
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const granted = await resolvedStorage.persist()
      setStoragePersistence(granted ? 'granted' : 'denied')
      if (granted) {
        setStatusMessage(
          'Persistent storage granted. Browser eviction under normal storage pressure is now disabled for this origin.',
        )
      }
    } catch {
      setStoragePersistence('denied')
    } finally {
      setIsBusy(false)
    }
  }

  const resetImportFlow = () => {
    setSelectedFilename(null)
    setValidatedBackup(null)
    setCurrentSnapshotDownloaded(false)
    setSafetyBackupAcknowledged(false)
    setReplaceAllConfirmed(false)
  }

  const handleExportCurrentData = async (isPreRestoreSafetyBackup: boolean) => {
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const snapshot = await exportSnapshot(
        {
          exportedAt: now().toISOString(),
          updateLastExportedAt: true,
        },
        database,
      )
      const filename = createBackupFilename(snapshot.exportedAt)
      const jsonContent = JSON.stringify(snapshot, null, 2)
      onDownloadFile(filename, jsonContent)
      await refreshMetadata()

      if (isPreRestoreSafetyBackup) {
        setCurrentSnapshotDownloaded(true)
        setStatusMessage(
          `Safety backup downloaded (${filename}). You may now acknowledge and confirm the replace-all restore.`,
        )
      } else {
        setStatusMessage(`Backup exported and downloaded (${filename}).`)
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to export backup snapshot.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    resetImportFlow()
    setStatusMessage(null)
    setErrorMessage(null)

    if (!file) return

    setSelectedFilename(file.name)
    setIsBusy(true)
    try {
      const validated = await validateSnapshot(file, { database })
      setValidatedBackup(validated)
    } catch (error) {
      const reason =
        error instanceof BackupValidationError || error instanceof Error
          ? error.message
          : 'Backup validation failed.'
      setErrorMessage(`${reason} No local data was modified.`)
    } finally {
      setIsBusy(false)
      event.target.value = ''
    }
  }

  const handleConfirmRestore = async () => {
    if (!validatedBackup) return
    setIsBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const preview = await restoreSnapshotValidated(
        validatedBackup.snapshot,
        {
          currentSnapshotDownloaded,
          safetyBackupAcknowledged,
          replaceAllConfirmed,
        },
        database,
      )
      resetImportFlow()
      await refreshMetadata()
      setStatusMessage(
        `Restore complete. Replaced local database with ${preview.totalRecords} records from backup.`,
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Restore failed.'
      setErrorMessage(`${reason} Existing local data was kept intact.`)
    } finally {
      setIsBusy(false)
    }
  }

  const staleReminder = isExportStale(lastExportedAt, now())
  const canExecuteRestore =
    validatedBackup !== null &&
    currentSnapshotDownloaded &&
    safetyBackupAcknowledged &&
    replaceAllConfirmed &&
    !isBusy

  return (
    <section
      aria-labelledby="backup-panel-heading"
      className="mt-8 space-y-6 border-t border-[var(--line)] pt-6"
    >
      <div>
        <h2
          id="backup-panel-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Backup &amp; Restore
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          All workouts, routines, daily habit check-ins, and body-weight entries
          live on this device only. Clearing browser site data, reinstalling the
          app, or browser storage eviction can remove local records.
        </p>
      </div>

      <div
        role="note"
        aria-label="Plaintext health-data warning"
        className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm"
      >
        <p className="font-semibold">Plain-text health data warning</p>
        <p className="mt-1 text-muted">
          Exported backup files are unencrypted plain-text JSON containing your
          workouts, body-weight measurements, daily habit logs, and personal
          exercise restrictions. Store backups privately and do not upload or
          share them with untrusted services.
        </p>
      </div>

      <div
        aria-label="Persistent storage settings"
        className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4 text-sm"
      >
        <h3 className="text-base font-semibold">
          Offline &amp; persistent storage
        </h3>
        <p className="mt-1 text-muted">
          Service workers, offline caching, and persistent storage require a
          secure context (HTTPS in production, or <code>localhost</code> /{' '}
          <code>127.0.0.1</code> during development).
        </p>
        <dl className="mt-3 space-y-1">
          <div className="flex flex-wrap gap-2">
            <dt className="font-medium">Storage protection status:</dt>
            <dd>
              {storagePersistence === 'checking' && 'Checking…'}
              {storagePersistence === 'granted' &&
                'Granted (protected from automatic browser eviction)'}
              {storagePersistence === 'not-granted' &&
                'Best-effort (not yet marked persistent)'}
              {storagePersistence === 'denied' &&
                'Denied by browser (using standard best-effort storage)'}
              {storagePersistence === 'unsupported' &&
                'Unsupported in this browser or context'}
            </dd>
          </div>
        </dl>

        {storagePersistence !== 'granted' &&
          storagePersistence !== 'unsupported' && (
            <div className="mt-4">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleRequestPersistentStorage()}
                className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Request persistent storage
              </button>
            </div>
          )}

        {(storagePersistence === 'denied' ||
          storagePersistence === 'unsupported') && (
          <p
            role="note"
            aria-label="Persistent storage fallback explanation"
            className="mt-3 text-muted"
          >
            {storagePersistence === 'denied'
              ? 'Your browser declined persistent storage. On Android Chrome and other mobile browsers, persistence is often granted only after installing the app to your Home Screen or after repeated use. Your workouts still save locally in IndexedDB, but you should download JSON backups regularly in case the browser evicts site storage or site data is cleared.'
              : 'This browser does not expose navigator.storage.persist() in the current context. Serve the app over HTTPS (or localhost) and download regular JSON backups to protect your history.'}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4">
        <h3 className="text-base font-semibold">Export backup</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="font-medium">Last exported:</dt>
            <dd>
              {isLoadingMeta
                ? 'Loading…'
                : (lastExportedAt ?? 'Never exported')}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="font-medium">Current local records:</dt>
            <dd>{isLoadingMeta ? 'Loading…' : localRecordCount}</dd>
          </div>
        </dl>

        {!isLoadingMeta && staleReminder && (
          <p className="mt-2 text-sm text-muted">
            Reminder: export a fresh backup JSON file regularly to keep an
            off-device copy of your recent logs.
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleExportCurrentData(false)}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            Download backup JSON
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-4">
        <h3 className="text-base font-semibold">
          Restore from backup (Replace all)
        </h3>
        <p className="mt-1 text-sm text-muted">
          Restoring validates the backup file first and replaces every table on
          this device inside a single database transaction.
        </p>

        <div className="mt-4">
          <label htmlFor={fileInputId} className="block text-sm font-medium">
            Select backup JSON file
          </label>
          <input
            id={fileInputId}
            type="file"
            accept=".json,application/json"
            disabled={isBusy}
            onChange={(event) => void handleFileChange(event)}
            className="mt-2 block min-h-12 w-full text-sm"
          />
        </div>

        {validatedBackup && (
          <div
            aria-label="Backup preview"
            className="mt-4 space-y-4 rounded-lg border border-[var(--line)] p-4 text-sm"
          >
            <div>
              <h4 className="font-semibold">
                Backup preview
                {selectedFilename ? ` (${selectedFilename})` : ''}
              </h4>
              <p className="mt-1 text-muted">
                Schema v{validatedBackup.preview.schemaVersion} · Catalog{' '}
                {validatedBackup.preview.catalogVersion} · Exported{' '}
                {validatedBackup.preview.exportedAt}
              </p>
            </div>

            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-medium">Total records in backup</dt>
                <dd>{validatedBackup.preview.totalRecords}</dd>
              </div>
              <div>
                <dt className="font-medium">Date range</dt>
                <dd>
                  {validatedBackup.preview.dateRange.earliest &&
                  validatedBackup.preview.dateRange.latest
                    ? `${validatedBackup.preview.dateRange.earliest.slice(0, 10)} to ${validatedBackup.preview.dateRange.latest.slice(0, 10)}`
                    : 'No dated records'}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Workouts &amp; sets</dt>
                <dd>
                  {validatedBackup.preview.counts.routines} routines,{' '}
                  {validatedBackup.preview.counts.sessions} sessions,{' '}
                  {validatedBackup.preview.counts.sessionExercises} session
                  exercises, {validatedBackup.preview.counts.setLogs} sets
                </dd>
              </div>
              <div>
                <dt className="font-medium">Health &amp; preferences</dt>
                <dd>
                  {validatedBackup.preview.counts.habits} habits,{' '}
                  {validatedBackup.preview.counts.habitLogs} habit logs,{' '}
                  {validatedBackup.preview.counts.bodyWeights} body-weight
                  entries, {validatedBackup.preview.counts.restrictions}{' '}
                  restrictions
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium">Overwrite impact</dt>
                <dd>
                  {validatedBackup.preview.replacesExistingData
                    ? `Will replace ${validatedBackup.preview.existingRecordCount} existing local records on this device.`
                    : 'Current local database is empty; restore will populate records from this backup.'}
                </dd>
              </div>
            </dl>

            <div className="space-y-3 border-t border-[var(--line)] pt-4">
              <p className="font-medium">
                Required before replace-all restore:
              </p>
              <div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleExportCurrentData(true)}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {currentSnapshotDownloaded
                    ? 'Current snapshot downloaded (Download again)'
                    : 'Step 1: Download current snapshot before restore'}
                </button>
              </div>

              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  disabled={!currentSnapshotDownloaded || isBusy}
                  checked={safetyBackupAcknowledged}
                  onChange={(event) =>
                    setSafetyBackupAcknowledged(event.target.checked)
                  }
                  className="mt-1 h-5 w-5"
                />
                <span>
                  I have downloaded a backup of my current data and acknowledge
                  it is saved before proceeding.
                </span>
              </label>

              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  disabled={!currentSnapshotDownloaded || isBusy}
                  checked={replaceAllConfirmed}
                  onChange={(event) =>
                    setReplaceAllConfirmed(event.target.checked)
                  }
                  className="mt-1 h-5 w-5"
                />
                <span>
                  I confirm replacing all local data on this device with the
                  selected backup file.
                </span>
              </label>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  disabled={!canExecuteRestore}
                  onClick={() => void handleConfirmRestore()}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--selected)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
                >
                  Replace all data with backup
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={resetImportFlow}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium"
                >
                  Cancel import
                </button>
              </div>
            </div>
          </div>
        )}
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
    </section>
  )
}
