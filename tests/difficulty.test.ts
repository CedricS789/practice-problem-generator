import assert from "node:assert/strict";
import test from "node:test";

import {
  DIFFICULTY_PROFILES,
  difficultyProfilesForPrompt,
  difficultyPromptGuidance,
  displayDifficulty,
  generationDifficultyFromSetting,
  settingDifficultyFromGeneration,
} from "../src/difficulty";

test("difficulty profiles are distinct, complete, and recommend deep exam practice", () => {
  assert.deepEqual(
    DIFFICULTY_PROFILES.map((profile) => profile.id),
    ["foundational", "deep-exam", "challenge"],
  );
  assert.deepEqual(
    DIFFICULTY_PROFILES.filter((profile) => profile.recommended).map((profile) => profile.id),
    ["deep-exam"],
  );
  for (const profile of DIFFICULTY_PROFILES) {
    assert.ok(profile.tagline.length > 10);
    assert.ok(profile.description.length > 50);
    assert.ok(profile.itemCalibration.length > 50);
    assert.match(difficultyProfilesForPrompt(), new RegExp(profile.id, "u"));
    assert.equal(displayDifficulty(profile.id), profile.label);
  }
});

test("difficulty guidance calibrates item labels without weakening source grounding", () => {
  assert.match(difficultyPromptGuidance("foundational"), /easy and medium/u);
  assert.match(difficultyPromptGuidance("deep-exam"), /medium and hard/u);
  assert.match(difficultyPromptGuidance("challenge"), /Favor hard items/u);
  assert.match(difficultyPromptGuidance("challenge"), /never missing facts/u);
});

test("stored defaults map losslessly to generation profiles", () => {
  for (const stored of ["foundation", "exam", "challenge"] as const) {
    assert.equal(
      settingDifficultyFromGeneration(generationDifficultyFromSetting(stored)),
      stored,
    );
  }
});
