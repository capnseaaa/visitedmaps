-- Visited Buildings: shared map storage.
-- Lives beside the snail mail tables in the same project and does not touch them.
-- Anyone can view the map. Only signed-in people whose email is in map_editors can add, change or remove buildings.

-- Who may edit. Add or remove people with:
--   insert into public.map_editors (email) values ('friend@example.com');
--   delete from public.map_editors where email = 'friend@example.com';
create table if not exists public.map_editors (
  email     text primary key check (email = lower(email)),
  added_at  timestamptz not null default now()
);
alter table public.map_editors enable row level security;
-- No policies: the page cannot read or change this list. It is managed from the Supabase dashboard / SQL.

create or replace function public.is_map_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.map_editors e
    where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_map_editor() from public;
grant execute on function public.is_map_editor() to anon, authenticated;

create table if not exists public.visited_buildings (
  id              text primary key,                 -- made by the page
  way_id          bigint,                           -- OpenStreetMap building id, if one was found
  label           text not null default '',
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  coords          jsonb not null,                   -- outline: [[[lng, lat], ...]]
  approx          boolean not null default false,   -- true when no outline was found (small circle)
  color           text check (color is null or color ~ '^#[0-9a-f]{6}$'),
  visit_date      date not null default current_date,
  added_by        uuid default auth.uid(),
  added_by_email  text default lower(auth.jwt() ->> 'email'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists visited_buildings_way_id_key
  on public.visited_buildings (way_id) where way_id is not null;

create or replace function public.visited_buildings_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists visited_buildings_touch on public.visited_buildings;
create trigger visited_buildings_touch before update on public.visited_buildings
  for each row execute function public.visited_buildings_touch();

alter table public.visited_buildings enable row level security;

drop policy if exists visited_buildings_read on public.visited_buildings;
create policy visited_buildings_read on public.visited_buildings
  for select to anon, authenticated using (true);

drop policy if exists visited_buildings_insert on public.visited_buildings;
create policy visited_buildings_insert on public.visited_buildings
  for insert to authenticated with check ((select public.is_map_editor()));

drop policy if exists visited_buildings_update on public.visited_buildings;
create policy visited_buildings_update on public.visited_buildings
  for update to authenticated using ((select public.is_map_editor())) with check ((select public.is_map_editor()));

drop policy if exists visited_buildings_delete on public.visited_buildings;
create policy visited_buildings_delete on public.visited_buildings
  for delete to authenticated using ((select public.is_map_editor()));

grant select on public.visited_buildings to anon, authenticated;
grant insert, update, delete on public.visited_buildings to authenticated;

-- Live updates: viewers see changes without reloading.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'visited_buildings') then
    alter publication supabase_realtime add table public.visited_buildings;
  end if;
end $$;
