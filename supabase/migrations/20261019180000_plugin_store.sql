-- Forgor plugin store: the list of plugins, their versions, and the zips (storage bucket "plugins").
--
-- Anyone can read the list and download plugins (the app uses the publishable key).
-- Nobody writes to these tables directly: publishing, counting installs and reports go
-- through the edge functions in supabase/functions (they use the secret key).
--
-- Moderation (in the SQL editor):
--   update public.plugins set removed_at = now(), removed_reason = 'Why' where id = '…';  -- the app turns it off for everyone
--   update public.plugins set removed_at = null, removed_reason = null where id = '…';     -- back again
--   update public.plugins set verified = true where id = '…';                              -- check mark (e.g. Forgor's own)
--   select * from public.plugin_reports order by created_at desc;

create table public.plugins (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null check (char_length(name) between 1 and 80),
  author text not null check (char_length(author) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  latest_version text not null,
  icon_path text,
  installs integer not null default 0,
  verified boolean not null default false,
  removed_at timestamptz,
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plugin_versions (
  plugin_id text not null references public.plugins (id) on delete cascade,
  version text not null check (version ~ '^\d{1,6}\.\d{1,6}\.\d{1,6}$'),
  path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size integer not null check (size > 0),
  min_app_version text,
  created_at timestamptz not null default now(),
  primary key (plugin_id, version)
);

-- Hash of each plugin's publish key (whoever has the key can publish new versions). Never readable from the app.
create table public.plugin_keys (
  plugin_id text primary key references public.plugins (id) on delete cascade,
  key_hash text not null
);

create table public.plugin_reports (
  id bigint generated always as identity primary key,
  plugin_id text not null references public.plugins (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.plugins enable row level security;
alter table public.plugin_versions enable row level security;
alter table public.plugin_keys enable row level security;
alter table public.plugin_reports enable row level security;
alter table public.rate_limits enable row level security;

create policy "Anyone can read the plugin list" on public.plugins for select to anon, authenticated using (true);
create policy "Anyone can read plugin versions" on public.plugin_versions for select to anon, authenticated using (true);
-- plugin_keys, plugin_reports, rate_limits: no policies, so only the edge functions (secret key) reach them.

create index plugin_reports_plugin on public.plugin_reports (plugin_id);

-- What the app lists: each plugin with its latest version.
create view public.store_plugins with (security_invoker = on) as
select
  p.id, p.name, p.author, p.description, p.latest_version as version, p.icon_path, p.installs, p.verified,
  p.removed_at, p.removed_reason, p.created_at, p.updated_at,
  v.path, v.sha256, v.size, v.min_app_version
from public.plugins p
join public.plugin_versions v on v.plugin_id = p.id and v.version = p.latest_version;

grant select on public.store_plugins to anon, authenticated;

-- Counts a hit in a fixed window; true while under the limit. Old windows are cleaned up as it goes.
create function public.hit_rate_limit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into n;
  delete from public.rate_limits where window_start < now() - interval '2 days';
  return n <= p_max;
end;
$$;

create function public.count_install(p_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.plugins set installs = installs + 1 where id = p_id and removed_at is null;
$$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.count_install(text) from public, anon, authenticated;

-- The zips and icons. Public to read; only the edge functions upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plugins', 'plugins', true, 5242880, array['application/zip', 'image/png', 'image/svg+xml']);
