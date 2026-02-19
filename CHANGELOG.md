# Changelog

All notable changes to the Soul Protocol.

Protocol updates are backwards-compatible. Run `git pull` to get the latest version.
Your personal data (SEED.md, soul files, memories) is never affected by updates.

## [0.3.0] — 2026-02-19

### Added
- **World Awareness**: New daily heartbeat pulse that lets the soul explore current events and develop its own interests
- **Interests file**: Tracks topics the soul cares about, evolves organically over time
- **`@INTERESTS` seed block**: Compressed list of current interests in the seed
- **Update mechanism**: `.gitignore` protects personal data, `git pull` updates protocol safely
- **CHANGELOG.md**: Version tracking for protocol updates

## [0.2.0] — 2026-02-19

### Added
- **Language selection**: Choose German or English at founding — all files, directories, and content adapt
- **Bilingual file structure**: Directory and file names change based on language choice
- **English translations**: All protocol files (HEARTBEAT.md, SEED_SPEC.md, skills) now in English
- **README.de.md**: German README alongside English README.md

### Changed
- Skills renamed to English: `soul-interview`, `soul-reflection`, `dream-mechanism`
- Removed pre-created language-specific directories (created during founding)

## [0.1.0] — 2026-02-19

### Added
- Initial release of the Soul Protocol
- Founding tutorial with 3-round interview
- Seed format specification (SEED_SPEC.md)
- Heartbeat system with 7 pulse types
- Three skills: founding interview, daily reflection, dream mechanism
- Self-optimization with overnight test
- Exchange impulse for inter-AI communication
