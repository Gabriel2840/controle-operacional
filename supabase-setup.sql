-- ============================================================================
--  Controle Operacional — criação das tabelas + segurança (RLS) + tempo real
--  Cole tudo no Supabase: menu lateral "SQL Editor" > New query > Run.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists cad_tanques (
  id uuid primary key default gen_random_uuid(),
  codigo text, reagente text, ts bigint, por text, created_at timestamptz default now()
);
create table if not exists cad_diametros (
  id uuid primary key default gen_random_uuid(),
  valor text, descricao text, ts bigint, por text, created_at timestamptz default now()
);
create table if not exists cad_floculantes (
  id uuid primary key default gen_random_uuid(),
  nome text, unidade text, ts bigint, por text, created_at timestamptz default now()
);
create table if not exists reg_tanques (
  id uuid primary key default gen_random_uuid(),
  data text, itens jsonb, ts bigint, por text, created_at timestamptz default now()
);
create table if not exists reg_bolas (
  id uuid primary key default gen_random_uuid(),
  data text, itens jsonb, ts bigint, por text, created_at timestamptz default now()
);
create table if not exists reg_floculante (
  id uuid primary key default gen_random_uuid(),
  data text, itens jsonb, ts bigint, por text, created_at timestamptz default now()
);
create table if not exists reg_glp (
  id uuid primary key default gen_random_uuid(),
  data text, pct numeric, ts bigint, por text, created_at timestamptz default now()
);

-- Segurança: somente usuários AUTENTICADOS leem/escrevem. + habilita Realtime.
do $$
declare t text;
begin
  foreach t in array array['cad_tanques','cad_diametros','cad_floculantes',
                           'reg_tanques','reg_bolas','reg_floculante','reg_glp']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "auth_all" on %I', t);
    execute format('create policy "auth_all" on %I for all to authenticated using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when others then null;  -- ignora se já estiver na publicação
    end;
  end loop;
end $$;

-- Garante que a Data API (PostgREST) enxergue as tabelas. A segurança real
-- continua no RLS acima (sem login, ninguém lê nem grava).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  cad_tanques, cad_diametros, cad_floculantes,
  reg_tanques, reg_bolas, reg_floculante, reg_glp
  to authenticated;

-- Pede ao PostgREST para recarregar o cache de schema.
notify pgrst, 'reload schema';
