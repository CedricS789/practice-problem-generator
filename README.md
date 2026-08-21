# Practice Problem Generator

Practice Problem Generator turns an active note, editor selection, or explicit PDF page range into source-grounded practice problems. Draft generation runs through an AI command-line tool that you install and select on desktop; saved banks, dashboards, and study sessions work on desktop and mobile.

It is a practice-problem workspace, not a flashcard or spaced-repetition system. Generated questions stay tied to the submitted source segments, and you review every draft before saving it.

## Install

Once the plugin is listed in Obsidian's Community Plugins directory, search for **Practice Problem Generator**, install it, and enable it.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the matching [GitHub release](https://github.com/CedricS789/practice-problem-generator/releases), place them in `<vault>/.obsidian/plugins/practice-lab-ai/`, and enable **Practice Problem Generator** under **Settings → Community plugins**. Keep the folder name `practice-lab-ai` so existing settings and banks remain compatible.

Desktop generation requires at least one supported AI CLI: Codex, Claude, or agy. PDF extraction requires Poppler (`pdfinfo` and `pdftotext`); animated image and video frames require FFmpeg (`ffmpeg` and `ffprobe`). Review mode does not require these tools.

## What it does

- Generates short-answer, causal-explanation, application, calculation, cloze, single-select, multi-select, matching, ordering, and image-occlusion exercises.
- Generates directly from vault PDFs without requiring notes first. Choose the PDF explicitly, then use **Single page** to extract and send exactly one chosen page (with adjacent pages excluded) or **Page range** for a bounded multi-page source. The dialog includes first/previous/next/last navigation, range presets, and keyboard submission. Text extraction runs locally with Poppler, the page-labeled source and exact provider payload remain inspectable, and extraction has visible local-only progress and cancellation. Scanned/image-only selections fail clearly because OCR is not silently attempted.
- Defaults to ten deep-exam items with a constructed-response-heavy mix.
- Provides in-place sliders and precise whole-number inputs for every exercise type. Changing one share automatically rebalances the other selected types to 100%, displays deterministic item counts, and enforces those exact counts in provider output without resetting the Practice Problem Generator pane.
- Accepts optional per-draft focus instructions for the AI, such as concepts to emphasize, comparisons to prioritize, or question styles to avoid. The exact text appears in the payload preview and is sent to every provider under the same grounding rules.
- Shows the exact text payload and selected visual list before any AI process starts.
- Gives every provider the same explicit study context: source-material title and scope, ordered heading paths and segment IDs, exercise-type intent, difficulty intent, visual IDs, grounding constraints, and a final quality checklist.
- Resolves local attachments through Obsidian, applies a configurable First/Middle/Last GIF default with per-image overrides, samples video frames with FFmpeg, imports remote images only after consent, and copies accepted Notability region previews into durable attachments.
- Selects all immediately usable images in one action; unresolved GIFs use the configured default, while videos and remote images retain their required manual review.
- Requires every generated exercise to cite source-segment IDs and validates the full result with a versioned draft-07 JSON Schema plus semantic checks.
- Lets you edit, reject, reorder, and approve drafts. Empty edited prompts or answers are identified inline before persistence, saving is single-flight, and failures remain visible for retry. Review occlusions one at a time or use **Accept all occlusions** to approve every kept exercise whose masks are complete and valid; incomplete masks remain blocked from saving.
- Stores a readable Markdown bank beside the course note under `Practice/` and appends session history only when a study session finishes.
- Treats free responses as one-session outcomes (`Incorrect`, `Partially correct`, or `Correct`). It does not create flashcard ratings or schedule future reviews.
- Lets you choose, for free responses only, between self-assessment and an optional background AI review. The selected provider and reasoning effort are captured with each answer; Practice Problem Generator advances to the next question immediately and never substitutes a provider. Pending reviews can be paused, and failed reviews can be retried with their original locked request.
- Shows a collapsible live agent-activity panel for generation and background answer review, with elapsed time, schema-repair state, provider progress, and safe emitted reasoning status. The capped panel is ephemeral: it never displays raw provider output or private chain-of-thought and is not written to the vault.
- Stores pending AI-reviewed answers as completed but unscored work. Session and dashboard performance remain visibly provisional until the review arrives, while failed reviews never count as incorrect.
- Shows a local performance score, latest and best session scores, completion, objective accuracy, free-response outcomes, per-exercise-type performance, duration, and complete session history in every saved bank.
- Keeps a durable generation audit trail for every bank revision: provider and CLI version, exact pinned model or an explicit unpinned-default marker, reasoning effort, prompt contract, source hash and scope, exercise mix, focus instructions, visual count, requested/drafted/saved counts, schema-repair attempts, and timestamp. PDF banks also retain the exact page range, document page count, extraction time, PDF content hash, and generation ID for every bank revision. Each session links back to the generation revision whose questions it used.
- Provides a responsive dashboard across all saved practice banks, with arbitrary-depth folder scopes, individual-source scopes, an optional source-tag facet, recent sessions, exercise-type breakdowns, and bank search.
- Adds scope-aware practice analytics inspired by the useful history views in study tools without copying their scheduling model: a 13-, 26-, or 52-week activity heatmap, weekly answers/sessions/practice-time bars, a weekly performance trend, a scored-outcome distribution, and an accessible weekly data table.
- Reveals the original unmasked image immediately after an image-occlusion answer is submitted.
- Adds a session-only **Practice Run** with deterministic run points, a consecutive full-credit answer streak, and an S-to-D run rank. These are derived from existing answers and history; there are no daily streaks, virtual currency, or review schedules.
- Supports an optional keyboard-first study flow with answer-field focus and Ctrl/Command + Enter for the current primary action. Completion saves only once, keeps errors recoverable, and offers **Save and practice again** without returning through the bank.
- Provides a full settings control center for provider-specific model defaults, reasoning, reusable focus instructions, automatic local-image/GIF selection, study order, free-response review, compact or comfortable density, and granular visibility of Practice Problem Generator, saved-bank, and dashboard statistics.
- Adds **Regenerate / tweak** to every saved bank and dashboard bank card on desktop. It opens Configure with the last portable generation recipe restored; older banks reconstruct their provider, reasoning, quantity, difficulty, and exercise mix where possible. Whole-note banks use the current note, selection banks stay bounded to their saved selection snapshot, PDF banks re-extract their original page range and disclose source changes, and previously used visuals are selected again without bypassing the exact-payload approval step.
- Provides guarded data management: remove one session entry, clear one bank's history, clear history across all valid banks, reset settings, or move one/all banks through Obsidian's configured trash method. Broad history changes create Markdown backups first, and every destructive action requires an exact typed phrase.

