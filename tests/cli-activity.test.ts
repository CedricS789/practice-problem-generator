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

test("Codex activity captures provider token metadata without exposing response content", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("codex", 1, (event) => events.push(event), {
    prompt: "approved source text",
  });
  decoder.start();
  decoder.push({
    stream: "stdout",
    text: [
      '{"type":"item.completed","item":{"type":"agent_message","text":"private structured answer"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":300,"output_tokens":450,"reasoning_tokens":200}}',
    ].join("\n"),
  });
  decoder.finish();

  const telemetry = events.at(-1)?.telemetry;
  assert.equal(telemetry?.tokenUsage.source, "provider-reported");
  assert.equal(telemetry?.tokenUsage.inputTokens, 1_200);
  assert.equal(telemetry?.tokenUsage.outputTokens, 450);
  assert.equal(telemetry?.tokenUsage.cachedInputTokens, 300);
  assert.equal(telemetry?.tokenUsage.reasoningTokens, 200);
  assert.equal(telemetry?.reportedCostUsd, undefined);
  assert.doesNotMatch(events.map((event) => event.message).join("\n"), /private structured answer/u);
});

test("Claude activity captures cache, duration, and explicitly reported monetary cost", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("claude", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: '{"type":"result","usage":{"input_tokens":100,"cache_read_input_tokens":20,"cache_creation_input_tokens":10,"output_tokens":30},"total_cost_usd":0.0123,"duration_ms":1000,"duration_api_ms":900,"structured_output":{"answer":"private"}}\n',
  });
  decoder.finish();

  const telemetry = events.at(-1)?.telemetry;
  assert.equal(telemetry?.tokenUsage.source, "provider-reported");
  assert.equal(telemetry?.tokenUsage.inputTokens, 130);
  assert.equal(telemetry?.tokenUsage.outputTokens, 30);
  assert.equal(telemetry?.tokenUsage.cachedInputTokens, 20);
  assert.equal(telemetry?.tokenUsage.cacheWriteInputTokens, 10);
  assert.equal(telemetry?.reportedCostUsd, 0.0123);
  assert.equal(telemetry?.providerDurationMs, 1_000);
  assert.equal(telemetry?.providerApiDurationMs, 900);
});

test("local activity estimates text tokens and marks visual usage as excluded", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("codex", 2, (event) => events.push(event), {
    prompt: "x".repeat(400),
    includesMedia: true,
  });
  decoder.start();
  decoder.push({
    stream: "stdout",
    text: '{"type":"item.completed","item":{"type":"agent_message","text":"' + "y".repeat(80) + '"}}\n',
  });
  decoder.finish();

  const telemetry = events.at(-1)?.telemetry;
  assert.equal(telemetry?.attempt, 2);
  assert.equal(telemetry?.tokenUsage.source, "local-estimate");
  assert.equal(telemetry?.tokenUsage.inputTokens, 100);
  assert.equal(telemetry?.tokenUsage.outputTokens, 20);
  assert.equal(telemetry?.tokenUsage.inputEstimateExcludesMedia, true);
  assert.match(events[0]?.message ?? "", /visual tokens are not included/u);
});

test("camel-case and nested provider usage metadata stays provider-neutral", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("agy", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: '{"event":"result","result":{"status":"SUCCESS","usageMetadata":{"promptTokenCount":700,"candidatesTokenCount":90,"cachedContentTokenCount":120,"thoughtsTokenCount":40},"structured_output":{"answer":"private"}}}\n',
  });
  decoder.finish();
  const telemetry = events.at(-1)?.telemetry;
  assert.equal(telemetry?.tokenUsage.inputTokens, 700);
  assert.equal(telemetry?.tokenUsage.outputTokens, 90);
  assert.equal(telemetry?.tokenUsage.cachedInputTokens, 120);
  assert.equal(telemetry?.tokenUsage.reasoningTokens, 40);
});

test("Claude local output estimates sum every visible assistant block", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("claude", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "x".repeat(80) },
          { type: "text", text: "y".repeat(120) },
        ],
      },
    }) + "\n",
  });
  decoder.finish();
  assert.equal(events.at(-1)?.telemetry?.tokenUsage.outputTokens, 50);
});

test("large single-line results retain a bounded local output estimate", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("claude", 1, (event) => events.push(event));
  decoder.push({ stream: "stdout", text: "x".repeat(300_000) });
  decoder.finish();
  assert.equal(events.at(-1)?.telemetry?.tokenUsage.outputTokens, 75_000);
  assert.match(events.map((event) => event.message).join("\n"), /large structured response/u);
});

test("path-like model metadata is never shown as a model identifier", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("claude", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: '{"type":"system","subtype":"init","model":"C:/Users/private/model"}\n',
  });
  decoder.finish();
  const messages = events.map((event) => event.message).join("\n");
  assert.match(messages, /Claude initialized\./u);
  assert.doesNotMatch(messages, /Users|private|C:\//u);
});

test("invalid provider subset counts are omitted from safe telemetry", () => {
  const events: CliActivityEvent[] = [];
  const decoder = new CliActivityDecoder("codex", 1, (event) => events.push(event));
  decoder.push({
    stream: "stdout",
    text: '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":101,"output_tokens":20,"reasoning_tokens":21}}\n',
  });
  decoder.finish();
  const usage = events.at(-1)?.telemetry?.tokenUsage;
  assert.equal(usage?.cachedInputTokens, undefined);
  assert.equal(usage?.reasoningTokens, undefined);
});
