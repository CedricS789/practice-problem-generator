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
- Gives every provider the same explicit study context: source-material title and scope, ordered heading paths and segment IDs, exercise-type intent, difficulty intent, visual IDs, grounding constraints, and a final quality checklist. Difficulty is a visible three-profile choice everywhere a set is created or regenerated: **Foundational** builds reliable fundamentals, **Deep exam practice** emphasizes explanation, connection, and transfer, and **Challenge** uses supported multi-step integration. Each profile also calibrates the generated easy/medium/hard item labels; none can expand the approved source or hide required assumptions.
- Resolves local attachments through Obsidian, applies a configurable First/Middle/Last GIF default with per-image overrides, samples video frames with FFmpeg, imports remote images only after consent, and copies accepted Notability region previews into durable attachments.
- Selects all immediately usable images in one action; unresolved GIFs use the configured default, while videos and remote images retain their required manual review.
- Requires every generated exercise to cite source-segment IDs and validates the full result with a versioned draft-07 JSON Schema plus semantic checks.
- Requires canonical Obsidian LaTeX in every learner-visible mathematical field (`$...$` inline and `$$...$$` display), rejects malformed delimiters or braces before a generated draft is accepted, and renders equations with Obsidian's native MathJax in draft previews, study cards, choices, matching and ordering items, occlusion labels, grounded answers, and AI-review history. Legacy malformed text remains readable as a visibly marked fallback instead of crashing the view.
- Lets you edit, reject, reorder, and approve drafts. Empty edited prompts or answers are identified inline before persistence, saving is single-flight, and failures remain visible for retry. Review occlusions one at a time or use **Accept all occlusions** to approve every kept exercise whose masks are complete and valid; incomplete masks remain blocked from saving.
- Stores a readable Markdown bank beside the course note under `Practice/` and appends session history only when a study session finishes.
- Treats free responses as one-session outcomes (`Incorrect`, `Partially correct`, or `Correct`). It does not create flashcard ratings or schedule future reviews.
- Opens a lightweight setup dialog before every practice run. Keep the reviewed bank order, shuffle every question, shuffle whole exercise-type blocks, or follow an editable type progression; type blocks can also be shuffled internally. The dialog shows the current bank's per-type counts, skips absent types, can remember the choice, and never rewrites the saved bank.
- Lets you choose, for free responses only, between self-assessment and an optional background AI review. The selected provider and reasoning effort are captured with each answer; Practice Problem Generator advances to the next question immediately and never substitutes a provider. Pending reviews can be paused, and failed reviews can be retried with their original locked request.
- Shows a collapsible live agent-activity panel for generation and background answer review, with elapsed time, schema-repair state, provider progress, and safe emitted reasoning status. The capped panel is ephemeral: it never displays raw provider output or private chain-of-thought and is not written to the vault.
- Makes generation crash-resilient by default. Once an approved CLI job starts, a hidden local helper owns that exact ephemeral process; if Obsidian closes or reloads, the process continues and Practice Problem Generator automatically reattaches to its existing output on the next launch. A completed but unsaved validated draft also reopens directly in Review.
- Checkpoints an active practice run in device-local plugin data. The checkpoint locks the exact bank identity and revision, exercise order and snapshots, cited source context, answers, current question, current input, review choices, and timestamps. Completed answers are saved immediately, typing is debounced, and the run resumes after suspension, force-quit, or plugin reload. The checkpoint is cleared only after its stable session ID has merged successfully into the bank or after an explicit typed-confirmation discard.
- Audits any dashboard scope with **Prepare for offline practice**. The report checks every selected bank, parse issue, image-occlusion reference, missing visual, unsupported media type, and static image stored outside `_Vault/Attachments/`. It reports readiness without depending on or configuring a sync plugin.
- Lets mobile queue a source-locked AI answer review for desktop. Practice continues immediately; the pending request retains the exact provider and reasoning choice in the saved bank, and desktop processes it only when that exact capability is available. A synchronized bank modification triggers a bounded desktop rescan, and the result later merges by stable request identity without replacing the provider.
- Stores pending AI-reviewed answers as completed but unscored work. Session and dashboard performance remain visibly provisional until the review arrives, while failed reviews never count as incorrect.
- Shows a local performance score, latest and best session scores, completion, objective accuracy, free-response outcomes, per-exercise-type performance, duration, and complete session history in every saved bank.
- Keeps a durable generation audit trail for every bank revision: provider and CLI version, exact pinned model or an explicit unpinned-default marker, reasoning effort, prompt contract, source hash and scope, exercise mix, focus instructions, visual count, requested/drafted/saved counts, schema-repair attempts, and timestamp. PDF banks also retain the exact page range, document page count, extraction time, PDF content hash, and generation ID for every bank revision. Each session links back to the generation revision whose questions it used.
- Provides a responsive dashboard across all saved practice banks, with arbitrary-depth folder scopes, individual-source scopes, an optional source-tag facet, recent sessions, exercise-type breakdowns, and bank search.
- Adds scope-aware practice analytics inspired by the useful history views in study tools without copying their scheduling model: a 13-, 26-, or 52-week activity heatmap, weekly answers/sessions/practice-time bars, a weekly performance trend, a scored-outcome distribution, and an accessible weekly data table.
- Reveals the original unmasked image immediately after an image-occlusion answer is submitted.
- Adds a session-only **Practice Run** with deterministic run points, a consecutive full-credit answer streak, and an S-to-D run rank. These are derived from existing answers and history; there are no daily streaks, virtual currency, or review schedules.
- Supports an optional keyboard-first study flow with answer-field focus and Ctrl/Command + Enter for the current primary action. Completion saves only once, keeps errors recoverable, and offers **Save and practice again** without returning through the bank.
- Provides a full settings control center for provider-specific model defaults, reasoning, reusable focus instructions, automatic local-image/GIF selection, study order, free-response review, compact or comfortable density, and granular visibility of Practice Problem Generator, saved-bank, and dashboard statistics.
- Opens the full creation workspace in a main tab by default so source review, occlusion editing, and study have enough width. A top-level **Quick set / Guided path** switch keeps both creation modes inside the current tab. A Right sidebar setting remains available for users who prefer a compact Quick set layout; the dashboard remains a dedicated main tab.
- Adds **Regenerate / tweak** to every saved bank and dashboard bank card on desktop. It opens Configure with the last portable generation recipe restored; older banks reconstruct their provider, reasoning, quantity, difficulty, and exercise mix where possible. Whole-note banks use the current note, selection banks stay bounded to their saved selection snapshot, PDF banks re-extract their original page range and disclose source changes, and previously used visuals are selected again without bypassing the exact-payload approval step.
- Provides guarded data management: remove one session entry, clear one bank's history, clear history across all valid banks, reset settings, or move one/all banks through Obsidian's configured trash method. Broad history changes create Markdown backups first, and every destructive action requires an exact typed phrase.

