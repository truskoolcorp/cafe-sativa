import {test} from "node:test";
import {strict as assert} from "node:assert";
import {zariaJobSubmissionBlockers} from "../lib/content/zaria-job-submission-blockers.ts";
test("current blocked job has no provider or budget consent",()=>{const b=zariaJobSubmissionBlockers({status:"blocked",provider:null,provider_task_id:null,budget_cap_usd:null,budget_approved_at:null,budget_approved_by:null});assert.ok(b.includes("RENDER_PROVIDER_NOT_SELECTED"));assert.ok(b.includes("PROVIDER_BUDGET_UNAPPROVED"))});
test("existing provider task cannot be submitted again",()=>{const b=zariaJobSubmissionBlockers({status:"blocked",provider:"heygen",provider_task_id:"existing",budget_cap_usd:5,budget_approved_at:"approved",budget_approved_by:"admin"});assert.ok(b.includes("PROVIDER_TASK_ALREADY_EXISTS"))});
test("missing job denies",()=>assert.deepEqual(zariaJobSubmissionBlockers(null),["VIDEO_JOB_UNAVAILABLE"]));
