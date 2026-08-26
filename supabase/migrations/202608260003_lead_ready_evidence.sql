-- Search results may be useful for review from cited pages, but a lead becomes
-- sendable only after the exact qualification and contact pages were opened.
alter table public.lead_search_runs
add column draft_openai_response_id text,
add column result_details jsonb not null default '{}'::jsonb
check (jsonb_typeof(result_details) = 'object');

comment on column public.lead_search_runs.draft_openai_response_id is
  'OpenAI Responses API identifier for the batched outreach-copy stage.';

comment on column public.lead_search_runs.result_details is
  'Sanitized search outcome counts and inserted lead ids used by async polling and diagnostics.';

update public.sales_leads
set status = 'new'
where status = 'ready'
  and (
    coalesce(qualification ->> 'ready_evidence_verified', 'false') <> 'true'
    or coalesce(qualification #>> '{contact_verification,source_was_opened}', 'false') <> 'true'
  );

alter table public.sales_leads
drop constraint sales_leads_ready_draft_quality_check;

alter table public.sales_leads
add constraint sales_leads_ready_draft_quality_check
check (
  status <> 'ready'
  or (
    coalesce(draft_quality ->> 'passed', 'false') = 'true'
    and coalesce(qualification ->> 'decision', '') = 'eligible'
    and coalesce(qualification ->> 'ready_evidence_verified', 'false') = 'true'
    and coalesce(qualification #>> '{contact_verification,source_was_opened}', 'false') = 'true'
  )
);

comment on constraint sales_leads_ready_draft_quality_check on public.sales_leads is
  'Ready leads require an eligible qualification, passing draft and exact opened web/contact evidence.';
