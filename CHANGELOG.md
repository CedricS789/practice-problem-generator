# Changelog

## 1.3.25

- Replaced the two visually competing Guided-session indicators with one **You are here** navigator that presents the path, current step, and current question as a single breadcrumb.
- Separated overall-path position from within-step question position into clearly labelled progress levels with distinct visual weight and accessible descriptions.
- Added previous- and next-step titles, including after checkpoint recovery, so the current set or tutor lesson has immediate sequence context.
- Kept the original compact question indicator for non-Guided practice while avoiding duplicate progress displays inside Guided sessions.

## 1.3.24

- Made the creation-mode switch highlight **Guided path** whenever the active or restored study session belongs to a Guided-path step, instead of always displaying **Quick set** as selected.
- Added accurate hover descriptions while a study session locks mode switching, without changing the saved session or its progress.

## 1.3.23

- Kept plugin-managed generation and recovery metadata fully collapsed in both Live Preview and Source mode instead of revealing the raw JSON when the cursor touched it.
- Made hidden metadata ranges atomic so keyboard navigation and accidental clicks skip over them without changing or exposing the portable data.
- Removed the visible metadata placeholder; the information remains safely stored in the Practice Markdown for recovery and cross-device use.

## 1.3.22

- Made Guided-path study show the exact overall path step, step type, current-step question count, and total saved-path question count instead of presenting a tutor step as an unexplained one-question path.
- Added **Save and continue path** so a completed or skipped tutor step advances directly to the next saved lesson or set, while **Save and stop here** remains available.
- Removed the meaningless question-order dialog from one-question tutor lessons while preserving order controls for named sets and mixed practice.
- Moved a self-explanatory **Start studying** launcher above history and analytics in every Practice note, with exact scope descriptions for guided continuation, named sets, mixed practice, free practice, recovery, management, and dashboard actions.
- Standardized Guided-path action labels and hover descriptions across the Practice note, path manager, and dashboard.

## 1.3.21

- Added a clearly labelled **Skip question** action throughout the Guided-path tutor stages before the first independent attempt.
- Guided skips now bypass the remaining lesson and guided problem, remain excluded from scoring, and persist through the existing session checkpoint and history flow.
- Kept post-attempt recovery non-skippable so a completed scored attempt cannot be erased after feedback or hints are shown.

## 1.3.20

- Fixed saved Practice Markdown files failing to open in Live Preview because their multi-line hidden-metadata replacement was supplied through an unsupported CodeMirror view-plugin decoration.
- Moved the hidden-metadata decoration into a supported editor state field while preserving the compact, inspectable metadata row.
- Made interactive bank rendering fail closed inside the code-block processor so a future renderer defect shows a recovery card instead of preventing the Markdown file itself from opening.

## 1.3.19

- Made the configured PDF page and extracted-character limits one shared budget across the primary PDF and every supporting PDF in a Guided path.
- Showed exact used and remaining PDF capacity in Source & intent, passed only the remaining allowance into each additional PDF picker, and disabled further PDF selection when either budget is exhausted.
- Added independent fail-closed budget checks after local extraction, while building the approved source bundle, immediately before planning, and before every newly launched set-generation job; PDF text is never silently truncated.
- Persisted structured page-range metadata in recoverable source presentations and derived it from authoritative PDF import provenance when restoring older Guided-path recovery data.

## 1.3.18

- Fixed the supporting-PDF file-picker handoff so its page-range dialog opens reliably after the file picker closes.
- Split supporting material into explicit **Add supporting note** and **Add supporting PDF pages** actions.
- Made every supporting PDF require an exact single-page or bounded page-range selection before local extraction.
- Displayed the configured per-PDF page limit in the Guided-path source stage and page selector, while retaining extraction-time enforcement.

## 1.3.17

- Fixed orphaned device-local study checkpoints trapping every practice action in a repeated unavailable-bank notice loop.
- Follow true bank moves by stable bank identity, persist the relocated path, and use it for both active-session recovery and pending final merges; replaced banks are never guessed from a matching title or source.
- Added one explicit **Discard session and start** flow for unavailable or conflicting checkpoints, then start the originally selected bank without requiring a second click.
- Made saved-bank actions state-aware with **Resume saved practice** or **Resolve saved session…** guidance and added a command to resume a saved session directly.
- Serialized rapid practice-start and restore requests, followed live vault renames, and preserved skipped-question state when restoring a session.
- Preserved answers and current input written while an asynchronous bank-relocation check is finishing, preventing recovery from rolling recent progress back.

## 1.3.16

- Collapsed plugin-managed generation, recovery, and provenance JSON into one compact row in Live Preview without changing the portable Practice Markdown.
- Made the row keyboard-accessible and temporarily reveal the exact metadata on demand; moving the editor cursor outside the block collapses it again.
- Kept Reading view clean and deliberate Source mode fully transparent for manual inspection or recovery.

## 1.3.15

- Fixed Guided-path saving by validating source-to-aspect, assignment, tutor-citation, and prerequisite relationships before accepting new AI output.
- Reconciled older recoverable batches at save time without changing learner-visible questions, answers, tutor explanations, or occlusion masks, and corrected single-source compatibility hashes.
- Replaced set-local bulk approval with one batch-wide **Approve all ready exercises** action, exact per-set progress, automatic navigation to the next blocker, and an explicit ready-to-save state.
- Made accepted occlusion controls visibly change to **Masks accepted**, disabled redundant re-acceptance, and summarized rare technical validation details behind an expandable error panel.

## 1.3.14