## Guided Learning Paths

**Quick set** is the original single-set workflow. **Guided path** builds connected tutor lessons and multiple focused sets. Both are modes of the same Practice Problem Generator creation workspace, while saved paths remain usable on desktop and mobile.

- Start with one primary note, selection, or exact PDF page range and optionally add up to four supporting notes or PDF ranges. Every source is chosen explicitly: the plugin never crawls links, expands a PDF range, or fills a source gap from general knowledge.
- Inspect and approve the complete planning payload, then edit the proposed aspect and prerequisite map, source gaps, lesson briefs, and named sets. Unsupported gaps must be removed or resolved with another explicitly selected source before generation.
- Inspect every exact set payload before approving the batch. Each set receives the complete approved bundle, global map and prerequisite chain, sibling-set briefs, global instructions, and its local objective. Sets run sequentially through the single-job coordinator; completed drafts survive a later failure, and the durable batch can resume after an unexpected Obsidian closure without starting a replacement provider turn.
- Tutor lessons move from purpose and supported prerequisites through a connected explanation, source-supported example or walkthrough, self-explanation, guided work with progressively stronger hints, and independent practice. Saved workspaces offer **Continue learning**, **Choose a set**, **Mixed practice**, **Manage path**, and per-set **Regenerate / tweak this set**; regenerating one set preserves siblings and historical evidence.
- After incorrect or partial independent work, **Save and build repair set** opens an editable brief. Submitted answers and review feedback are excluded by default and enter the provider payload only if their separate switches are enabled and the resulting exact preview is approved.

