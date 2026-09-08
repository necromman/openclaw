// Durable store for the department projection and agent bindings.
//
// Row access goes through Kysely; only the DDL in departments-schema.ts is raw SQL.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  ensureDepartmentsSchema,
  type DepartmentRow,
  type DepartmentsDatabase,
} from "./departments-schema.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";

function departmentsDb(db: DatabaseSync) {
  return getNodeSqliteKysely<DepartmentsDatabase>(db);
}

/** Normalize a department code into the stored slug form. */
export function normalizeDepartmentSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Every known department, ordered by slug. */
export function listDepartments(options: OpenClawStateDatabaseOptions = {}): DepartmentRow[] {
  ensureDepartmentsSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    departmentsDb(database.db).selectFrom("departments").selectAll().orderBy("slug"),
  ).rows;
}

/** Department codes one profile currently projects into, ordered by slug. */
export function listDepartmentsForProfile(
  profileId: string,
  options: OpenClawStateDatabaseOptions = {},
): string[] {
  ensureDepartmentsSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    departmentsDb(database.db)
      .selectFrom("department_members")
      .select("department_slug")
      .where("profile_id", "=", profileId)
      .orderBy("department_slug"),
  ).rows.map((row) => row.department_slug);
}

/** Profile ids projected into one department, ordered by profile id. */
export function listDepartmentMembers(
  departmentSlug: string,
  options: OpenClawStateDatabaseOptions = {},
): string[] {
  ensureDepartmentsSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    departmentsDb(database.db)
      .selectFrom("department_members")
      .select("profile_id")
      .where("department_slug", "=", normalizeDepartmentSlug(departmentSlug))
      .orderBy("profile_id"),
  ).rows.map((row) => row.profile_id);
}

/** Every agent binding, as `agentId -> departmentSlug`. */
export function readDepartmentAgentBindings(
  options: OpenClawStateDatabaseOptions = {},
): Map<string, string> {
  ensureDepartmentsSchema(options);
  const database = openOpenClawStateDatabase(options);
  const rows = executeSqliteQuerySync(
    database.db,
    departmentsDb(database.db).selectFrom("department_agents").selectAll().orderBy("agent_id"),
  ).rows;
  return new Map(rows.map((row) => [row.agent_id, row.department_slug] as const));
}

/** Record a department so later bindings and listings can name it. Idempotent. */
export function upsertDepartment(
  params: { slug: string; displayName?: string; nowMs: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  const slug = normalizeDepartmentSlug(params.slug);
  const authoredName = params.displayName?.trim();
  ensureDepartmentsSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        departmentsDb(db)
          .insertInto("departments")
          .values({
            slug,
            display_name: authoredName ?? slug,
            created_at: params.nowMs,
            updated_at: params.nowMs,
          })
          .onConflict((conflict) =>
            // A caller that only knows the slug (a projected login, an agent binding) must
            // not overwrite the name an operator typed. Only a real name advances the row.
            authoredName === undefined
              ? conflict.column("slug").doNothing()
              : conflict.column("slug").doUpdateSet({
                  display_name: authoredName,
                  updated_at: params.nowMs,
                }),
          ),
      );
    },
    options,
    { operationLabel: "departments.upsert" },
  );
}

/**
 * Replace one profile's department membership with the codes on its current token.
 *
 * IX-Auth is canonical: a code that disappeared from the group claim disappears here on
 * the next login, which is what makes removal take effect without an operator step.
 */
export function syncDepartmentMembership(
  params: { profileId: string; departments: readonly string[]; nowMs: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  const slugs = [...new Set(params.departments.map(normalizeDepartmentSlug))].filter(
    (slug) => slug.length > 0,
  );
  ensureDepartmentsSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      const kysely = departmentsDb(db);
      for (const slug of slugs) {
        executeSqliteQuerySync(
          db,
          kysely
            .insertInto("departments")
            .values({
              slug,
              display_name: slug,
              created_at: params.nowMs,
              updated_at: params.nowMs,
            })
            .onConflict((conflict) => conflict.column("slug").doNothing()),
        );
        executeSqliteQuerySync(
          db,
          kysely
            .insertInto("department_members")
            .values({
              department_slug: slug,
              profile_id: params.profileId,
              synced_at: params.nowMs,
            })
            .onConflict((conflict) =>
              conflict.columns(["department_slug", "profile_id"]).doUpdateSet({
                synced_at: params.nowMs,
              }),
            ),
        );
      }
      let stale = kysely
        .deleteFrom("department_members")
        .where("profile_id", "=", params.profileId);
      if (slugs.length > 0) {
        stale = stale.where("department_slug", "not in", slugs);
      }
      executeSqliteQuerySync(db, stale);
    },
    options,
    { operationLabel: "departments.sync-membership" },
  );
}

/** Bind one agent to one department, replacing any previous binding. */
export function setDepartmentAgent(
  params: { agentId: string; departmentSlug: string; nowMs: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  const slug = normalizeDepartmentSlug(params.departmentSlug);
  upsertDepartment({ slug, nowMs: params.nowMs }, options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        departmentsDb(db)
          .insertInto("department_agents")
          .values({
            agent_id: params.agentId,
            department_slug: slug,
            assigned_at: params.nowMs,
          })
          .onConflict((conflict) =>
            conflict.column("agent_id").doUpdateSet({
              department_slug: slug,
              assigned_at: params.nowMs,
            }),
          ),
      );
    },
    options,
    { operationLabel: "departments.bind-agent" },
  );
}

/** Remove one agent's department binding, returning it to the shared pool. */
export function clearDepartmentAgent(
  agentId: string,
  options: OpenClawStateDatabaseOptions = {},
): void {
  ensureDepartmentsSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        departmentsDb(db).deleteFrom("department_agents").where("agent_id", "=", agentId),
      );
    },
    options,
    { operationLabel: "departments.unbind-agent" },
  );
}
