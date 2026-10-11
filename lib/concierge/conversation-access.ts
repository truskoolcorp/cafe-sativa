export function conversationMatchesRequester(
  conversation: {user_id:string|null;session_id:string|null;host_agent:string;ended_at:string|null}|null,
  requester: {userId:string|null;sessionId:string|null;host:string},
) {
  if (!conversation || conversation.ended_at || conversation.host_agent !== requester.host) return false
  if (requester.userId) return conversation.user_id === requester.userId
  return Boolean(requester.sessionId && !conversation.user_id && conversation.session_id === requester.sessionId)
}
