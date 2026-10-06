const OpenAI = require('openai');
const { OPENAI_API_KEY } = require('../config');
const channels = require('../channels');

function clientFor(tenant) {
  const key = (tenant.ai && tenant.ai.apiKey) || OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/**
 * Build a reply draft from recent conversation context + tenant knowledge.
 * Returns { text, confident } or null when AI is unavailable.
 */
async function draftReply(tenant, channel, contactId) {
  const ai = tenant.ai || {};
  const openai = clientFor(tenant);
  if (!openai) return null;

  let history = [];
  try { history = await channels.fetchMessages(tenant.slug, channel, contactId, 12); } catch (_) {}
  if (!history.length) return null;

  const sys = [
    ai.persona || 'You are a concise, friendly customer-support assistant.',
    ai.knowledge ? `\nKnowledge base (only use facts from here; do not invent policies):\n${ai.knowledge}` : '',
    '\nIf you cannot answer from the knowledge base, reply exactly: I\'ll check with a teammate and get back to you.'
  ].join('');

  const messages = [{ role: 'system', content: sys }].concat(
    history.slice(-12).map(m => ({ role: m.from === 'me' ? 'assistant' : 'user', content: (m.text || '').slice(0, 1500) }))
  );

  try {
    const r = await openai.chat.completions.create({
      model: ai.model || 'gpt-4o-mini',
      messages, temperature: 0.3, max_tokens: 220
    });
    const text = (r.choices[0].message.content || '').trim();
    if (!text) return null;
    try { require('../lib/plans').bump(tenant._id, 'aiCreditsThisPeriod', (r.usage && r.usage.total_tokens) ? Math.ceil(r.usage.total_tokens / 10) : 20); } catch (_) {}
    const confident = !/i'?ll check with a teammate/i.test(text);
    return { text, confident };
  } catch (e) {
    console.error(`[${tenant.slug}] AI draft:`, e.message);
    return null;
  }
}

function wantsHuman(text, ai) {
  const kws = (ai && ai.handoffKeywords) || [];
  const t = (text || '').toLowerCase();
  return kws.some(k => k && t.includes(String(k).toLowerCase()));
}

module.exports = { draftReply, wantsHuman, clientFor };
