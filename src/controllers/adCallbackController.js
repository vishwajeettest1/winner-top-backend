// Server-to-server callbacks from ad networks. These are the ONLY legitimate
// source of ad-network revenue figures. Never trust a client-submitted
// revenue number for an ad_network-sourced view.
//
// This is a scaffold: each ad network has its own SSV signature scheme
// (AdMob uses a query-string signature verified against its published public
// key; Unity Ads uses an HMAC with your configured shared secret). Wire up
// the real verification per each network's docs before going live.

const crypto = require('crypto');

function verifyUnityAdsSignature(req) {
  const secret = process.env.UNITY_ADS_SSV_SHARED_SECRET;
  const receivedSig = req.headers['x-unity-ads-signature'];
  if (!secret || !receivedSig) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig || ''));
}

async function admobSsv(req, res) {
  // TODO: verify AdMob's SSV query-string signature against Google's
  // published public key (see AdMob SSV documentation) before trusting
  // ad_network_reward_amount / ad_network_reward_item.
  // On success, persist a pending revenue record keyed by the reward token,
  // which videoController.completeVideo() then looks up instead of trusting
  // the client.
  return res.status(501).json({ error: 'AdMob SSV verification not yet implemented' });
}

async function unityAdsSsv(req, res) {
  if (!verifyUnityAdsSignature(req)) {
    return res.status(401).json({ error: 'Invalid Unity Ads SSV signature' });
  }
  // TODO: persist the verified revenue record keyed by reward token.
  return res.status(501).json({ error: 'Unity Ads SSV persistence not yet implemented' });
}

module.exports = { admobSsv, unityAdsSsv };
