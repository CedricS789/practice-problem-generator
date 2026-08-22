# Changelog

## 1.2.9

- Stopped guided batch generation and saved-set regeneration from rebuilding their full UI on every streamed agent event.
- Kept guided batch status and live activity updating in place, with unavailable set tabs visibly disabled until review is ready.
- Restored two saved-set image action labels that could be erased by late icon rendering, and strengthened the regression check.
- Added keyboard activation and focus styling to the guided progress step that returns to source configuration.

## 1.2.8

- Added explicit Select all and Deselect all controls to the quick-set exercise mix without rebuilding or resetting the configuration window.
- Kept an intentionally empty mix visible and safely blocked generation until at least one exercise type is selected again.

## 1.2.7

- Guaranteed hover descriptions across every plugin view, picker, and modal, including disabled and dynamically rendered buttons.
- Preserved visible action labels on 87 icon-enhanced buttons so Obsidian cannot erase the semantic text used by hover and keyboard descriptions.

## 1.2.6

- Restored visible labels on the guided planning actions instead of leaving ambiguous icon-only controls.
- Added an explicit working panel, live in-place agent activity, and cancellation while the blueprint planner runs.

## 1.2.5

- Kept Quick set available from Guided path before a primary source is selected, so switching modes cannot trap an empty creation workspace.

## 1.2.4

- Unified quick-set and guided-path creation under one clearly labelled mode switch that reuses the current workspace tab.
- Added visible resume, exact-approved-request retry, and guarded discard actions wherever an interrupted generation blocks work.
- Explained and enforced the one-job recovery boundary inside guided-path creation instead of failing behind an unrelated tab.

## 1.2.3

- Reduced practice-note Properties to the useful source link and a hidden discovery marker.
- Moved generation recipes, model history, hashes, revisions, and PDF provenance into one invisible versioned metadata block.
- Preserved legacy frontmatter parsing and immediately hid legacy plugin-owned properties without rewriting notes.

## 1.2.2

- Replaced the crowded all-visible dashboard default with a focused layout while preserving customized layouts.
- Moved activity range, graph metric, week start, section visibility, and dashboard layout presets into grouped plugin settings.
- Added independent controls for scope filters, offline preparation, guided-path analytics, and activity summary cards.

## 1.2.1

- Fixed mobile practice sessions reopening in a persisted right drawer by relocating them to a root workspace tab safely.

## 1.1.0

- Added device-local, crash-safe practice-session checkpoints with exact input and exercise-order restoration.
- Added offline-readiness audits for scoped banks and static image-occlusion assets.
- Added mobile queuing for source-locked AI answer reviews that execute later on desktop without provider substitution.
- Added durable generation recovery, provider model discovery, full reasoning choices, and three-hour generation and review defaults.
- Added note and PDF source bundles, learning paths, improved exercise-mix controls, configurable study ordering, native LaTeX rendering, dashboard analytics, and guarded data management.
- Fixed schema-v3 LaTeX validation and preserved legacy v1 and v2 bank migration.

## 1.0.1

- Renamed the public display name to Practice Problem Generator while preserving the `practice-lab-ai` plugin ID and existing data.

## 1.0.0

- Initial public release.