- Rebuilt Guided-path batch navigator items as bounded two-row cards so titles and statuses no longer overlap the scrollbar or adjacent controls.
- Animated the active generation icon as an actual loading spinner while retaining explicit text status and reduced-motion behavior.
- Kept queued, validating, completed, and failed states visually stable, readable, and announced through a polite live region.

## 1.3.13

- Scrolled the newly prepared Guided-path planning payload into view so the result cannot appear unnoticed below the viewport.
- Moved keyboard focus to the exact payload panel after a successful preview and respected the operating system's reduced-motion preference.

## 1.3.12

- Restored recoverable Guided-path maps and queue state when their tabs are opened, without starting or retrying an AI generation job.
- Kept completed Guided-path steps freely navigable after returning to Source & intent, including after a view or plugin reload.
- Made Map & configure respond to the actual Obsidian pane width, stacking set actions, provider controls, and exercise-mix sliders before they can overlap.

## 1.3.11

- Fixed recoverable Guided-path helpers exiting immediately in Obsidian builds that do not support `ELECTRON_RUN_AS_NODE`.
- Detached generation now resolves and launches through an actual installed Node.js runtime, preferring the provider's already verified Node executable.
- Preserved exact-request recovery and added an Electron-host regression without transmitting authored source material.

## 1.3.10

- Made every unlocked Guided-path progress step clickable so users can move backward and forward without losing retained work.
- Added Enter/Space navigation, current/locked accessibility state, focus styling, and hover explanations for unavailable steps.
- Invalidated stale review results when map or set settings change, preventing old generated exercises from being saved against a revised configuration.

## 1.3.9

- Fixed Guided-path set generation failing after launch when its durable recovery context tried to serialize Obsidian's circular live file object.
- Snapshot source metadata and visual selections into an explicit JSON-safe contract before storing batch recovery data, without weakening generation resume support.
- Added a regression covering circular source and visual runtime fields.

## 1.3.8

- Fixed Guided-path exercise mixes so every rebalanced slider, percentage output, and zero/active row style refreshes together.
- Removed the misleading grey Image occlusion label after its allocation increases above zero and prevented stale percentages from remaining beside rebalanced sliders.

## 1.3.7

- Prevented exercise-percentage sliders from initiating a ghost-image drag of their containing Guided-path set card.
- Limited mouse drag reordering to the numbered set-order handle while retaining the existing keyboard-accessible move buttons.
- Marked percentage sliders as explicitly non-draggable across Quick set, Guided path, and saved-set regeneration.

## 1.3.6

- Added a searchable **Choose another note…** action directly to the selected primary-source card in both Quick set and Guided path creation.
- Replacing a note no longer requires changing the active Obsidian tab; cancellation keeps the existing source, and Guided path shows the chosen note before default GIF frames finish preparing.
- Kept source-card actions responsive and readable in narrow panes.

## 1.3.5

- Fixed the shared source picker so replacement guidance occupies its own row instead of overlapping source-choice or selected-source cards.
- Preserved consistent spacing in both Quick set and Guided path layouts, including narrow panes.

## 1.3.4

- Made Quick set to Guided path navigation immediate even when the approved source contains GIFs whose default frames still need extraction.
- Continued default GIF-frame preparation visibly in the opened Guided path and prevented stale background results from replacing a newer source or mode choice.

## 1.3.3

- Fixed Guided Path generation with the current Codex structured-output API by replacing unsupported provider-schema keywords while retaining duplicate and reference enforcement in the local validator.
- Preserved and safely summarized provider error details, including actionable schema, authentication, quota, context, and model failures, instead of showing only a generic CLI exit message.
- Unified Quick set and Guided path headers, mode controls, source selectors, source cards, step styling, visual defaults, and responsive widths; visual defaults now appear beside the visuals they govern.
- Removed redundant product-name labels from note and PDF context menus so only the relevant practice actions appear.

## 1.3.2

- Fixed false desktop `Codex (unavailable)` states by starting provider discovery independently of long interrupted-generation recovery, safely waiting for the shared CLI slot during reattachment, and publishing failures consistently to both creation modes.
- Made Windows npm CLI shims work when Obsidian inherits a stale GUI `PATH` by locating Node in standard installation directories without enabling shell execution.
- Removed practice-creation and provider controls from the mobile practice surface while preserving offline study and queue-for-desktop answer review.

## 1.3.1

- Replaced the long, competing editor context-menu generation actions with one labeled Practice Problem Generator group and concise create/start-practice actions.
- Moved the quick-set versus guided-path choice entirely into the unified creation workspace, where users can switch modes without reopening a context menu.
- Applied the same grouped creation and saved-practice actions to PDF file menus while keeping every generation entry point hidden on mobile.

## 1.3.0

- Hardened Codex, Claude, and agy execution with bounded requests, installed-capability discovery, fail-fast terminal-error handling, fixed non-shell argument contracts, and least-privilege isolated jobs.
- Hid every creation, generation, guided-path, regeneration, recovery, PDF-extraction, and media-extraction entry point on mobile while retaining offline study, saved paths, dashboards, checkpoints, and queued answer review.
- Reduced selected-image memory pressure by retaining Obsidian's existing binary buffer instead of cloning every approved visual before its neutral job copy is written.
- Added the complete Claude reasoning vocabulary to persisted contracts while exposing only the levels reported by the installed CLI; newly supported aliases and levels can appear without a plugin update.
- Included the unreleased 1.2.4–1.2.9 interface fixes: unified creation modes and recovery controls, reliable mode switching, in-place guided progress, complete hover descriptions, bulk exercise-mix selection, and streamed-generation UI stability.

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
