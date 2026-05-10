create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
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
create policy "service_all_users" on users for all using (true);
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
