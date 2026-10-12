import assert from "node:assert/strict";
import test from "node:test";
import { customModelsValidationIssue } from "./custom-models-validation.ts";

const model={model:"claude",baseUrl:"https://fixture.invalid/v1",protocol:"anthropicMessages",contextWindow:"200K",autoCompactEnabled:true,autoCompactLimit:"180K"};

test("advanced model validation keeps independent protocols and window units",()=>{
  assert.equal(customModelsValidationIssue([model,{...model,model:"gemini",protocol:"geminiGenerateContent",contextWindow:"1M"}]),null);
});
test("advanced model validation rejects duplicate or missing identities without deleting rows",()=>{
  assert.equal(customModelsValidationIssue([]),"empty");
  assert.equal(customModelsValidationIssue([{...model,model:" "}]),"name");
  assert.equal(customModelsValidationIssue([model,{...model,model:"CLAUDE[1M]"}]),"duplicate");
});
test("advanced model validation refuses invalid endpoint and wire types but accepts inherited endpoints",()=>{
  assert.equal(customModelsValidationIssue([{...model,baseUrl:"file:///fixture"}]),"url");
  assert.equal(customModelsValidationIssue([{...model,protocol:"invalid"}]),"protocol");
  assert.equal(customModelsValidationIssue([{...model,baseUrl:""}],"http://127.0.0.1:23456/v1"),null);
});
test("advanced compression validation retains disabled thresholds and rejects invalid enabled limits",()=>{
  assert.equal(customModelsValidationIssue([{...model,autoCompactEnabled:false,autoCompactLimit:"stored old value"}]),null);
  assert.equal(customModelsValidationIssue([{...model,contextWindow:"-1"}]),"window");
  assert.equal(customModelsValidationIssue([{...model,autoCompactLimit:"200K"}]),"compression");
  assert.equal(customModelsValidationIssue([{...model,autoCompactLimit:""}]),"compression");
});
