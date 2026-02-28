create table if not exists public.dining_subscribers (
  email text primary key,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists dining_subscribers_created_at_idx
  on public.dining_subscribers (created_at desc);
