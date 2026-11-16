const input = document.getElementById('limit');
const status = document.getElementById('status');

const gkey = document.getElementById('gkey');

(async () => {
  const { xbrake } = await chrome.storage.local.get('xbrake');
  if (xbrake && xbrake.limitMin) input.value = xbrake.limitMin;
  if (xbrake && xbrake.gatewayKey) gkey.value = xbrake.gatewayKey;
})();

document.getElementById('save').onclick = async () => {
  const v = Math.max(1, Math.min(480, parseInt(input.value, 10) || 30));
  const { xbrake } = await chrome.storage.local.get('xbrake');
  await chrome.storage.local.set({ xbrake: { ...(xbrake || {}), limitMin: v, gatewayKey: gkey.value.trim() } });
  status.textContent = `Saved. New budget: ${v} min/day (applies on next page load).`;
};
