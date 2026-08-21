import type {
  AiReviewCriterionResultV2,
  AiReviewSessionItemResultV2,
  ExerciseV1,
  PracticeBankV2,
  SessionItemResultV2,
} from "./model";
import { displayReasoningEffort } from "./reasoning";
import { displayModelSelection } from "./model-selection";
import {
  generationForBankRevision,
  type GenerationHistoryEntryV1,
  type GenerationHistoryV1,
} from "./generation-history";
import {
  calculatePracticeBankStatistics,
  type PerformanceScore,
  type SessionStatistic,
} from "./session-statistics";
import {
  formatPracticeRunPoints,
  practiceRunRankText,
} from "./practice-run";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  hasVisibleBankOverview,
  type BankStatisticsPreferences,
} from "./preferences";
import { installHoverDescriptions } from "./ui/hover-descriptions";
import type { PersistedAnswerReviewRetryTarget } from "./ui/contracts";

export interface BankStatisticsViewOptions {
  readonly visibility?: BankStatisticsPreferences;
  readonly generationHistory?: GenerationHistoryV1;
  readonly generationHistoryWarning?: string;
  readonly retryAnswerReview?: (
    target: PersistedAnswerReviewRetryTarget,
  ) => Promise<void> | void;
  readonly pauseAnswerReview?: (requestId: string) => Promise<void> | void;
  readonly removeSession?: (sessionId: string) => Promise<void> | void;
}

const EXERCISE_TYPE_LABELS: Readonly<Record<ExerciseV1["type"], string>> = {
  "short-answer": "Short answer",
  "causal-explanation": "Causal explanation",
  application: "Application / scenario",
  calculation: "Calculation",
  cloze: "Cloze",
  "single-select": "Single-select MCQ",
  "multi-select": "Multi-select MCQ",
  matching: "Matching",
  ordering: "Ordering",
  "image-occlusion": "Image occlusion",
};

function isAiReviewResult(
  result: SessionItemResultV2,
): result is AiReviewSessionItemResultV2 {
  return result.grading === "ai-review";
}

function percentText(percent: number | null): string {
  return percent === null ? "—" : `${percent}%`;
}

function pointsText(score: PerformanceScore): string {
  const earned = Number.isInteger(score.earnedPoints)
    ? String(score.earnedPoints)
    : score.earnedPoints.toFixed(1);
  return `${earned} / ${score.totalPoints} points`;
}

