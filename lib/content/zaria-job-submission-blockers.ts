export type ZariaJob = {status:string;provider:string|null;provider_task_id:string|null;budget_cap_usd:number|null;budget_approved_at:string|null;budget_approved_by:string|null};
export function zariaJobSubmissionBlockers(job:ZariaJob|null):string[]{
 if(!job)return ["VIDEO_JOB_UNAVAILABLE"];
 const blockers:string[]=[];
 if(job.status!=="blocked" && job.status!=="draft")blockers.push("VIDEO_JOB_STATE_REQUIRES_REVIEW");
 if(job.provider_task_id)blockers.push("PROVIDER_TASK_ALREADY_EXISTS");
 if(!job.provider)blockers.push("RENDER_PROVIDER_NOT_SELECTED");
 if(!job.budget_approved_at || !job.budget_approved_by || !(Number(job.budget_cap_usd)>0))blockers.push("PROVIDER_BUDGET_UNAPPROVED");
 return blockers;
}
