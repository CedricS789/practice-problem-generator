import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, viewSource, learningPathViewSource, styles] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("saved Practice notes render one active Practice, Progress, or Manage panel", () => {
  assert.match(mainSource, /type SavedBankPage = "practice" \| "progress" \| "manage"/u);
  assert.match(mainSource, /renderHorizontalTabs<SavedBankPage>/u);
  assert.match(mainSource, /label: "Practice"/u);
  assert.match(mainSource, /label: "Progress"/u);
  assert.match(mainSource, /label: "Manage"/u);
  assert.match(mainSource, /private readonly savedBankPagesByLeaf = new WeakMap/u);
  assert.match(mainSource, /"Continue learning"/u);
  assert.match(mainSource, /"Choose a set"/u);
  assert.match(mainSource, /"Mixed practice"/u);
  assert.match(mainSource, /"Free practice"/u);
  assert.match(mainSource, /"Choose another session…"/u);
  assert.match(mainSource, /renderSavedBankProgressPage/u);
  assert.match(mainSource, /renderSavedBankManagePage/u);
  assert.ok(
    mainSource.indexOf("private renderSavedBankPracticePage")
      < mainSource.indexOf("private renderSavedBankProgressPage"),
    "Practice must remain the first saved-note task panel",
  );
});

test("a tutor step uses one compact path locator and skips the one-question order dialog", () => {
  assert.match(viewSource, /private renderGuidedPathPosition\(/u);
  assert.match(viewSource, /text: "Guided path"/u);
  assert.match(viewSource, /`Step \$\{step\.stepIndex \+ 1\} of \$\{step\.stepCount\}`/u);
  assert.match(viewSource, /`Question \$\{this\.studyIndex \+ 1\} of \$\{this\.studyExercises\.length\}`/u);
  assert.match(viewSource, /"Path details"/u);
  assert.match(viewSource, /practice-lab-path-primary-progress/u);
  assert.match(viewSource, /text: "Previous step"/u);
  assert.match(viewSource, /text: "Next step"/u);
  assert.match(viewSource, /across the saved path/u);
  assert.match(
    viewSource,
    /this\.studyPathStep === null\s*&& this\.displayPreferences\.practice\.showStudyProgress/u,
  );
  assert.match(viewSource, /const isSingleTutorStep = learning\?\.pathStep\?\.kind === "tutor-lesson"/u);
  assert.match(viewSource, /isSingleTutorStep\s*\? null\s*: await chooseStudyOrder/u);
  assert.match(styles, /\.practice-lab-path-position \{/u);
  assert.match(styles, /\.practice-lab-path-compact-current \{/u);
  assert.match(styles, /\.practice-lab-path-details \{/u);
  assert.match(styles, /\.practice-lab-path-adjacent-steps \{/u);
});

test("Guided path location reconstructs neighboring steps after recovery", () => {
  assert.match(viewSource, /readonly previousStepTitle\?: string/u);
  assert.match(viewSource, /readonly nextStepTitle\?: string/u);
  assert.match(viewSource, /titleForStep\(steps\[stepIndex - 1\]\)/u);
  assert.match(viewSource, /titleForStep\(steps\[stepIndex \+ 1\]\)/u);
  assert.match(viewSource, /const recoveredPathStep = recoveredPathStepPresentation/u);
});

test("study replaces the creation mode switch with a non-interactive session badge", () => {
  assert.match(viewSource, /if \(this\.stage === "study"\)/u);
  assert.match(viewSource, /cls: "practice-lab-session-mode-badge"/u);
  assert.match(viewSource, /\? "Guided path session"\s*: "Quick practice session"/u);
  assert.match(viewSource, /\} else \{\s*this\.renderCreationModeSwitch\(this\.contentEl\)/u);
  assert.match(styles, /\.practice-lab-session-mode-badge \{/u);
});

test("completing a path step can save and open the next recommendation", () => {
  assert.match(viewSource, /setButtonText\(this\.studyFinishing \? "Saving path step…" : "Save and continue path"\)/u);
  assert.match(viewSource, /this\.finishStudy\("continue"\)/u);
  assert.match(viewSource, /completedPathStep\.stepIndex/u);
  assert.match(mainSource, /continueLearningPath: async \(completedStepIndex\) =>/u);
  assert.match(mainSource, /const nextStepIndex = completedStepIndex \+ 1/u);
  assert.match(mainSource, /kind: "path-set"/u);
  assert.match(mainSource, /kind: "lesson", lessonId: nextStep\.lessonId/u);
  assert.match(learningPathViewSource, /"Continue guided path"/u);
});

test("saved-session recovery is one explicit action instead of several misleading scopes", () => {
  const practice = mainSource.slice(
    mainSource.indexOf("private renderSavedBankPracticePage"),
    mainSource.indexOf("private renderSavedBankProgressPage"),
  );
  assert.match(practice, /savedSessionMatchesBank/u);
  assert.match(practice, /Nothing is discarded without explicit confirmation/u);
  assert.match(practice, /if \(savedSession !== undefined \|\| hasUnreadableSession\) return/u);
  assert.ok(
    practice.indexOf("hasUnreadableSession) return") < practice.indexOf('"Choose a set"'),
    "Alternate scopes must be unreachable while a checkpoint needs recovery",
  );
});

test("the Guided Ready page names checkpoint recovery before invoking a study action", () => {
  assert.match(learningPathViewSource, /savedWorkspaceStudyState/u);
  assert.match(learningPathViewSource, /"Open recovery choices"/u);
  assert.match(learningPathViewSource, /"Resume saved session"/u);
  assert.match(learningPathViewSource, /studyState\.state === "ready"/u);
  assert.match(mainSource, /savedWorkspaceStudyState: \(workspace\) =>/u);
  assert.match(mainSource, /studyCheckpointWorkspaceActionState\(/u);
});
