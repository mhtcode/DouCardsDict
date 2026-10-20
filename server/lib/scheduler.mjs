import { Rating, State, createEmptyCard, fsrs } from 'ts-fsrs'
import { answerAlignment } from './text.mjs'

const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: true, enable_short_term: true })

export function automaticRating({ expected, answer, elapsedMs = 0, replayCount = 0, hintsUsed = 0, revealed = false, override }) {
  if (override && [1, 2, 3, 4].includes(Number(override))) return Number(override)
  const alignment = answerAlignment(expected, answer)
  if (revealed || alignment.similarity < 0.58) return Rating.Again
  let score = alignment.similarity * 4
  if (elapsedMs > 30000) score -= 0.4
  if (elapsedMs > 60000) score -= 0.4
  score -= Math.min(0.8, replayCount * 0.12)
  score -= Math.min(1.2, hintsUsed * 0.22)
  if (alignment.similarity === 1 && elapsedMs < 12000 && hintsUsed === 0) score += 0.8
  if (score >= 4.2) return Rating.Easy
  if (score >= 3) return Rating.Good
  if (score >= 2.1) return Rating.Hard
  return Rating.Again
}

export function legacyReviewToCard(row, at = new Date()) {
  if (!row || (!row.fsrs_state && !row.repetitions && !row.attempts)) return createEmptyCard(at)
  const state = row.fsrs_state ?? (row.repetitions > 0 ? State.Review : row.lapses > 0 ? State.Relearning : State.Learning)
  return {
    due: new Date(row.due_at || at),
    stability: Number(row.fsrs_stability || Math.max(0.1, Number(row.interval_days || 0.1))),
    difficulty: Number(row.fsrs_difficulty || Math.max(1, Math.min(10, 6.2 - Number(row.ease || 2.5)))),
    elapsed_days: Number(row.fsrs_elapsed_days || 0),
    scheduled_days: Number(row.fsrs_scheduled_days || Math.round(Number(row.interval_days || 0))),
    learning_steps: Number(row.fsrs_learning_steps || 0),
    reps: Number(row.repetitions || 0),
    lapses: Number(row.lapses || 0),
    state,
    last_review: row.fsrs_last_review ? new Date(row.fsrs_last_review) : row.updated_at ? new Date(row.updated_at) : undefined,
  }
}

export function scheduleReview(row, rating, at = new Date()) {
  const result = scheduler.next(legacyReviewToCard(row, at), at, Number(rating))
  return { ...result, intervalDays: Math.max(result.card.scheduled_days, (result.card.due.getTime() - at.getTime()) / 86400000) }
}

export function skippedSchedule(at = new Date()) {
  return new Date(at.getTime() + 15 * 60_000)
}
