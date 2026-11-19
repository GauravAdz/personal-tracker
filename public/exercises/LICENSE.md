# Exercise Catalog & Media Provenance

## Upstream Metadata Source

- **Dataset:** `yuhonas/free-exercise-db` (https://github.com/yuhonas/free-exercise-db)
- **Pinned Commit SHA:** `b67291321c9f6b18fe2d29d18c7d14e6b17f6e90`
- **Catalog Version ID:** `fedb-b67291321c9f`
- **Curated Exercise Count:** 75
- **Upstream Repository License:** Unlicense (Public Domain dedication)
- **Normalized Output SHA-256:** `c6c10e53e6bf6db298fa27af31825cd8454ba2bf67b5a21055f2ef66c9015cbb`

## Image License Audit & Replacement Gate (Architecture §5A)

Although `yuhonas/free-exercise-db` declares **The Unlicense** at the repository level, its upstream `.jpg` photographs do not carry per-image photographer releases. Under Architecture §5A:

1. **No upstream third-party photographs are redistributed** in this application bundle.
2. **Self-created SVG diagrams (`public/exercises/<group>/0.svg` and `1.svg`):** All bundled start/end movement diagrams and `public/exercises/placeholder.svg` are generated deterministically by `scripts/prepare-exercises.mjs` as original geometric vector illustrations dedicated to the public domain (**CC0 1.0 / The Unlicense**).
3. **Offline guarantee:** Every catalog entry resolves either to local self-created SVG diagrams in `public/exercises/` or to the local fallback `exercises/placeholder.svg`. No runtime network requests or external CDNs are used.