Learning-path analytics remain non-SRS. `Unpracticed` means no scored independent evidence; `Developing` means some independent evidence; `Consistent evidence` requires at least three independent attempts across two sessions with at least 80% weighted performance. Guided attempts, hints, retries, lesson completion, assistance, and recovery are reported separately and never raise independent performance. **Recommended next** is calculated locally from prerequisites and evidence, explains its reasons, creates no due date, and can always be ignored.

No planning, set, regeneration, or repair request is sent until its complete text and neutral-media manifest are previewed and approved. The selected CLI receives only that approved source bundle and configuration through the existing neutral temporary-job boundary; vault paths are not placed in prompts or shell commands, providers are never switched silently, and the plugin has no telemetry.

## Commands

- `Practice Problem Generator: Generate from selection`
- `Practice Problem Generator: Generate from current note`
- `Practice Problem Generator: Generate from current PDF`
- `Practice Problem Generator: Open workspace`
- `Practice Problem Generator: Build guided learning path from selection`
- `Practice Problem Generator: Build guided learning path from current note`
- `Practice Problem Generator: Build guided learning path from current PDF`
- `Practice Problem Generator: Open guided learning path builder`
- `Practice Problem Generator: Resume interrupted guided learning path`
- `Practice Problem Generator: Discard interrupted guided learning path`
- `Practice Problem Generator: Resume interrupted generation`
- `Practice Problem Generator: Discard interrupted generation`
- `Practice Problem Generator: Discard saved practice session`
- `Practice Problem Generator: Start practice for current note`
- `Practice Problem Generator: Start practice for current PDF`
- `Practice Problem Generator: Open practice dashboard`
- `Practice Problem Generator: Prepare for offline practice`

Note generation actions are available from the Markdown editor context menu. **Generate from PDF** is available from the PDF file menu. The plugin does not rely on the ribbon.

## Settings and display control

Settings are split into generation defaults, PDF source defaults, study defaults, Practice Problem Generator view, saved-bank statistics, dashboard, and advanced runtime sections. New sources can inherit a provider, provider-aware model choice, reasoning level, item count, a clearly described difficulty profile, exact exercise percentages, focus instructions, GIF frame, and manual or automatic local-image/GIF selection. The selected default remains independently adjustable for every quick set, every guided-path set, and every regeneration before its exact payload is approved. The model picker shows locally detected models, falls back to conservative built-in choices when discovery is unavailable, and always retains an explicit Custom model ID option. Each provider remembers its own model selection. PDF defaults control the initial page window, maximum pages, maximum extracted characters, extraction timeout, and exact `pdfinfo` / `pdftotext` executables. Study defaults control the initial session-order mode, an editable ten-type progression, and optional shuffling inside type blocks; every run still presents these choices for confirmation. The Practice Problem Generator view settings choose a main-tab or right-sidebar workspace in addition to density and visibility. Keyboard shortcuts, automatic answer-field focus, the visible shortcut hint, and the live agent-activity panel are independently configurable. Generation and background AI review each default to a configurable 180-minute timeout. Advanced runtime settings can disable interrupted-generation recovery, choose its 1-to-720-hour retention window, or open the guarded typed-confirmation discard control.

Detailed, focused, and minimal visibility presets provide coherent starting points. The dashboard has its own quick-layout controls, so changing it does not reset the practice workspace or saved-bank presentation. Focused is the calm default: core performance cards, the activity heatmap, and the searchable bank list. Every item can then be adjusted independently in grouped Dashboard settings, including scope controls, offline preparation, guided-path analytics, summary cards, weekly activity/performance/outcome graphs, recent sessions, paths, tags, and per-bank activity. The same settings own the 13-, 26-, or 52-week window, answers/sessions/practice-time metric, and Monday/Sunday week start; configuration controls do not occupy the dashboard itself. These settings affect presentation only; they never delete or rewrite history. Payload consent, validation failures, unresolved AI-review management, and bank/dashboard integrity diagnostics cannot be hidden.

Display preferences update an open Practice Problem Generator or dashboard view without replacing the current generation configuration. During an active question, a display change is applied at the next normal question transition so typed input is preserved. A saved bank block uses the new visibility settings when its Markdown preview next renders. Only provider executable-path changes restart provider detection.

## Data management and recovery

