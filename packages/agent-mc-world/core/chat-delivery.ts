import type { ChatDeliveryReceipt } from '../src/contracts/chat-delivery.ts';

/** Commands/authentication are not player conversation and are never journaled here. */
export function chatDeliveryMessage(value: string): Pick<ChatDeliveryReceipt, 'channel' | 'to' | 'text'> | null {
  const text = value.trim();
  if (!text) return null;
  if (!text.startsWith('/')) return { channel: 'public', text };
  const whisper = /^\/(?:minecraft:)?(?:msg|tell|w)[ \t]+([\p{L}\p{N}_.-]{1,16})[ \t]+([^\r\n]+)$/iu.exec(text);
  return whisper ? { channel: 'private', to: whisper[1], text: whisper[2] } : null;
}
