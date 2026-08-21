import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewSource = await readFile(
  new URL("../src/ui/practice-lab-view.ts", import.meta.url),
  "utf8",
);

test("review exposes a guarded bulk occlusion acceptance action", () => {
  assert.match(viewSource, /setButtonText\("Accept all occlusions"\)/u);
  assert.match(viewSource, /acceptAllValidOcclusions\(this\.drafts\)/u);
  assert.match(
    viewSource,
    /setDisabled\(!gate\.hasUnreviewedOcclusion\)/u,
  );
});
