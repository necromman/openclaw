import type { CronCreatorProfileLookup } from "../cron/public-job.js";
import { readUserProfileEmail } from "../state/user-profiles.js";
import { resolveCurrentUserProfileDisplay } from "./current-user-profile-display.js";

type CronCreatorProfile = { email?: string; displayName?: string } | undefined;

/**
 * Reverse-resolves a durable profile id to the display facts the Automations
 * screen shows for a job creator. Both reads are merge-aware and read-only, so
 * a deleted or unknown profile degrades to the bare profile id in the public
 * projection instead of failing the request.
 */
function readCronCreatorProfile(profileId: string): CronCreatorProfile {
  try {
    const display = resolveCurrentUserProfileDisplay(profileId);
    const displayName = display.kind === "resolved" ? display.label : undefined;
    const email = readUserProfileEmail(profileId);
    return {
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Builds a per-response lookup with a local cache so one cron list reads each
 * distinct creator profile at most once.
 */
export function createCronCreatorProfileLookup(): CronCreatorProfileLookup {
  const cache = new Map<string, CronCreatorProfile>();
  return (profileId) => {
    if (!cache.has(profileId)) {
      cache.set(profileId, readCronCreatorProfile(profileId));
    }
    return cache.get(profileId);
  };
}