function durationText(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds === 0
    ? `${totalMinutes}m`
    : `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function createMetric(
  container: HTMLElement,
  label: string,
  value: string,
  note: string,
): void {
  const metric = container.createDiv({ cls: "practice-lab-bank-metric" });
  metric.createSpan({ cls: "practice-lab-bank-metric-label", text: label });
  metric.createEl("strong", {
    cls: "practice-lab-bank-metric-value",
    text: value,
  });
  metric.createSpan({ cls: "practice-lab-bank-metric-note", text: note });
}

function createPerformanceBar(
  container: HTMLElement,
  percent: number | null,
  label: string,
): void {
  const attributes: Record<string, string> = {
    role: "progressbar",
    "aria-label": label,
    "aria-valuemin": "0",
    "aria-valuemax": "100",
  };
  if (percent === null) {
    attributes["aria-valuetext"] = "No scored answers";
  } else {
    attributes["aria-valuenow"] = String(percent);
  }
  const track = container.createDiv({
    cls: "practice-lab-performance-track",
    attr: attributes,
  });
  const fill = track.createDiv({ cls: "practice-lab-performance-fill" });
  fill.style.width = `${percent ?? 0}%`;
}

function sessionOutcomeText(session: SessionStatistic): string {
  const parts: string[] = [];
  if (session.objectiveTotal > 0) {
    parts.push(
      `${session.objectiveCorrect}/${session.objectiveTotal} objective correct`,
    );
  }
  const freeTotal = session.freeResponseCorrect
    + session.freeResponsePartial
    + session.freeResponseIncorrect;
  if (freeTotal > 0) {
    parts.push(
      `${session.freeResponseCorrect} correct, ${session.freeResponsePartial} partial, ${session.freeResponseIncorrect} incorrect free responses`,
    );
  }
  return parts.join(" · ") || "No scored answers";
}

function providerLabel(provider: "codex" | "claude" | "agy"): string {
  if (provider === "claude") return "Claude";
  return provider === "agy" ? "agy" : "Codex";
}

function difficultyLabel(difficulty: GenerationHistoryEntryV1["difficulty"]): string {
  if (difficulty === "foundational") return "Foundational";
  return difficulty === "challenge" ? "Challenge" : "Deep exam practice";
}

function generationAuditSummary(entry: GenerationHistoryEntryV1): string {
  const version = entry.providerVersion === undefined
    ? "CLI version not recorded"
    : entry.providerVersion;
  return [
    providerLabel(entry.provider),
    version,
    `Model ${displayModelSelection(entry.model)}`,
    `${displayReasoningEffort(entry.reasoningEffort)} reasoning`,
    difficultyLabel(entry.difficulty),
  ].join(" · ");
}

function renderGenerationEntry(
  container: HTMLElement,
  entry: GenerationHistoryEntryV1,
): void {
  const row = container.createEl("details", {
    cls: "practice-lab-generation-history-entry",
  });
  const summary = row.createEl("summary");
  summary.createEl("strong", {
    text: new Date(entry.generatedAt).toLocaleString(),
  });
  summary.createSpan({ text: generationAuditSummary(entry) });
  const fields = row.createEl("dl", {
    cls: "practice-lab-generation-audit-grid",
  });
  const add = (label: string, value: string): void => {
    fields.createEl("dt", { text: label });
    fields.createEl("dd", { text: value });
  };
  add("Bank revision", String(entry.bankRevision));
  add("Generation job", entry.id);
  add("Prompt contract", entry.promptVersion);
  add("Source", `${entry.sourceScope} · ${entry.sourceHash}`);
  add(
    "Exercises",
    `${entry.requestedQuantity} requested · ${entry.draftExerciseCount} drafted · ${entry.savedExerciseCount} saved`,
  );
  add(
    "Provider attempts",
    `${entry.attempts}${entry.attempts === 2 ? " (one schema-repair retry)" : ""}`,
  );
  add("Selected visuals", String(entry.selectedVisualCount));
  const mix = Object.entries(entry.exerciseTypePercentages)
    .filter(([, percentage]) => percentage > 0)
    .map(([type, percentage]) => (
      `${EXERCISE_TYPE_LABELS[type as ExerciseV1["type"]]} ${percentage}%`
    ))
    .join(" · ");
  add("Exercise mix", mix);
  add("Focus instructions", entry.focusInstructions || "None");
}

function renderGenerationHistory(
  container: HTMLElement,
  bank: PracticeBankV2,
  history: GenerationHistoryV1 | undefined,
  warning: string | undefined,
): void {
  container.createEl("h4", { text: "Generation history" });
  if (warning !== undefined) {
    container.createEl("p", {
      cls: "practice-lab-bank-migration-note",
      text: `Generation history is read-only because it could not be validated: ${warning}`,
    });
  }
  if (history === undefined || history.entries.length === 0) {
    const generation = bank.generation;
    container.createEl("p", {
      cls: "practice-lab-statistics-method",
      text: generation === undefined
        ? "This older bank does not contain a recorded generation run."
        : `Current-bank metadata: ${providerLabel(generation.provider)} · Model not recorded · ${generation.reasoningEffort === undefined ? "Reasoning not recorded" : `${displayReasoningEffort(generation.reasoningEffort)} reasoning`} · ${new Date(generation.generatedAt).toLocaleString()} · Prompt ${generation.promptVersion}. Exact revision history starts with the next generation saved by this version.`,
    });
    return;
  }
  const list = container.createDiv({ cls: "practice-lab-generation-history" });
  for (const entry of [...history.entries].reverse()) {
    renderGenerationEntry(list, entry);
  }
}

function renderSessionGenerationAudit(
  container: HTMLElement,
  session: SessionStatistic,
  history: GenerationHistoryV1 | undefined,
): void {
  const generation = history === undefined
    ? undefined
    : generationForBankRevision(history, session.bankRevisionAtStart);
  container.createSpan({
    cls: "practice-lab-session-generation-audit",
    text: generation === undefined
      ? `Question generation: not recorded for bank revision ${session.bankRevisionAtStart}`
      : `Question generation: ${generationAuditSummary(generation)} · generated ${new Date(generation.generatedAt).toLocaleString()} · bank revision ${generation.bankRevision}`,
  });
}

function renderAnswerReviewAudit(
  container: HTMLElement,
  review: AiReviewSessionItemResultV2,
): void {
  const terminal = review.state.status === "reviewed"
    ? `reviewed ${new Date(review.state.reviewedAt).toLocaleString()}`
    : review.state.status === "failed"
      ? `failed ${new Date(review.state.failedAt).toLocaleString()}`
      : `queued ${new Date(review.state.queuedAt).toLocaleString()}`;
  container.createEl("p", {
    cls: "practice-lab-ai-review-audit",
    text: [
      `Provider ${providerLabel(review.request.provider)}`,
      "CLI version not recorded",
      "Model provider default (not pinned or recorded)",
      `${displayReasoningEffort(review.request.reasoningEffort)} reasoning`,
      `prompt ${review.request.promptVersion}`,
      `requested ${new Date(review.request.requestedAt).toLocaleString()}`,
      `${review.state.attempts} ${review.state.attempts === 1 ? "attempt" : "attempts"}`,
      terminal,
      `request ${review.request.requestId}`,
      `hash ${review.request.requestHash}`,
    ].join(" · "),
  });
}

function renderCriterionFeedback(
  container: HTMLElement,
  criteria: readonly AiReviewCriterionResultV2[],
  sourceSegments: readonly {
    readonly id: string;
    readonly headingPath: readonly string[];
    readonly text: string;
  }[],
): void {
  if (criteria.length === 0) return;
  const list = container.createEl("ul", {
    cls: "practice-lab-ai-review-criteria",
    attr: { "aria-label": "Criterion-level feedback" },
  });
  for (const result of criteria) {
    const item = list.createEl("li", {
      cls: `practice-lab-ai-review-criterion is-${result.outcome}`,
    });
    const heading = item.createDiv({
      cls: "practice-lab-ai-review-criterion-heading",
    });
    heading.createEl("strong", { text: result.criterion });
    heading.createSpan({
      text: result.outcome === "met"
        ? "Met"
        : result.outcome === "partial"
          ? "Partial"
          : "Missed",
    });
    item.createEl("p", { text: result.feedback });
    const evidence = item.createDiv({
      cls: "practice-lab-ai-review-evidence",
    });
    evidence.createSpan({ text: "Evidence segments:" });
    if (result.sourceSegmentIds.length === 0) {
      evidence.createSpan({ text: " none returned" });
    } else {
      const evidenceList = evidence.createEl("ul");
      for (const segmentId of result.sourceSegmentIds) {
        const segment = sourceSegments.find((candidate) => candidate.id === segmentId);
        const row = evidenceList.createEl("li");
        row.createEl("code", { text: segmentId });
        if (segment !== undefined) {
          const heading = segment.headingPath.length === 0
            ? "Source excerpt"
            : segment.headingPath.join(" › ");
          const excerpt = segment.text.length <= 180
            ? segment.text
            : `${segment.text.slice(0, 177)}…`;
          row.createSpan({ text: `${heading}: ${excerpt}` });
        }
      }
    }
  }
}

function runPersistedReviewAction(
  button: HTMLButtonElement,
  status: HTMLElement,
  action: () => Promise<void> | void,
  progressText: string,
  successText: string,
): void {
  button.disabled = true;
  status.setText(progressText);
  Promise.resolve()
    .then(action)
    .then(() => {
      status.setText(successText);
    })
    .catch((error: unknown) => {
      button.disabled = false;
      status.setText(
        error instanceof Error ? error.message : "The review action failed.",
      );
      status.addClass("is-warning");
    });
}

export function renderBankStatistics(
  container: HTMLElement,
  bank: PracticeBankV2,
  options: BankStatisticsViewOptions = {},
): void {
  installHoverDescriptions(container);
  const statistics = calculatePracticeBankStatistics(bank);
  const visibility = options.visibility ?? DEFAULT_DISPLAY_PREFERENCES.bank;
  const requiresReviewManagement = bank.sessions.some((session) =>
    session.results.some((result) =>
      result.grading === "ai-review"
      && (result.state.status === "pending" || result.state.status === "failed"),
    ),
  );
  const hasDetails = visibility.showAnswerOutcomes
    || visibility.showTypeBreakdown
    || visibility.showSessionHistory
    || visibility.showGenerationHistory
    || options.generationHistoryWarning !== undefined
    || requiresReviewManagement;
  if (!hasVisibleBankOverview(visibility) && !hasDetails) return;
  const overview = container.createDiv({ cls: "practice-lab-bank-statistics" });
  if (statistics.sessionCount === 0) {
    if (hasVisibleBankOverview(visibility) || hasDetails) {
      overview.createEl("p", {
        cls: "practice-lab-bank-statistics-empty",
        text: "No score history yet. Complete a practice session to build local statistics for this bank.",
      });
    }
    if (!visibility.showGenerationHistory && !requiresReviewManagement) return;
  }

  if (hasVisibleBankOverview(visibility)) {
    const metrics = overview.createDiv({ cls: "practice-lab-bank-metrics" });
    if (visibility.showOverallScore) {
      createMetric(
        metrics,
        "Overall score",
        percentText(statistics.performance.percent),
        `${statistics.provisional ? "Provisional · " : ""}${pointsText(statistics.performance)}`,
      );
    }
    if (visibility.showLatestSession) {
      createMetric(
        metrics,
        "Latest session",
        percentText(statistics.latestScorePercent),
        statistics.history[0] === undefined
          ? "No completed run"
          : `${statistics.history[0].provisional ? "Provisional · " : ""}${practiceRunRankText(statistics.history[0].practiceRun.rank)} · ${statistics.history[0].completedCount} answered`,
      );
    }
    if (visibility.showBestSession) {
      createMetric(
        metrics,
        "Best session",
        percentText(statistics.bestScorePercent),
        `${statistics.sessionCount} completed ${statistics.sessionCount === 1 ? "session" : "sessions"}`,
      );
    }
    if (visibility.showCompletion) {
      createMetric(
        metrics,
        "Completion",
        percentText(statistics.completionPercent),
        `${statistics.totalAnswered} total answers`,
      );
    }
    if (visibility.showBestStreak) {
      createMetric(
        metrics,
        "Best answer streak",
        String(statistics.bestAnswerStreak),
        "Consecutive full-credit answers",
      );
    }
    if (visibility.showAiReviews) {
      createMetric(
        metrics,
        "AI answer reviews",
        String(statistics.reviewedAiResponseCount),
        `${statistics.pendingAiReviewCount} pending · ${statistics.failedAiReviewCount} failed`,
      );
    }
  }

  if (!hasDetails) return;
  const details = overview.createEl("details", {
    cls: "practice-lab-bank-statistics-details",
  });
  details.createEl("summary", {
    text: visibility.showSessionHistory || visibility.showGenerationHistory
      ? "Generation, session, and performance history"
      : "AI review management",
  });
  if (visibility.showGenerationHistory || options.generationHistoryWarning !== undefined) {
    renderGenerationHistory(
      details,
      bank,
      options.generationHistory,
      options.generationHistoryWarning,
    );
  }
  if (visibility.showAnswerOutcomes || visibility.showTypeBreakdown || visibility.showSessionHistory) {
    details.createEl("p", {
      cls: "practice-lab-statistics-method",
      text: "Objective scoring is local and deterministic. Free responses are either self-assessed or reviewed by the explicitly selected AI provider. Correct answers earn 1 run point, partial answers earn 0.5, and incorrect answers earn 0. Pending or failed AI reviews are excluded from scores and make the result provisional.",
    });
  }

  if (visibility.showAnswerOutcomes) {
    const outcomeSummary = details.createDiv({
      cls: "practice-lab-bank-outcome-summary",
    });
    outcomeSummary.createEl("h4", { text: "Answer outcomes" });
    outcomeSummary.createEl("p", {
      text: `${statistics.objectiveCorrect}/${statistics.objectiveTotal} objective answers correct · Free responses: ${statistics.freeResponseCorrect} correct, ${statistics.freeResponsePartial} partially correct, ${statistics.freeResponseIncorrect} incorrect`,
    });
  }

  if (visibility.showTypeBreakdown && statistics.typeBreakdown.length > 0) {
    details.createEl("h4", { text: "Performance by exercise type" });
    const typeList = details.createDiv({ cls: "practice-lab-type-statistics" });
    for (const type of statistics.typeBreakdown) {
      const row = typeList.createDiv({ cls: "practice-lab-type-statistic" });
      const heading = row.createDiv({ cls: "practice-lab-type-statistic-heading" });
      heading.createEl("strong", { text: EXERCISE_TYPE_LABELS[type.type] });
      heading.createSpan({
        text: `${percentText(type.performance.percent)} · ${type.attempts} ${type.attempts === 1 ? "attempt" : "attempts"}`,
      });
      createPerformanceBar(
        row,
        type.performance.percent,
        `${EXERCISE_TYPE_LABELS[type.type]} score`,
      );
      row.createSpan({
        cls: "practice-lab-type-statistic-outcomes",
        text: `${type.performance.correct} correct · ${type.performance.partial} partial · ${type.performance.incorrect} incorrect`,
      });
    }
  }
  if (visibility.showTypeBreakdown && statistics.unmappedAttempts > 0) {
    details.createEl("p", {
      cls: "practice-lab-statistics-method",
      text: `${statistics.unmappedAttempts} older ${statistics.unmappedAttempts === 1 ? "attempt is" : "attempts are"} retained in session history but excluded from the type breakdown because the corresponding exercise is no longer in the current bank revision.`,
    });
  }

  const sessionsToRender = visibility.showSessionHistory
    ? statistics.history
    : statistics.history.filter((session) =>
      session.pendingAiReviewCount + session.failedAiReviewCount > 0,
    );
  if (sessionsToRender.length > 0) {
    details.createEl("h4", {
      text: visibility.showSessionHistory ? "Session history" : "Pending and failed reviews",
    });
  }
  const history = details.createDiv({ cls: "practice-lab-session-history" });
  for (const session of sessionsToRender) {
    const row = history.createDiv({ cls: "practice-lab-session-history-row" });
    const heading = row.createDiv({ cls: "practice-lab-session-history-heading" });
    heading.createEl("strong", {
      text: new Date(session.finishedAt).toLocaleString(),
    });
    if (visibility.showSessionHistory) {
      heading.createSpan({
        text: `${session.provisional ? "Provisional · " : ""}${practiceRunRankText(session.practiceRun.rank)} · ${percentText(session.performance.percent)}`,
      });
      createPerformanceBar(row, session.performance.percent, "Session score");
      row.createSpan({
        cls: "practice-lab-session-history-meta",
        text: `${formatPracticeRunPoints(session.practiceRun.earnedPoints)}/${session.practiceRun.totalPoints} run points · Best answer streak ${session.practiceRun.bestStreak} · ${session.completedCount}/${session.exerciseCount} completed · ${durationText(session.durationMs)} · ${sessionOutcomeText(session)}`,
      });
      if (visibility.showGenerationHistory) {
        renderSessionGenerationAudit(row, session, options.generationHistory);
      }
    }
    if (session.pendingAiReviewCount + session.reviewedAiResponseCount + session.failedAiReviewCount > 0) {
      const storedSession = bank.sessions.find((candidate) => candidate.id === session.id);
      const reviews = storedSession?.results
        .filter(isAiReviewResult)
        .filter((result) =>
          visibility.showSessionHistory || result.state.status !== "reviewed",
        ) ?? [];
      const reviewDetails = row.createEl("details", { cls: "practice-lab-ai-review-history" });
      reviewDetails.open = !visibility.showSessionHistory;
      reviewDetails.createEl("summary", {
        text: `AI answer reviews (${session.reviewedAiResponseCount} reviewed · ${session.pendingAiReviewCount} pending · ${session.failedAiReviewCount} failed)`,
      });
      for (const review of reviews) {
        const exerciseTitle = bank.exercises.find((exercise) => exercise.id === review.exerciseId)?.title
          ?? review.request.context.exerciseTitle;
        const item = reviewDetails.createDiv({ cls: "practice-lab-ai-review-history-item" });
        item.createEl("strong", { text: exerciseTitle });
        item.createEl("p", { text: `Your answer: ${review.request.submittedAnswer}` });
        renderAnswerReviewAudit(item, review);
        if (review.state.status === "reviewed") {
          item.createEl("p", {
            text: `${review.state.verdict === "correct" ? "Correct" : review.state.verdict === "partial" ? "Partially correct" : "Incorrect"}: ${review.state.feedback}`,
          });
          renderCriterionFeedback(
            item,
            review.state.criteria,
            review.request.context.sourceSegments,
          );
        } else if (review.state.status === "pending") {
          item.createEl("p", { text: "Waiting for Practice Problem Generator on desktop to finish this review." });
          if (options.pauseAnswerReview !== undefined) {
            const actions = item.createDiv({ cls: "practice-lab-ai-review-actions" });
            const pause = actions.createEl("button", {
              text: "Pause review",
              attr: { type: "button" },
            });
            const status = actions.createSpan({
              cls: "practice-lab-answer-review-note",
              attr: { role: "status", "aria-live": "polite" },
            });
            pause.addEventListener("click", () => {
              runPersistedReviewAction(
                pause,
                status,
                () => options.pauseAnswerReview?.(review.request.requestId),
                "Pausing this exact review request…",
                "Paused. It remains pending and will resume on a later desktop start.",
              );
            });
          }
        } else {
          item.createEl("p", { text: `Review failed: ${review.state.error.message}` });
          const actions = item.createDiv({ cls: "practice-lab-ai-review-actions" });
          const originalProvider = providerLabel(review.request.provider);
          const retry = actions.createEl("button", {
            text: `Retry with ${originalProvider}`,
            attr: { type: "button" },
          });
          retry.disabled = options.retryAnswerReview === undefined;
          const status = actions.createSpan({
            cls: `practice-lab-answer-review-note${options.retryAnswerReview === undefined ? " is-warning" : ""}`,
            text: options.retryAnswerReview === undefined
              ? "Retry is available in Practice Problem Generator on desktop."
              : `Uses the original ${originalProvider} provider, ${displayReasoningEffort(review.request.reasoningEffort)} reasoning, answer, and locked context.`,
            attr: { role: "status", "aria-live": "polite" },
          });
          retry.addEventListener("click", () => {
            if (options.retryAnswerReview === undefined) return;
            runPersistedReviewAction(
              retry,
              status,
              () => options.retryAnswerReview?.({
                bankId: bank.bankId,
                sessionId: session.id,
                requestId: review.request.requestId,
                requestHash: review.request.requestHash,
              }),
              "Queuing the original locked review request…",
              "Retry queued. The stored request, provider, and reasoning are unchanged.",
            );
          });
        }
      }
    }
    if (visibility.showSessionHistory && options.removeSession !== undefined) {
      const dataActions = row.createEl("details", {
        cls: "practice-lab-entry-data-actions",
      });
      dataActions.createEl("summary", { text: "Manage this history entry" });
      dataActions.createEl("p", {
        text: "Removing this entry changes this bank's statistics and deletes any stored answers and AI-review feedback in the session. Other sessions and generated exercises are preserved.",
      });
      const actionRow = dataActions.createDiv({ cls: "practice-lab-destructive-actions" });
      const remove = actionRow.createEl("button", {
        text: "Remove entry…",
        cls: "mod-warning",
        attr: {
          type: "button",
          title: "Review a warning and type a confirmation phrase before removing this session",
        },
      });
      const status = actionRow.createSpan({
        cls: "practice-lab-answer-review-note",
        attr: { role: "status", "aria-live": "polite" },
      });
      remove.addEventListener("click", () => {
        runPersistedReviewAction(
          remove,
          status,
          () => options.removeSession?.(session.id),
          "Opening the confirmation…",
          "History entry removed. The bank view will refresh from the saved file.",
        );
      });
    }
  }
}
