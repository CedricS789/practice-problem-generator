import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, viewSource, learningPathViewSource, styles] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("saved Practice notes explain path scope and every study choice", () => {
  assert.match(mainSource, /text: "Start studying"/u);
  assert.match(mainSource, /total \$\{bank\.exercises\.length === 1 \? "question" : "questions"\}/u);
  assert.match(mainSource, /Finishing this step does not end the path/u);
  assert.match(mainSource, /"Continue guided path"/u);
  assert.match(mainSource, /Tutor steps contain one guided problem/u);
  assert.match(mainSource, /"Choose a set"/u);
  assert.match(mainSource, /"Mixed practice"/u);
  assert.match(mainSource, /"Free practice"/u);
  assert.match(mainSource, /"Manage and review"/u);
  assert.match(styles, /\.practice-lab-bank-launcher \{/u);
  assert.match(styles, /\.practice-lab-bank-action \{/u);
  assert.ok(
    mainSource.indexOf('cls: "practice-lab-bank-launcher"')
      < mainSource.indexOf("renderBankStatistics(element, bank"),
    "Study choices must appear before history and analytics on the Practice note",
  );
});

test("a tutor step shows overall path position and skips the one-question order dialog", () => {
  assert.match(viewSource, /private renderGuidedPathPosition\(/u);
  assert.match(viewSource, /text: "You are here"/u);
  assert.match(viewSource, /"Guided path location"/u);
  assert.match(viewSource, /text: "Overall path"/u);
  assert.match(viewSource, /"Inside this tutor lesson"/u);
  assert.match(viewSource, /"Inside this practice set"/u);
  assert.match(viewSource, /text: "Previous step"/u);
  assert.match(viewSource, /text: "Next step"/u);
  assert.match(viewSource, /saved questions across the full path/u);
  assert.match(
    viewSource,
    /this\.studyPathStep === null\s*&& this\.displayPreferences\.practice\.showStudyProgress/u,
  );
  assert.match(viewSource, /const isSingleTutorStep = learning\?\.pathStep\?\.kind === "tutor-lesson"/u);
  assert.match(viewSource, /isSingleTutorStep\s*\? null\s*: await chooseStudyOrder/u);
  assert.match(styles, /\.practice-lab-path-position \{/u);
  assert.match(styles, /\.practice-lab-path-progress-levels \{/u);
  assert.match(styles, /\.practice-lab-path-adjacent-steps \{/u);
});

test("Guided path location reconstructs neighboring steps after recovery", () => {
  assert.match(viewSource, /readonly previousStepTitle\?: string/u);
  assert.match(viewSource, /readonly nextStepTitle\?: string/u);
  assert.match(viewSource, /titleForStep\(steps\[stepIndex - 1\]\)/u);
  assert.match(viewSource, /titleForStep\(steps\[stepIndex \+ 1\]\)/u);
  assert.match(viewSource, /const recoveredPathStep = recoveredPathStepPresentation/u);
});

test("an active Guided path session highlights Guided path in the mode switch", () => {
  const switchImplementation = viewSource.slice(
    viewSource.indexOf("private renderCreationModeSwitch"),
    viewSource.indexOf("private renderGenerationRecovery"),
  );
  assert.match(
    switchImplementation,
    /this\.studyLearningProgress\?\.scope\.mode === "learning-path"/u,
  );
  assert.match(switchImplementation, /active: activeMode/u);
  assert.match(switchImplementation, /This Guided path practice session is active/u);
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
  const recoveryBranch = mainSource.slice(
    mainSource.indexOf("if (recoveryActionLabel !== undefined)"),
    mainSource.indexOf("} else if (bank.learningPath !== null)", mainSource.indexOf("if (recoveryActionLabel !== undefined)")),
  );
  assert.match(recoveryBranch, /Finish or discard it before choosing another scope/u);
  assert.match(recoveryBranch, /addStudyAction\(/u);
  assert.doesNotMatch(recoveryBranch, /"Choose a set"|"Mixed practice"|"Free practice"/u);
});
