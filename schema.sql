create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  avatar_url text default null,
  created_at timestamptz default now()
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Study Room',
  code text unique not null,
  pin char(4) not null default '0000',
  is_public boolean default false,
  topic text default 'General',
  max_members int default 10,
  created_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists rooms_code_idx on rooms(code);
create index if not exists rooms_public_idx on rooms(is_public);
create index if not exists rooms_user_idx on rooms(created_by);

alter table users enable row level security;
alter table rooms enable row level security;

drop policy if exists "service_all_users" on users;
create policy "service_all_users" on users for all using (true);

drop policy if exists "service_all_rooms" on rooms;
create policy "service_all_rooms" on rooms for all using (true);

-- socket.io feature persistence
create table if not exists room_timers (
  room_code text primary key references rooms(code) on delete cascade,
  mode text default 'pomodoro',
  status text default 'stopped',
  time_remaining int default 1500,
  updated_at timestamptz default now()
);

create table if not exists room_whiteboards (
  room_code text primary key references rooms(code) on delete cascade,
  elements jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- ── Friends / Buddies ──────────────────────────────────────────────────
create table if not exists friends (
  id uuid primary key default gen_random_uuid(),
  user_id_1 uuid not null references users(id) on delete cascade,
  user_id_2 uuid not null references users(id) on delete cascade,
  status text not null default 'pending',
  requested_by uuid not null references users(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id_1, user_id_2)
);
create index if not exists friends_user1_idx on friends(user_id_1);
create index if not exists friends_user2_idx on friends(user_id_2);
alter table friends enable row level security;
drop policy if exists "service_all_friends" on friends;
create policy "service_all_friends" on friends for all using (true);

-- ── To-Do Lists ────────────────────────────────────────────────────────
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_completed boolean default false,
  created_by uuid not null references users(id) on delete cascade,
  shared_with_user_id uuid references users(id) on delete cascade default null,
  created_at timestamptz default now()
);
create index if not exists todos_user_idx on todos(created_by);
alter table todos enable row level security;
drop policy if exists "service_all_todos" on todos;
create policy "service_all_todos" on todos for all using (true);

-- ── Activity Logs ──────────────────────────────────────────────────────
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  duration_minutes int not null default 0,
  room_code text default null,
  created_at timestamptz default now()
);
create index if not exists activity_user_idx on activity_logs(user_id);
alter table activity_logs enable row level security;
drop policy if exists "service_all_activity" on activity_logs;
create policy "service_all_activity" on activity_logs for all using (true);
