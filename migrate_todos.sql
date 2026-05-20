create table if not exists todo_participants (
  todo_id uuid not null references todos(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  is_completed boolean default false,
  assigned_at timestamptz default now(),
  primary key (todo_id, user_id)
);

-- Migrate existing creator data
insert into todo_participants (todo_id, user_id, is_completed)
select id, created_by, is_completed from todos
on conflict do nothing;

-- Migrate existing shared users
insert into todo_participants (todo_id, user_id, is_completed)
select id, shared_with_user_id, is_completed from todos
where shared_with_user_id is not null
on conflict do nothing;

-- Add RLS
alter table todo_participants enable row level security;
drop policy if exists "service_all_todo_participants" on todo_participants;
create policy "service_all_todo_participants" on todo_participants for all using (true);
