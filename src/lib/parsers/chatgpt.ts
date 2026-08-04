/**
 * ChatGPT export parser.
 *
 * Runs in the browser. See docs/architecture.md - archives are never parsed
 * server-side.
 *
 * The export zip contains conversations.json: an array of conversations, each
 * holding a `mapping` of node id -> node. Nodes form a tree (regenerations and
 * edits create branches), so the same conversation can contain prompts the
 * respondent replaced. We take every user-authored text message; a superseded
 * prompt is still something they typed.
 *
 * We take user messages only. Assistant output is not the respondent's
 * behaviour and collecting it would widen the disclosure for no measurement
 * gain.
 */

import { ActivityRecord, recordId } from '../records'

interface ChatGPTNode {
  message?: {
    author?: { role?: string }
    create_time?: number | null
    content?: { content_type?: string; parts?: unknown[] }
    metadata?: { is_visually_hidden_from_conversation?: boolean }
  }
}

interface ChatGPTConversation {
  title?: string
  create_time?: number
  mapping?: Record<string, ChatGPTNode>
}

function textFromParts(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p): p is string => typeof p === 'string')
    .join('\n')
    .trim()
}

export function parseChatGPTExport(json: string): ActivityRecord[] {
  let conversations: unknown
  try {
    conversations = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(conversations)) return []

  const records: ActivityRecord[] = []

  for (const conversation of conversations as ChatGPTConversation[]) {
    if (!conversation?.mapping) continue
    const title = conversation.title?.trim() || undefined

    for (const node of Object.values(conversation.mapping)) {
      const message = node?.message
      if (!message) continue
      if (message.author?.role !== 'user') continue

      // System-injected user turns (custom instructions, tool plumbing) are
      // flagged hidden. They are not something the respondent typed.
      if (message.metadata?.is_visually_hidden_from_conversation) continue

      const contentType = message.content?.content_type
      if (contentType && contentType !== 'text') continue

      const text = textFromParts(message.content?.parts)
      if (!text) continue

      const seconds = message.create_time ?? conversation.create_time
      if (!seconds) continue
      const timestamp = new Date(seconds * 1000).toISOString()
      if (timestamp === 'Invalid Date') continue

      records.push({
        id: recordId('chatgpt', timestamp, text),
        source: 'chatgpt',
        timestamp,
        text,
        action: 'searched',
        context: title,
      })
    }
  }

  return records
}
