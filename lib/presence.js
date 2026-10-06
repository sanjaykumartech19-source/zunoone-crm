// Tracks which agents have an open socket, per workspace. Used for round-robin routing.
const online = new Map();      // slug -> Set(username)
const rrCursor = new Map();    // slug -> index

function setOnline(slug, username) {
  if (!slug || !username) return;
  if (!online.has(slug)) online.set(slug, new Set());
  online.get(slug).add(username);
}
function setOffline(slug, username) {
  const s = online.get(slug);
  if (s) s.delete(username);
}
function list(slug) { return [...(online.get(slug) || [])]; }

/**
 * Round-robin pick.
 * @param routing  tenant.routing  { agents:[{username,channels:[]}], pool:[] }
 * @param channel  restrict to agents who handle this channel (empty channels = all)
 */
function pick(slug, routing, channel) {
  routing = routing || {};
  let entries = (routing.agents && routing.agents.length)
    ? routing.agents
    : (routing.pool || []).map(u => ({ username: u, channels: [] }));
  if (channel) entries = entries.filter(e => !e.channels || !e.channels.length || e.channels.includes(channel));
  let candidates = entries.map(e => e.username);
  const on = list(slug);
  if (candidates.length) {
    const onlineCands = candidates.filter(u => on.includes(u));
    if (onlineCands.length) candidates = onlineCands;
  } else {
    candidates = on; // nothing configured -> any online agent
  }
  if (!candidates.length) return '';
  const i = (rrCursor.get(slug) || 0) % candidates.length;
  rrCursor.set(slug, i + 1);
  return candidates[i];
}

module.exports = { setOnline, setOffline, list, pick };
