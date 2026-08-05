import type { NextRequest } from 'next/server'
import { getStudy } from '@/lib/studies'
import { dbConfigured } from '@/lib/db'
import { findOrCreateSession } from '@/lib/sessions'
import { getQuestions, persistSurvey } from '@/lib/survey_store'
import {
  pruneAnswers,
  terminatedBy,
  validateAnswer,
  visibleQuestions,
  type AnswerValue,
  type Answers,
} from '@/lib/survey'

/**
 * Records the survey, which must be complete before the respondent reaches
 * review (invariant 2).
 *
 * Answers are validated against the study's own questions rather than trusted,
 * so a client that has been tampered with cannot write an answer to a question
 * this study does not ask, or a value outside the range it offered.
 */

function readAnswer(raw: unknown): AnswerValue | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { kind, value, values } = raw as Record<string, unknown>

  switch (kind) {
    case 'choice':
      return typeof value === 'string' ? { kind: 'choice', value } : null
    case 'choices':
      return Array.isArray(values) && values.every((v) => typeof v === 'string')
        ? { kind: 'choices', values: values as string[] }
        : null
    case 'number':
      return typeof value === 'number' ? { kind: 'number', value } : null
    case 'text':
      return typeof value === 'string' ? { kind: 'text', value } : null
    default:
      return null
  }
}

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const { studySlug, respondentId, sessionId, answers } = (body ?? {}) as Record<
    string,
    unknown
  >

  if (typeof studySlug !== 'string') {
    return Response.json({ error: 'studySlug is required.' }, { status: 400 })
  }
  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return Response.json({ error: 'Bad sessionId.' }, { status: 400 })
  }
  const study = await getStudy(studySlug)
  if (!study) {
    return Response.json({ error: 'Unknown study.' }, { status: 400 })
  }
  if (respondentId !== undefined && typeof respondentId !== 'string') {
    return Response.json({ error: 'Bad respondentId.' }, { status: 400 })
  }
  // The interview belongs to the client in append mode and its answers are
  // never ours to hold. Accepting them here would quietly create a second,
  // unaudited copy of their instrument.
  if (study.mode === 'append') {
    return Response.json(
      { error: 'This study does not run its survey here.' },
      { status: 400 }
    )
  }
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return Response.json({ error: 'answers must be an object.' }, { status: 400 })
  }

  if (!dbConfigured()) {
    return Response.json({ recorded: false }, { status: 200 })
  }

  const questions = await getQuestions(studySlug)
  const asked = new Set(questions.map((q) => q.code))
  for (const code of Object.keys(answers)) {
    if (!asked.has(code)) {
      return Response.json(
        { error: `This study does not ask ${code}.` },
        { status: 400 }
      )
    }
  }

  // Read everything first: visibility is decided by the answers themselves, so
  // there is nothing to branch on until they are parsed.
  const submitted: Answers = {}
  for (const question of questions) {
    const raw = (answers as Record<string, unknown>)[question.code]
    if (raw === undefined || raw === null) continue
    const answer = readAnswer(raw)
    if (!answer) {
      return Response.json(
        { error: `Could not read the answer to ${question.code}.` },
        { status: 400 }
      )
    }
    submitted[question.code] = answer
  }

  // Answers to questions this respondent's route never reached are dropped
  // rather than rejected. Storing one would deliver a reply to a question they
  // were not asked; rejecting would dead-end someone whose tab went stale over
  // a branch, and protects nothing that dropping does not.
  const parsed = pruneAnswers(questions, submitted)
  const dropped = Object.keys(submitted).filter((code) => !(code in parsed))
  if (dropped.length) {
    console.warn(`dropped answers to unasked questions: ${dropped.join(', ')}`)
  }

  // Only what they were actually shown is required of them.
  for (const question of visibleQuestions(questions, parsed)) {
    const problem = validateAnswer(question, parsed[question.code])
    if (problem) {
      return Response.json(
        { error: `${question.code}: ${problem}`, question: question.code },
        { status: 400 }
      )
    }
  }

  const terminator = terminatedBy(questions, parsed)

  try {
    const session = await findOrCreateSession(
      studySlug,
      respondentId as string | undefined,
      sessionId as string | undefined
    )
    const { answered } = await persistSurvey(session.id, parsed, !!terminator)
    return Response.json(
      {
        recorded: true,
        answered,
        sessionId: session.id,
        // The answers up to the screen-out are kept. They are how the client
        // works out what their incidence actually was, and throwing them away
        // would make the qualifying rate unmeasurable from our own data.
        screenedOut: !!terminator,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('survey failed', error)
    return Response.json(
      { error: 'Could not save your answers.' },
      { status: 500 }
    )
  }
}