## Commands

- `Practice Problem Generator: Generate from selection`
- `Practice Problem Generator: Generate from current note`
- `Practice Problem Generator: Generate from current PDF`
- `Practice Problem Generator: Open workspace`
- `Practice Problem Generator: Start practice for current note`
- `Practice Problem Generator: Start practice for current PDF`
- `Practice Problem Generator: Open practice dashboard`

Note generation actions are available from the Markdown editor context menu. **Generate from PDF** is available from the PDF file menu. The plugin does not rely on the ribbon.

## Settings and display control

Settings are split into generation defaults, PDF source defaults, study defaults, Practice Problem Generator view, saved-bank statistics, dashboard, and advanced runtime sections. New sources can inherit a provider, provider-specific model, reasoning level, item count, difficulty, exact exercise percentages, focus instructions, GIF frame, and manual or automatic local-image/GIF selection. PDF defaults control the initial page window, maximum pages, maximum extracted characters, extraction timeout, and exact `pdfinfo` / `pdftotext` executables. Codex and Claude model defaults may be left blank to use their provider default; agy preserves its installed Practice Problem Generator default until changed. New sessions can retain bank order or shuffle a copy without changing the saved bank. Keyboard shortcuts, automatic answer-field focus, the visible shortcut hint, and the live agent-activity panel are independently configurable. Generation and background AI review each default to a configurable 180-minute timeout.

