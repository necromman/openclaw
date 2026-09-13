import type { DatabaseSync } from "node:sqlite";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for job titles, the second classification over the IX-Auth
// group claim. Kept feature-local exactly as departments-schema.ts is, so a deployment
// that never delegates identity carries neither table.
//
// IX-Auth owns who holds which title; these tables are a projection refreshed on every
// login. Authorization reads the codes on the live verified token, never this projection,
// so a stale row can widen nobody's reach. The projection exists so an operator can see
// who holds a title and so a title can be named in a folder rule before anybody holding
// it has signed in here.
//
// There is no `title_agents` table on purpose. An agent is bound to a department because
// a department partitions agents; a title says what a person is, not which assistant they
// talk to, so it has nothing to bind.
const TITLES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS titles (
  slug TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS title_members (
  title_slug TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (title_slug, profile_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_title_members_profile
  ON title_members(profile_id);
`;

export type TitlesDatabase = {
  titles: {
    slug: string;
    display_name: string;
    created_at: number;
    updated_at: number;
  };
  title_members: {
    title_slug: string;
    profile_id: string;
    synced_at: number;
  };
};

export type TitleRow = TitlesDatabase["titles"];

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the title tables on first use. Idempotent and cached per handle. */
export function ensureTitlesSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(TITLES_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "titles.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
