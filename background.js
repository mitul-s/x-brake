// x-brake background: proxies AI Gateway calls so page CORS never blocks them
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'classify') return;
  fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + msg.key },
    body: JSON.stringify(msg.body)
  })
    .then(async r => sendResponse({ ok: r.ok, status: r.status, j: await r.json().catch(() => null) }))
    .catch(e => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});
