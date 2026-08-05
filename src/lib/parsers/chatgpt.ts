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
 * Each record is one exchange: the prompt as `text`, the assistant's reply as
 * `answer`, and any sources the reply cited as `citations` - the same shape as
 * an AI Mode record. What an assistant told a respondent is the point of the
 * measurement, not a by-product of it: a client asking whether an AI recommends
 * them is asking about exactly this text.
 */

import {
  ActivityRecord,
  normaliseAnswer,
  normaliseText,
  recordId,
} from '../records'

interface ChatGPTNode {
  id?: string
  parent?: string | null
  children?: string[]
  message?: {
    author?: { role?: string }
    create_time?: number | null
    content?: { content_type?: string; parts?: unknown[] }
    metadata?: {
      is_visually_hidden_from_conversation?: boolean
      citations?: { metadata?: { url?: string } }[]
    }
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

/**
 * Sources the reply pointed at: whatever the export records in citation
 * metadata, plus any markdown or bare links in the text itself. Different
 * ChatGPT versions use different ones, so read both.
 */
function citationsFrom(node: ChatGPTNode, text: string): string[] | undefined {
  const urls: string[] = []
  const add = (url?: string) => {
    if (url && /^https?:/i.test(url) && !urls.includes(url)) urls.push(url)
  }

  for (const c of node.message?.metadata?.citations ?? []) {
    add(c?.metadata?.url)
  }
  for (const m of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) add(m[1])
  for (const m of text.matchAll(/(?<![([])\bhttps?:\/\/[^\s<>()[\]]+/g)) add(m[0])

  return urls.length ? urls : undefined
}

/** First assistant reply beneath a prompt, following the branch it was on. */
function replyTo(
  node: ChatGPTNode,
  mapping: Record<string, ChatGPTNode>
): ChatGPTNode | undefined {
  const queue = [...(node.children ?? [])]
  const seen = new Set<string>()

  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)

    const child = mapping[id]
    if (!child) continue

    const role = child.message?.author?.role
    if (role === 'assistant') {
      const type = child.message?.content?.content_type
      // Tool calls and reasoning traces sit between prompt and reply; keep
      // walking past them to the text the respondent actually saw.
      if (!type || type === 'text') return child
    }
    if (role === 'user') continue // a following turn, not this one's answer

    queue.push(...(child.children ?? []))
  }
  return undefined
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
    const mapping = conversation.mapping
    const title = conversation.title?.trim() || undefined

    for (const node of Object.values(mapping)) {
      const message = node?.message
      if (!message) continue
      if (message.author?.role !== 'user') continue

      // System-injected user turns (custom instructions, tool plumbing) are
      // flagged hidden. They are not something the respondent typed.
      if (message.metadata?.is_visually_hidden_from_conversation) continue

      const contentType = message.content?.content_type
      if (contentType && contentType !== 'text') continue

      const text = normaliseText(textFromParts(message.content?.parts))
      if (!text) continue

      const seconds = message.create_time ?? conversation.create_time
      if (!seconds) continue
      const timestamp = new Date(seconds * 1000).toISOString()
      if (timestamp === 'Invalid Date') continue

      const reply = replyTo(node, mapping)
      const answerRaw = reply
        ? textFromParts(reply.message?.content?.parts)
        : ''
      const answer = answerRaw ? normaliseAnswer(answerRaw) : undefined

      records.push({
        id: recordId('chatgpt', timestamp, text),
        source: 'chatgpt',
        timestamp,
        text,
        action: 'searched',
        context: title,
        answer,
        citations: reply ? citationsFrom(reply, answerRaw) : undefined,
      })
    }
  }

  return records
}
