/** Routing evidence supplied by an explicitly enabled server adapter.
 * It describes scope, never recipient delivery, presence or permission to speak. */
export interface ChatAudienceEvidence {
  channel: 'nearby' | 'shout' | 'server-default';
  scope: 'same-world-range' | 'server' | 'unknown';
  source: 'server-decoration' | 'server-policy';
  radius?: number;
  observedAt?: string;
}

/** One logical player-facing chat send, after the client transport call returns.
 * A server or recipient acknowledgment is deliberately not implied. */
export interface ChatDeliveryReceipt {
  protocol: 'agent-mc/chat-delivery/v1';
  id: string;
  status: 'sent';
  sentAt: string;
  channel: 'public' | 'private';
  to?: string;
  text: string;
  audience?: ChatAudienceEvidence;
  callId?: string;
  taskExecutionId?: string;
  stepIndex?: number;
  boundary: 'client-transport';
  recipientRead: 'unknown';
}

/** Proven pre-dispatch rejection, unlike a transport timeout with an unknown effect. */
export interface ChatDeliveryRejection {
  protocol: 'agent-mc/chat-delivery/v1';
  status: 'rejected';
  dispatchStarted: false;
}
