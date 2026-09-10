import type { DatabaseSync } from "node:sqlite";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

// Canonical additive schema for department access control. Kept feature-local so
// deployments that never enable ix-auth department scoping do not carry these tables at
// all, the same posture ix_auth_login_sessions and user_profiles take.
//
// IX-Auth owns who belongs to which department; these tables are a projection refreshed
// on every login. Authorization never reads the projection - it reads the department
// codes on the live verified token - so a stale row can widen nobody's access. The
// projection exists so operators can see and audit membership, and so an agent can be
// bound to a department without inventing a second identity store.
const DEPARTMENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS departments (
  slug TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS department_members (
  department_slug TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (department_slug, profile_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_department_members_profile
  ON department_members(profile_id);

CREATE TABLE IF NOT EXISTS department_agents (
  agent_id TEXT NOT NULL PRIMARY KEY,
  department_slug TEXT NOT NULL,
  assigned_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_department_agents_department
  ON department_agents(department_slug, agent_id);
`;

export type DepartmentsDatabase = {
  departments: {
    slug: string;
    display_name: string;
    created_at: number;
    updated_at: number;
  };
  department_members: {
    department_slug: string;
    profile_id: string;
    synced_at: number;
  };
  department_agents: {
    agent_id: string;
    department_slug: string;
    assigned_at: number;
  };
};

export type DepartmentRow = DepartmentsDatabase["departments"];

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** Install the department tables on first use. Idempotent and cached per handle. */
export function ensureDepartmentsSchema(
  options: OpenClawStateDatabaseOptions,
  database = openOpenClawStateDatabase(options),
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      db.exec(DEPARTMENTS_SCHEMA_SQL); // sqlite-allow-raw -- Canonical feature-local additive DDL.
    },
    options,
    { operationLabel: "departments.schema.ensure" },
  );
  // Cache only a committed ensure so a rolled-back transaction stays retryable.
  ensuredDatabases.add(database.db);
}
