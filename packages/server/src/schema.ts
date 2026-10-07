/**
 * SQL migrations, applied in order at startup. Plain Postgres, so the same
 * files work on PGlite locally and on Supabase later.
 *
 * Storage model: the live league (players, teams, schedule, stats) is one
 * JSONB document versioned by `leagues.version`. Box scores, which make up ~85%
 * of the data by the end of a season, live in their own table and are loaded
 * only when someone opens a game. Membership, readiness and the advance audit
 * log are ordinary relational tables so they can be queried and locked cheaply.
 */
export const MIGRATIONS: Array<[string, string]> = [
  [
    '001_init',
    `
create table users (
  id text primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table leagues (
  id text primary key,
  name text not null,
  commissioner_id text not null references users(id),
  invite_code text not null unique,
  seed bigint not null,
  advance jsonb not null,
  state jsonb not null,
  version integer not null default 0,
  next_advance_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table league_members (
  league_id text not null references leagues(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  team_id text,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create unique index league_members_team on league_members (league_id, team_id) where team_id is not null;

create table box_scores (
  league_id text not null references leagues(id) on delete cascade,
  season integer not null,
  game_id integer not null,
  box jsonb not null,
  primary key (league_id, season, game_id)
);

create table advance_log (
  id bigserial primary key,
  league_id text not null references leagues(id) on delete cascade,
  triggered_by text not null,
  from_day integer not null,
  to_day integer not null,
  games integer not null,
  phase_changes jsonb not null,
  created_at timestamptz not null default now()
);

create index advance_log_league on advance_log (league_id, id desc);
`,
  ],
  [
    '002_notifications',
    `
create table notifications (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  league_id text not null references leagues(id) on delete cascade,
  kind text not null,
  text text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user on notifications (user_id, id desc);
`,
  ],
  [
    // Supabase exposes tables in the public schema through its REST API to
    // anyone with the project's (public) anon key. Row-level security with no
    // policies shuts that door; the game server connects as the table owner,
    // which RLS doesn't apply to.
    '003_row_level_security',
    `
alter table users enable row level security;
alter table sessions enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table box_scores enable row level security;
alter table advance_log enable row level security;
alter table notifications enable row level security;
alter table _migrations enable row level security;
`,
  ],
  [
    '004_co_commissioners',
    `
alter table league_members add column co_commissioner boolean not null default false;
`,
  ],
  [
    // The league document, gzipped (about a fifth of the size of the JSON). Once a
    // league is saved this way, \`state\` holds only a small summary. Rows written
    // before this (state_z null) are still read from \`state\`.
    '005_compressed_state',
    `
alter table leagues add column state_z bytea;
`,
  ],
  [
    // Players named in a notification ([{ id, name }]), so each name can link to his page.
    '006_notification_players',
    `
alter table notifications add column refs jsonb;
`,
  ],
];
