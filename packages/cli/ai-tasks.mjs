/**
 * Executes an ASSIGNED task and returns a DRAFT. It never writes content, never
 * sends mail, never publishes and never charges. The human approves in the UI.
 * A task that is not assigned is refused, so the checkboxes are a real permission
 * boundary rather than decoration.
 */
import * as AI from './ai-provider.mjs';

export class TaskError extends Error { constructor(m, c) { super(m); this.code = c || 400; } }
const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

const SYSTEM = 'You draft text for the owner of a personal portfolio site. '
  + 'Output ONLY the draft, no preamble, no markdown headings, no invented facts. '
  + 'If a fact is missing, leave a bracketed placeholder like [confirm rate]. '
  + 'Never promise availability, prices or timelines that were not supplied.';

/** Deterministic prompt builders. Pure functions - the gate asserts them. */
export const BUILDERS = {
  draft_reply: p => 'Write a short, warm reply to this enquiry. Sign as ' + clean(p.owner) + '.\n'
    + 'From: ' + clean(p.name) + ' <' + clean(p.email) + '>\nMessage: ' + clean(p.message) + '\n'
    + 'Keep it under 120 words. Do not commit to a time or a price.',
  summarize_lead: p => 'Summarise this enquiry in two sentences, then list any explicit ask as bullets.\n'
    + 'Message: ' + clean(p.message),
  triage_suggest: p => 'Classify this enquiry as one of: new, read, replied, archived. '
    + 'Answer with the single word and one short reason.\nMessage: ' + clean(p.message),
  spam_score: p => 'Rate 0-10 how likely this is spam, then one sentence of reasoning. '
    + 'Never recommend deletion.\nMessage: ' + clean(p.message),
  booking_confirm_draft: p => 'Draft a booking confirmation. Slot: ' + clean(p.starts_at)
    + ' (' + clean(p.duration_minutes) + ' minutes, ' + clean(p.timezone) + '). Attendee: ' + clean(p.name)
    + '. Do not claim payment was received. Under 100 words.',
  booking_reminder_draft: p => 'Draft a one-paragraph reminder for a call at ' + clean(p.starts_at)
    + ' with ' + clean(p.name) + '. Under 60 words.',
  intro_draft: p => 'Write a homepage intro in the first person for ' + clean(p.name)
    + ', ' + clean(p.headline) + '. Skills: ' + clean(p.skills) + '. Location: ' + clean(p.location)
    + '. 60-90 words, plain prose, no heading.',
  service_copy: p => 'Write a 40-60 word description for a service called "' + clean(p.title)
    + '". Known facts: ' + clean(p.facts) + '. Do not invent deliverables or prices.',
  seo_description: p => 'Write a meta description of 120-155 characters for a page titled "'
    + clean(p.title) + '" about: ' + clean(p.about) + '. One sentence, no quotes.',
  alt_text: p => 'Write alt text under 125 characters for an image named "' + clean(p.filename)
    + '". Context: ' + clean(p.context) + '. Describe only what the context supports; '
    + 'if unsure, output [describe image].',
  translate: p => 'Translate the following into ' + clean(p.language)
    + '. Preserve meaning and tone. Output only the translation.\n\n' + clean(p.text)
};

export function assigned() { return AI.status().tasks || []; }

export function buildPrompt(task, payload = {}) {
  const id = String(task || '');
  if (!BUILDERS[id]) throw new TaskError('unknown task: ' + id);
  return BUILDERS[id](payload || {});
}

export async function run(task, payload = {}) {
  const id = String(task || '');
  if (!BUILDERS[id]) throw new TaskError('unknown task: ' + id);
  if (!assigned().includes(id)) throw new TaskError('task not assigned: ' + id + ' - enable it in Settings -> AI', 403);
  if (!AI.hasKey()) throw new TaskError('no AI provider key configured', 409);
  const prompt = buildPrompt(id, payload);
  const r = await AI.complete(prompt, { system: SYSTEM });
  return { task: id, draft: r.text, ms: r.ms, model: r.model, writeback: false,
           note: 'DRAFT ONLY - nothing was saved, sent or published.' };
}
