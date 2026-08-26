alter table public.lead_search_runs
add column prompt_version text not null default 'legacy'
check (char_length(prompt_version) between 1 and 80);

alter table public.sales_leads
add column qualification jsonb not null default '{}'::jsonb
check (jsonb_typeof(qualification) = 'object'),
add column draft_quality jsonb not null default '{}'::jsonb
check (jsonb_typeof(draft_quality) = 'object'),
add column draft_prompt_version text
check (draft_prompt_version is null or char_length(draft_prompt_version) between 1 and 80),
add column draft_openai_response_id text;

-- Legacy ready drafts were produced without the quality contract. Preserve the
-- text for review, but require regeneration or an explicit edit before send.
update public.sales_leads
set status = 'new'
where status = 'ready';

-- Do not reset legacy rows already in `sending`: Resend may have accepted such
-- a message before bookkeeping completed, so automatic recovery could duplicate it.

alter table public.sales_leads
add constraint sales_leads_ready_draft_quality_check
check (
  status <> 'ready'
  or (
    coalesce(draft_quality ->> 'passed', 'false') = 'true'
    and coalesce(qualification ->> 'decision', '') = 'eligible'
  )
);

comment on column public.lead_search_runs.prompt_version is
  'Versioned lead-research prompt contract used for this run.';

comment on column public.sales_leads.qualification is
  'Structured commerce and purchase-complexity checks captured before outreach drafting.';

comment on column public.sales_leads.draft_quality is
  'Deterministic quality-gate result for the current outreach draft.';

comment on column public.sales_leads.draft_prompt_version is
  'Versioned outreach-copy prompt contract used for the current draft.';

comment on column public.sales_leads.draft_openai_response_id is
  'OpenAI Responses API identifier for the current draft.';
