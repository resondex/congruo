import type { NextRequest } from 'next/server'
import { getStudy } from '@/lib/studies'
import { dbConfigured } from '@/lib/db'
import { findOrCreateSession } from '@/lib/sessions'
import { getQuestions, persistSurvey } from '@/lib/survey_store'
import { validateAnswer, type AnswerValue, type Answers } from '@/lib/survey'

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

  const parsed: Answers = {}
  for (const question of questions) {
    const raw = (answers as Record<string, unknown>)[question.code]
    const given = raw !== undefined && raw !== null

    let answer: AnswerValue | undefined
    if (given) {
      const read = readAnswer(raw)
      if (!read) {
        return Response.json(
          { error: `Could not read the answer to ${question.code}.` },
          { status: 400 }
        )
      }
      answer = read
    }
    const problem = validateAnswer(question, answer)
    if (problem) {
      return Response.json(
        { error: `${question.code}: ${problem}`, question: question.code },
        { status: 400 }
      )
    }
    if (answer) parsed[question.code] = answer
  }

  try {
    const session = await findOrCreateSession(
      studySlug,
      respondentId as string | undefined,
      sessionId as string | undefined
    )
    const { answered } = await persistSurvey(session.id, parsed)
    return Response.json(
      { recorded: true, answered, sessionId: session.id },
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
