/** Role/session conversation backend, not a raw chat-completion API.
 * Replacements preserve session isolation; providers do not execute Minecraft actions.
 */
export interface ModelUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ModelRequest {
  roleId: string
  sessionId: string
  userId: string
  prompt: string
  images?: string[]
}

export interface ModelChatRequest extends ModelRequest {
  timeoutMs: number
}

export interface ModelReply {
  text: string
  usage?: ModelUsage
}

export interface ModelProviderInfo {
  id: string
  label: string
  capabilities: { chat: boolean; task: boolean }
}

export interface ModelProvider {
  readonly info: Readonly<ModelProviderInfo>
  chat(request: ModelChatRequest): Promise<ModelReply>
  /** Optional durable/background request support. The caller owns fallback policy. */
  task?(request: ModelRequest): Promise<ModelReply>
}
