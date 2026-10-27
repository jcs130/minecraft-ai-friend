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
