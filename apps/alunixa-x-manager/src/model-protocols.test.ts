import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelProtocols, hasModelProtocols, modelProtocolForName } from "./model-protocols.ts";
import { modelWindowRowsFromProfile, serializeModelWindowRows, mergeModelWindowRows } from "./model-windows.ts";
import { modelRouteSaveRequiresRestart } from "./model-routes.ts";

test("per-model protocols preserve inheritance and explicit Responses under a Chat default", () => {
  const legacy = modelWindowRowsFromProfile("a\nb", "{}");
  assert.equal(serializeModelWindowRows(legacy).modelProtocols, "{}");
  legacy[0].protocol = "responses";
  legacy[1].protocol = "anthropicMessages";
  const saved = serializeModelWindowRows(legacy);
  assert.equal(modelProtocolForName(saved.modelProtocols, "a", "chatCompletions"), "responses");
  assert.equal(modelProtocolForName(saved.modelProtocols, "b", "responses"), "anthropicMessages");
  assert.equal(modelProtocolForName(saved.modelProtocols, "c", "chatCompletions"), "chatCompletions");
  assert.deepEqual(modelWindowRowsFromProfile(saved.modelList, saved.modelWindows, saved.modelVlm, saved.modelProtocols), legacy);
});

test("model rename, reorder, suffix and fetched model merge retain each protocol", () => {
  const rows = modelWindowRowsFromProfile("Claude[1M]\ngpt", "{}", "{}", '{"claude":"chatCompletions","gpt":"responses"}');
  assert.equal(rows[0].protocol, "chatCompletions");
  rows[0].model = "renamed";
  const merged = mergeModelWindowRows(rows.reverse(), [{model:"gpt",window:"",imageHandling:"",protocol:"anthropicMessages"}]);
  const saved = parseModelProtocols(serializeModelWindowRows(merged).modelProtocols);
  assert.equal(saved.renamed, "chatCompletions");
  assert.equal(saved.gpt, "responses");
  assert.equal(saved.claude, undefined);
});

test("malformed protocol maps are errors, not a default transport", () => {
  for (const value of ["[]", "invalid", '{"a":"typo"}']) {
    assert.throws(() => parseModelProtocols(value));
    assert.equal(hasModelProtocols(value), true);
    assert.equal(modelProtocolForName(value, "a", "responses"), "");
  }
});

test("first model protocol override activates the helper through the restart path", () => {
  const base = {relayProfilesEnabled:true,activeRelayId:"p",relayProfiles:[{id:"p",name:"p",baseUrl:"https://fixture.invalid/v1",apiKey:"fixture",protocol:"responses",relayMode:"pureApi",officialMixApiKey:false}]};
  const next = {...base,relayProfiles:[{...base.relayProfiles[0],modelProtocols:'{"claude":"chatCompletions"}'}]};
  assert.equal(modelRouteSaveRequiresRestart(base, next, "https://fixture.invalid/v1"), true);
  assert.equal(modelRouteSaveRequiresRestart(next, next, "http://127.0.0.1:57321/v1"), false);
});