Interrupted-generation recovery does not use a provider conversation or start a replacement model turn. Codex remains ephemeral and Claude remains non-persistent. The plugin stores only a small recovery handle in its settings; the exact approved prompt, schema, neutral media copies, provider output, and validated draft checkpoint stay in the isolated operating-system temporary job. On desktop startup, recovery runs before provider discovery or queued AI answer reviews so two CLI jobs cannot overlap. Until the draft is saved or explicitly discarded, new generation is blocked rather than silently overwriting it.

The default recovery retention is seven days and is never shorter than the configured generation timeout plus one hour. Saving removes the checkpoint. Manual discard cancels a still-running helper first and requires the exact phrase `DISCARD INTERRUPTED GENERATION`. An operating-system restart, external process termination, manual temporary-directory cleanup, or provider failure can make same-process continuation impossible; the plugin then reports the failure and keeps the approved source available for an explicit discard and retry instead of silently launching a new provider request.

Destructive controls are intentionally secondary. Individual sessions appear under **Manage this history entry** in a saved bank. Per-bank controls appear under **Manage bank data**, bank deletion appears under **Data actions** on dashboard cards, and vault-wide controls are collapsed under **Settings → Practice Problem Generator → Data management**. Opening a control does not mutate anything: Practice Problem Generator states the exact scope, lists what is preserved, and requires a case-sensitive confirmation phrase before proceeding.

Removing session history increments the affected bank revision through `Vault.process()` and preserves its exercises, generation recipe, generation audit ledger, source links, PDF provenance, and other sessions. Practice Problem Generator snapshots every affected Markdown bank under `.tmp/practice-lab-ai/data-management/` before clearing history. Bank deletion uses Obsidian's configured deletion method; recoverability therefore depends on the user's Obsidian and operating-system trash configuration. Source notes, PDFs, original attachments, and settings are never deleted with a bank. A full settings reset leaves every bank and session untouched.

## Dashboard and statistics

**Open practice dashboard** opens a dedicated main tab. Its primary scope follows the source-note hierarchy, so you can inspect all practice in the vault, any folder subtree at any nesting depth, or exactly one source note. A tag is an optional secondary facet and can be combined with the folder or source scope. Clicking a folder or tag on a bank card applies that facet directly.

Folder paths are the stable organization model. Tags are read dynamically from the current source note, including frontmatter and inline tags; a parent tag also includes its nested tags. Practice Problem Generator does not copy tags into the bank or require a special dashboard tag, so changing a source note's taxonomy changes the next dashboard refresh without rewriting practice history.

The dashboard can report scoped banks, problems, completed sessions, completion, answer streaks, weighted performance, exercise-type performance, recent sessions, AI-review status, and per-bank activity. The active folder/source/tag filter also drives its local-calendar activity heatmap, weekly answers/sessions/practice-time graph, weekly scored-performance trend, answer-outcome distribution, and expandable data table. All of these optional sections and their range, metric, and week-start choices live under **Settings → Practice Problem Generator → Dashboard**. Every heatmap day and chart value has a keyboard-focusable description, and the table provides a non-visual equivalent. A visible refresh control reports its load state and last successful update. Performance is calculated from individual stored outcomes rather than averaging bank percentages. Pending or failed AI reviews stay outside the score denominator and provisional weeks remain identified. Historical answers whose exercise was later removed remain in overall totals and are identified as unmapped. Invalid banks, missing source notes, and duplicated bank identifiers are disclosed; duplicated identifiers are excluded from aggregate scores to prevent double counting.

These statistics are descriptive only. They do not schedule reviews, create a flashcard queue, or change which practice set appears next.

## Desktop and mobile

Generation, guided-path creation, regeneration, PDF extraction, media extraction, and executing AI answer reviews are desktop-only because they start locally installed command-line programs. Their commands, context-menu actions, creation views, and generation-only settings are not registered on mobile. The plugin itself is not desktop-only: the dashboard and saved `practice-lab` blocks render on mobile, all exercise types can be completed offline, LaTeX renders through Obsidian MathJax, occlusion feedback reveals the unmasked local image, and session history is written in one revision-aware batch at completion.

An unfinished practice run is device-local and crash-safe. It resumes automatically on that same device without adding partial history to the bank. On mobile, choosing AI review creates a locked pending request but does not start a process or block the next question. After the completed session and its bank synchronize to desktop, Practice Problem Generator detects the pending work and runs it only with the selected provider and reasoning capability. If the provider is unavailable, the request stays pending and visible.

