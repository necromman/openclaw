// Durable store for the job-title projection.
//
// Row access goes through Kysely; only the DDL in titles-schema.ts is raw SQL. The shape
// mirrors departments-store.ts because the two answer the same kind of question, minus
// the agent bindings a department owns and a title has no use for.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "./openclaw-state-db.js";
import { ensureTitlesSchema, type TitleRow, type TitlesDatabase } from "./titles-schema.js";

function titlesDb(db: DatabaseSync) {
  return getNodeSqliteKysely<TitlesDatabase>(db);
}

/** Normalize a title code into the stored slug form. */
export function normalizeTitleSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Every known title, ordered by slug. */
export function listTitles(options: OpenClawStateDatabaseOptions = {}): TitleRow[] {
  ensureTitlesSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    titlesDb(database.db).selectFrom("titles").selectAll().orderBy("slug"),
  ).rows;
}

/** Title codes one profile currently projects into, ordered by slug. */
export function listTitlesForProfile(
  profileId: string,
  options: OpenClawStateDatabaseOptions = {},
): string[] {
  ensureTitlesSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    titlesDb(database.db)
      .selectFrom("title_members")
      .select("title_slug")
      .where("profile_id", "=", profileId)
      .orderBy("title_slug"),
  ).rows.map((row) => row.title_slug);
}

/** Profile ids projected into one title, ordered by profile id. */
export function listTitleMembers(
  titleSlug: string,
  options: OpenClawStateDatabaseOptions = {},
): string[] {
  ensureTitlesSchema(options);
  const database = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    database.db,
    titlesDb(database.db)
      .selectFrom("title_members")
      .select("profile_id")
      .where("title_slug", "=", normalizeTitleSlug(titleSlug))
      .orderBy("profile_id"),
  ).rows.map((row) => row.profile_id);
}

/** Record a title so later listings and rules can name it. Idempotent. */
export function upsertTitle(
  params: { slug: string; displayName?: string; nowMs: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  const slug = normalizeTitleSlug(params.slug);
  const authoredName = params.displayName?.trim();
  ensureTitlesSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      executeSqliteQuerySync(
        db,
        titlesDb(db)
          .insertInto("titles")
          .values({
            slug,
            display_name: authoredName ?? slug,
            created_at: params.nowMs,
            updated_at: params.nowMs,
          })
          .onConflict((conflict) =>
            // A caller that only knows the slug (a projected login) must not overwrite the
            // name an operator typed. Only a real name advances the row.
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
    { operationLabel: "titles.upsert" },
  );
}

/**
 * Replace one profile's titles with the codes on its current token.
 *
 * IX-Auth is canonical: a code that disappeared from the group claim disappears here on
 * the next login, which is what makes a withdrawn title take effect without an operator
 * step.
 */
export function syncTitleMembership(
  params: { profileId: string; titles: readonly string[]; nowMs: number },
  options: OpenClawStateDatabaseOptions = {},
): void {
  const slugs = [...new Set(params.titles.map(normalizeTitleSlug))].filter(
    (slug) => slug.length > 0,
  );
  ensureTitlesSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      const kysely = titlesDb(db);
      for (const slug of slugs) {
        executeSqliteQuerySync(
          db,
          kysely
            .insertInto("titles")
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
            .insertInto("title_members")
            .values({
              title_slug: slug,
              profile_id: params.profileId,
              synced_at: params.nowMs,
            })
            .onConflict((conflict) =>
              conflict.columns(["title_slug", "profile_id"]).doUpdateSet({
                synced_at: params.nowMs,
              }),
            ),
        );
      }
      let stale = kysely.deleteFrom("title_members").where("profile_id", "=", params.profileId);
      if (slugs.length > 0) {
        stale = stale.where("title_slug", "not in", slugs);
      }
      executeSqliteQuerySync(db, stale);
    },
    options,
    { operationLabel: "titles.sync-membership" },
  );
}

/**
 * Forget one title: its row and its projected members.
 *
 * The identity server owns whether the group exists; this only removes what the fork
 * holds. Folder rules naming the slug are deliberately left behind, because deleting them
 * here would silently re-open folders the title was closing; they surface as orphans.
 */
export function deleteTitle(slug: string, options: OpenClawStateDatabaseOptions = {}): void {
  const normalized = normalizeTitleSlug(slug);
  ensureTitlesSchema(options);
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      const kysely = titlesDb(db);
      executeSqliteQuerySync(
        db,
        kysely.deleteFrom("title_members").where("title_slug", "=", normalized),
      );
      executeSqliteQuerySync(db, kysely.deleteFrom("titles").where("slug", "=", normalized));
    },
    options,
    { operationLabel: "titles.delete" },
  );
}
