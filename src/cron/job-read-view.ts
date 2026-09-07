import { resolveCronJobConfigRevision } from "./config-revision.js";
import { type CronCreatorProfileLookup, toPublicCronJob } from "./public-job.js";
import type { CronJob } from "./types.js";

// The optional lookup stays a caller-injected function so this read view keeps
// no dependency on gateway profile storage.
export function cronJobReadView(job: CronJob, creatorProfiles?: CronCreatorProfileLookup) {
  const publicJob = toPublicCronJob(job, creatorProfiles);
  return {
    ...publicJob,
    configRevision: resolveCronJobConfigRevision(job),
    nextRunAtMs: job.state.nextRunAtMs,
    lastRunAtMs: job.state.lastRunAtMs,
    lastRunStatus: job.state.lastRunStatus ?? job.state.lastStatus,
    lastRunError: job.state.lastError,
    lastDelivered: job.state.lastDelivered,
    lastDeliveryStatus: job.state.lastDeliveryStatus,
    lastDeliveryError: job.state.lastDeliveryError,
    deliverySuppressionReason: job.state.deliverySuppressionReason,
    lastFailureNotificationDelivered: job.state.lastFailureNotificationDelivered,
    lastFailureNotificationDeliveryStatus: job.state.lastFailureNotificationDeliveryStatus,
    lastFailureNotificationDeliveryError: job.state.lastFailureNotificationDeliveryError,
  };
}

// Strip only metadata added by the public read view, never unknown definition fields.
// createdBy counts as such metadata: it is a projection of the store-only creator
// stamp, so it must not enter definition comparisons or config revisions.
// Stored revisions and privacy projection have separate owners and stay unchanged.
export function cronJobDefinitionFromReadView(view: Partial<ReturnType<typeof cronJobReadView>>) {
  const {
    configRevision: _configRevision,
    createdBy: _createdBy,
    nextRunAtMs: _nextRunAtMs,
    lastRunAtMs: _lastRunAtMs,
    lastRunStatus: _lastRunStatus,
    lastRunError: _lastRunError,
    lastDelivered: _lastDelivered,
    lastDeliveryStatus: _lastDeliveryStatus,
    lastDeliveryError: _lastDeliveryError,
    deliverySuppressionReason: _deliverySuppressionReason,
    lastFailureNotificationDelivered: _lastFailureNotificationDelivered,
    lastFailureNotificationDeliveryStatus: _lastFailureNotificationDeliveryStatus,
    lastFailureNotificationDeliveryError: _lastFailureNotificationDeliveryError,
    ...definition
  } = view;
  return definition;
}
