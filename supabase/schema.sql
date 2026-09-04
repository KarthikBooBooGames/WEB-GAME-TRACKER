-- WebGL Line — Supabase schema. Run once in the SQL editor (or via the CLI).
-- The board is one JSON document guarded by a team passcode. The browser never touches the tables
-- directly: it calls the two functions below, which check the passcode and do compare-and-set saves.

create table if not exists public.boards (
  id text primary key,
  state jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.board_secrets (
  id text primary key,
  passcode text not null
);

alter table public.boards enable row level security;
alter table public.board_secrets enable row level security;
revoke all on public.boards from anon, authenticated;
revoke all on public.board_secrets from anon, authenticated;

-- Set the team passcode here (change it any time by re-running this statement).
insert into public.board_secrets (id, passcode) values ('main', 'CHANGE-ME')
on conflict (id) do update set passcode = excluded.passcode;

create or replace function public.board_get(p_id text, p_pass text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.boards%rowtype; v_ok boolean;
begin
  select true into v_ok from public.board_secrets where id = p_id and passcode = p_pass;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_passcode'); end if;
  select * into v_row from public.boards where id = p_id;
  if not found then return jsonb_build_object('ok', true, 'found', false); end if;
  return jsonb_build_object('ok', true, 'found', true, 'state', v_row.state, 'version', v_row.version, 'updated_at', v_row.updated_at);
end $$;

create or replace function public.board_save(p_id text, p_pass text, p_state jsonb, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.boards%rowtype; v_ok boolean;
begin
  select true into v_ok from public.board_secrets where id = p_id and passcode = p_pass;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_passcode'); end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or pg_column_size(p_state) > 2000000 then
    return jsonb_build_object('ok', false, 'error', 'bad_state');
  end if;
  select * into v_row from public.boards where id = p_id for update;
  if not found then
    insert into public.boards (id, state, version) values (p_id, p_state, 1);
    return jsonb_build_object('ok', true, 'version', 1);
  end if;
  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'state', v_row.state, 'version', v_row.version);
  end if;
  update public.boards set state = p_state, version = v_row.version + 1, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'version', v_row.version + 1);
end $$;

revoke all on function public.board_get(text, text) from public;
revoke all on function public.board_save(text, text, jsonb, integer) from public;
grant execute on function public.board_get(text, text) to anon, authenticated;
grant execute on function public.board_save(text, text, jsonb, integer) to anon, authenticated;