Use **Prepare for offline practice** before a commute. A ready report proves that the chosen bank files and referenced static occlusion images are present in the current vault; it does not prove that another sync tool has transferred them. Keep each device's Obsidian configuration independent when the chosen sync setup excludes hidden files.

Node modules are loaded lazily only inside desktop generation or media actions. Loading or studying a saved bank does not load `child_process`, filesystem, or operating-system modules.

## Providers

Codex is the default. Claude and agy are selectable when their executables are detected. Practice Problem Generator never silently switches providers.

The Configure stage has a provider-aware model dropdown with **Automatic**, every model reported by the installed CLI, and **Custom model ID…** for safe exact identifiers not present in the catalog. Unknown models restored from older generation history stay intact as Custom instead of being discarded. Codex and agy catalogs are discovered locally; Claude's prompt-free detection reads its installed `--help` output for rolling aliases and reasoning levels. Catalog failure does not disable a working provider: the picker discloses the failure and uses conservative built-in choices. The reasoning dropdown then shows every level compatible with the selected model: Codex offers up to Ultra where supported, Claude exposes every installed level (including Ultracode when that CLI supports it), and agy offers Low through High where a corresponding available model variant exists. Changing agy reasoning switches only to a sibling present in the active model list, never an invented model name. A pinned model is passed as one fixed CLI argument and recorded exactly; Codex or Claude Automatic is recorded honestly as **Provider default (not pinned)**, while agy Automatic records the exact model it must pin. Answer review has explicit provider/reasoning controls; Codex and Claude use an unpinned provider default, while agy selects the matching effort variant from the plugin default model family.

The exercise-mix editor includes recommended, core-reasoning-only, and equal-selected presets. The recommended preset starts image occlusion at 0% so text-only notes work immediately. A positive image-occlusion count requires a selected ready visual; it is never silently reassigned to a different exercise type.

The optional **Focus instructions for the AI** field can start from a reusable setting and still be edited for the current draft. It can steer emphasis, comparisons, scenarios, wording, exclusions, and challenge within the submitted source, but it cannot override source grounding, the exact exercise mix, the output schema, or visual requirements.

Completed-session statistics are calculated locally from the history already stored in the practice Markdown. Correct answers earn one point, partially correct free responses earn half a point, and incorrect answers earn zero. Objective, self-assessed, and AI-reviewed provenance remain distinct. Pending and failed reviews count toward completion but not points, rank, or streak. Practice Problem Generator does not send telemetry.

- Codex runs ephemerally with approvals disabled, user configuration and local instructions ignored, a read-only sandbox, a JSON output schema, JSONL progress events, and neutral image copies.
- Claude runs in safe, non-persistent streaming print mode with Chrome, plugins, hooks, MCP servers, and unrelated tools disabled; image reading is restricted to neutral copies in the isolated job directory.
- agy runs in sandboxed, new-project print mode without a blanket permission bypass. It supports text generation; vision remains unavailable until **Settings → Practice Problem Generator → Test agy vision** completes its synthetic one-pixel headless probe successfully, and no vault content is used by that test.

One CLI child process may run at a time, including provider detection and capability probes. Generation supports targeted cancellation and defaults to a configurable three-hour timeout shared by its initial call and single schema-repair attempt. Provider-declared authentication, policy, model, cancellation, and terminal failures stop immediately instead of being misclassified as malformed JSON. Prompt, schema, visual-count, visual-byte, and process-output bounds fail before or during execution with actionable errors. Background answer reviews wait without interrupting practice, also default to a separately configurable three-hour timeout, and retry one retryable process failure. A transient bank-write failure uses bounded backoff while retaining the finished result for later retry. Every structured job uses neutral files under the operating-system temporary directory. Ordinary jobs are removed after completion; recoverable generation jobs remain only until the validated draft is saved, discarded, or expires.

## Privacy and data handling

Practice Problem Generator has no telemetry and no background conversion. It never sends a note merely because the note was opened or saved.

Generation and optional AI answer review are explicit networked actions. After you inspect and approve the payload, the plugin starts the selected locally installed Codex, Claude, or agy executable. That CLI may send the approved source text, neutral media copies, answers, and bounded grading context to its provider. Practice Problem Generator does not silently switch providers. Provider accounts, terms, retention policies, and possible usage charges are managed by the selected CLI provider; the plugin itself is free and open source.

