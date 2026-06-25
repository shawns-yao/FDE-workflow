import type { FeishuCallbackEvent, FeishuCallbackInput, FeishuChatMember, ListChatMembersInput, MentionUserInput, MentionUserResult, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "./types.js";

export interface IMConnectorService {
  sendCard(input: SendCardInput): Promise<SendCardResult>;
  updateCard(input: UpdateCardInput): Promise<void>;
  replyMessage(input: ReplyMessageInput): Promise<ReplyMessageResult>;
  mentionUser(input: MentionUserInput): MentionUserResult;
  listChatMembers?(input: ListChatMembersInput): Promise<FeishuChatMember[]>;
  handleCallback(input: FeishuCallbackInput): Promise<FeishuCallbackEvent>;
}

export interface FeishuCardRecord extends SendCardInput {
  message_id: string;
  sent_at: string;
}
