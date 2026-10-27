export type ClientMessage = { role: "user" | "assistant"; content: string };

export function completedMessages<T extends ClientMessage>(messages: T[]): ClientMessage[] {
  return messages
    .filter(message => message.content.trim().length > 0)
    .map(({ role, content }) => ({ role, content }));
}

export function requestMessages(messages: ClientMessage[]): ClientMessage[] {
  return completedMessages(messages).slice(-12);
}