The plugin starts local executables and therefore accesses the operating-system temporary directory outside the vault. It uses neutral job and media filenames, cleans ordinary temporary jobs after completion, and does not place source text in shell commands. Crash-recovery inputs remain there only for the configured bounded retention period and can be removed through the guarded discard control. Configured Poppler and FFmpeg executables process PDFs and media locally. A remote image is fetched only after the plugin shows its host and you explicitly approve the import.

AI answer review runs only after you select it and submit that response. The provider receives the bounded exercise title, exercise prompt, your submitted answer, the grounded answer, key-point rubric, source-heading labels, and only the cited source segments locked when you answered. It does not receive vault paths, a separate source-file or note-title field, tags, the full note, unrelated segments, other exercises, session history, or statistics. Submitted/source text is explicitly treated as untrusted data, and the reviewer is forbidden from following embedded instructions or returning chain-of-thought. When you finish the session, the submitted answer and locked cited context are stored in that Practice Markdown so a delayed review can resume and its provenance remains auditable.

The live activity panel is derived locally from provider event metadata. It shows bounded status labels and response-size progress, never raw prompts, paths, generated answer JSON, tool input, or private reasoning text. Activity entries are capped in memory and disappear when the view is closed; only the established generation audit and finished-session records are persisted.

Before generation, the Configure stage shows the exact submitted text, provider, and image list. Source vault paths are not placed in prompts or CLI arguments. Local media is copied to neutral filenames. For PDF sources, the vault binary is copied to a neutral operating-system temporary job before `pdfinfo` or `pdftotext` runs; only the approved, page-labeled extraction enters the generation prompt. Authored source notes, PDFs, images, animations, videos, and Notability material are never modified.

Persistent snapshots use content-hash filenames under:

```text
_Vault/Attachments/Practice Problem Generator/
```

Banks created under either former display name remain readable, including snapshots under `_Vault/Attachments/Grounded Problems/` and `_Vault/Attachments/Practice Lab/`. New snapshots use the Practice Problem Generator folder; the plugin does not move or rewrite legacy material automatically.

Temporary CLI/media files use the operating-system temporary directory. Deployment staging and rollback backups use the target vault's ignored `.tmp/` directory.

## Attribution

The normalized rectangle editor and related accessible native-interface patterns were adapted from [Notability Live Region](https://github.com/CedricS789/notability-live-region), an MIT-licensed project by the same author. Practice Problem Generator reads an installed Notability Live Region preview only as an optional import source and stores accepted snapshots independently.

## Bank format

Each source note owns one bank at:

```text
Notes/<term>/<course>/Practice/<source> - Practice.md
```

A PDF under the same course hierarchy uses that course's `Practice/` folder. A PDF elsewhere in the vault uses a deterministic collision-safe bank under `Notes/Practice Sources/Practice/`; Practice Problem Generator never writes beside a mirrored or read-only source PDF.

The **Practice-bank storage** settings can instead route newly created banks through a custom vault-relative base folder and relative path template. Templates support `{term}`, `{course}`, `{source}`, `{sourceHash}`, `{pdfHashSuffix}`, `{sourceType}`, and `{parent}`, display a live example, and fail closed on absolute paths, traversal, protected Obsidian folders, unsafe characters, missing `.md`, or collision-prone templates without `{source}` or `{sourceHash}`. Existing banks are discovered by their stored source identity and remain at their current paths when these defaults change; the setting never moves or rewrites them.

The note keeps only its useful source wikilink in Obsidian's visible Properties. Schema markers, hashes, bank IDs, revisions, model recipes, generation history, and PDF provenance are plugin-owned and live in the versioned fenced bank or one invisible versioned metadata comment. Legacy frontmatter remains readable and is hidden from the Properties editor immediately; the next authorized bank write consolidates it into the hidden metadata block. The sidecar preserves strict bank-schema compatibility while allowing revision-linked generation history. Bank schema v3 preserves pending, reviewed, and failed answer-review provenance, immutable session evidence, source-material references, and optional learning-path records without introducing scheduling. Legacy v1 and v2 banks validate and migrate in memory; the first authorized write stores v3. Unknown schema versions render read-only with recovery instructions.

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
