import type { NextRequest } from 'next/server'
import { getStudy } from '@/lib/studies'
import { dbConfigured } from '@/lib/db'
import { findOrCreateSession } from '@/lib/sessions'
import { getQuestions, persistSurvey } from '@/lib/survey_store'
import { variablesFor, persistVariables, persistQuality } from '@/lib/variables_store'
import { derive } from '@/lib/variables'
import { runQualityChecks } from '@/lib/quality'
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
  const { kind, value, codes, text, parts } = raw as Record<string, unknown>

  const allNumbers = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n))

  switch (kind) {
    case 'codes':
      if (!allNumbers(codes)) return null
      return {
        kind: 'codes',
        codes,
        text: typeof text === 'string' ? text : undefined,
      }
    case 'order':
      return allNumbers(codes) ? { kind: 'order', codes } : null
    case 'allocation': {
      if (typeof parts !== 'object' || parts === null) return null
      const out: Record<number, number> = {}
      for (const [code, amount] of Object.entries(parts)) {
        if (!Number.isFinite(Number(code)) || typeof amount !== 'number') return null
        out[Number(code)] = amount
      }
      return { kind: 'allocation', parts: out }
    }
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
  for (const key of Object.keys(answers)) {
    // A matrix answer arrives as "question#row".
    if (!asked.has(key.split('#')[0])) {
      return Response.json(
        { error: `This study does not ask ${key}.` },
        { status: 400 }
      )
    }
  }

  // Read everything first: visibility is decided by the answers themselves, so
  // there is nothing to branch on until they are parsed.
  // Keyed by whatever arrived, so matrix rows survive; validation below reads
  // the question code out of the key.
  const submitted: Answers = {}
  for (const [key, raw] of Object.entries(answers as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue
    const answer = readAnswer(raw)
    if (!answer) {
      return Response.json(
        { error: `Could not read the answer to ${key}.` },
        { status: 400 }
      )
    }
    submitted[key] = answer
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
    // A matrix is validated per row; a plain question has the one key.
    const keys = question.matrixRows?.length
      ? question.matrixRows.map((r) => `${question.code}#${r.code}`)
      : [question.code]
    for (const key of keys) {
      const problem = validateAnswer(question, parsed[key])
      if (problem) {
        return Response.json(
          { error: `${question.code}: ${problem}`, question: question.code },
          { status: 400 }
        )
      }
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

    // After the answers are safely stored, and never in a way that can fail
    // the submission: a respondent must not lose a completed interview because
    // a derived variable's rule was malformed.
    try {
      const shown = new Set(visibleQuestions(questions, parsed).map((q) => q.code))
      await Promise.all([
        persistQuality(
          session.id,
          runQualityChecks(questions, parsed, (code) => shown.has(code))
        ),
        persistVariables(session.id, derive(await variablesFor(studySlug), parsed)),
      ])
    } catch (error) {
      console.error('post-survey variables or quality failed', error)
    }
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
