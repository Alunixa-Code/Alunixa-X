import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_ARCHIVE_ENDINGS,
  SIGNAL_ARCHIVE_NODES,
  availableSignalArchiveChoices,
  chooseSignalArchivePath,
  createSignalArchiveState,
  normalizeSignalArchiveProgress,
  recordSignalArchiveEnding,
  type SignalArchiveEnding,
  type SignalArchiveState,
} from "./signal-archive.ts";

test("signal archive graph references valid nodes and has complete localization", () => {
  for (const node of Object.values(SIGNAL_ARCHIVE_NODES)) {
    for (const locale of ["zh", "en", "ru"] as const) {
      assert.ok(node.chapter[locale].trim(), `${node.id} chapter ${locale}`);
      assert.ok(node.title[locale].trim(), `${node.id} title ${locale}`);
      assert.ok(node.speaker[locale].trim(), `${node.id} speaker ${locale}`);
      assert.ok(node.text[locale].trim(), `${node.id} text ${locale}`);
    }
    for (const choice of node.choices ?? []) {
      assert.ok(SIGNAL_ARCHIVE_NODES[choice.next], `${node.id}.${choice.id} -> ${choice.next}`);
      for (const locale of ["zh", "en", "ru"] as const) {
        assert.ok(choice.label[locale].trim(), `${node.id}.${choice.id} label ${locale}`);
      }
    }
  }
});

test("all four endings are reachable through the declarative state machine", () => {
  const queue: SignalArchiveState[] = [createSignalArchiveState()];
  const visited = new Set<string>();
  const endings = new Set<SignalArchiveEnding>();
  while (queue.length) {
    const state = queue.shift()!;
    const key = `${state.nodeId}:${[...state.flags].sort().join(",")}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = SIGNAL_ARCHIVE_NODES[state.nodeId];
    if (node.ending) endings.add(node.ending);
    for (const choice of availableSignalArchiveChoices(state)) {
      queue.push(chooseSignalArchivePath(state, choice.id));
    }
  }
  assert.deepEqual([...endings].sort(), [...SIGNAL_ARCHIVE_ENDINGS].sort());
});

test("true ending requires the silent, complete, truthful route", () => {
  const incomplete: SignalArchiveState = {
    nodeId: "lastPower",
    flags: ["stayedSilent", "heardWholeMessage", "noticedLoop", "chartedEcho"],
    trail: ["wake", "lastPower"],
  };
  assert.ok(!availableSignalArchiveChoices(incomplete).some((choice) => choice.next === "endingTe"));
  const complete = { ...incomplete, flags: [...incomplete.flags, "acceptedTruth"] as SignalArchiveState["flags"] };
  assert.ok(availableSignalArchiveChoices(complete).some((choice) => choice.next === "endingTe"));
});

test("progress normalization is bounded and ending records stay unique", () => {
  assert.deepEqual(normalizeSignalArchiveProgress({ endings: ["he", "he", "bad", "te"], visits: 2.9 }), {
    endings: ["he", "te"],
    visits: 2,
  });
  assert.deepEqual(recordSignalArchiveEnding({ endings: ["he"], visits: 3 }, "he"), {
    endings: ["he"],
    visits: 3,
  });
});