Detailed, focused, and minimal visibility presets provide coherent starting points. Every item can then be adjusted independently: source metadata, payload-preview expansion, draft grounding and rationale, progress, run points/streak/rank, completion metrics, generation history, bank score/session history/type statistics, dashboard overview cards, activity heatmap, weekly activity/performance/outcome graphs, recent sessions, paths, tags, and per-bank activity. Dashboard defaults also control the initial 13-, 26-, or 52-week window, answers/sessions/practice-time metric, and Monday/Sunday week start. These settings affect presentation only; they never delete or rewrite history. Payload consent, validation failures, unresolved AI-review management, and bank/dashboard integrity diagnostics cannot be hidden.

Display preferences update an open Practice Problem Generator or dashboard view without replacing the current generation configuration. During an active question, a display change is applied at the next normal question transition so typed input is preserved. A saved bank block uses the new visibility settings when its Markdown preview next renders. Only provider executable-path changes restart provider detection.

## Data management and recovery

Destructive controls are intentionally secondary. Individual sessions appear under **Manage this history entry** in a saved bank. Per-bank controls appear under **Manage bank data**, bank deletion appears under **Data actions** on dashboard cards, and vault-wide controls are collapsed under **Settings → Practice Problem Generator → Data management**. Opening a control does not mutate anything: Practice Problem Generator states the exact scope, lists what is preserved, and requires a case-sensitive confirmation phrase before proceeding.

Removing session history increments the affected bank revision through `Vault.process()` and preserves its exercises, generation recipe, generation audit ledger, source links, PDF provenance, and other sessions. Practice Problem Generator snapshots every affected Markdown bank under `.tmp/practice-lab-ai/data-management/` before clearing history. Bank deletion uses Obsidian's configured deletion method; recoverability therefore depends on the user's Obsidian and operating-system trash configuration. Source notes, PDFs, original attachments, and settings are never deleted with a bank. A full settings reset leaves every bank and session untouched.

## Dashboard and statistics

**Open practice dashboard** opens a dedicated main tab. Its primary scope follows the source-note hierarchy, so you can inspect all practice in the vault, any folder subtree at any nesting depth, or exactly one source note. A tag is an optional secondary facet and can be combined with the folder or source scope. Clicking a folder or tag on a bank card applies that facet directly.

Folder paths are the stable organization model. Tags are read dynamically from the current source note, including frontmatter and inline tags; a parent tag also includes its nested tags. Practice Problem Generator does not copy tags into the bank or require a special dashboard tag, so changing a source note's taxonomy changes the next dashboard refresh without rewriting practice history.

The dashboard reports scoped banks, problems, completed sessions, completion, answer streaks, weighted performance, exercise-type performance, recent sessions, AI-review status, and per-bank activity. The same active folder/source/tag filter also drives its local-calendar activity heatmap, weekly answers/sessions/practice-time graph, weekly scored-performance trend, answer-outcome distribution, and expandable data table. The range can be changed between 13, 26, and 52 weeks without modifying history. Every heatmap day and chart value has a keyboard-focusable description, and the table provides a non-visual equivalent. A visible refresh control reports its load state and last successful update. Performance is calculated from individual stored outcomes rather than averaging bank percentages. Pending or failed AI reviews stay outside the score denominator and provisional weeks remain identified. Historical answers whose exercise was later removed remain in overall totals and are identified as unmapped. Invalid banks, missing source notes, and duplicated bank identifiers are disclosed; duplicated identifiers are excluded from aggregate scores to prevent double counting.

