import type { CronCreatedBy, CronJob, CronStoredJob } from "./types.js";

/**
 * Optional display enrichment for a profile creator. Injected so this module
 * stays pure and never reaches into gateway state storage.
 */
export type CronCreatorProfileLookup = (
  profileId: string,
) => { email?: string; displayName?: string } | undefined;

/** Project the store-only creator stamp onto the public createdBy surface. */
function resolveCreatedBy(
  job: CronStoredJob,
  lookup?: CronCreatorProfileLookup,
): CronCreatedBy | undefined {
  const actor = job.createdActor;
  if (actor?.type !== "human" || !actor.id) {
    // Agent, system, and unknown-source creators carry no shareable identity.
    return undefined;
  }
  if (actor.source === "channel") {
    return { source: "channel", id: actor.id };
  }
  if (actor.source !== "profile") {
    return undefined;
  }
  const profile = lookup?.(actor.id);
  return {
    profileId: actor.id,
    ...(profile?.email ? { email: profile.email } : {}),
    ...(profile?.displayName ? { displayName: profile.displayName } : {}),
  };
}

/** Remove scheduler-only state before a cron job crosses a public API boundary. */
export function toPublicCronJob(job: CronStoredJob, lookup?: CronCreatorProfileLookup): CronJob {
  const {
    skillLibrarySelections: _skillLibrarySelections,
    createdActor: _createdActor,
    // Never trust a persisted projection; createdBy is recomputed from the stamp.
    createdBy: _createdBy,
    toolsAllowProvenance: _toolsAllowProvenance,
    toolsAllowExecTarget: _toolsAllowExecTarget,
    toolsAllowExecTargetRequirement: _toolsAllowExecTargetRequirement,
    runtimeAuthority: _runtimeAuthority,
    runtimeAuthorityRecoveryRequired: _runtimeAuthorityRecoveryRequired,
    ...publicJob
  } = job;
  const state = { ...job.state };
  delete state.queuedAtMs;
  delete state.startupCatchupAtMs;
  delete state.pacedNextRunAtMs;
  delete state.forcePreservedNextRunAtMs;
  const createdBy = resolveCreatedBy(job, lookup);
  return { ...publicJob, ...(createdBy ? { createdBy } : {}), state };
}
