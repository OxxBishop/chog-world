/*
 * The one place the brain calls Claude. Claude Haiku 5.5: fast and cheap, and plenty for a Chog.
 * Structured output, so the app always gets { reply, mood, ... } it can act on.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const MODEL = 'claude-haiku-5-5';
export const MOODS = ['happy', 'excited', 'calm', 'curious', 'surprised', 'sleepy', 'sad'];

let client = null;
const anthropic = () => (client ??= new Anthropic());

// BRAIN_MOCK=1 answers without calling Claude (local dev and tests, no key needed).
const MOCK = process.env.BRAIN_MOCK === '1';
export const hasKey = () => MOCK || Boolean(process.env.ANTHROPIC_API_KEY);

function mock(schema) {
  const shape = schema.shape ?? {};
  if ('lines' in shape) return { lines: [{ who: 'a', text: 'oh hey, fancy seeing you here!', mood: 'happy' }, { who: 'b', text: 'my keeper says hi, probably.', mood: 'calm' }], noteA: 'bumped into a friend', noteB: 'bumped into a friend' };
  return { reply: '(mock) chog chog! tell me more.', mood: 'happy', remember: ['mock note about the keeper'], world: [] };
}

/**
 * system: [{ text, cache? }]. Resolves to the parsed object, or throws.
 * Thinking is off and effort low: these are short in-character lines where speed matters most.
 */
export async function ask({ system, messages, schema, maxTokens = 1024 }) {
  if (MOCK) return { out: mock(schema), usage: null, prompt: { system, messages } };
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: zodOutputFormat(schema) },
    system: system.map((b) => (b.cache ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: b.text })),
    messages,
  });
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('refused'), { status: 422 });
  if (!res.parsed_output) throw Object.assign(new Error(`no structured output (stop: ${res.stop_reason})`), { status: 502 });
  return { out: res.parsed_output, usage: res.usage };
}

/** Map SDK errors to a status and a message that's safe to show. */
export function apiError(err) {
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: 'Chogs are busy right now. Try again in a moment.' };
  if (err instanceof Anthropic.AuthenticationError) return { status: 500, message: 'The Chog brain is not set up yet.' };
  if (err instanceof Anthropic.BadRequestError) return { status: 500, message: 'The Chog brain had a hiccup.' };
  if (err instanceof Anthropic.APIError) return { status: 502, message: 'The Chog brain is unreachable right now.' };
  if (err?.status === 422) return { status: 200, message: null, refused: true };
  return { status: err?.status || 500, message: 'The Chog brain had a hiccup.' };
}
