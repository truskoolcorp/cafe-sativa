-- The audited decision RPC is callable by the trusted server only.
grant execute on function public.cs_decide_programming_proposal(uuid,text,text,uuid) to service_role;
