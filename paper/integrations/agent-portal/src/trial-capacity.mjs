export const TRIAL_CAPACITY = 100;
export const TRIAL_REGISTRATION_TTL_MS = 24 * 3600000;

// Read-only, shared by admission and the operator's diagnostic. A released
// reservation is NOT a deleted/revoked identity. No activity extends its TTL.
// Any persisted game evidence wins over age and API credential revocation.
export function trialCapacity(db, now = Date.now()) {
  const pool = db.prepare('SELECT owner_id FROM agent_trial_pool WHERE singleton=1').get()?.owner_id;
  const waitingInvitations = db.prepare(`SELECT count(*) AS n FROM agent_trial_invites t
    JOIN agent_invites i ON i.id=t.invite_id
    WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?`).get(now).n;
  const rows = pool ? db.prepare(`SELECT c.id,c.name,c.expected_uuid,c.owner_id,c.created_at,c.revoked_at,c.game_request_id,
    EXISTS(SELECT 1 FROM agent_public_registrations p WHERE p.invite_id=c.invite_id)
      OR EXISTS(SELECT 1 FROM agent_trial_invites t WHERE t.invite_id=c.invite_id) AS trial_origin,
    EXISTS(SELECT 1 FROM portal_agents p WHERE p.player_uuid=c.expected_uuid OR p.normalized=c.normalized)
      OR EXISTS(SELECT 1 FROM ownerships o WHERE o.agent_uuid=c.expected_uuid)
      OR EXISTS(SELECT 1 FROM archived_test_roles r WHERE r.player_uuid=c.expected_uuid OR lower(r.name)=c.normalized) AS has_identity,
    EXISTS(SELECT 1 FROM account_jobs j WHERE j.operation='create'
      AND (j.id=c.game_request_id OR j.expected_uuid=c.expected_uuid OR lower(j.name)=c.normalized)
      AND j.state='succeeded') AS succeeded,
    EXISTS(SELECT 1 FROM account_jobs j WHERE j.operation='create'
      AND (j.id=c.game_request_id OR j.expected_uuid=c.expected_uuid OR lower(j.name)=c.normalized)) AS has_job,
    EXISTS(SELECT 1 FROM account_jobs j WHERE j.operation='create'
      AND (j.id=c.game_request_id OR j.expected_uuid=c.expected_uuid OR lower(j.name)=c.normalized)
      AND (j.state NOT IN ('failed','succeeded','pending') OR j.state='pending' AND j.expires_at<=?)) AS unknown_job,
    EXISTS(SELECT 1 FROM account_jobs j WHERE j.operation='create'
      AND (j.id=c.game_request_id OR j.expected_uuid=c.expected_uuid OR lower(j.name)=c.normalized)
      AND j.state='pending' AND j.expires_at>?) AS pending_job
    FROM agent_clients c WHERE c.owner_id=?
      OR EXISTS(SELECT 1 FROM agent_public_registrations p WHERE p.invite_id=c.invite_id)
      OR EXISTS(SELECT 1 FROM agent_trial_invites t WHERE t.invite_id=c.invite_id)
    ORDER BY c.id`).all(now, now, pool) : [];
  const states = { awaiting_activation: 0, registration_released: 0, creating: 0,
    creation_unknown: 0, creation_failed_review: 0, created: 0, claimed: 0, custody_review: 0 };
  const clients = rows.map(row => {
    let state;
    if (row.owner_id !== pool) state = 'claimed';
    else if (row.has_identity || row.succeeded) state = 'created';
    else if (row.unknown_job) state = 'creation_unknown';
    else if (row.pending_job) state = 'creating';
    // A generic failed receipt is not proof that a game identity is absent.
    // Keep even detached historical jobs; never infer absence from a missing
    // current pointer or a revoked API credential.
    else if (row.has_job) state = 'creation_failed_review';
    else if (row.game_request_id) state = 'creation_unknown';
    else if (!row.trial_origin) state = 'custody_review';
    else state = row.revoked_at !== null || row.created_at + TRIAL_REGISTRATION_TTL_MS <= now
      ? 'registration_released' : 'awaiting_activation';
    states[state]++;
    return { clientId: row.id, username: row.name, playerUuid: row.expected_uuid, gameRequestId: row.game_request_id, state,
      countsTowardCapacity: !['claimed', 'registration_released'].includes(state),
      reservationExpiresAt: ['awaiting_activation', 'registration_released'].includes(state)
        ? new Date(row.created_at + TRIAL_REGISTRATION_TTL_MS).toISOString() : null };
  });
  const used = waitingInvitations + clients.filter(row => row.countsTowardCapacity).length;
  return { capacity: TRIAL_CAPACITY, used, available: Math.max(0, TRIAL_CAPACITY - used),
    waitingInvitations, registrationTtlSeconds: TRIAL_REGISTRATION_TTL_MS / 1000, states, clients };
}
