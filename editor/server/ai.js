// Claude calls: plan a new video from an idea, and turn review comments into edits.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

const MODEL = process.env.RECUT_MODEL || 'claude-opus-5-5';
let client = null;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY
export const resetClient = () => { client = null; };

/* ---------- 1. plan a video ---------- */
const PlanSchema = z.object({
  title: z.string(),
  scenes: z.array(z.object({
    voiceover: z.string().describe('Exact narration for this scene, spoken by the voice. 1–3 short sentences.'),
    onscreen: z.string().describe('Short on-screen title or number for this scene (max ~6 words). Empty string for none.'),
    visual: z.string().describe('What the footage or image should show. Concrete and filmable, no text in the image.'),
  })),
});

const PLAN_SYSTEM = `You write scripts for short-form and long-form videos that will be assembled on an editable multi-track timeline.
Each scene becomes: one voiceover clip, one subtitle clip, one optional on-screen title, and one footage slot.
Rules:
- Hook in the first scene (a number, a contradiction or a question).
- Narration is spoken English unless the brief says otherwise. Short sentences. No stage directions in the narration.
- Only state facts given in the brief or widely established. When the brief supplies figures, use them exactly and do not invent new figures.
- The last scene is a clear call to action if the brief mentions a channel or a full video.
- Pace: about 2.5 spoken words per second. Hit the requested length.`;

export async function planVideo({ brief, seconds, language }) {
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(PlanSchema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: PLAN_SYSTEM,
    messages: [{ role: 'user', content: `Target length: about ${seconds} seconds.\nLanguage: ${language || 'English'}.\n\nBrief:\n${brief}` }],
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined this brief.');
  if (!res.parsed_output) throw new Error('The model did not return a usable plan. Try again.');
  return res.parsed_output;
}

/* ---------- 2. apply review comments ---------- */
const EditsSchema = z.object({
  edits: z.array(z.object({
    clip: z.string().describe('id of the clip the comment is on'),
    action: z.enum(['set_text', 'set_voiceover', 'set_volume', 'set_timing', 'delete_clip', 'needs_human']),
    text: z.string().describe('New text for set_text / set_voiceover. Empty string otherwise.'),
    volume: z.number().describe('0–1 for set_volume. -1 otherwise.'),
    start: z.number().describe('New start in seconds for set_timing. -1 to keep.'),
    duration: z.number().describe('New duration in seconds for set_timing. -1 to keep.'),
    reply: z.string().describe('One short sentence to the reviewer: what you changed, or why a human must do it.'),
  })),
});

const EDIT_SYSTEM = `You apply a reviewer's comments to a video project timeline. You receive the project's clips and a list of open comments.
For each comment, return the smallest edit that satisfies it, on the clip the comment is attached to, unless the comment clearly names another clip.
- Text clips (titles, subtitles): set_text.
- Voiceover clips: set_voiceover with the full new narration line; it will be re-recorded with the same voice. If the voiceover has a matching subtitle clip at the same time, also return set_text for that subtitle with the same wording.
- Volume requests: set_volume. Timing requests: set_timing.
- Requests that need new footage or images, or anything you cannot do with these actions: needs_human, with a reply saying what to provide.
Never change clips that no comment asks about.`;

export async function planEdits({ project, comments }) {
  const clips = project.tracks.flatMap((t) => t.clips.map((c) => ({
    id: c.id, track: t.name, type: t.type, start: c.start, duration: c.duration,
    text: c.text ?? undefined,
    voiceover: t.type === 'audio' && project.assets[c.asset]?.script ? project.assets[c.asset].script : undefined,
    asset: c.asset ? { name: project.assets[c.asset]?.name, prompt: project.assets[c.asset]?.prompt } : undefined,
    volume: c.volume,
  })));
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(EditsSchema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: EDIT_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ title: project.meta.title, clips, comments }, null, 1) }],
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined these changes.');
  if (!res.parsed_output) throw new Error('The model did not return usable edits. Try again.');
  return res.parsed_output.edits;
}

export function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic API key is missing or invalid (set ANTHROPIC_API_KEY in .env).';
  if (e instanceof Anthropic.RateLimitError) return 'Anthropic rate limit hit. Wait a moment and try again.';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`;
  return e.message || String(e);
}
