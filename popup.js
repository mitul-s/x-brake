const input = document.getElementById('limit');
const status = document.getElementById('status');

(async () => {
  const { xbrake } = await chrome.storage.local.get('xbrake');
  if (xbrake && xbrake.limitMin) input.value = xbrake.limitMin;
})();

document.getElementById('save').onclick = async () => {
  const v = Math.max(1, Math.min(480, parseInt(input.value, 10) || 30));
  const { xbrake } = await chrome.storage.local.get('xbrake');
  await chrome.storage.local.set({ xbrake: { ...(xbrake || {}), limitMin: v } });
  status.textContent = `Saved. New budget: ${v} min/day (applies on next page load).`;
};