These statistics are descriptive only. They do not schedule reviews, create a flashcard queue, or change which practice set appears next.

## Desktop and mobile

Generation, PDF extraction, media extraction, and starting new AI answer reviews are desktop-only because they start locally installed command-line programs. The plugin itself is not desktop-only: the dashboard and saved `practice-lab` blocks render on mobile, mobile can self-assess and complete a study session with one batched history update, and synchronized pending, reviewed, and failed AI-review records remain readable. A persisted pending review resumes when its exact provider and reasoning capability are available on desktop; it is never moved to another provider.

Node modules are loaded lazily only inside desktop generation or media actions. Loading or studying a saved bank does not load `child_process`, filesystem, or operating-system modules.

## Providers

Codex is the default. Claude and agy are selectable when their executables are detected. Practice Problem Generator never silently switches providers.

The Configure stage exposes every reasoning level reported by the installed CLI family. Codex offers Low, Medium, High, Extra high, Maximum, and Ultra; Claude offers Low through Maximum; agy offers Low through High. A selected Codex model may support only a subset, in which case that exact model rejects the unsupported choice rather than Practice Problem Generator silently substituting one. Current agy model variants encode Low, Medium, or High in their identifier; changing agy reasoning visibly updates that suffix, while an incompatible manually pinned pair is blocked locally with an exact correction. Generation has explicit provider, model, and reasoning controls. A nonblank model is passed as one fixed CLI argument and recorded exactly; a blank model is recorded honestly as **Provider default (not pinned)**. Answer review has explicit provider/reasoning controls; Codex and Claude use an unpinned provider default, while agy selects the matching effort variant from the plugin default model family.

The exercise-mix editor includes recommended, core-reasoning-only, and equal-selected presets. The recommended preset starts image occlusion at 0% so text-only notes work immediately. A positive image-occlusion count requires a selected ready visual; it is never silently reassigned to a different exercise type.

The optional **Focus instructions for the AI** field can start from a reusable setting and still be edited for the current draft. It can steer emphasis, comparisons, scenarios, wording, exclusions, and challenge within the submitted source, but it cannot override source grounding, the exact exercise mix, the output schema, or visual requirements.

Completed-session statistics are calculated locally from the history already stored in the practice Markdown. Correct answers earn one point, partially correct free responses earn half a point, and incorrect answers earn zero. Objective, self-assessed, and AI-reviewed provenance remain distinct. Pending and failed reviews count toward completion but not points, rank, or streak. Practice Problem Generator does not send telemetry.

- Codex runs ephemerally in a read-only sandbox with a JSON output schema, JSONL progress events, and neutral image copies.
- Claude runs in non-persistent streaming print mode with a JSON schema and access restricted to the isolated job directory.
- agy supports text generation. Vision remains unavailable until **Settings → Practice Problem Generator → Test agy vision** completes its synthetic one-pixel headless probe successfully; no vault content is used by that test.

One CLI child process may run at a time, including provider detection and capability probes. Generation supports targeted cancellation and defaults to a configurable three-hour timeout shared by its initial call and single schema-repair attempt. Background answer reviews wait without interrupting practice, also default to a separately configurable three-hour timeout, and retry one retryable process failure. A transient bank-write failure uses bounded backoff while retaining the finished result for later retry. Every structured job uses neutral files under the operating-system temporary directory. Temporary jobs are removed after completion.

## Privacy and data handling

Practice Problem Generator has no telemetry and no background conversion. It never sends a note merely because the note was opened or saved.

Generation and optional AI answer review are explicit networked actions. After you inspect and approve the payload, the plugin starts the selected locally installed Codex, Claude, or agy executable. That CLI may send the approved source text, neutral media copies, answers, and bounded grading context to its provider. Practice Problem Generator does not silently switch providers. Provider accounts, terms, retention policies, and possible usage charges are managed by the selected CLI provider; the plugin itself is free and open source.

