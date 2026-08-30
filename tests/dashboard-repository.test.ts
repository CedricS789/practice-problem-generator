import assert from "node:assert/strict";
import test from "node:test";

import type { App, TFile } from "obsidian";
import {
  PracticeDashboardRepository,
} from "../src/dashboard-repository";
import type { PracticeBankV2 } from "../src/model";
import { serializePracticeBank } from "../src/persistence";

interface FakeFile extends TFile {
  content: string;
}

class FakeVault {
  readonly files = new Map<string, FakeFile>();
  readonly readPaths: string[] = [];
  onCachedRead: ((
    file: FakeFile,
    contentAtReadStart: string,
    readNumber: number,
  ) => void) | undefined;

  getMarkdownFiles(): FakeFile[] {
    return [...this.files.values()];
  }

  getAbstractFileByPath(path: string): FakeFile | null {
    return this.files.get(path) ?? null;
  }

  async cachedRead(file: FakeFile): Promise<string> {
    this.readPaths.push(file.path);
    const contentAtReadStart = file.content;
    this.onCachedRead?.(file, contentAtReadStart, this.readPaths.length);
    return contentAtReadStart;
  }
}

function file(path: string, content: string, mtime = 1): FakeFile {
  const name = path.split("/").at(-1) ?? path;
  const extension = name.split(".").at(-1) ?? "";
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/u, ""),
    extension,
    content,
    stat: { ctime: mtime, mtime, size: content.length },
  } as FakeFile;
}

function bank(id: string, sourcePath: string): PracticeBankV2 {
  return {
    schemaVersion: 2,
    bankId: id,
    revision: 0,
    createdAt: "2026-08-21T08:00:00.000Z",
    updatedAt: "2026-08-21T08:00:00.000Z",
    source: {
      vaultPath: sourcePath,
      wikilink: `[[${sourcePath.replace(/\.md$/u, "")}]]`,
      title: sourcePath.split("/").at(-1)?.replace(/\.md$/u, "") ?? id,
      scope: "note",
      hash: `sha256:${"a".repeat(64)}`,
    },
    segments: [{
      id: "segment-1",
      kind: "paragraph",
      ordinal: 0,
      headingPath: [],
      text: "Synthetic evidence.",
    }],
    visuals: [],
    exercises: [{
      id: "exercise-1",
      type: "short-answer",
      title: "Explain",
      prompt: "Explain the evidence.",
      difficulty: "medium",
      sourceSegmentIds: ["segment-1"],
      groundedAnswer: "Synthetic evidence.",
      acceptableAnswers: ["Synthetic evidence."],
      keyPoints: ["Use the evidence."],
    }],
    sessions: [],
  };
}

test("dashboard discovery reads only candidates and resolves source tags live", async () => {
  const vault = new FakeVault();
  const source = file("Notes/Term/Course/Topic.md", "# Topic");
  const valid = file(
    "Notes/Term/Course/Practice/Topic - Practice.md",
    serializePracticeBank(bank("bank-valid", source.path)),
  );
  const moved = file(
    "Archive/Moved bank.md",
    serializePracticeBank(bank("bank-moved", "Notes/Term/Course/Missing.md")),
  );
  const ordinary = file("Notes/Term/Course/Ordinary.md", "# Ordinary");
  const ordinaryPractice = file(
    "Notes/Term/Course/Practice/Handwritten drills.md",
    "# Handwritten drills",
  );
  const markedBroken = file("Archive/Broken bank.md", "# Missing block");
  for (const entry of [source, valid, moved, ordinary, ordinaryPractice, markedBroken]) {
    vault.files.set(entry.path, entry);
  }

  const repository = new PracticeDashboardRepository(
    { vault } as unknown as App,
    {
      hasPracticeBankMarker: (candidate) =>
        candidate.path === moved.path || candidate.path === markedBroken.path,
      sourceTags: (candidate) => candidate.path === source.path
        ? ["course/ELEC", "#Topic", "#topic", ""]
        : [],
    },
  );
  const snapshot = await repository.load();

  assert.deepEqual(
    vault.readPaths.sort(),
    [markedBroken.path, moved.path, ordinaryPractice.path, valid.path].sort(),
  );
  assert.equal(snapshot.records.length, 2);
  const validRecord = snapshot.records.find(
    (record) => record.bank.bankId === "bank-valid",
  );
  assert.equal(validRecord?.sourceExists, true);
  assert.deepEqual(validRecord?.sourceTags, ["#course/ELEC", "#Topic"]);
  const movedRecord = snapshot.records.find(
    (record) => record.bank.bankId === "bank-moved",
  );
  assert.equal(movedRecord?.sourceExists, false);
  assert.deepEqual(movedRecord?.sourceTags, []);
  assert.equal(snapshot.issues.length, 1);
  assert.equal(snapshot.issues[0]?.bankPath, markedBroken.path);
  assert.equal(snapshot.issues[0]?.severity, "error");
});

