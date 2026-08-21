import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { DraftExercisePresentation } from "../src/ui/contracts";
import { presentStudyOcclusionVisual } from "../src/ui/study-occlusion";

const viewSource = await readFile(
  new URL("../src/ui/practice-lab-view.ts", import.meta.url),
  "utf8",
);

function occlusionExercise(): DraftExercisePresentation {
  return {
    id: "occlusion-study-1",
    type: "image-occlusion",
    prompt: "Identify the hidden node.",
    groundedAnswer: "Node A",
    sourceSegmentIds: ["segment-1"],
    visualUrl: "app://local/source.png",
    masks: [
      {
        id: "mask-1",
        label: "Node",
        answer: "Node A",
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.2,
      },
    ],
    grading: {
      kind: "occlusion",
      acceptedAnswers: { "mask-1": ["Node A"] },
    },
  };
}

test("occlusion study removes every mask but preserves the image after submission", () => {
  const exercise = occlusionExercise();
  const question = presentStudyOcclusionVisual(exercise, false);
  const feedback = presentStudyOcclusionVisual(exercise, true);

  assert.equal(question?.imageUrl, "app://local/source.png");
  assert.equal(question?.revealed, false);
  assert.equal(question?.masks.length, 1);
  assert.equal(feedback?.imageUrl, question?.imageUrl);
  assert.equal(feedback?.revealed, true);
  assert.deepEqual(feedback?.masks, []);
});

test("non-occlusion exercises do not create an occlusion visual", () => {
  const exercise: DraftExercisePresentation = {
    id: "short-answer-1",
    type: "short-answer",
    prompt: "Explain the node.",
    groundedAnswer: "It is Node A.",
    sourceSegmentIds: ["segment-1"],
    grading: { kind: "self", groundedAnswer: "It is Node A." },
  };
  assert.equal(presentStudyOcclusionVisual(exercise, true), null);
});

test("study input renders masks and feedback renders the revealed visual", () => {
  assert.match(
    viewSource,
    /renderStudyOcclusionVisual\(container, exercise, false\)/u,
  );
  assert.match(
    viewSource,
    /renderStudyOcclusionVisual\(container, exercise, true\)/u,
  );
  assert.match(viewSource, /Original image revealed/u);
});