The plugin starts local executables and therefore accesses the operating-system temporary directory outside the vault. It uses neutral job and media filenames, cleans temporary jobs after completion, and does not place source text in shell commands. Configured Poppler and FFmpeg executables process PDFs and media locally. A remote image is fetched only after the plugin shows its host and you explicitly approve the import.

AI answer review runs only after you select it and submit that response. The provider receives the bounded exercise title, exercise prompt, your submitted answer, the grounded answer, key-point rubric, source-heading labels, and only the cited source segments locked when you answered. It does not receive vault paths, a separate source-file or note-title field, tags, the full note, unrelated segments, other exercises, session history, or statistics. Submitted/source text is explicitly treated as untrusted data, and the reviewer is forbidden from following embedded instructions or returning chain-of-thought. When you finish the session, the submitted answer and locked cited context are stored in that Practice Markdown so a delayed review can resume and its provenance remains auditable.

The live activity panel is derived locally from provider event metadata. It shows bounded status labels and response-size progress, never raw prompts, paths, generated answer JSON, tool input, or private reasoning text. Activity entries are capped in memory and disappear when the view is closed; only the established generation audit and finished-session records are persisted.

Before generation, the Configure stage shows the exact submitted text, provider, and image list. Source vault paths are not placed in prompts or CLI arguments. Local media is copied to neutral filenames. For PDF sources, the vault binary is copied to a neutral operating-system temporary job before `pdfinfo` or `pdftotext` runs; only the approved, page-labeled extraction enters the generation prompt. Authored source notes, PDFs, images, animations, videos, and Notability material are never modified.

Persistent snapshots use content-hash filenames under:

```text
_Vault/Attachments/Practice Problem Generator/
```

Banks created under either former display name remain readable, including snapshots under `_Vault/Attachments/Grounded Problems/` and `_Vault/Attachments/Practice Lab/`. New snapshots use the Practice Problem Generator folder; the plugin does not move or rewrite legacy material automatically.

Temporary CLI/media files use the operating-system temporary directory. Deployment staging and rollback backups use the target vault's ignored `.tmp/` directory.

## Bank format

Each source note owns one bank at:

```text
Notes/<term>/<course>/Practice/<source> - Practice.md
```

A PDF under the same course hierarchy uses that course's `Practice/` folder. A PDF elsewhere in the vault uses a deterministic collision-safe bank under `Notes/Practice Sources/Practice/`; Practice Problem Generator never writes beside a mirrored or read-only source PDF.

The note has readable frontmatter, a source wikilink and hash, a separate versioned generation recipe and audit ledger, and a versioned `practice-lab` fenced JSON block. The sidecar ledger preserves strict bank-schema compatibility while allowing revision-linked generation history. Bank schema v2 preserves pending, reviewed, and failed answer-review provenance alongside its locked context. Legacy v1 banks validate and migrate losslessly in memory; the first authorized write stores v2. Unknown schema versions render read-only with recovery instructions.

## Development

Requirements: Node.js 22 or newer.

```powershell
npm ci
npm run check
```

The release gate runs TypeScript, ESLint, unit tests, atomic-deploy tests, a production build, release metadata validation, and bundle assertions.

For a local development deployment, use an exact vault path:

```powershell
$env:PRACTICE_LAB_VAULT = 'C:\path\to\exact\vault'
npm run deploy
```

The deployer requires the exact path to be the `open: true` vault in Obsidian's live registry. It appends only `practice-lab-ai` to `community-plugins.json`, preserves existing plugin data, records SHA-256 hashes, and leaves a rollback manifest and backups under the vault `.tmp/` directory.

## Deliberate product boundaries

Practice Problem Generator does not perform on-save or whole-vault conversion, crawl or automatically ingest linked PDFs, run OCR, create a spaced-repetition or flashcard queue, schedule reviews with FSRS, export to Anki, run a localhost service, or collect telemetry.
