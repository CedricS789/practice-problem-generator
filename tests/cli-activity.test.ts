import assert from "node:assert/strict";
import test from "node:test";

import { CliActivityDecoder } from "../src/cli/activity";
import type { CliActivityEvent } from "../src/cli/contracts";

test("Codex JSONL activity never exposes IDs, answer JSON, or reasoning text", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("codex", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: [
      '{"type":"thread.started","thread_id":"C:/private-vault/thread"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"hidden causal chain"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"secretAnswer\\":\\"private\\"}"}}',
      '{"type":"turn.completed"}',
    ].join("\n"),
  });
  decoder.finish();

  const messages = events.map((event) => event.message).join("\n");
  assert.match(messages, /Codex session started/u);
  assert.match(messages, /reasoning/u);
  assert.match(messages, /structured response/u);
  assert.doesNotMatch(messages, /private-vault|hidden causal chain|secretAnswer|thread/u);
});

test("Claude and agy stream-json activity uses metadata only", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("claude", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: [
      '{"type":"system","subtype":"init","model":"claude-opus-4-6","cwd":"C:/School Vault/private"}',
      '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-4-6"}}}',
      '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"thinking","thinking":"private plan"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden step"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"answer\\":\\"private\\"}"}}}',
      '{"type":"result","structured_output":{"answer":"private"}}',
    ].join("\n"),
  });
  decoder.finish();

  const messages = events.map((event) => event.message).join("\n");
  assert.match(messages, /Claude initialized · claude-opus-4-6/u);
  assert.match(messages, /reasoning is in progress/u);
  assert.match(messages, /Receiving the structured response/u);
  assert.doesNotMatch(messages, /School Vault|private plan|hidden step|partial_json|"answer"/u);
});

test("agy event streams expose progress without conversation IDs or response bodies", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("agy", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: [
      '{"event":"init","conversation_id":"private-id","init":{"model":"gemini-3.6-flash-high","cwd":"C:/private-vault"}}',
      '{"event":"step_update","step_update":{"state":"DONE","step_type":"checkpoint"}}',
      '{"event":"step_update","step_update":{"state":"DONE","step_type":"agent_response","text_delta":"{\\"answer\\":\\"private\\"}"}}',
      '{"event":"result","result":{"status":"SUCCESS","structured_output":{"answer":"private"}}}',
    ].join("\n"),
  });
  decoder.finish();
  const messages = events.map((event) => event.message).join("\n");
  assert.match(messages, /agy initialized · gemini-3.6-flash-high/u);
  assert.match(messages, /agy reasoning is in progress/u);
  assert.match(messages, /Receiving the structured response/u);
  assert.doesNotMatch(messages, /private-id|private-vault|"answer"/u);
});
