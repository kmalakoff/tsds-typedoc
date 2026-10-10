# Changelog

## [1.21.0] - 2026-10-09

### Fixed

Report installation restoration failures after documentation generation. When
generation and restoration both fail, return both failures in `error.errors`,
with the generation failure first. Restore the original installation after
synchronous failures following link acquisition, and leave it untouched when
failure occurs before acquisition.
