export const GENERATION_DIFFICULTIES = [
  "foundational",
  "deep-exam",
  "challenge",
] as const;

export type GenerationDifficulty = typeof GENERATION_DIFFICULTIES[number];
export type StoredDifficulty = "foundation" | "exam" | "challenge";

export interface DifficultyProfile {
  readonly id: GenerationDifficulty;
  readonly label: string;
  readonly tagline: string;
  readonly description: string;
  readonly itemCalibration: string;
  readonly recommended: boolean;
}

export const DIFFICULTY_PROFILES: readonly DifficultyProfile[] = [
  {
    id: "foundational",
    label: "Foundational",
    tagline: "Build reliable fundamentals",
    description:
      "Use core distinctions, direct explanation, and one-step application or calculation. Problems stay meaningful rather than trivial.",
    itemCalibration:
      "Favor easy and medium items; use a hard item only for a supported connection between fundamentals.",
    recommended: false,
  },
  {
    id: "deep-exam",
    label: "Deep exam practice",
    tagline: "Explain, connect, and transfer",
    description:
      "Use mechanisms, consequences, multi-concept application, and defensible calculations at a demanding university-practice level.",
    itemCalibration:
      "Favor medium and hard items; use an easy item only when it establishes an essential prerequisite.",
    recommended: true,
  },
  {
    id: "challenge",
    label: "Challenge",
    tagline: "Integrate across several steps",
    description:
      "Use subtle distinctions and multi-step transfer while remaining fully solvable from the approved source.",
    itemCalibration:
      "Favor hard items; difficulty must come from reasoning, never missing facts or unstated assumptions.",
    recommended: false,
  },
];

const PROFILE_BY_ID = new Map(
  DIFFICULTY_PROFILES.map((profile) => [profile.id, profile]),
);

export function difficultyProfile(
  difficulty: GenerationDifficulty,
): DifficultyProfile {
  const profile = PROFILE_BY_ID.get(difficulty);
  if (profile === undefined) {
    throw new Error(`Unknown generation difficulty: ${difficulty as string}.`);
  }
  return profile;
}

export function displayDifficulty(difficulty: GenerationDifficulty): string {
  return difficultyProfile(difficulty).label;
}

export function difficultyPromptGuidance(
  difficulty: GenerationDifficulty,
): string {
  const profile = difficultyProfile(difficulty);
  return `${profile.description} ${profile.itemCalibration}`;
}

export function difficultyProfilesForPrompt(): string {
  return DIFFICULTY_PROFILES.map((profile) => (
    `- ${profile.id} (${profile.label}): ${difficultyPromptGuidance(profile.id)}`
  )).join("\n");
}

export function generationDifficultyFromSetting(
  difficulty: StoredDifficulty,
): GenerationDifficulty {
  if (difficulty === "foundation") return "foundational";
  return difficulty === "exam" ? "deep-exam" : "challenge";
}

export function settingDifficultyFromGeneration(
  difficulty: GenerationDifficulty,
): StoredDifficulty {
  if (difficulty === "foundational") return "foundation";
  return difficulty === "deep-exam" ? "exam" : "challenge";
}
