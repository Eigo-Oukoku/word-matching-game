/* =========================================================================
 * NinjaUI — drop-in UI module for the Ninja-family games
 * -------------------------------------------------------------------------
 * Pairs with NinjaCore. Provides:
 *   • Shadow Clone Scroll modal     (NinjaUI.openScroll())
 *   • Analysis Scroll modal/screen  (NinjaUI.openAnalysis(catalogs))
 *   • Character Maker picker        (NinjaUI.openDesignPicker())
 *   • Name lock modal               (NinjaUI.openNameModal())
 *   • Profile chip / status badge   (NinjaUI.statusBadgeHTML())
 *
 * All UI strings are kept in Japanese as per the original eigo-ninja design.
 *
 * The modal CSS is injected once on first call. Modals overlay the host
 * game without touching its layout, so this module is pure additive.
 * ========================================================================= */

(function (global) {
  'use strict';

  if (!global.Ninja) { console.warn('[NinjaUI] requires NinjaCore (window.Ninja) to be loaded first'); return; }
  var N = global.Ninja;

  // ───────────────────────────────────────────────────────────────────────
  // Shared CSS — injected once. Mirrors eigo-ninja's `.overlay` /
  // `.modal-box` styling so the modal renders as a centred popup with a
  // dim backdrop (NOT as page-bottom content scrollable inline). Scoped
  // under `.ninja-ui-*` so it cannot collide with the host game's CSS.
  // ───────────────────────────────────────────────────────────────────────
  var STYLE_ID = 'ninja-ui-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      // ── pop-in animation (matches eigo-ninja's @keyframes popIn) ──
      '@keyframes ninjaUiPopIn{0%{transform:scale(0.78);opacity:0}70%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}',
      // ── backdrop overlay: full-viewport, fixed, centred. Use both
      //    `inset:0` and explicit top/left/right/bottom so older mobile
      //    Safari (which treats inset poorly) still pins the overlay. ──
      // Use Nunito (loaded by host games) as the default font for all
      // NinjaUI overlays — matches eigo-ninja's body typography.
      '.ninja-ui-overlay{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;inset:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:flex-start;justify-content:center;z-index:100000;padding:max(4vh,16px) 14px;font-family:"Nunito","Helvetica Neue",Arial,sans-serif;-webkit-overflow-scrolling:touch;overflow-y:auto;}',
      // ── modal box: matches eigo-ninja's .modal-box dimensions, with
      //    a max-height + internal scroll so long content (the design
      //    grid, the scroll modal) NEVER pushes content past viewport. ──
      '.ninja-ui-modal{position:relative;background:#fff;border-radius:22px;padding:22px 18px;max-width:420px;width:100%;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:0 16px 48px rgba(0,0,0,0.3);color:#2b2d42;animation:ninjaUiPopIn 0.25s ease;}',
      '.ninja-ui-title{font-size:22px;font-weight:900;text-align:center;margin-bottom:10px;color:#4C1D95;letter-spacing:0.5px;}',
      '.ninja-ui-top-close{position:absolute;top:10px;right:12px;width:32px;height:32px;border:none;background:rgba(0,0,0,0.07);border-radius:50%;font-size:17px;line-height:32px;text-align:center;cursor:pointer;color:#555;font-weight:900;padding:0;z-index:1;}',
      '.ninja-ui-top-close:active{background:rgba(0,0,0,0.15);}',
      '.ninja-ui-close{display:block;width:100%;margin-top:12px;padding:13px;font-size:14px;font-weight:900;border:none;border-radius:12px;background:#eee;color:#333;cursor:pointer;}',
      '.ninja-ui-close:active{transform:translateY(1px);}',
      '.ninja-ui-btn{display:block;width:100%;padding:12px;font-size:14px;font-weight:900;border:none;border-radius:12px;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,0.18);transition:0.1s;}',
      '.ninja-ui-btn:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,0.18);}',
      '.ninja-ui-btn.primary{background:#7C3AED;color:#fff;box-shadow:0 3px 0 #5B21B6;}',
      '.ninja-ui-btn.retry{background:#FFB000;color:#fff;box-shadow:0 3px 0 #b07a00;}',
      '.ninja-ui-btn.danger{background:#FFE5E7;color:#E63946;border:2px solid #E63946;box-shadow:0 3px 0 #a02030;}',
      '.ninja-ui-ta{width:100%;min-height:90px;padding:10px;font-family:monospace;font-size:11px;border:2px solid #ddd;border-radius:10px;resize:vertical;color:#333;background:#f8f8f5;box-sizing:border-box;}',
      '.ninja-ui-ta[readonly]{background:#f3f1ec;}',
      '.ninja-ui-input{flex:1;padding:11px 12px;font-size:15px;font-weight:800;border:2px solid #ddd;border-radius:12px;outline:none;color:#2b2d42;box-sizing:border-box;}',
      '.ninja-ui-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2b2d42;color:#fff;padding:10px 18px;border-radius:24px;font-weight:800;font-size:13px;z-index:100001;box-shadow:0 6px 16px rgba(0,0,0,0.3);animation:ninjaUiPopIn 0.2s ease;}',
      '.ninja-ui-row{display:flex;gap:8px;margin-bottom:6px;align-items:center;}',
      // ── Status card (matches eigo-ninja's home profile card style) ──
      // Bigger card with internal padding, drop-shadow accent, and a row
      // for the avatar + identity text. The XP progress bar + meta row
      // live below the main row.
      // Card padding mirrors eigo-ninja's `padding:18px 18px 16px` so the
      // bottom edge matches when the XP bar / meta rows are present.
      '.ninja-ui-card{background:linear-gradient(135deg,#4C1D95,#7C3AED);color:#fff;border-radius:22px;padding:18px 18px 16px;box-shadow:0 6px 0 #5B21B6;}',
      '.ninja-ui-card-row{display:flex;gap:14px;align-items:center;}',
      // ── Status-card avatar: fixed 120×120 box (matches eigo-ninja
      //    home profile card byte-for-byte) with consistent inner image
      //    sizing across all 14 ninja designs. ──
      '.ninja-ui-avatar{width:120px;height:120px;flex:0 0 120px;background:rgba(255,255,255,0.18);border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;border:3px solid rgba(255,255,255,0.35);}',
      '.ninja-ui-avatar img{width:100%;height:100%;object-fit:contain;display:block;}',
      // Compact variant for in-modal usage where space is tight.
      '.ninja-ui-avatar.compact{width:80px;height:80px;flex:0 0 80px;border-width:2px;}',
      // ── XP progress bar ──
      '.ninja-ui-xpbar{margin-top:12px;height:10px;background:rgba(255,255,255,0.18);border-radius:999px;overflow:hidden;}',
      '.ninja-ui-xpfill{height:100%;background:linear-gradient(90deg,#FFD54F,#FFB000);transition:width 0.5s;}',
      '.ninja-ui-meta{display:flex;justify-content:space-between;font-size:12px;font-weight:700;opacity:0.92;margin-top:6px;gap:8px;}',
      '.ninja-ui-table{width:100%;border-collapse:collapse;font-size:12px;}',
      '.ninja-ui-table th,.ninja-ui-table td{padding:6px 4px;border-bottom:1px solid #eee;text-align:left;}',
      '.ninja-ui-table th{background:#f8f8f5;font-weight:900;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;}',
      '.ninja-ui-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
      '.ninja-ui-pickcard{border:3px solid #eee;border-radius:18px;padding:14px 10px;text-align:center;cursor:pointer;background:#fff;transition:0.1s;box-shadow:0 3px 0 #eee;}',
      '.ninja-ui-pickcard:active{transform:translateY(2px);box-shadow:0 1px 0 #ddd;}',
      '.ninja-ui-pickcard.selected{border-color:#7C3AED;background:#F3E8FF;box-shadow:0 4px 0 #7C3AED;}',
      '.ninja-ui-pickcard.unlocked{border-color:#dee2e6;}',
      '.ninja-ui-pickcard.starter{border-color:#FFD54F;background:#FFFDE7;box-shadow:0 4px 0 #FFD54F;}',
      '.ninja-ui-pickcard.token{border-color:#A78BFA;background:#F3E8FF;box-shadow:0 4px 0 #A78BFA;}',
      '.ninja-ui-pickcard.locked{border-color:#eee;opacity:0.5;cursor:not-allowed;box-shadow:none;}',
      // ── Pick image: fixed 110×110 round frame, image fills container.
      //    `width:100%;height:100%;object-fit:contain` guarantees every
      //    avatar renders at the same visual size regardless of the
      //    underlying PNG's intrinsic dimensions. ──
      '.ninja-ui-pickimg{width:110px;height:110px;margin:0 auto 6px;background:#f8f8f5;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;}',
      '.ninja-ui-pickimg img{width:100%;height:100%;object-fit:contain;display:block;}',
      '.ninja-ui-banner{border-radius:12px;padding:9px 12px;text-align:center;font-size:12px;font-weight:800;line-height:1.5;margin-bottom:14px;}',
      // ── Clan carousel ──
      '.ninja-ui-carousel{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:4px 2px 10px;}',
      '.ninja-ui-carousel::-webkit-scrollbar{height:4px;}',
      '.ninja-ui-carousel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.3);border-radius:999px;}',
      '.ninja-ui-member-card{flex:0 0 168px;scroll-snap-align:start;background:linear-gradient(135deg,#4C1D95,#7C3AED);color:#fff;border-radius:18px;padding:13px 12px 11px;cursor:pointer;transition:0.15s;border:3px solid transparent;box-shadow:0 4px 0 #5B21B6;}',
      '.ninja-ui-member-card.active{border-color:#FFD54F;box-shadow:0 4px 0 #FFD54F;}',
      '.ninja-ui-member-card.inactive{opacity:0.72;}',
      '.ninja-ui-member-card:active{transform:translateY(2px);}',
      '.ninja-ui-add-card{flex:0 0 80px;scroll-snap-align:start;background:#f3f1ec;border:3px dashed #ccc;border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;min-height:118px;transition:0.15s;color:#999;font-size:11px;font-weight:800;gap:4px;}',
      '.ninja-ui-add-card:active{border-color:#7C3AED;background:#F3E8FF;color:#7C3AED;}',
      // ── Inline XP feedback row (placed by host games right below the
      //    question card). Mirrors eigo-ninja's `.feedback-row`. ──
      '.ninja-xp-feedback{text-align:center;min-height:32px;font-size:21px;font-weight:900;margin:6px 0 4px;line-height:1.25;}',
      '.ninja-xp-fb-ok{color:#0a5c2d;animation:ninjaUiPopIn 0.2s ease;display:inline-block;}',
      '.ninja-xp-fb-bad{color:#E63946;animation:ninjaUiPopIn 0.2s ease;display:inline-block;}',
      '.ninja-xp-fb-ok .xp-amount{color:#7C3AED;font-weight:900;margin-left:6px;}',
      '.ninja-xp-fb-ok .xp-tag{color:#666;font-weight:700;font-size:15px;}',
      // ── Body lock — applied to <body> when an overlay is open so the
      //    background page doesn't scroll behind the modal. ──
      'body.ninja-ui-modal-open{overflow:hidden!important;}',
    ].join('\n');
    document.head.appendChild(s);
  }
  // Body scroll lock helpers — count concurrent overlays so we only
  // unlock when the LAST overlay closes.
  var _overlayCount = 0;
  function lockBodyScroll() {
    _overlayCount++;
    document.body.classList.add('ninja-ui-modal-open');
  }
  function unlockBodyScroll() {
    _overlayCount = Math.max(0, _overlayCount - 1);
    if (_overlayCount === 0) document.body.classList.remove('ninja-ui-modal-open');
  }

  // ───────────────────────────────────────────────────────────────────────
  // helpers
  // ───────────────────────────────────────────────────────────────────────
  function htmlEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }
  function showToast(msg) {
    var t = document.createElement('div');
    t.className = 'ninja-ui-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }

  // _findVisibleFeedback — locate the right `.ninja-xp-feedback` slot.
  //
  // Multiple host games render the slot in DIFFERENT containers (e.g.
  // sentence-ninja has both a normal `#game-area` slot and a separate
  // `#blitz-panel` slot). Only one container is visible at a time, but
  // both elements may be in the DOM simultaneously, which would cause
  // `document.getElementById` to return the wrong one.
  //
  // This helper:
  //   1. Honours an explicit `targetId` if it points at a visible node.
  //   2. Otherwise scans every `.ninja-xp-feedback` element and returns
  //      the first one whose `offsetParent` is non-null (visible).
  //   3. Falls back to the first DOM match (so something always renders
  //      even if visibility detection fails on exotic layouts).
  function _findVisibleFeedback(targetId) {
    if (targetId) {
      var byId = document.getElementById(targetId);
      if (byId && byId.offsetParent !== null) return byId;
    }
    var nodes = document.querySelectorAll('.ninja-xp-feedback');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetParent !== null) return nodes[i]; // first visible wins
    }
    return nodes.length > 0 ? nodes[0] : null;
  }

  // flashAnswerXp — eigo-ninja-parity per-question feedback.
  //
  // Renders something like:
  //   "Nice! 🔥  +5 XP"                        (regular correct)
  //   "Amazing! ⭐  +7 XP · 初成功+2"          (firstTimeCorrect)
  //   "Yes! 💪  +8 XP · 弱点突破！+3"          (recovered → SRS overcame)
  //   "Great! 🌟  +6 XP · 🔥 streak ×4"        (streak bonus)
  //
  // Display location:
  //   1. INLINE (preferred): if the host game has a `#ninja-xp-feedback`
  //      element on screen, the message is injected into it — mirrors
  //      eigo-ninja's `.feedback-row` placement directly under the
  //      question card.
  //   2. TOAST fallback: if no inline target exists, a bottom-of-screen
  //      toast is shown so feedback is never lost.
  //
  // Caller passes:
  //   { gainedXp:        scaled XP just awarded (after Ninja.addExp)
  //     firstTimeCorrect: bool (from recordAnswer return)
  //     recovered:        bool (from recordAnswer return)
  //     streak:           current consecutive-correct count
  //     targetId:         optional — override of '#ninja-xp-feedback' }
  function flashAnswerXp(opts) {
    if (!opts || !opts.gainedXp || opts.gainedXp <= 0) return;
    injectStyles();
    var msgs = ['Great! 🌟', 'Amazing! ⭐', 'Correct! 🎉', 'Nice! 🔥', 'Yes! 💪'];
    var headline = msgs[Math.floor(Math.random() * msgs.length)];
    // Tags are now CONCATENATED so a 3-in-a-row that's also a first-time
    // correct shows BOTH (e.g. "初成功+2 · 🔥 streak ×3"). Previously the
    // if/else-if chain hid the streak tag whenever firstTimeCorrect or
    // recovered were also true — so during normal play (where most words
    // are unseen) the streak tag almost never appeared.
    var tagParts = [];
    if (opts.recovered)               tagParts.push('弱点突破！+3');
    if (opts.firstTimeCorrect)        tagParts.push('初成功+2');
    if ((opts.streak || 0) >= 3)      tagParts.push('🔥 streak ×' + opts.streak);
    var bonusTag = tagParts.length ? ' · ' + tagParts.join(' · ') : '';
    // ── Inline mode ──
    // Pick the FIRST VISIBLE .ninja-xp-feedback element. Multiple games
    // render the slot in different panels (normal play vs Type Blitz
    // panel), so picking only the visible one avoids duplicate-ID
    // ambiguity and keeps the feedback in the right place.
    var inline = _findVisibleFeedback(opts.targetId);
    if (inline) {
      inline.innerHTML = '<span class="ninja-xp-fb-ok">' + headline
        + '<span class="xp-amount">+' + opts.gainedXp + ' XP</span>'
        + '<span class="xp-tag">' + bonusTag + '</span>'
        + '</span>';
      return;
    }
    // ── Toast fallback ──
    var t = document.createElement('div');
    t.className = 'ninja-ui-toast';
    t.innerHTML = headline +
      '&nbsp;&nbsp;<span style="color:#FFD54F;font-weight:900;">+' + opts.gainedXp + ' XP</span>' +
      '<span style="color:#fff;opacity:0.85;font-weight:700;">' + bonusTag + '</span>';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1500);
  }
  // flashStreakBreak — softer feedback when a long streak ends.
  // Only fires when the streak that just broke was ≥ 4. Uses the same
  // inline-then-toast strategy as flashAnswerXp.
  function flashStreakBreak(brokenStreak, opts) {
    if (!brokenStreak || brokenStreak < 4) return;
    injectStyles();
    var inline = _findVisibleFeedback(opts && opts.targetId);
    if (inline) {
      inline.innerHTML = '<span class="ninja-xp-fb-bad">💔 streak ×' + brokenStreak + ' broken</span>';
      return;
    }
    var t = document.createElement('div');
    t.className = 'ninja-ui-toast';
    t.style.background = '#3a2030';
    t.innerHTML = '💔 streak ×' + brokenStreak + ' broken';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1300);
  }
  function openOverlay(innerHTML, opts) {
    injectStyles();
    var ov = document.createElement('div');
    ov.className = 'ninja-ui-overlay';
    ov.innerHTML = '<div class="ninja-ui-modal"><button class="ninja-ui-top-close" onclick="NinjaUI._closeOverlay(this)" aria-label="Close">✕</button>' + innerHTML + '</div>';
    if (!(opts && opts.lockBackdrop)) {
      // Tap on backdrop closes the modal — but never on a tap that
      // started inside the modal box (prevents accidental dismissal
      // when dragging to scroll long content).
      ov.addEventListener('click', function (ev) { if (ev.target === ov) closeOverlay(ov); });
    }
    document.body.appendChild(ov);
    lockBodyScroll();
    return ov;
  }
  function closeOverlay(node) {
    var ov = node && node.classList && node.classList.contains('ninja-ui-overlay')
      ? node
      : (node && node.closest ? node.closest('.ninja-ui-overlay') : null);
    if (ov) {
      ov.remove();
      unlockBodyScroll();
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Profile chip — embed in the host game's home screen
  // ───────────────────────────────────────────────────────────────────────
  // Big home status card. Matches eigo-ninja's home profile card layout:
  //   • 110×110 avatar (uniform across all 14 designs via CSS)
  //   • Big tappable name with 🔒/✏️ indicator
  //   • Lv · XP line
  //   • XP progress bar to next level
  //   • Meta row: words trained / XP needed for next level
  //   • Last trained timestamp
  // No internal "忍者 / NINJA" label — the avatar already conveys identity.
  function statusBadgeHTML() {
    // CRITICAL: host games (index.html / game2.html / spelling-ninja /
    // sentence-ninja) embed this card into their welcome screen via
    // innerHTML at FIRST render — before any NinjaUI overlay/toast has
    // run injectStyles(). Without the styles, .ninja-ui-card and
    // .ninja-ui-avatar have no rules at all, so the inner <img> renders
    // at its natural pixel size, looking like a giant character splash
    // instead of the 120×120 profile chip. Force-inject here so the
    // status card always renders correctly on cold start.
    injectStyles();
    var p = N.progress;
    var avatarFile = N.designSelectedFile();
    var avatarHTML = avatarFile
      ? '<img src="' + htmlEsc(avatarFile) + '" alt="忍者" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<span style=&quot;font-size:14px;font-weight:800;color:#fff;text-align:center;padding:6px;&quot;>Tap to<br>choose</span>\';">'
      : '<span style="font-size:14px;font-weight:800;color:#fff;text-align:center;padding:6px;line-height:1.3;">Tap to<br>choose</span>';
    // XP progress within current level
    var lvl   = p.level;
    var cur   = p.exp;
    var nextE = N.expForLevel(Math.min(N.constants.LEVEL_CAP, lvl + 1));
    var baseE = N.expForLevel(lvl);
    var span  = Math.max(1, nextE - baseE);
    var pctXp = Math.min(100, Math.round(((cur - baseE) / span) * 100));
    var seenCount = 0;
    try {
      var words = N.progress.words || {};
      for (var k in words) { if (words[k] && words[k].seen) seenCount++; }
    } catch (e) {}
    var lastTrained = p.lastTrainedAt ? N.formatTimestamp(p.lastTrainedAt) : '— まだ修行していません';
    var nameMarker  = p.nameLocked
      ? '<span style="font-size:13px;opacity:0.85;font-weight:800;">🔒</span>'
      : '<span style="font-size:13px;opacity:0.85;font-weight:800;">✏️</span>';
    return [
      '<div class="ninja-ui-card" id="ninja-status-card" style="cursor:pointer;" onclick="NinjaUI.openProfile()">',
        '<div class="ninja-ui-card-row">',
          '<div class="ninja-ui-avatar">', avatarHTML, '</div>',
          '<div style="flex:1;min-width:0;">',
            // Name row — Bangers display font matches eigo-ninja's hero
            // typography. NOTE: the host games declare a global
            //   * { font-family: 'Helvetica Neue', ... }
            // selector that BEATS inheritance from the parent div, so
            // the Bangers rule MUST be applied directly to the inner
            // <span> (specificity 1,0,0,0 from inline style) — putting
            // it only on the parent leaves the span rendered in
            // Helvetica Neue.
            '<div style="font-size:30px;letter-spacing:1.5px;line-height:1.05;word-break:break-word;display:flex;align-items:center;gap:8px;">',
              '<span style="font-family:\'Bangers\',cursive;">', htmlEsc(p.name || 'Ninja'), '</span>',
              '<span style="font-family:\'Nunito\',sans-serif;">', nameMarker, '</span>',
            '</div>',
            (p.nameLocked
              ? ''
              : '<div style="font-size:11px;font-weight:700;opacity:0.85;margin-top:3px;">タップして名前を登録 / tap to name</div>'),
            '<div style="font-size:16px;font-weight:900;margin-top:6px;">Lv ', lvl, (lvl >= N.constants.LEVEL_CAP ? ' ★MAX' : ''),
              ' &nbsp;·&nbsp; <span style="font-size:14px;opacity:0.9;">', cur.toLocaleString(), ' XP</span></div>',
          '</div>',
        '</div>',
        // XP progress bar
        '<div class="ninja-ui-xpbar"><div class="ninja-ui-xpfill" style="width:', pctXp, '%;"></div></div>',
        // Meta: words trained / XP-to-next
        '<div class="ninja-ui-meta">',
          '<span>', seenCount, ' 単語修行済 / words trained</span>',
          '<span>', (lvl >= N.constants.LEVEL_CAP ? 'MAX' : (nextE - cur).toLocaleString() + ' XP → Lv ' + (lvl + 1)), '</span>',
        '</div>',
        '<div style="margin-top:5px;font-size:12px;font-weight:700;opacity:0.92;">',
          '⏱ 最後に修行した日時 / Last trained: <span style="opacity:0.95;">', htmlEsc(lastTrained), '</span>',
        '</div>',
        (p.sessionPending && p.lastTrainedAt
          ? '<div style="margin-top:4px;font-size:11px;font-weight:800;color:#E63946;background:rgba(230,57,70,0.1);border-radius:6px;padding:3px 8px;display:inline-block;">⚠️ 修行未完了 / Training not yet completed</div>'
          : ''),
      '</div>'
    ].join('');
  }

  // identityHeaderHTML — compact card for use INSIDE modals (Analysis
  // Scroll, Profile Hub, etc). No big XP bar / metadata since space is
  // already cramped, and the surrounding modal title provides context.
  // The optional `label` param is now ignored (kept for backward compat
  // with existing callers); the card reads the player identity directly.
  function identityHeaderHTML(/*label*/) {
    // Same cold-start risk as statusBadgeHTML — guarantee styles are in.
    injectStyles();
    var p = N.progress;
    var avatarFile = N.designSelectedFile();
    var avatarHTML = avatarFile
      ? '<img src="' + htmlEsc(avatarFile) + '" alt="忍者" onerror="this.style.display=\'none\'">'
      : '<span style="font-size:11px;font-weight:800;color:#fff;text-align:center;">未選択</span>';
    return [
      '<div class="ninja-ui-card" style="margin:6px 0 14px;padding:14px;">',
        '<div class="ninja-ui-card-row">',
          '<div class="ninja-ui-avatar compact">', avatarHTML, '</div>',
          '<div style="flex:1;min-width:0;">',
            // Same anti-`*`-selector pattern as statusBadgeHTML: Bangers
            // applied directly to the inner span containing the name.
            '<div style="font-size:26px;letter-spacing:1px;line-height:1.05;">',
              '<span style="font-family:\'Bangers\',cursive;">', htmlEsc(p.name || 'Ninja'), '</span>',
              (p.nameLocked ? ' <span style="font-family:\'Nunito\',sans-serif;font-size:14px;">🔒</span>' : ''),
            '</div>',
            '<div style="font-size:14px;font-weight:900;margin-top:4px;">Lv ', p.level, ' · ', p.exp.toLocaleString(), ' XP</div>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  // ───────────────────────────────────────────────────────────────────────
  // Profile menu — single tap from home, opens a hub of all NinjaUI features
  // ───────────────────────────────────────────────────────────────────────
  // openProfile — unified hub reachable by tapping the home status card.
  // No "🥷 [gameLabel]" title and no "忍者ステータス / STATUS" sub-label;
  // the embedded identity card already shows who the player is, and the
  // four buttons below speak for themselves.
  function openProfile() {
    // Larger margin between buttons (14px) for easier thumb taps —
    // matches phone-screen ergonomics and prevents accidental
    // mis-taps. Each button is also a hair taller via padding bump.
    var btnGap = 'margin-bottom:14px;padding:14px;font-size:15px;';
    var html = [
      identityHeaderHTML(),
      '<button class="ninja-ui-btn primary" style="' + btnGap + 'background:#A78BFA;box-shadow:0 3px 0 #7C3AED;" onclick="NinjaUI.openDesignPicker()">🎨 忍者デザイン / Change Design</button>',
      '<button class="ninja-ui-btn primary" style="' + btnGap + '" onclick="NinjaUI.openNameModal()">📝 忍者の名前 / Name ' + (N.progress.nameLocked ? '🔒' : '') + '</button>',
      '<button class="ninja-ui-btn primary" style="' + btnGap + 'background:#FFB000;box-shadow:0 3px 0 #b07a00;" onclick="NinjaUI.openAnalysis()">🎯 Analysis Scroll</button>',
      '<button class="ninja-ui-btn primary" style="' + btnGap + 'background:#3A8EE8;box-shadow:0 3px 0 #2060b0;" onclick="NinjaUI.openScroll()">📜 Shadow Clone Scroll</button>',
      '<button class="ninja-ui-btn primary" style="' + btnGap + 'background:#059669;box-shadow:0 3px 0 #065f46;" onclick="NinjaUI.openVillage()">🏯 忍者の里 / Village</button>',
      '<button class="ninja-ui-close" style="margin-top:18px;">閉じる / Close</button>',
    ].join('');
    var ov = openOverlay(html);
    ov.querySelector('.ninja-ui-close').onclick = function () { closeOverlay(ov); };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Shadow Clone Scroll modal
  // ───────────────────────────────────────────────────────────────────────
  function openScroll() {
    var p = N.progress;
    var code = N.generateScrollCode(N.exportData());
    var html = [
      '<div class="ninja-ui-title">📜 Shadow Clone Scroll</div>',
      '<div style="font-size:12px;color:#666;text-align:center;margin-bottom:10px;line-height:1.5;">',
        '修行の記録を影として巻物に封じよう<br>',
        '<span style="font-size:11px;color:#888;">Save / Load Your Training Progress.</span>',
      '</div>',
      // Name section
      '<div style="font-size:13px;font-weight:900;color:#333;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">',
        '<span>🥷 忍者の名前 / Ninja Name</span>',
        (p.nameLocked
          ? '<span style="font-size:10px;color:#7C3AED;font-weight:800;">🔒 LOCKED</span>'
          : '<span style="font-size:10px;color:#b07a00;font-weight:800;">⚠️ ONE-TIME</span>'),
      '</div>',
      '<div class="ninja-ui-row">',
        '<input id="ninja-name-input-modal" type="text" maxlength="20" value="', htmlEsc(p.name || 'Ninja'), '" ',
          (p.nameLocked ? 'readonly disabled ' : ''),
          'placeholder="名前を入れる / your name" class="ninja-ui-input" ',
          'style="background:', (p.nameLocked ? '#F3E8FF' : '#fff'), ';">',
        '<button class="ninja-ui-btn primary" style="width:auto;padding:11px 14px;', (p.nameLocked ? 'opacity:0.4;' : ''), '" ',
          (p.nameLocked ? 'disabled' : 'onclick="NinjaUI._applyName()"'), '>決定</button>',
      '</div>',
      '<div style="font-size:10px;color:#888;font-weight:700;line-height:1.5;margin-bottom:14px;">',
        (p.nameLocked
          ? '名前は一度きり登録できます。変更したい場合は 原点回帰 が必要です。<br>Name is locked once set — only resetting can change it.'
          : '⚠️ 一度登録するとこの名前は変更できません。慎重に！<br>You can name your ninja only ONCE — choose carefully.'),
      '</div>',
      // Save scroll
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">',
        '<span style="font-size:13px;font-weight:900;color:#333;">⬇ Shadow Clone Scrollを作る</span>',
        '<span style="font-size:11px;color:#7C3AED;font-weight:800;">Lv ', p.level, ' · ', p.exp.toLocaleString(), ' XP</span>',
      '</div>',
      '<button class="ninja-ui-btn primary" style="background:#7C3AED;box-shadow:0 3px 0 #5B21B6;" onclick="NinjaUI._exportScrollFile()">📥 ファイルに保存</button>',
      '<details style="margin-top:6px;margin-bottom:2px;">',
        '<summary style="font-size:11px;font-weight:800;color:#666;cursor:pointer;padding:4px 2px;user-select:none;">',
          '📋 テキストとして共有 / Share as text',
        '</summary>',
        '<div style="margin-top:6px;">',
          '<textarea class="ninja-ui-ta" id="ninja-scroll-out" readonly>', htmlEsc(code), '</textarea>',
          '<button class="ninja-ui-btn primary" style="margin-top:6px;" onclick="NinjaUI._copyScroll()">📋 コピーする</button>',
        '</div>',
      '</details>',
      // Load scroll
      '<div style="height:1px;background:#eee;margin:12px 0 10px;"></div>',
      '<div style="font-size:13px;font-weight:900;color:#333;margin-bottom:6px;">⬆ Shadow Clone Scrollを読み込む</div>',
      '<label class="ninja-ui-btn retry" style="display:block;text-align:center;cursor:pointer;">',
        '📂 ファイルから読み込む',
        '<input type="file" accept=".txt" style="display:none;" onchange="NinjaUI._importScrollFile(this)">',
      '</label>',
      '<details style="margin-top:6px;">',
        '<summary style="font-size:11px;font-weight:800;color:#666;cursor:pointer;padding:4px 2px;user-select:none;">',
          '📝 テキストを貼り付けて読み込む / Paste scroll text',
        '</summary>',
        '<div style="margin-top:6px;">',
          '<textarea class="ninja-ui-ta" id="ninja-scroll-in" placeholder="ここにShadow Clone Scrollを貼り付け / paste NINJA1...."></textarea>',
          '<button class="ninja-ui-btn retry" style="margin-top:6px;" onclick="NinjaUI._applyLoad()">🥷 修行記録を呼び戻す</button>',
        '</div>',
      '</details>',
      // Persistence note
      '<div style="background:#FFF8E1;border:2px solid #FFD54F;border-radius:12px;padding:9px 12px;margin-top:14px;font-size:11px;color:#7a5800;font-weight:700;line-height:1.5;">',
        '💡 ブラウザの記録はページを閉じても残りますが、<br>',
        '「閲覧履歴の削除 → サイトデータ」を消すと失われます。<br>',
        '大事な巻物はコピーして外に保存しておくと安心 ✨',
      '</div>',
      // Reset
      '<div style="margin-top:14px;padding-top:12px;border-top:1px dashed #ddd;">',
        '<button class="ninja-ui-btn danger" onclick="NinjaUI._resetProgress()">🌅 原点回帰 — Reset All Progress</button>',
        '<div style="font-size:10px;color:#888;text-align:center;margin-top:6px;line-height:1.4;">',
          '全ての修行記録を消去します。確認は2回行います。<br>',
          'Will erase Lv, EXP, and all word stats. Confirms twice.',
        '</div>',
      '</div>',
      '<button class="ninja-ui-close">閉じる</button>',
    ].join('');
    var ov = openOverlay(html, { lockBackdrop: false });
    ov.querySelector('.ninja-ui-close').onclick = function () { closeOverlay(ov); };
  }
  function _copyScroll() {
    var ta = document.getElementById('ninja-scroll-out'); if (!ta) return;
    ta.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(
        function () { showToast('📋 Scrollをコピーしました！'); },
        function () { try { document.execCommand('copy'); showToast('📋 Scrollをコピーしました！'); } catch (e) {} }
      );
    } else {
      try { document.execCommand('copy'); showToast('📋 Scrollをコピーしました！'); } catch (e) {}
    }
  }
  function _exportScrollFile() {
    try {
      var code     = N.generateScrollCode(N.exportData());
      var name     = (N.progress.name || 'ninja').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
      var today    = new Date();
      var datePart = today.getFullYear() + '-' +
                     String(today.getMonth() + 1).padStart(2, '0') + '-' +
                     String(today.getDate()).padStart(2, '0');
      var filename = name + '_' + datePart + '.txt';
      var blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      showToast('📥 ' + filename + ' を保存しました！');
    } catch (e) {
      showToast('⚠️ 保存失敗: ' + e.message);
    }
  }
  function _importScrollFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var code = (e.target.result || '').trim();
        var data = N.loadFromScrollCode(code);
        N.importData(data);
        showToast('📂 ' + (N.progress.name || 'Ninja') + ' Lv ' + N.progress.level + ' を呼び戻しました！');
        closeOverlay(input);
        if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
      } catch (err) {
        showToast('⚠️ 読み込み失敗: ' + err.message);
      }
    };
    reader.onerror = function () { showToast('⚠️ ファイルを読み取れませんでした'); };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }
  function _applyLoad() {
    var ta = document.getElementById('ninja-scroll-in'); if (!ta) return;
    var code = (ta.value || '').trim();
    if (!code) { showToast('⚠️ 巻物のテキストを入れてね'); return; }
    try {
      var data = N.loadFromScrollCode(code);
      N.importData(data);
      showToast('🥷 ' + (N.progress.name || 'Ninja') + ' Lv ' + N.progress.level + ' を呼び戻しました！');
      // Refresh the modal to reflect new state, and notify the host game
      closeOverlay(ta);
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
    } catch (e) {
      showToast('⚠️ 読み込み失敗: ' + e.message);
    }
  }
  function _applyName() {
    var inp = document.getElementById('ninja-name-input-modal'); if (!inp) return;
    if (N.setName(inp.value)) {
      showToast('🥷 名前を「' + N.progress.name + '」に登録！🔒');
      closeOverlay(inp);
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
    } else {
      showToast('⚠️ 名前を入れてね（または既にロック済み）');
    }
  }
  function _resetProgress() {
    if (!confirm('⚠️ 原点回帰\n\nすべての修行記録（レベル・経験値・全単語の正答記録）をゼロに戻します。\nこの操作は取り消せません！\n\nWipe ALL training progress?\nThis cannot be undone.')) return;
    if (!confirm('⚠️ 本当に消去してよろしいですか？\n\nThis will permanently erase your training scroll. Continue?')) return;
    N.resetProgress();
    showToast('🌅 原点回帰しました — Reset complete.');
    var any = document.querySelector('.ninja-ui-overlay');
    if (any) any.remove();
    if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
    setTimeout(openDesignPicker.bind(null, { firstRun: true }), 250);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Standalone name modal (for tapping the profile chip)
  // ───────────────────────────────────────────────────────────────────────
  function openNameModal() {
    var p = N.progress;
    if (p.nameLocked) { showToast('🔒 名前は登録済みです · 原点回帰でリセットできます'); return; }
    var html = [
      '<div class="ninja-ui-title">🥷 名前を決める / Name your Ninja</div>',
      '<div style="font-size:12px;color:#666;text-align:center;margin-bottom:14px;line-height:1.5;">',
        '⚠️ 一度登録するとこの名前は変更できません<br>',
        '<span style="font-size:11px;color:#888;">Name your ninja just once.</span>',
      '</div>',
      '<div class="ninja-ui-row">',
        '<input id="ninja-name-input-solo" type="text" maxlength="20" value="', htmlEsc(p.name || ''), '" ',
          'placeholder="名前を入れる / your name" class="ninja-ui-input">',
        '<button class="ninja-ui-btn primary" style="width:auto;padding:11px 14px;" onclick="NinjaUI._applyNameSolo()">決定</button>',
      '</div>',
      '<button class="ninja-ui-close">後で / Later</button>',
    ].join('');
    var ov = openOverlay(html);
    ov.querySelector('.ninja-ui-close').onclick = function () { closeOverlay(ov); };
    setTimeout(function () { var i = document.getElementById('ninja-name-input-solo'); if (i) i.focus(); }, 80);
  }
  function _applyNameSolo() {
    var inp = document.getElementById('ninja-name-input-solo'); if (!inp) return;
    if (N.setName(inp.value)) {
      showToast('🥷 名前を「' + N.progress.name + '」に登録！🔒');
      closeOverlay(inp);
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
    } else {
      showToast('⚠️ 名前を入れてね');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Character Maker (design picker)
  // ───────────────────────────────────────────────────────────────────────
  function openDesignPicker(opts) {
    var firstRun = !!(opts && opts.firstRun);
    injectStyles();
    // Tear down any stale picker (post-reset re-mounts) and reset the
    // body-scroll lock counter so we don't double-count.
    var stale = document.getElementById('ninja-ui-design-pick');
    if (stale) {
      stale.remove();
      unlockBodyScroll();
    }
    var ov = document.createElement('div');
    ov.id = 'ninja-ui-design-pick';
    ov.className = 'ninja-ui-overlay';
    ov.innerHTML = '<div class="ninja-ui-modal" id="ninja-ui-design-box"><button class="ninja-ui-top-close" onclick="NinjaUI._closeDesignPicker()" aria-label="Close">✕</button></div>';
    // Tap on backdrop closes — same UX as openOverlay
    ov.addEventListener('click', function (ev) { if (ev.target === ov) _closeDesignPicker(); });
    document.body.appendChild(ov);
    lockBodyScroll();
    refreshDesignPicker(firstRun);
  }
  function refreshDesignPicker(firstRun) {
    var box = document.getElementById('ninja-ui-design-box'); if (!box) return;
    var tokens   = N.designTokensAvailable();
    var xpToNext = N.designXpToNextToken();
    var hasNoPick = !N.design.selected;
    // ── Three modes (mutually exclusive) ──
    //   • starter    : the player has NEVER claimed a design in any Ninja
    //                  game (unlocked is empty). They get one free pick.
    //   • adopt      : the player has unlocked designs (e.g. carried over
    //                  from another game via the shared design key) but
    //                  no active selection. Force them to pick from the
    //                  unlocked list — no extra free starter.
    //   • regular    : a design is active; level-based tokens may unlock
    //                  more designs.
    var canStarter  = N.designHasStarterAvailable();
    var starterMode = (firstRun || hasNoPick) && canStarter;
    var adoptMode   = hasNoPick && !canStarter; // unlocked.length > 0 but selected null
    var prefix = N.profile.imagePathPrefix || 'images/';
    var cards = N.assetIds.map(function (id) {
      var def = N.assets[id];
      var unlocked = N.designIsUnlocked(id);
      var selected = N.design.selected === id;
      var cls = 'ninja-ui-pickcard';
      var status, action = '';
      if (selected) {
        cls += ' selected'; status = '✅ Selected';
      } else if (unlocked) {
        cls += ' unlocked'; status = 'Tap to switch'; action = "NinjaUI._designAction('select','" + id + "')";
      } else if (starterMode) {
        cls += ' starter'; status = '🆓 Free starter'; action = "NinjaUI._designAction('starter','" + id + "')";
      } else if (adoptMode) {
        // No starter slot left → can only adopt from unlocked list. Locked others.
        cls += ' locked'; status = '🔒 Locked';
      } else if (tokens > 0) {
        cls += ' token'; status = '🔓 Tap to unlock'; action = "NinjaUI._designAction('unlock','" + id + "')";
      } else {
        cls += ' locked'; status = '🔒 Need token';
      }
      var num = N.assetIds.indexOf(id) + 1;
      var fileSrc = prefix + def.file.replace(/^images\//, '');
      return [
        '<div class="', cls, '"', (action ? ' onclick="' + action + '"' : ''), '>',
          '<div class="ninja-ui-pickimg">',
            '<img src="', htmlEsc(fileSrc), '" alt="Ninja ', num, '" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<span style=&quot;font-size:13px;color:#999;font-weight:800;&quot;>#' + num + '</span>\';">',
          '</div>',
          '<div style="font-size:12px;font-weight:700;color:#666;">', status, '</div>',
        '</div>'
      ].join('');
    }).join('');
    var banner;
    if (starterMode) {
      banner = '<div class="ninja-ui-banner" style="background:#FFF8E1;border:2px solid #FFD54F;color:#7a5800;">🆓 まずは1つ自由に選ぼう！<br>Pick any design as your free starter.</div>';
    } else if (adoptMode) {
      banner = '<div class="ninja-ui-banner" style="background:#F3E8FF;border:2px solid #A78BFA;color:#4C1D95;">🥷 解放済みのデザインから選んでください<br>Pick your active design from your unlocks.</div>';
    } else {
      banner = '<div class="ninja-ui-banner" style="background:' + (tokens>0 ? '#F3E8FF' : '#f8f8f5')
        + ';border:2px solid ' + (tokens>0 ? '#A78BFA' : '#ddd')
        + ';color:' + (tokens>0 ? '#4C1D95' : '#666')
        + ';">🎟 Unlock tokens: <span style="font-size:18px;">' + tokens + '</span> &nbsp;·&nbsp; Lv ' + N.progress.level
        + '<br><span style="font-size:11px;font-weight:700;opacity:0.85;">'
        + (tokens>0
            ? '好きなデザインを選んで解放しよう！<br>Earned across all Ninja games.'
            : 'あと ' + xpToNext.toLocaleString() + ' XP で次のトークン獲得')
        + '</span></div>';
    }
    box.innerHTML = [
      '<div class="ninja-ui-title">🥷 Ninja Design', (starterMode ? ' — Welcome!' : ''), '</div>',
      '<p style="text-align:center;font-size:12px;color:#666;font-weight:700;margin-bottom:10px;line-height:1.5;">',
        (starterMode
          ? '好きな忍者を選んで修行を始めよう！<br>Pick your favorite ninja to start training.'
          : adoptMode
            ? '別ゲームで獲得したデザインから今のメインを選ぼう。<br>Choose your active design from previously unlocked picks.'
            : 'いつでも解放済みデザインに切り替え可能<br>Switch between any unlocked design anytime.'),
      '</p>',
      banner,
      '<div class="ninja-ui-grid2" style="margin-bottom:12px;">', cards, '</div>',
      '<button class="ninja-ui-btn primary" onclick="NinjaUI._closeDesignPicker()">',
        (starterMode ? '後で / Later' : '✅ 決定 / Done'),
      '</button>',
    ].join('');
  }
  // Flag set by _addMember() so _closeDesignPicker() knows to reopen the
  // village modal after the new ninja's starter design has been chosen.
  var _pendingVillageReopen = false;

  function _closeDesignPicker() {
    var ov = document.getElementById('ninja-ui-design-pick');
    if (ov) {
      ov.remove();
      unlockBodyScroll();
    }
    if (_pendingVillageReopen) {
      _pendingVillageReopen = false;
      setTimeout(openVillage, 60);   // reopen village with fresh carousel data
    }
    if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
  }
  function _designAction(action, id) {
    if (action === 'select') {
      if (N.designSelect(id)) refreshDesignPicker(false);
      return;
    }
    if (action === 'starter') {
      // Defence in depth: NinjaCore.designStarter already refuses if the
      // starter slot has been used in any other Ninja game, but we double-
      // check here so the picker UI never silently no-ops.
      if (!N.designHasStarterAvailable()) {
        showToast('⚠️ スターターは別のゲームで使用済みです');
        refreshDesignPicker(false);
        return;
      }
      if (N.designStarter(id)) {
        // ── Per user request, the "Ninja #N を選びました！" confirmation
        //    toast on starter pick is suppressed. Kept commented for
        //    easy re-enable if we ever want it back. ──
        // showToast('🥷 Ninja #' + (N.assetIds.indexOf(id) + 1) + ' を選びました！');
        _closeDesignPicker();
      }
      return;
    }
    if (action === 'unlock') {
      if (N.designTokensAvailable() <= 0) { showToast('⚠️ トークンが足りません'); return; }
      var num = N.assetIds.indexOf(id) + 1;
      if (!confirm('「Ninja #' + num + '」を解放してこのデザインに切り替えますか？\n（解放トークンを1つ使います）\n\nUnlock and switch to this design? Spends 1 token.')) return;
      if (N.designUnlock(id)) {
        showToast('🔓 Ninja #' + num + ' を解放！');
        refreshDesignPicker(false);
      }
      return;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Village (忍者の里)  —  clan carousel + Bloodline Scroll
  // ───────────────────────────────────────────────────────────────────────

  // clanCarouselHTML — horizontal swipe carousel, one card per member.
  // imagePathPrefix is forwarded from the host game's profile config.
  function clanCarouselHTML() {
    injectStyles();
    var prefix  = N.profile.imagePathPrefix || 'images/';
    var members = N.clanMembers();
    var maxSize = N.constants.MAX_CLAN_SIZE;
    var cards   = members.map(function (m) {
      // Avatar
      var avatarSrc = '';
      if (m.designSelected && N.assets[m.designSelected]) {
        avatarSrc = prefix + N.assets[m.designSelected].file.replace(/^images\//, '');
      }
      var avatarHTML = avatarSrc
        ? '<img src="' + htmlEsc(avatarSrc) + '" alt="" style="width:100%;height:100%;object-fit:contain;display:block;" onerror="this.style.display=\'none\'">'
        : '<span style="font-size:11px;font-weight:800;color:rgba(255,255,255,0.7);text-align:center;padding:4px;">未選択</span>';
      var cls     = 'ninja-ui-member-card' + (m.active ? ' active' : ' inactive');
      var onclick = m.active ? '' : 'onclick="NinjaUI._switchSlot(' + m.slot + ')"';
      var safeName = htmlEsc(m.name || 'Ninja');
      return [
        '<div class="' + cls + '" ' + onclick + '>',
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">',
            '<div style="width:46px;height:46px;flex:0 0 46px;background:rgba(255,255,255,0.18);border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid rgba(255,255,255,0.35);">',
              avatarHTML,
            '</div>',
            '<div style="flex:1;min-width:0;">',
              '<div style="font-family:\'Bangers\',cursive;font-size:19px;letter-spacing:1px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + safeName + '</div>',
              '<div style="font-size:11px;font-weight:800;opacity:0.9;margin-top:1px;">Lv ' + m.level + '</div>',
            '</div>',
          '</div>',
          '<div style="font-size:10px;font-weight:700;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + m.exp.toLocaleString() + ' XP</div>',
          (m.active
            ? '<div style="margin-top:5px;font-size:10px;font-weight:900;background:rgba(255,213,79,0.25);color:#FFD54F;border-radius:6px;padding:2px 6px;display:inline-block;">▶ 修行中</div>'
            : '<div style="margin-top:5px;font-size:10px;font-weight:800;opacity:0.65;border-radius:6px;padding:2px 6px;display:inline-block;border:1px solid rgba(255,255,255,0.3);">タップで切替</div>'),
        '</div>',
      ].join('');
    });
    // "+" add card (shown only if under the limit)
    var addCard = members.length < maxSize
      ? '<div class="ninja-ui-add-card" onclick="NinjaUI._addMember()"><span style="font-size:22px;">＋</span><span>新忍者</span></div>'
      : '';
    return '<div class="ninja-ui-carousel">' + cards.join('') + addCard + '</div>';
  }

  // openVillage — Village management modal
  function openVillage() {
    injectStyles();
    var members = N.clanMembers();
    var maxSize = N.constants.MAX_CLAN_SIZE;
    var clanName = N.getClanName();
    var html = [
      '<div class="ninja-ui-title">🏯 忍者の里 / Village</div>',

      // ── Clan name row ──
      '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;">',
        '<div id="ninja-clan-name-display" style="font-size:15px;font-weight:900;color:#333;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">',
          htmlEsc(clanName || '里に名前をつけよう'),
        '</div>',
        '<button style="background:none;border:none;cursor:pointer;font-size:15px;padding:2px 4px;line-height:1;" ',
                'title="里の名前を変更" onclick="NinjaUI._clanNameEdit()">✏️</button>',
      '</div>',
      '<div id="ninja-clan-name-edit" style="display:none;margin-bottom:10px;">',
        '<input id="ninja-clan-name-input" type="text" maxlength="30" ',
               'style="width:100%;padding:8px 10px;font-size:14px;font-weight:800;border:2px solid #059669;',
                      'border-radius:10px;outline:none;color:#333;box-sizing:border-box;" ',
               'placeholder="里の名前 (最大30文字)" ',
               'value="' + htmlEsc(clanName) + '">',
        '<div style="display:flex;gap:6px;margin-top:6px;">',
          '<button class="ninja-ui-btn primary" style="background:#059669;box-shadow:0 3px 0 #065f46;" ',
                  'onclick="NinjaUI._clanNameSave()">✅ 決定</button>',
          '<button class="ninja-ui-btn" onclick="NinjaUI._clanNameCancel()">✕ キャンセル</button>',
        '</div>',
      '</div>',

      '<div style="font-size:11px;color:#888;text-align:center;margin-bottom:10px;">',
        '最大' + maxSize + '人の忍者を管理 / Manage up to ' + maxSize + ' ninjas',
      '</div>',

      // Member carousel
      clanCarouselHTML(),
      // Member remove buttons (non-active members only, if more than 1)
      (members.length > 1 ? _memberManageHTML(members) : ''),
      '<div style="height:1px;background:#eee;margin:14px 0;"></div>',

      // ── Bloodline Scroll section ──
      '<div style="font-size:14px;font-weight:900;color:#059669;margin-bottom:8px;">🩸 Bloodline Scroll</div>',
      '<div style="font-size:11px;color:#666;line-height:1.5;margin-bottom:10px;">',
        '一族全員のデータを一本のファイルにまとめます。<br>',
        '<span style="color:#888;">Save all clan members as a file to transfer anywhere.</span>',
      '</div>',

      // ── Save: file (primary) ──
      '<div style="font-size:12px;font-weight:900;color:#333;margin-bottom:6px;">⬇ 保存する / Save</div>',
      '<button class="ninja-ui-btn primary" style="background:#059669;box-shadow:0 3px 0 #065f46;" ',
              'onclick="NinjaUI._bloodlineExportFile()">📥 ファイルに保存</button>',

      // ── Save: text fallback (collapsed) ──
      '<details style="margin-top:6px;margin-bottom:2px;">',
        '<summary style="font-size:11px;font-weight:800;color:#666;cursor:pointer;padding:4px 2px;user-select:none;">',
          '📋 テキストとして共有 / Share as text (for messaging apps)',
        '</summary>',
        '<div style="margin-top:6px;">',
          '<textarea class="ninja-ui-ta" id="ninja-bloodline-out" readonly placeholder="← 生成ボタンを押してください"></textarea>',
          '<button class="ninja-ui-btn primary" style="margin-top:6px;background:#059669;box-shadow:0 3px 0 #065f46;" ',
                  'onclick="NinjaUI._bloodlineGenerate()">🩸 テキストを生成する</button>',
          '<button class="ninja-ui-btn primary" style="margin-top:6px;background:#0d9488;box-shadow:0 3px 0 #0f766e;display:none;" ',
                  'id="ninja-bloodline-copy-btn" onclick="NinjaUI._bloodlineCopy()">📋 コピーする</button>',
        '</div>',
      '</details>',

      // ── Load: file (primary) ──
      '<div style="height:1px;background:#eee;margin:12px 0 10px;"></div>',
      '<div style="font-size:12px;font-weight:900;color:#333;margin-bottom:6px;">⬆ 読み込む / Load</div>',
      '<label class="ninja-ui-btn retry" style="display:block;text-align:center;cursor:pointer;">',
        '📂 ファイルから読み込む',
        '<input type="file" accept=".txt" style="display:none;" onchange="NinjaUI._bloodlineImportFile(this)">',
      '</label>',

      // ── Load: text fallback (collapsed) ──
      '<details style="margin-top:6px;">',
        '<summary style="font-size:11px;font-weight:800;color:#666;cursor:pointer;padding:4px 2px;user-select:none;">',
          '📝 テキストを貼り付けて読み込む / Paste scroll text',
        '</summary>',
        '<div style="margin-top:6px;">',
          '<input id="ninja-bloodline-in" type="text" maxlength="4000" ',
                 'style="width:100%;padding:10px 12px;font-family:monospace;font-size:13px;font-weight:800;',
                        'border:2px solid #ddd;border-radius:10px;outline:none;color:#333;box-sizing:border-box;" ',
                 'placeholder="CLAN2.... を貼り付け" ',
                 'oninput="NinjaUI._bloodlineInputHint(this)" ',
                 'onpaste="setTimeout(function(){NinjaUI._bloodlineInputHint(document.getElementById(\'ninja-bloodline-in\'));},10)">',
          '<div id="ninja-bloodline-in-hint" style="font-size:10px;font-weight:800;margin-top:3px;min-height:14px;"></div>',
          '<button class="ninja-ui-btn retry" style="margin-top:6px;" onclick="NinjaUI._bloodlineLoad()">🩸 一族を呼び戻す</button>',
        '</div>',
      '</details>',

      '<div style="background:#F0FDF4;border:2px solid #6EE7B7;border-radius:12px;padding:9px 12px;margin-top:12px;font-size:11px;color:#065f46;font-weight:700;line-height:1.5;">',
        '💡 Bloodline ScrollはShadow Clone Scrollとは独立した巻物です。<br>',
        '個別の忍者にはShadow Clone Scroll、全員まとめてはBloodline Scrollをご利用ください。',
      '</div>',
      '<button class="ninja-ui-close" style="margin-top:14px;">閉じる / Close</button>',
    ].join('');
    var ov = openOverlay(html);
    ov.querySelector('.ninja-ui-close').onclick = function () { closeOverlay(ov); };
  }

  // _memberManageHTML — remove buttons for non-active members
  function _memberManageHTML(members) {
    var rows = members.filter(function (m) { return !m.active; }).map(function (m) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 4px;border-bottom:1px solid #f0f0f0;">' +
        '<span style="font-size:13px;font-weight:800;color:#333;">🥷 ' + htmlEsc(m.name || 'Ninja') + ' (Lv ' + m.level + ')</span>' +
        '<button class="ninja-ui-btn danger" style="width:auto;padding:6px 10px;font-size:11px;" onclick="NinjaUI._removeMember(' + m.slot + ')">🗑 削除</button>' +
        '</div>';
    });
    if (!rows.length) return '';
    return '<div style="font-size:11px;font-weight:900;color:#666;margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.5px;">メンバー管理</div>' +
           '<div style="border:1px solid #eee;border-radius:10px;overflow:hidden;margin-bottom:8px;">' + rows.join('') + '</div>';
  }

  // ── Clan name edit ────────────────────────────────────────────────────
  function _clanNameEdit() {
    var disp = document.getElementById('ninja-clan-name-display');
    var edit = document.getElementById('ninja-clan-name-edit');
    if (!disp || !edit) return;
    disp.parentElement.style.display = 'none';
    edit.style.display = 'block';
    var inp = document.getElementById('ninja-clan-name-input');
    if (inp) { inp.focus(); inp.select(); }
  }
  function _clanNameSave() {
    var inp  = document.getElementById('ninja-clan-name-input');
    var disp = document.getElementById('ninja-clan-name-display');
    var edit = document.getElementById('ninja-clan-name-edit');
    if (!inp) return;
    var name = inp.value.trim().slice(0, 30);
    N.setClanName(name);
    if (disp) disp.textContent = name || '里に名前をつけよう';
    if (edit) edit.style.display = 'none';
    var row  = disp && disp.parentElement;
    if (row)  row.style.display = 'flex';
    showToast('🏯 ' + (name || '里の名前を削除しました'));
  }
  function _clanNameCancel() {
    var disp = document.getElementById('ninja-clan-name-display');
    var edit = document.getElementById('ninja-clan-name-edit');
    if (edit) edit.style.display = 'none';
    var row  = disp && disp.parentElement;
    if (row)  row.style.display = 'flex';
  }

  // ── File export ───────────────────────────────────────────────────────
  function _bloodlineExportFile() {
    try {
      var code     = N.generateBloodlineScroll();
      var clanName = N.getClanName();
      var today    = new Date();
      var datePart = today.getFullYear() + '-' +
                     String(today.getMonth() + 1).padStart(2, '0') + '-' +
                     String(today.getDate()).padStart(2, '0');
      var safeName = (clanName || 'bloodline').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
      var filename = safeName + '_' + datePart + '.txt';
      var blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      showToast('📥 ' + filename + ' を保存しました！');
    } catch (e) {
      showToast('⚠️ 保存失敗: ' + e.message);
    }
  }

  // ── File import ───────────────────────────────────────────────────────
  function _bloodlineImportFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var raw  = (e.target.result || '').trim();
        var data = N.parseBloodlineScroll(raw);
        var ok   = N.importBloodlineScroll(data);
        if (!ok) throw new Error('import failed');
        var count = N.clanSlotCount();
        showToast('📂 ' + count + '人の一族をファイルから呼び戻しました！');
        // Refresh the village modal
        var ov = document.querySelector('.ninja-ui-overlay');
        if (ov) { closeOverlay(ov); setTimeout(openVillage, 50); }
        if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
      } catch (err) {
        showToast('⚠️ 読み込み失敗: ' + err.message);
      }
    };
    reader.onerror = function () { showToast('⚠️ ファイルを読み取れませんでした'); };
    reader.readAsText(file, 'utf-8');
    // Reset so the same file can be selected again if needed
    input.value = '';
  }

  // Village private handlers
  function _bloodlineGenerate() {
    var ta = document.getElementById('ninja-bloodline-out'); if (!ta) return;
    try {
      var code = N.generateBloodlineScroll();
      ta.value = code;
      ta.select();
      var btn = document.getElementById('ninja-bloodline-copy-btn');
      if (btn) btn.style.display = 'block';
      showToast('🩸 Bloodline Scrollを生成しました！');
    } catch (e) {
      showToast('⚠️ 生成失敗: ' + e.message);
    }
  }
  function _bloodlineCopy() {
    var ta = document.getElementById('ninja-bloodline-out'); if (!ta || !ta.value) { showToast('⚠️ まずScrollを生成してください'); return; }
    ta.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(
        function () { showToast('📋 Bloodline Scrollを写し取りました！'); },
        function () { try { document.execCommand('copy'); showToast('📋 コピーしました！'); } catch (e) {} }
      );
    } else {
      try { document.execCommand('copy'); showToast('📋 コピーしました！'); } catch (e) {}
    }
  }
  // ── Input hint: show CLAN2 / CLAN1 detected in real time ────────────
  function _bloodlineInputHint(el) {
    var hint = document.getElementById('ninja-bloodline-in-hint');
    if (!hint) return;
    var v = (el.value || '').trim();
    if (!v) { hint.textContent = ''; hint.style.color = '#888'; return; }
    if (v.indexOf('CLAN2.') === 0) {
      hint.textContent = '📜 Bloodline Scrollを認識 / Scroll detected';
      hint.style.color = '#059669';
    } else if (v.indexOf('CLAN1.') === 0) {
      hint.textContent = '📜 旧形式のScrollを認識 / Legacy scroll detected';
      hint.style.color = '#3A8EE8';
    } else {
      hint.textContent = '⚠️ 形式が正しくありません / Unrecognised format';
      hint.style.color = '#E63946';
    }
  }

  // ── Load ─────────────────────────────────────────────────────────────
  function _bloodlineLoad() {
    var inp = document.getElementById('ninja-bloodline-in'); if (!inp) return;
    var raw = (inp.value || '').trim();
    if (!raw) { showToast('⚠️ 巻物のテキストを入れてね'); return; }
    try {
      var data = N.parseBloodlineScroll(raw);
      var ok = N.importBloodlineScroll(data);
      if (!ok) throw new Error('import failed');
      var count = N.clanSlotCount();
      showToast('🩸 ' + count + '人の一族を呼び戻しました！');
      closeOverlay(inp);
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
    } catch (e) {
      showToast('⚠️ 読み込み失敗: ' + e.message);
    }
  }
  function _switchSlot(n) {
    if (!confirm('「' + (N.clanMembers().filter(function(m){return m.slot===n;})[0] || {}).name + '」に切り替えますか？\nSwitch to this ninja?')) return;
    if (N.clanSetActiveSlot(n)) {
      showToast('🥷 ' + N.progress.name + ' Lv' + N.progress.level + ' に切り替えました');
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
      // Refresh the village modal if still open
      var ov = document.querySelector('.ninja-ui-overlay');
      if (ov) { closeOverlay(ov); setTimeout(openVillage, 50); }
    }
  }
  function _addMember() {
    var n = N.clanAddMember();
    if (n < 0) { showToast('⚠️ 里は満員です（最大' + N.constants.MAX_CLAN_SIZE + '人）'); return; }
    if (N.clanSetActiveSlot(n)) {
      showToast('🥷 新しい忍者を里に招きました！');
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
      // Close the village modal now; _closeDesignPicker() will reopen it
      // after the new ninja's starter design has been chosen, so the
      // carousel reflects the fresh design without a double-flash.
      var ov = document.querySelector('.ninja-ui-overlay');
      if (ov) { closeOverlay(ov); }
      _pendingVillageReopen = true;
      setTimeout(function () { openDesignPicker({ firstRun: true }); }, 60);
    }
  }
  function _removeMember(n) {
    var members = N.clanMembers();
    var m = members.filter(function(x){return x.slot===n;})[0];
    if (!m) return;
    if (!confirm('🗑 「' + (m.name || 'Ninja') + '」(Lv' + m.level + ') を里から外しますか？\n（この操作は取り消せません）\n\nRemove this ninja from the village?')) return;
    if (N.clanRemoveMember(n)) {
      showToast('🥷 ' + (m.name || 'Ninja') + ' を里から外しました');
      if (typeof global.onNinjaProgressChanged === 'function') global.onNinjaProgressChanged();
      var ov = document.querySelector('.ninja-ui-overlay');
      if (ov) { closeOverlay(ov); setTimeout(openVillage, 50); }
    }
  }

  // switchToSlot — public convenience wrapper
  function switchToSlot(n) { _switchSlot(n); }

  // ───────────────────────────────────────────────────────────────────────
  // Analysis Scroll  —  weak words list with CSV / Copy export
  // ───────────────────────────────────────────────────────────────────────
  // The host can either:
  //   (a) call NinjaUI.openAnalysis(catalogs) to render a modal, or
  //   (b) call NinjaUI.analysisHTML(catalogs) and embed it themselves.
  // catalogs default to a single namespace = the current game.
  function _resolveCatalogs(catalogs) {
    if (!catalogs && typeof global.getNinjaCatalogs === 'function') catalogs = global.getNinjaCatalogs();
    return catalogs || [];
  }

  function analysisHTML(catalogs) {
    catalogs = _resolveCatalogs(catalogs);
    var items = N.weakWords(catalogs, 60);
    var mastered = N.masteredCount(catalogs);
    var rows = items.length
      ? items.map(function (it) {
          var w = it.w;
          var accColor = it.acc >= 0.6 ? '#0a5c2d' : it.acc >= 0.3 ? '#b07a00' : '#E63946';
          return [
            '<tr', (w.lastWrong ? ' style="background:#fff5f5;"' : ''), '>',
              '<td>', htmlEsc(it.entry.word || ''), (w.lastWrong ? ' 🔥' : ''), '</td>',
              '<td>', htmlEsc(it.entry.jp || ''), '</td>',
              '<td style="text-align:center;font-weight:800;color:#7C3AED;">', htmlEsc(it.label || ''), '</td>',
              '<td style="text-align:center;color:#0a5c2d;font-weight:800;">', w.correct, '</td>',
              '<td style="text-align:center;color:#E63946;font-weight:800;">', w.wrong, '</td>',
              '<td style="text-align:center;color:#b07a00;font-weight:800;">', w.slow, '</td>',
              '<td style="text-align:center;font-weight:900;color:', accColor, ';">', (it.acc * 100).toFixed(0), '%</td>',
            '</tr>'
          ].join('');
        }).join('')
      : '<tr><td colspan="7" style="padding:24px;text-align:center;color:#888;font-weight:700;">まだ弱点はありません 🎉<br><span style="font-size:11px;font-weight:600;">Play more to see your weakness scroll.</span></td></tr>';
    // stash for export
    _lastAnalysisItems = items;
    return [
      identityHeaderHTML('Analysis Scroll / WEAK SPOTS'),
      '<p style="text-align:center;font-size:11px;color:#888;font-weight:700;margin-bottom:6px;">',
        items.length, ' 修行待ち · <span style="color:#0a5c2d;">', mastered, ' 習得済</span> · cross-game memory',
      '</p>',
      '<p style="text-align:center;font-size:10px;color:#aaa;font-weight:600;margin-bottom:10px;">',
        '✅ ', N.constants.MASTERY_THRESHOLD, '回以上正解で自動で消えます · 間違えると再登場<br>',
        '🔥=直前で間違えた · ○=正解数 · ×=間違い数 · ⏱=遅かった回数',
      '</p>',
      (items.length ? [
        '<div style="display:flex;justify-content:flex-end;gap:7px;margin-bottom:8px;">',
          '<button class="ninja-ui-btn primary" style="width:auto;padding:8px 12px;font-size:12px;" onclick="NinjaUI._weakExportCSV()">⬇ CSV</button>',
          '<button class="ninja-ui-btn retry" style="width:auto;padding:8px 12px;font-size:12px;" onclick="NinjaUI._weakCopyText()">📋 Copy</button>',
        '</div>'
      ].join('') : ''),
      '<div style="overflow-x:auto;"><table class="ninja-ui-table">',
        '<thead><tr><th>Word</th><th>意味</th><th style="text-align:center;">Lv</th><th style="text-align:center;">○</th><th style="text-align:center;">×</th><th style="text-align:center;">⏱</th><th style="text-align:center;">Acc</th></tr></thead>',
        '<tbody>', rows, '</tbody>',
      '</table></div>',
    ].join('');
  }

  var _lastAnalysisItems = [];

  function openAnalysis(catalogs) {
    var html = [
      '<div class="ninja-ui-title">🎯 Analysis Scroll · Words to Master</div>',
      analysisHTML(catalogs),
      '<button class="ninja-ui-close">閉じる</button>',
    ].join('');
    var ov = openOverlay(html);
    ov.querySelector('.ninja-ui-close').onclick = function () { closeOverlay(ov); };
  }

  function _weakExportCSV() {
    var items = _lastAnalysisItems;
    if (!items.length) { showToast('⚠️ まだ弱点がありません'); return; }
    var header = ['word','jp','source','correct','wrong','slow','accuracy_pct','synonym','example','exJP','definition','last_wrong'];
    var rows = items.map(function (it) {
      var w = it.w, e = it.entry;
      return [
        N.csvEscape(e.word),
        N.csvEscape(e.jp || ''),
        N.csvEscape(it.label || ''),
        w.correct, w.wrong, w.slow,
        (it.acc * 100).toFixed(0),
        N.csvEscape(e.syn || ''),
        N.csvEscape(e.ex || ''),
        N.csvEscape(e.exJP || ''),
        N.csvEscape(e.def || ''),
        w.lastWrong ? '1' : '0',
      ].join(',');
    });
    var csv = N.statusCSVMeta('Analysis Scroll / Weak Spots').concat([header.join(',')]).concat(rows).join('\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var safeName = (N.progress.name || 'Ninja').replace(/[^a-zA-Z0-9_-]/g, '');
    a.download = 'WeakSpots_' + safeName + '_Lv' + N.progress.level + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('⬇ Analysis Scroll CSVを保存しました！');
  }
  function _weakCopyText() {
    var items = _lastAnalysisItems;
    if (!items.length) { showToast('⚠️ まだ弱点がありません'); return; }
    var lines = N.statusTextHeader('Analysis Scroll / Words to Master');
    items.forEach(function (it, i) {
      var w = it.w, e = it.entry;
      lines.push((i + 1) + '. ' + (e.word || '') + (w.lastWrong ? ' 🔥' : '') + '　[' + (it.label || '') + ']　' + (e.jp || ''));
      lines.push('   ○' + w.correct + ' × ' + w.wrong + ' ⏱ ' + w.slow + '   acc ' + (it.acc * 100).toFixed(0) + '%');
      if (e.syn) lines.push('   syn: ' + e.syn);
      if (e.ex)  lines.push('   ex: ' + e.ex);
      if (e.def) lines.push('   def: ' + e.def);
      lines.push('');
    });
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showToast('📋 Analysis Scrollを写し取りました！'); },
        function () { showToast('⚠️ コピー失敗 — テキストを手動で選択してください'); }
      );
    } else {
      showToast('⚠️ クリップボードが使えません');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Training Scroll (per-session result CSV/copy helper)
  // ───────────────────────────────────────────────────────────────────────
  // host calls NinjaUI.exportSessionCSV({label, header, rows})
  function exportSessionCSV(opts) {
    var header = opts.header || [];
    var rows   = opts.rows || [];
    var label  = opts.label || 'Training Scroll';
    var csv    = N.statusCSVMeta(label).concat([header.join(',')]).concat(rows.map(function (r) {
      return r.map(function (c) { return N.csvEscape(c); }).join(',');
    })).join('\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var safeName = (N.progress.name || 'Ninja').replace(/[^a-zA-Z0-9_-]/g, '');
    a.download = (opts.filename || 'TrainingScroll') + '_' + safeName + '_Lv' + N.progress.level + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('⬇ ' + (opts.filename || 'Training Scroll') + ' CSVを保存しました！');
  }
  function copySessionText(opts) {
    var label = opts.label || 'Training Scroll';
    var lines = N.statusTextHeader(label);
    (opts.lines || []).forEach(function (l) { lines.push(l); });
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showToast('📋 ' + label + 'をコピーしました！'); },
        function () { showToast('⚠️ コピー失敗'); }
      );
    } else {
      showToast('⚠️ クリップボードが使えません');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Boot helpers
  // ───────────────────────────────────────────────────────────────────────
  // Auto-prompt the design picker on first boot when the player has no
  // active design selected. Two valid trigger states:
  //   • Brand-new player (unlocked.length === 0)        → starter mode
  //   • Imported state with unlocks but no active pick  → adopt mode
  // In both cases we want to surface the picker once so the user lands
  // with a real design active before entering gameplay.
  function maybePromptStarter(delayMs) {
    if (!N.design.selected) {
      setTimeout(function () { openDesignPicker({ firstRun: true }); }, delayMs || 250);
    }
  }
  // Auto-prompt the name modal once the player has a design but no name.
  function maybePromptName(delayMs) {
    if (!N.progress.nameLocked && N.design.selected) {
      setTimeout(function () { openNameModal(); }, delayMs || 250);
    }
  }
  // Wire up Other Games handoff — call this in your link click handler.
  // Use armOnLinks(querySelector) to hook all matching links automatically.
  function armOnLinks(selector) {
    var links = document.querySelectorAll(selector || 'a.game-link-btn, .game-link-btn');
    links.forEach(function (a) {
      a.addEventListener('click', function () { try { N.armHandoff(); } catch (e) {} }, { capture: true });
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────
  global.NinjaUI = {
    // chrome
    statusBadgeHTML:  statusBadgeHTML,
    identityHeaderHTML: identityHeaderHTML,
    showToast:        showToast,
    flashAnswerXp:    flashAnswerXp,
    flashStreakBreak: flashStreakBreak,

    // hub
    openProfile:        openProfile,

    // modals
    openScroll:         openScroll,
    openNameModal:      openNameModal,
    openDesignPicker:   openDesignPicker,
    openAnalysis:       openAnalysis,
    analysisHTML:       analysisHTML,

    // exports
    exportSessionCSV:   exportSessionCSV,
    copySessionText:    copySessionText,

    // boot helpers
    maybePromptStarter: maybePromptStarter,
    maybePromptName:    maybePromptName,
    armOnLinks:         armOnLinks,

    // village (clan system)
    clanCarouselHTML: clanCarouselHTML,
    openVillage:      openVillage,
    switchToSlot:     switchToSlot,

    // private callbacks (referenced by inline onclick handlers)
    _closeOverlay:  function(el) { closeOverlay(el); },
    _copyScroll:       _copyScroll,
    _exportScrollFile: _exportScrollFile,
    _importScrollFile: _importScrollFile,
    _applyLoad:        _applyLoad,
    _applyName:     _applyName,
    _applyNameSolo: _applyNameSolo,
    _resetProgress: _resetProgress,
    _designAction:      _designAction,
    _closeDesignPicker: _closeDesignPicker,
    _weakExportCSV: _weakExportCSV,
    _weakCopyText:  _weakCopyText,
    _clanNameEdit:       _clanNameEdit,
    _clanNameSave:       _clanNameSave,
    _clanNameCancel:     _clanNameCancel,
    _bloodlineExportFile:  _bloodlineExportFile,
    _bloodlineImportFile:  _bloodlineImportFile,
    _bloodlineGenerate:  _bloodlineGenerate,
    _bloodlineCopy:      _bloodlineCopy,
    _bloodlineLoad:      _bloodlineLoad,
    _bloodlineInputHint: _bloodlineInputHint,
    _switchSlot:        _switchSlot,
    _addMember:         _addMember,
    _removeMember:      _removeMember,
  };

})(typeof window !== 'undefined' ? window : this);
