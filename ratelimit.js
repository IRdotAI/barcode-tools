/**
 * RdotA Rate Limiter — server-side tamper-proof generation tracking
 * Uses Supabase `generations` table with RLS (no client DELETE/UPDATE).
 * Server timestamps only — device clock & VPN changes are irrelevant.
 */
(function () {
  'use strict';

  var FREE_LIMIT = 5;

  /* ── iOS 26-style notification banner ── */
  function injectStyles() {
    if (document.getElementById('rdota-ratelimit-css')) return;
    var style = document.createElement('style');
    style.id = 'rdota-ratelimit-css';
    style.textContent = [
      '.rl-overlay{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.4);opacity:0;transition:opacity .3s ease;pointer-events:none;}',
      '.rl-overlay.visible{opacity:1;pointer-events:auto;}',

      '.rl-banner{position:fixed;top:0;left:0;right:0;z-index:99999;',
      'padding:calc(env(safe-area-inset-top,50px) + 12px) 16px 16px;',
      'background:rgba(30,30,32,0.92);',
      '-webkit-backdrop-filter:saturate(180%) blur(40px);',
      'backdrop-filter:saturate(180%) blur(40px);',
      'border-bottom:0.5px solid rgba(84,84,88,0.34);',
      'transform:translateY(-100%);transition:transform .38s cubic-bezier(.32,.72,0,1);',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;}',

      '.rl-banner.visible{transform:translateY(0);}',

      '.rl-banner-inner{display:flex;align-items:flex-start;gap:12px;max-width:500px;margin:0 auto;}',

      '.rl-icon{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#ff453a 0%,#ff6961 100%);',
      'display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
      '.rl-icon svg{width:22px;height:22px;}',

      '.rl-body{flex:1;min-width:0;}',
      '.rl-app{font-size:13px;font-weight:600;color:rgba(235,235,245,0.6);margin-bottom:2px;text-transform:uppercase;letter-spacing:0.4px;}',
      '.rl-title{font-size:15px;font-weight:600;color:#fff;margin-bottom:3px;}',
      '.rl-msg{font-size:13px;color:rgba(235,235,245,0.6);line-height:1.35;}',
      '.rl-timer{font-size:12px;font-weight:500;color:#ff9f0a;margin-top:6px;font-variant-numeric:tabular-nums;}',

      '.rl-actions{display:flex;gap:8px;margin-top:12px;max-width:500px;margin-left:auto;margin-right:auto;}',
      '.rl-btn{flex:1;padding:12px;border-radius:12px;border:none;font-size:15px;font-weight:600;',
      'font-family:inherit;cursor:pointer;transition:transform .12s ease,opacity .12s ease;}',
      '.rl-btn:active{transform:scale(0.97);opacity:0.8;}',
      '.rl-btn-dismiss{background:rgba(44,44,46,0.8);color:#fff;}',
      '.rl-btn-premium{background:linear-gradient(135deg,#6c5ce7 0%,#a78bfa 100%);color:#fff;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildBanner() {
    if (document.getElementById('rl-banner')) return;

    var overlay = document.createElement('div');
    overlay.className = 'rl-overlay';
    overlay.id = 'rl-overlay';

    var banner = document.createElement('div');
    banner.className = 'rl-banner';
    banner.id = 'rl-banner';
    banner.innerHTML = [
      '<div class="rl-banner-inner">',
      '  <div class="rl-icon"><svg fill="none" viewBox="0 0 24 24" stroke="#fff" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>',
      '  <div class="rl-body">',
      '    <div class="rl-app">RdotA Generators</div>',
      '    <div class="rl-title">Daily limit reached</div>',
      '    <div class="rl-msg">You\'ve used all <strong>5 free generations</strong> for today. Upgrade to Premium for unlimited generations.</div>',
      '    <div class="rl-timer" id="rl-timer"></div>',
      '  </div>',
      '</div>',
      '<div class="rl-actions">',
      '  <button class="rl-btn rl-btn-dismiss" id="rl-dismiss">Dismiss</button>',
      '  <button class="rl-btn rl-btn-premium" id="rl-upgrade">Go Premium</button>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);
    document.body.appendChild(banner);

    document.getElementById('rl-dismiss').addEventListener('click', hideBanner);
    overlay.addEventListener('click', hideBanner);
    document.getElementById('rl-upgrade').addEventListener('click', function () {
      hideBanner();
      /* TODO: wire to payment page */
      window.location.href = 'profile.html';
    });
  }

  var countdownInterval = null;

  function showBanner(resetTimeISO) {
    buildBanner();
    var overlay = document.getElementById('rl-overlay');
    var banner = document.getElementById('rl-banner');

    /* Force reflow then animate in */
    overlay.offsetHeight;
    overlay.classList.add('visible');
    banner.classList.add('visible');

    /* Start countdown to reset */
    if (countdownInterval) clearInterval(countdownInterval);
    var timerEl = document.getElementById('rl-timer');

    function tick() {
      var now = Date.now();
      var resetMs = new Date(resetTimeISO).getTime();
      var diff = resetMs - now;
      if (diff <= 0) {
        timerEl.textContent = 'Limit resets now — try again!';
        clearInterval(countdownInterval);
        return;
      }
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      timerEl.textContent = 'Resets in ' +
        (h > 0 ? h + 'h ' : '') +
        (m > 0 ? m + 'm ' : '') +
        s + 's';
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function hideBanner() {
    var overlay = document.getElementById('rl-overlay');
    var banner = document.getElementById('rl-banner');
    if (overlay) overlay.classList.remove('visible');
    if (banner) banner.classList.remove('visible');
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  /* ── Supabase queries ── */

  /**
   * Check how many generations the user has today (server time).
   * Returns { allowed: bool, used: number, resetAt: ISO string }
   */
  async function checkLimit(sb) {
    var session = (await sb.auth.getSession()).data.session;
    if (!session) return { allowed: true, used: 0, resetAt: null }; /* not logged in — let page handle */

    /* Ask Supabase for server time + today's count in one RPC, fallback to query */
    var userId = session.user.id;

    var { data, error } = await sb.rpc('get_generation_count', { p_user_id: userId });

    if (error || data === null || data === undefined) {
      /* RPC not set up yet — fallback to direct query */
      var { data: rows, error: qErr } = await sb
        .from('generations')
        .select('created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 86400000).toISOString())
        .order('created_at', { ascending: true });

      if (qErr || !rows) return { allowed: true, used: 0, resetAt: null }; /* fail open on error */

      /* Filter to only last 24h using server timestamps from response */
      var used = rows.length;
      var resetAt = null;
      if (used > 0) {
        var oldest = new Date(rows[0].created_at);
        resetAt = new Date(oldest.getTime() + 86400000).toISOString();
      }
      return { allowed: used < FREE_LIMIT, used: used, resetAt: resetAt };
    }

    /* RPC returns { count, oldest_at, server_now } */
    var used = data.count || 0;
    var resetAt = null;
    if (data.oldest_at) {
      resetAt = new Date(new Date(data.oldest_at).getTime() + 86400000).toISOString();
    }
    return { allowed: used < FREE_LIMIT, used: used, resetAt: resetAt };
  }

  /**
   * Log a successful generation (INSERT — server sets created_at via default now()).
   */
  async function logGeneration(sb, generatorType) {
    try {
      var session = (await sb.auth.getSession()).data.session;
      if (!session) return;

      await sb.from('generations').insert({
        user_id: session.user.id,
        generator_type: generatorType || 'unknown'
      });
    } catch (e) {
      console.warn('Failed to log generation:', e);
    }
  }

  /**
   * Gate function — call BEFORE generating. Returns true if allowed, shows banner if not.
   * Has a 1.5s hard timeout — if the server doesn't respond fast, just allow it.
   */
  function canGenerate(sb) {
    return Promise.race([
      _canGenerateInner(sb),
      new Promise(function(resolve) { setTimeout(function() { resolve(true); }, 1500); })
    ]).catch(function() { return true; });
  }

  async function _canGenerateInner(sb) {
    try {
      injectStyles();

      var session = (await sb.auth.getSession()).data.session;
      if (!session) return true;

      /* Check if premium (stored in user metadata) */
      var meta = session.user.user_metadata || {};
      if (meta.premium === true || meta.tier === 'premium') return true;

      var result = await checkLimit(sb);
      if (result.allowed) return true;

      showBanner(result.resetAt);
      return false;
    } catch (e) {
      console.warn('Rate limit check failed, allowing generation:', e);
      return true;
    }
  }

  /* ── Public API ── */
  window.RdotaRateLimit = {
    canGenerate: canGenerate,
    logGeneration: logGeneration,
    FREE_LIMIT: FREE_LIMIT
  };

})();
