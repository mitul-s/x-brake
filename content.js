/* x-brake — daily time brake for X and YouTube */
(() => {
  if (window.__xbrake) return; // already running
  window.__xbrake = true;

  const SITE = /youtube/.test(location.hostname) ? 'youtube' : 'x';
  const SITE_NAME = SITE === 'x' ? 'X' : 'YouTube';
  const STORE_KEY = 'xbrake:' + SITE; // separate budget per site
  const BUDGET_ENABLED = SITE === 'x'; // YouTube long-form is allowed; Shorts/curfew/grayscale still apply
  const DAY = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const DEFAULT_LIMIT_MIN = 10;
  const GRANT_MIN = 5;         // minutes granted per hold-to-continue
  const MAX_GRANTS = 3;        // per day
  const HOLD_LADDER = [3000, 10000, 30000]; // escalating hold per extension (ms)
  const CURFEW_START = 7;      // hard block from 7am...
  const CURFEW_END = 12;       // ...until noon, no buy-ins
  const GRAY_START = 0.5;      // grayscale from 12:30am...
  const GRAY_END = 7;          // ...until 7am

  // ---- storage ----
  // localStorage is shared across x.com tabs, survives reloads, and is readable
  // from both the content-script and page worlds. chrome.storage is only used to
  // receive the daily limit set in the extension popup.
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } };
  const lsSet = (v) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch {} };

  let state; // { date, usedSec, grants, limitMin }

  async function load() {
    const s = lsGet();
    if (s.date !== DAY) {
      state = { date: DAY, usedSec: 0, grants: 0, posts: 0, slopSec: 0, limitMin: s.limitMin || DEFAULT_LIMIT_MIN };
    } else {
      state = { limitMin: DEFAULT_LIMIT_MIN, usedSec: 0, grants: 0, posts: 0, slopSec: 0, ...s };
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const o = await chrome.storage.local.get('xbrake');
        if (o.xbrake && o.xbrake.limitMin) { state.limitMin = o.xbrake.limitMin; lsSet(state); }
      }
    } catch {}
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => lsSet(state), 250);
  }
  window.addEventListener('beforeunload', () => lsSet(state));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lsSet(state); });

  // ---- pill UI ----
  const css = `
    #xbrake-pill{position:fixed;right:16px;bottom:16px;z-index:999998;
      font:500 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      background:rgba(20,20,22,.92);color:#e7e9ea;border:1px solid rgba(255,255,255,.12);
      padding:9px 14px;border-radius:999px;backdrop-filter:blur(8px);
      box-shadow:0 4px 16px rgba(0,0,0,.4);user-select:none;cursor:default;
      transition:color .3s,border-color .3s}
    #xbrake-pill.warn{color:#ffb224;border-color:rgba(255,178,36,.4)}
    #xbrake-pill.over{color:#f4212e;border-color:rgba(244,33,46,.5)}
    #xbrake-overlay{position:fixed;inset:0;z-index:999999;display:flex;
      align-items:center;justify-content:center;flex-direction:column;gap:18px;
      background:rgba(0,0,0,.72);backdrop-filter:blur(18px);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e7e9ea;
      text-align:center;padding:24px}
    #xbrake-overlay h1{font-size:26px;font-weight:700;margin:0}
    #xbrake-overlay p{font-size:15px;color:#9ba0a5;max-width:420px;margin:0;line-height:1.5}
    #xbrake-hold{position:relative;overflow:hidden;margin-top:8px;
      font:600 15px/1 inherit;color:#e7e9ea;background:transparent;
      border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:14px 28px;cursor:pointer}
    #xbrake-hold .fill{position:absolute;inset:0;background:rgba(255,255,255,.18);
      transform:scaleX(0);transform-origin:left;pointer-events:none}
    #xbrake-hold span{position:relative}
    #xbrake-done{background:transparent;border:none;color:#71767b;font-size:13px;
      text-decoration:underline;cursor:pointer}
    #xbrake-nudge{position:fixed;inset:0;z-index:999997;display:flex;
      align-items:center;justify-content:center;flex-direction:column;gap:14px;
      background:rgba(0,0,0,.6);backdrop-filter:blur(14px);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e7e9ea;
      text-align:center;padding:24px}
    #xbrake-nudge h2{font-size:34px;font-weight:700;margin:0}
    #xbrake-nudge p{font-size:15px;color:#9ba0a5;margin:0;line-height:1.5}
    #xbrake-nudge button{margin-top:10px;font:600 15px/1 inherit;color:#000;background:#e7e9ea;
      border:none;border-radius:999px;padding:14px 28px;cursor:pointer}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const pill = document.createElement('div');
  pill.id = 'xbrake-pill';
  document.body.appendChild(pill);

  let overlay = null;
  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function remaining() {
    return Math.max(0, state.limitMin * 60 + state.grants * GRANT_MIN * 60 - state.usedSec);
  }

  function render() {
    if (!BUDGET_ENABLED) {
      // YouTube: no time budget, just a slop-allowance indicator
      const slopLeft = Math.max(0, (SLOP_LIMIT_MIN + state.grants * GRANT_MIN) * 60 - (state.slopSec || 0));
      pill.textContent = `${fmt(slopLeft)} slop left`;
      pill.className = slopLeft <= 0 ? 'over' : slopLeft <= 300 ? 'warn' : '';
      return;
    }
    const r = remaining();
    pill.textContent = r > 0
      ? `${fmt(r)} left · ${state.posts || 0} scrolled`
      : `over budget (+${state.grants}/${MAX_GRANTS} extensions)`;
    pill.className = r <= 0 ? 'over' : r <= 300 ? 'warn' : '';
    if (r <= 0 && !overlay && !inCurfew()) showOverlay();
    if (r > 0 && overlay) hideOverlay();
  }

  function showOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'xbrake-overlay';
    const canGrant = state.grants < MAX_GRANTS;
    const holdMs = HOLD_LADDER[Math.min(state.grants, HOLD_LADDER.length - 1)];
    const slopMode = SITE === 'youtube';
    overlay.innerHTML = `
      <h1>${slopMode ? "That's your slop for today." : `That's your ${SITE_NAME} time for today.`}</h1>
      <p>${slopMode
        ? `${SLOP_LIMIT_MIN} min of attention-engineered content is the daily allowance.
           Close the tab, or hold the button for ${holdMs / 1000}s to buy ${GRANT_MIN} more slop minutes
           (${MAX_GRANTS - state.grants} left today).`
        : `You set a ${state.limitMin}-minute daily budget and you've used it.
           Close the tab, or hold the button for ${holdMs / 1000}s to buy ${GRANT_MIN} more minutes
           (${MAX_GRANTS - state.grants} left today).`}</p>
      ${canGrant ? `<button id="xbrake-hold"><div class="fill"></div><span>Hold for ${GRANT_MIN} more minutes</span></button>` : ''}
      <button id="xbrake-done">I'm done here — close the tab</button>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#xbrake-done').onclick = () => {
      overlay.querySelector('p').textContent = 'Nice. Use Cmd+W — future you says thanks.';
    };

    const btn = overlay.querySelector('#xbrake-hold');
    if (btn) {
      const fill = btn.querySelector('.fill');
      let start = 0, raf = 0;
      const tick = (t) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / holdMs);
        fill.style.transform = `scaleX(${p})`;
        if (p >= 1) {
          state.grants++; save(); hideOverlay(); render();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      const begin = (e) => { e.preventDefault(); start = 0; raf = requestAnimationFrame(tick); };
      const cancel = () => { cancelAnimationFrame(raf); start = 0; fill.style.transform = 'scaleX(0)'; };
      btn.addEventListener('pointerdown', begin);
      btn.addEventListener('pointerup', cancel);
      btn.addEventListener('pointerleave', cancel);
    }
  }
  function hideOverlay() { overlay?.remove(); overlay = null; }

  // ---- curfew + grayscale ----
  function hoursNow() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  function inWindow(h, a, b) { return a < b ? (h >= a && h < b) : (h >= a || h < b); }
  function inCurfew() { return inWindow(hoursNow(), CURFEW_START, CURFEW_END); }
  function inGray() { return inWindow(hoursNow(), GRAY_START, GRAY_END); }
  let curfewEl = null, shortsEl = null;
  function applyMode() {
    document.documentElement.style.filter = inGray() ? 'grayscale(1)' : '';
    // Shorts are the pit: hard block, no exceptions
    const onShorts = SITE === 'youtube' && location.pathname.startsWith('/shorts');
    if (onShorts && !shortsEl) {
      shortsEl = document.createElement('div');
      shortsEl.id = 'xbrake-overlay';
      shortsEl.innerHTML = `<h1>Nope. Shorts are the pit.</h1><p>Nothing good has ever come from this page.</p>`;
      const back = document.createElement('button');
      back.id = 'xbrake-done';
      back.textContent = 'Take me back';
      back.onclick = () => history.back();
      shortsEl.appendChild(back);
      document.body.appendChild(shortsEl);
    } else if (!onShorts && shortsEl) {
      shortsEl.remove();
      shortsEl = null;
    }
    if (SITE === 'x' && inCurfew() && !curfewEl) {
      curfewEl = document.createElement('div');
      curfewEl.id = 'xbrake-overlay';
      curfewEl.innerHTML = `<h1>No socials in the morning.</h1><p>Blocked until noon. Go make something.</p>`;
      document.body.appendChild(curfewEl);
    } else if (!inCurfew() && curfewEl) {
      curfewEl.remove();
      curfewEl = null;
    }
  }

  // ---- scroll-depth nudge: count tweets scrolled past, interrupt every NUDGE_EVERY ----
  const NUDGE_EVERY = 25;
  const seen = new WeakSet();
  function showNudge() {
    if (overlay || document.getElementById('xbrake-nudge')) return;
    const mins = Math.floor(state.usedSec / 60);
    const n = document.createElement('div');
    n.id = 'xbrake-nudge';
    const h = document.createElement('h2');
    h.textContent = `${state.posts} ${SITE === 'x' ? 'posts' : 'videos'} deep.`;
    const p = document.createElement('p');
    p.textContent = `${mins} min gone. Still here on purpose?`;
    const btn = document.createElement('button');
    btn.textContent = 'Yep, keep scrolling';
    btn.onclick = () => n.remove();
    n.appendChild(h);
    n.appendChild(p);
    n.appendChild(btn);
    document.body.appendChild(n);
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !seen.has(e.target)) {
        seen.add(e.target);
        // dedupe by tweet URL so re-scrolling or refreshing doesn't re-count
        const link = e.target.querySelector('a[href*="/status/"], a[href*="/watch"], a[href*="/shorts/"]');
        const id = link ? link.href : null;
        state.seenIds = state.seenIds || {};
        if (id && state.seenIds[id]) return;
        if (id) {
          state.seenIds[id] = 1;
          if (Object.keys(state.seenIds).length > 2000) state.seenIds = {};
        }
        state.posts = (state.posts || 0) + 1;
        save();
        if (state.posts - (state.lastNudgeAt || 0) >= NUDGE_EVERY && (!BUDGET_ENABLED || remaining() > 0)) {
          state.lastNudgeAt = state.posts;
          save();
          showNudge();
        }
      }
    }
  }, { threshold: 0.6 });
  const ITEM_SELECTOR = SITE === 'x'
    ? 'article[data-testid="tweet"]'
    : 'ytd-rich-item-renderer, ytd-video-renderer, ytd-reel-video-renderer, ytd-compact-video-renderer';
  if (BUDGET_ENABLED) {
    const watchTweets = () => document.querySelectorAll(ITEM_SELECTOR).forEach((el) => io.observe(el));
    new MutationObserver(watchTweets).observe(document.body, { childList: true, subtree: true });
    watchTweets();
  }

  // ---- AI slop judge (YouTube watch pages) ----
  // Channels are classified once via Vercel AI Gateway and cached forever.
  // Slop channels get a shared daily budget; everything else is unrestricted.
  const SLOP_CHANNELS = ['mrbeast', 'airrack', 'ryan trahan', 'udy', 'nectar']; // manual overrides, lowercase
  const SLOP_LIMIT_MIN = 20;
  const slopCacheGet = () => { try { return JSON.parse(localStorage.getItem('xbrake:slopCache') || '{}'); } catch { return {}; } };
  const slopCacheSet = (v) => { try { localStorage.setItem('xbrake:slopCache', JSON.stringify(v)); } catch {} };
  let gatewayKey = null, slopChannel = false, classifying = false;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('xbrake').then(o => { gatewayKey = (o.xbrake && o.xbrake.gatewayKey) || null; });
    }
  } catch {}
  async function classifyChannel(name, title) {
    const key = name.toLowerCase();
    const cache = slopCacheGet();
    if (key in cache) return cache[key];
    if (SLOP_CHANNELS.some(s => key.includes(s))) { cache[key] = true; slopCacheSet(cache); return true; }
    if (!gatewayKey || classifying) return false; // free pass while unknown
    classifying = true;
    try {
      const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + gatewayKey },
        body: JSON.stringify({
          model: 'openai/gpt-4.1-nano',
          messages: [{ role: 'user', content:
            'Classify this YouTube channel as SLOP or OK. SLOP = attention-engineered brainrot: challenge/stunt videos, giveaways, sensationalism, retention hacking. OK = educational, documentary, music, cooking, craft, video essays, substance. Examples SLOP: MrBeast, Airrack, Ryan Trahan. Examples OK: Anthony Bourdain, NYT Cooking, lofi mixes. Reply with one word only.\nChannel: ' + name + '\nVideo: ' + title }],
          max_tokens: 4
        })
      });
      const j = await res.json();
      const verdict = /slop/i.test((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
      cache[key] = verdict; slopCacheSet(cache);
      return verdict;
    } catch { return false; } // fail open
    finally { classifying = false; }
  }
  function slopActive() { return (state.slopSec || 0) >= (SLOP_LIMIT_MIN + state.grants * GRANT_MIN) * 60; }
  function tickYouTube() {
    if (SITE !== 'youtube') return;
    if (location.pathname === '/watch') {
      const ch = [...document.querySelectorAll('ytd-channel-name a, #channel-name a, ytd-video-owner-renderer a')].find(a => a.textContent.trim());
      const name = ch ? ch.textContent.trim() : '';
      if (name) {
        classifyChannel(name, document.title).then(v => { slopChannel = v; });
        if (slopChannel && document.visibilityState === 'visible') {
          state.slopSec = (state.slopSec || 0) + 1;
          save();
        }
      }
    }
    if (slopActive() && !overlay) showOverlay();
  }

  // ---- timer: only counts while tab is visible AND focused ----
  function active() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  (async () => {
    await load();
    render();
    setInterval(() => {
      if (active()) { state.usedSec++; save(); }
      render();
      applyMode();
      tickYouTube();
    }, 1000);
    applyMode();
  })();
})();
