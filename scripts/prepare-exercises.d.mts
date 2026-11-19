import type { CatalogExercise } from '../src/domain/models'
import type { ExerciseCatalogProvenance } from '../src/data/seed'

export const MIN_CURATED_EXERCISES: number
export const MAX_CURATED_EXERCISES: number
export const FALLBACK_IMAGE_PATH: string

export interface UpstreamRawExercise {
  id: string
  name: string
  force?: string | null
  level?: string
  mechanic?: string | null
  equipment?: string | null
  primaryMuscles: string[]
  secondaryMuscles?: string[]
  instructions: string[]
  category: string
  images?: string[]
  mediaAuditStatus?: 'self-created-svg' | 'text-only-fallback'
}

export interface UpstreamExerciseBundle {
  repository?: string
  pinnedCommitSha: string
  upstreamLicense?: string
  exercises: UpstreamRawExercise[]
}

export function isValidSourceId(value: unknown): boolean
export function isValidLocalAssetPath(value: unknown): boolean
export function selectDiagramGroup(
  primaryMuscles: readonly string[],
  category: string,
): string
export function normalizeUpstreamExercise(
  raw: UpstreamRawExercise,
): CatalogExercise
export function prepareExerciseCatalog(
  upstreamBundle: UpstreamExerciseBundle,
): {
  exercises: CatalogExercise[]
  provenance: ExerciseCatalogProvenance
  canonicalOutputJson: string
}
export function runPrepareExercises(options?: { rootDir?: string }): {
  exercises: CatalogExercise[]
  provenance: ExerciseCatalogProvenance
}
