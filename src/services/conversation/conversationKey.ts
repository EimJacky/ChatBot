interface ConversationSource {
  channelId: string;
  userId: string;
  guildId?: string | null;
  channel?: unknown;
}

interface ThreadLike {
  id?: string;
  isThread?: () => boolean;
}

export interface ConversationIdentity {
  conversationKey: string;
  threadId?: string;
}

export function resolveConversationIdentity(source: ConversationSource): ConversationIdentity {
  if (!source.guildId) {
    return { conversationKey: `dm:${source.userId}` };
  }

  const channel = source.channel as ThreadLike | undefined;
  if (channel?.isThread?.() && channel.id) {
    return {
      conversationKey: `thread:${channel.id}`,
      threadId: channel.id,
    };
  }

  return { conversationKey: `channel:${source.channelId}` };
}
