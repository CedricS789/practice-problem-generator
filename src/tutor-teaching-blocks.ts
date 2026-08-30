import type {
  TutorTeachingBlockKindV1,
  TutorTeachingBlockV1,
} from "./model";

const TUTOR_TEACHING_BLOCK_RANK: Readonly<Record<TutorTeachingBlockKindV1, number>> = {
  why: 0,
  prerequisite: 1,
  explanation: 2,
  "worked-example": 3,
  "causal-walkthrough": 3,
};

export function tutorTeachingBlocksAreOrdered(
  blocks: readonly Pick<TutorTeachingBlockV1, "kind">[],
): boolean {
  return blocks.every((block, index) => (
    index === 0
    || TUTOR_TEACHING_BLOCK_RANK[block.kind]
      >= TUTOR_TEACHING_BLOCK_RANK[blocks[index - 1]?.kind ?? block.kind]
  ));
}

/**
 * Return the pedagogical sequence required by persisted learning paths while
 * preserving the relative order of blocks with the same instructional rank.
 */
export function orderTutorTeachingBlocks<T extends TutorTeachingBlockV1>(
  blocks: readonly T[],
): T[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => (
      TUTOR_TEACHING_BLOCK_RANK[left.block.kind]
        - TUTOR_TEACHING_BLOCK_RANK[right.block.kind]
      || left.index - right.index
    ))
    .map(({ block }) => block);
}
