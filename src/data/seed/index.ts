import type { CatalogExercise, ID } from '../../domain/models'
import { catalogExerciseSchema } from '../validation'
import rawExercises from './exercises.json'
import rawProvenance from './provenance.json'

export interface ExerciseCatalogProvenance {
  sourceRepository: string
  pinnedCommitSha: string
  catalogVersion: string
  upstreamMetadataLicense: string
  mediaLicensePolicy: string
  fallbackImagePath: string
  exerciseCount: number
  inputSha256: string
  outputSha256: string
}

export const EXERCISE_FALLBACK_IMAGE_PATH = 'exercises/placeholder.svg' as const

export const EXERCISE_CATALOG_PROVENANCE: Readonly<ExerciseCatalogProvenance> =
  Object.freeze({ ...rawProvenance })

export const SEEDED_CATALOG_VERSION: string =
  EXERCISE_CATALOG_PROVENANCE.catalogVersion

export const EXERCISE_CATALOG: readonly CatalogExercise[] = Object.freeze(
  rawExercises.map((entry) =>
    Object.freeze(catalogExerciseSchema.parse(entry)),
  ),
)

export const EXERCISE_CATALOG_BY_ID: ReadonlyMap<ID, CatalogExercise> = new Map(
  EXERCISE_CATALOG.map((exercise) => [exercise.id, exercise]),
)

export function resolveExerciseImagePaths(
  exercise: Pick<CatalogExercise, 'imagePaths'>,
): readonly string[] {
  return exercise.imagePaths.length > 0
    ? exercise.imagePaths
    : [EXERCISE_FALLBACK_IMAGE_PATH]
}
