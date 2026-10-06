/**
 * Inbound webhooks for Meta channels (Instagram / Messenger).
 *   GET  /webhooks/:channel/:slug   -> verification handshake
 *   POST /webhooks/:channel/:slug   -> message events
 * Requires a PUBLIC HTTPS URL registered in the Meta app (won't fire on localhost).
 */
const express = require('express');
const { Tenant } = require('../db');
const meta = require('../channels/meta');

const router = express.Router();

router.get('/:channel/:slug', async (req, res) => {
  const t = await Tenant.findOne({ slug: req.params.slug });
  const conf = t && t.channels && t.channels[req.params.channel] && t.channels[req.params.channel].config;
  const verifyToken = (conf && conf.verifyToken) || ('verify_' + req.params.slug);
  const challenge = meta.verifyWebhook(req.query, verifyToken);
  if (challenge) return res.status(200).send(challenge);
  res.sendStatus(403);
});

router.post('/:channel/:slug', async (req, res) => {
  try {
    await meta.handleWebhook(req.params.slug, req.params.channel, req.body || {});
  } catch (e) { console.error('webhook error:', e.message); }
  res.sendStatus(200);
});

module.exports = router;
