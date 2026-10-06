// Message bus between channel adapters and the application pipeline.
// Adapters call bus.inbound() / bus.outbound(); the server registers handlers.
let io = null;
const inboundHandlers = [];
const outboundHandlers = [];

function init(_io) { io = _io; }

function emitMessage(slug, channel, message) {
  if (io) io.to(`t:${slug}:${channel}`).emit('channel:message', { channel, message });
}

function onInbound(fn) { inboundHandlers.push(fn); }
function onOutbound(fn) { outboundHandlers.push(fn); }

async function inbound(slug, channel, message) {
  emitMessage(slug, channel, message);
  for (const fn of inboundHandlers) {
    try { await fn(slug, channel, message); } catch (e) { console.error('inbound handler:', e.message); }
  }
}
async function outbound(slug, channel, message) {
  emitMessage(slug, channel, message);
  for (const fn of outboundHandlers) {
    try { await fn(slug, channel, message); } catch (e) { console.error('outbound handler:', e.message); }
  }
}

module.exports = { init, emitMessage, onInbound, onOutbound, inbound, outbound };