test("malformed and unsupported banks cannot suppress valid dashboard records", async () => {
  const vault = new FakeVault();
  const source = file("Notes/Term/Course/Topic.md", "# Topic");
  const valid = file(
    "Notes/Term/Course/Practice/Topic - Practice.md",
    serializePracticeBank(bank("bank-valid", source.path)),
  );
  const malformed = file(
    "Notes/Term/Course/Practice/Broken - Practice.md",
    "---\npractice-lab: true\n---\n```practice-lab\n{broken}\n```",
  );
  const unsupported = file(
    "Notes/Term/Course/Practice/Future - Practice.md",
    serializePracticeBank(bank("bank-future", source.path)).replace(
      '"schemaVersion": 4',
      '"schemaVersion": 99',
    ),
  );
  for (const entry of [source, valid, malformed, unsupported]) {
    vault.files.set(entry.path, entry);
  }
  const repository = new PracticeDashboardRepository(
    { vault } as unknown as App,
  );
  const snapshot = await repository.load();

  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0]?.bank.bankId, "bank-valid");
  assert.equal(snapshot.issues.length, 2);
  assert.ok(snapshot.issues.some((issue) => /JSON/iu.test(issue.message)));
  assert.ok(snapshot.issues.some((issue) => /schema version 99/iu.test(issue.message)));
});

test("unchanged banks reuse parsed data while source tags stay live", async () => {
  const vault = new FakeVault();
  const source = file("Notes/Term/Course/Topic.md", "# Topic");
  const valid = file(
    "Notes/Term/Course/Practice/Topic - Practice.md",
    serializePracticeBank(bank("bank-valid", source.path)),
  );
  vault.files.set(source.path, source);
  vault.files.set(valid.path, valid);
  let tags = ["#first"];
  const repository = new PracticeDashboardRepository(
    { vault } as unknown as App,
    { sourceTags: () => tags },
  );

  const first = await repository.load();
  tags = ["#second"];
  const second = await repository.load();
  assert.equal(vault.readPaths.filter((path) => path === valid.path).length, 1);
  assert.deepEqual(first.records[0]?.sourceTags, ["#first"]);
  assert.deepEqual(second.records[0]?.sourceTags, ["#second"]);
});

test("a mutation during cachedRead cannot cache stale content under the new stat", async () => {
  const vault = new FakeVault();
  const source = file("Notes/Term/Course/Topic.md", "# Topic");
  const oldMarkdown = serializePracticeBank(bank("bank-old", source.path));
  const newMarkdown = serializePracticeBank(bank("bank-new-with-longer-id", source.path));
  const practice = file(
    "Notes/Term/Course/Practice/Topic - Practice.md",
    oldMarkdown,
  );
  vault.files.set(source.path, source);
  vault.files.set(practice.path, practice);
  vault.onCachedRead = (candidate, _contentAtReadStart, readNumber) => {
    if (candidate.path !== practice.path || readNumber !== 1) return;
    candidate.content = newMarkdown;
    candidate.stat.size = newMarkdown.length;
  };
  const repository = new PracticeDashboardRepository(
    { vault } as unknown as App,
  );

  const first = await repository.load();
  const second = await repository.load();

  assert.equal(first.records[0]?.bank.bankId, "bank-new-with-longer-id");
  assert.equal(second.records[0]?.bank.bankId, "bank-new-with-longer-id");
  assert.equal(
    vault.readPaths.filter((path) => path === practice.path).length,
    2,
  );
});

test("two unstable reads produce a warning and do not poison the parse cache", async () => {
  const vault = new FakeVault();
  const source = file("Notes/Term/Course/Topic.md", "# Topic");
  const practice = file(
    "Notes/Term/Course/Practice/Topic - Practice.md",
    serializePracticeBank(bank("bank-initial", source.path)),
  );
  vault.files.set(source.path, source);
  vault.files.set(practice.path, practice);
  vault.onCachedRead = (candidate) => {
    if (candidate.path !== practice.path) return;
    const nextId = `bank-after-read-${String(vault.readPaths.length)}`;
    candidate.content = serializePracticeBank(bank(nextId, source.path));
    candidate.stat.mtime += 1;
    candidate.stat.size = candidate.content.length;
  };
  const repository = new PracticeDashboardRepository(
    { vault } as unknown as App,
  );

  const unstable = await repository.load();
  assert.equal(unstable.records.length, 0);
  assert.equal(unstable.issues.length, 1);
  assert.equal(unstable.issues[0]?.severity, "warning");
  assert.match(unstable.issues[0]?.message ?? "", /changed while/iu);
  assert.equal(
    vault.readPaths.filter((path) => path === practice.path).length,
    2,
  );

  vault.onCachedRead = undefined;
  const stable = await repository.load();
  assert.equal(stable.records[0]?.bank.bankId, "bank-after-read-2");
  assert.equal(
    vault.readPaths.filter((path) => path === practice.path).length,
    3,
  );
});
