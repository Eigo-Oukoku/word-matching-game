/* =========================================================================
 * NinjaCore — drop-in module for sibling Ninja games
 * -------------------------------------------------------------------------
 * Mirrors the eigo-ninja master template.  Designed to be 100% backward
 * compatible with Shadow Clone Scroll strings ("NINJA1.<base64>") generated
 * by eigo-ninja.  Do NOT edit the storage keys or codec without bumping
 * the scroll version — old scrolls would stop loading.
 *
 * Usage in a host HTML game:
 *   1. Inline this whole script inside a <script> block.
 *   2. Configure the per-game profile BEFORE calling Ninja.boot():
 *        Ninja.configure({
 *          gameId:        'sentence-ninja',  // unique per game
 *          xpMultiplier:  0.75,              // sentence:.75, spell:.65, word:.5
 *          slowMs:        12000,             // mode-aware slow threshold
 *          imagePathPrefix: 'images/',       // where ninjaAssets pngs live
 *          gameLabel:     'Sentence Ninja',
 *        });
 *   3. Call Ninja.boot()  — this loads cross-game state from localStorage.
 *   4. Award XP through Ninja.addExp(rawAmount)  — multiplier applied inside.
 *   5. Record per-question results through Ninja.recordAnswer(entry, ok, ms).
 * ========================================================================= */

(function (global) {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // 1.  CONSTANTS  —  must stay byte-identical to eigo-ninja
  // ───────────────────────────────────────────────────────────────────────
  // Per-app cache key (each game can override via configure({storageKey}))
  var DEFAULT_STORAGE_KEY     = 'ninja_app_progress_v1';
  // Shared cross-game key — same as eigo-ninja's NINJA_SHARED_KEY
  var SHARED_KEY              = 'ninja_shared_word_memory_v1';
  // Design selection / unlocks key — same as eigo-ninja's NINJA_DESIGN_STORAGE_KEY
  var DESIGN_KEY              = 'shadowNinjaScroll';
  // Optional one-shot handoff key for cross-page migrations
  var HANDOFF_KEY             = 'ninja_seamless_handoff_v1';

  var LEVEL_CAP               = 1000;
  var LEVEL_FACTOR            = 50;     // level = floor(sqrt(exp / 50))
  var DESIGN_UNLOCK_EVERY     = 5;      // 1 token / 5 levels (+1 free starter)
  var MASTERY_THRESHOLD       = 3;      // ≥3 correct & not lastWrong → drop from weak list

  // ninjaAssets — must match eigo-ninja exactly so designs round-trip via scroll
  var NINJA_ASSETS = {
    ninja_01: { gender: null, file: 'images/Sublect0.png'  },
    ninja_02: { gender: null, file: 'images/Subject 2.png' },
    ninja_03: { gender: null, file: 'images/Subject 3.png' },
    ninja_04: { gender: null, file: 'images/Subject 4.png' },
    ninja_05: { gender: null, file: 'images/Subject 5.png' },
    ninja_06: { gender: null, file: 'images/Subject 6.png' },
    ninja_07: { gender: null, file: 'images/Subject 7.png' },
    ninja_08: { gender: null, file: 'images/Subject 8.png' },
    ninja_09: { gender: null, file: 'images/Subject 9.png' },
    ninja_10: { gender: null, file: 'images/Subject 10.png' },
    ninja_11: { gender: null, file: 'images/Subject 11.png' },
    ninja_12: { gender: null, file: 'images/Subject 12.png' },
    ninja_13: { gender: null, file: 'images/Subject 13.png' },
    ninja_14: { gender: null, file: 'images/Subject 14.png' },
  };
  var NINJA_ASSET_IDS = Object.keys(NINJA_ASSETS);

  // ───────────────────────────────────────────────────────────────────────
  // 2.  STATE
  // ───────────────────────────────────────────────────────────────────────
  var profile = {
    gameId:          'unknown-ninja',
    storageKey:      DEFAULT_STORAGE_KEY,
    xpMultiplier:    1.0,
    slowMs:          10000,
    imagePathPrefix: 'images/',
    gameLabel:       'Ninja',
  };

  var progress = {
    name:           'Ninja',
    nameLocked:     false,
    exp:            0,
    level:          0,
    words:          {},   // wordKey -> { correct, wrong, slow, seen, lastWrong, lastSeenIndex }
    globalIndex:    0,
    totalSessions:  0,
    lastTrainedAt:  0,
  };

  var design = {
    selected: null,   // id of the currently active design (null = no pick yet)
    unlocked: [],     // ordered list of unlocked design ids
  };

  // ───────────────────────────────────────────────────────────────────────
  // 3.  SCROLL CODEC  —  byte-identical to eigo-ninja
  // ───────────────────────────────────────────────────────────────────────
  // FNV-1a-style 32-bit hash → base36.  DO NOT change.
  function ninjaChecksum(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  // UTF-8 safe Base64 encode/decode — matches eigo-ninja helpers exactly.
  function _utf8Btoa(s) { return btoa(unescape(encodeURIComponent(s))); }
  function _utf8Atob(s) { return decodeURIComponent(escape(atob(s))); }

  // generateScrollCode: data → 'NINJA1.<base64>'
  // The wrapping JSON shape ({v, sum, payload}) is a hard contract with
  // eigo-ninja — bump v only with a coordinated migration in all games.
  function generateScrollCode(data) {
    var payload = JSON.stringify(data || {});
    var sum     = ninjaChecksum(payload);
    var wrap    = JSON.stringify({ v: 1, sum: sum, payload: payload });
    return 'NINJA1.' + _utf8Btoa(wrap);
  }
  function loadFromScrollCode(code) {
    if (typeof code !== 'string') throw new Error('scroll code missing');
    var t = code.trim();
    if (t.indexOf('NINJA1.') !== 0) throw new Error('invalid scroll header');
    var wrap;
    try { wrap = JSON.parse(_utf8Atob(t.slice(7))); }
    catch (e) { throw new Error('cannot decode scroll'); }
    if (!wrap || wrap.v !== 1)                       throw new Error('unsupported scroll version');
    if (ninjaChecksum(wrap.payload) !== wrap.sum)    throw new Error('checksum mismatch');
    return JSON.parse(wrap.payload);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4.  XP / LEVEL  —  byte-identical formulas
  // ───────────────────────────────────────────────────────────────────────
  function levelFromExp(e) {
    return Math.min(LEVEL_CAP, Math.floor(Math.sqrt(Math.max(0, e | 0) / LEVEL_FACTOR)));
  }
  function expForLevel(L) { return L * L * LEVEL_FACTOR; }

  // addExp: applies the per-game xpMultiplier *before* adding to the shared
  // pool.  This keeps the master XP value comparable across games.
  function addExp(rawAmount) {
    rawAmount = Math.max(0, rawAmount | 0);
    if (!rawAmount) return 0;
    var scaled = Math.max(1, Math.round(rawAmount * profile.xpMultiplier));
    var before = progress.level;
    progress.exp  += scaled;
    progress.level = levelFromExp(progress.exp);
    saveLocal();
    return progress.level - before; // levels gained this call
  }

  // calculateAnswerExp — eigo-ninja-parity per-question bonus XP formula.
  //
  //   exp = base × (1 + streak × 0.05)
  //         + 2 if firstTimeCorrect
  //         + 3 if recovered (came back from a wrong on this word)
  //
  // Caller passes the per-game `base` (e.g. 5 for Word Ninja, 6 for
  // Spelling, 8 for Sentence Ninja). The xpMultiplier is applied later
  // by addExp(), so don't double-apply.
  //
  // Returns 0 for wrong answers — the wrong path contributes 0 XP and
  // resets the streak counter (caller's responsibility).
  function calculateAnswerExp(opts) {
    opts = opts || {};
    if (!opts.isCorrect) return 0;
    var base = Math.max(0, opts.base | 0);
    if (!base) return 0;
    var streakMul = 1 + ((opts.streak || 0) * 0.05);
    var exp = base * streakMul;
    if (opts.firstTimeCorrect) exp += 2;
    if (opts.recovered)        exp += 3;
    return Math.round(exp);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 5.  WORD MEMORY  —  the Analysis Scroll backbone
  // ───────────────────────────────────────────────────────────────────────
  // entry shape: at minimum { word, jp?, syn?, ex?, exJP?, def? }
  // namespace lets each game keep its own keys while sharing the same DB.
  function wordKey(entry, namespace) {
    var ns = namespace || profile.gameId;
    var w  = (entry && (entry.word || entry.audio || entry.id || '')) + '';
    return ns + '::' + w.toLowerCase();
  }
  function getWord(entry, namespace) {
    var k = wordKey(entry, namespace);
    if (!progress.words[k]) {
      progress.words[k] = {
        correct: 0, wrong: 0, slow: 0,
        seen: false, lastWrong: false, lastSeenIndex: -999,
      };
    }
    return progress.words[k];
  }
  // recordAnswer: returns {firstTimeCorrect, recovered} — same shape as
  // eigo-ninja so callers can award bonuses identically.
  function recordAnswer(entry, isCorrect, timeMs, namespace) {
    if (!entry) return { firstTimeCorrect: false, recovered: false };
    var w = getWord(entry, namespace);
    var wasFirstTime = !w.seen;
    var wasWrong     = w.lastWrong === true;
    w.seen = true;
    progress.globalIndex++;
    w.lastSeenIndex = progress.globalIndex;
    if (isCorrect) { w.correct++; w.lastWrong = false; }
    else           { w.wrong++;   w.lastWrong = true;  }
    var threshold = profile.slowMs || 10000;
    if (typeof timeMs === 'number' && timeMs > threshold) w.slow++;
    saveLocal();
    return {
      firstTimeCorrect: isCorrect && wasFirstTime,
      recovered:        isCorrect && wasWrong,
    };
  }

  // Adaptive weighting (frequency tuning per the user's spec).
  function weight(d) {
    var w = 1 + (d.wrong * 2) - (d.correct * 0.2) + (d.slow * 1.2);
    if (d.lastWrong)                                      w += 5;
    if (!d.seen)                                           w += 3;
    if ((progress.globalIndex - d.lastSeenIndex) <= 2)    return 0;
    return Math.max(0.5, w);
  }
  function weightedSample(entries, count, namespace) {
    var items = entries.map(function (e) { return { e: e, w: weight(getWord(e, namespace)) }; });
    var out   = [];
    while (out.length < count && items.length) {
      var total = 0;
      for (var i = 0; i < items.length; i++) total += items[i].w;
      if (total <= 0) {
        var idx0 = Math.floor(Math.random() * items.length);
        out.push(items.splice(idx0, 1)[0].e);
        continue;
      }
      var r = Math.random() * total, idx = 0;
      for (var j = 0; j < items.length; j++) { r -= items[j].w; if (r <= 0) { idx = j; break; } }
      out.push(items.splice(idx, 1)[0].e);
    }
    return out;
  }

  function isMastered(w) {
    return (w.correct || 0) >= MASTERY_THRESHOLD && !w.lastWrong;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 6.  PERSISTENCE  —  per-app key + shared cross-game key
  // ───────────────────────────────────────────────────────────────────────
  function saveLocal() {
    try {
      // Per-app cache (fast restore, includes session counters)
      localStorage.setItem(profile.storageKey, JSON.stringify({
        name:          progress.name,
        nameLocked:    progress.nameLocked,
        exp:           progress.exp,
        level:         progress.level,
        words:         progress.words,
        globalIndex:   progress.globalIndex,
        totalSessions: progress.totalSessions,
        lastTrainedAt: progress.lastTrainedAt,
      }));
      // SHARED cross-game key — every Ninja game (incl. eigo-ninja) reads
      // from this on boot, so the user's progress flows seamlessly when
      // they jump between games via the Other Games menu.
      localStorage.setItem(SHARED_KEY, JSON.stringify({
        name:          progress.name,
        nameLocked:    progress.nameLocked,
        exp:           progress.exp,
        level:         progress.level,
        words:         progress.words,
        lastTrainedAt: progress.lastTrainedAt,
        updatedAt:     Date.now(),
      }));
    } catch (e) { /* localStorage may be disabled — fail quietly */ }
  }
  function loadLocal() {
    try {
      var raw    = localStorage.getItem(profile.storageKey);
      var shared = localStorage.getItem(SHARED_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        progress.name          = d.name        || progress.name;
        progress.nameLocked    = !!d.nameLocked;
        progress.exp           = d.exp         || 0;
        progress.level         = levelFromExp(progress.exp);
        progress.words         = d.words       || {};
        progress.globalIndex   = d.globalIndex || 0;
        progress.totalSessions = d.totalSessions || 0;
        progress.lastTrainedAt = d.lastTrainedAt || 0;
      }
      if (shared) {
        var s = JSON.parse(shared);
        if (s.words) mergeWords(s.words);
        // Cross-game progress wins if it's higher (the user did more elsewhere)
        if ((s.exp || 0) > progress.exp) {
          progress.exp   = s.exp;
          progress.level = levelFromExp(progress.exp);
        }
        // Adopt cross-game name+lock if local hasn't been claimed
        if (!progress.nameLocked && s.nameLocked) {
          progress.name       = s.name || progress.name;
          progress.nameLocked = true;
        }
        if ((s.lastTrainedAt || 0) > progress.lastTrainedAt) progress.lastTrainedAt = s.lastTrainedAt;
      }
    } catch (e) { /* corrupt blob — start fresh */ }
  }
  function mergeWords(incoming) {
    for (var k in incoming) {
      var a = progress.words[k] || { correct:0, wrong:0, slow:0, seen:false, lastWrong:false, lastSeenIndex:-999 };
      var b = incoming[k]       || {};
      progress.words[k] = {
        correct:   Math.max(a.correct || 0, b.correct || 0),
        wrong:     Math.max(a.wrong   || 0, b.wrong   || 0),
        slow:      Math.max(a.slow    || 0, b.slow    || 0),
        seen:      a.seen || b.seen || false,
        lastWrong: b.lastWrong || a.lastWrong || false,
        lastSeenIndex: a.lastSeenIndex || -999,
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // 7.  EXPORT / IMPORT  —  Shadow Clone Scroll payload shape
  // ───────────────────────────────────────────────────────────────────────
  // exportData shape MUST match eigo-ninja's ninjaExportData() exactly,
  // including the optional `design` block (selected + unlocked array).
  function exportData() {
    return {
      name:          progress.name,
      nameLocked:    progress.nameLocked,
      exp:           progress.exp,
      level:         progress.level,
      words:         progress.words,
      lastTrainedAt: progress.lastTrainedAt,
      design:        { selected: design.selected, unlocked: design.unlocked.slice() },
    };
  }
  // importData mirrors eigo-ninja's ninjaImportData semantics:
  //   • exp is taken as MAX(local, scroll) — never regresses
  //   • words are merged (max counts)
  //   • design is REPLACED (not merged) when the scroll has a design block
  //   • legacy scrolls without a design block leave local design untouched
  //   • name lock auto-engages when scroll carries a name without the flag
  function importData(d) {
    if (!d || typeof d !== 'object') return false;
    if (d.name) progress.name = String(d.name).slice(0, 40);
    if (typeof d.nameLocked === 'boolean') progress.nameLocked = d.nameLocked;
    else if (d.name)                       progress.nameLocked = true;
    if (typeof d.exp === 'number')   progress.exp   = Math.max(progress.exp, d.exp);
    progress.level = levelFromExp(progress.exp);
    if (d.words) mergeWords(d.words);
    if (typeof d.lastTrainedAt === 'number' && d.lastTrainedAt > (progress.lastTrainedAt || 0)) {
      progress.lastTrainedAt = d.lastTrainedAt;
    }
    if (d.design && typeof d.design === 'object') {
      // Drain the in-memory list IN PLACE so any held references stay valid
      design.unlocked.splice(0, design.unlocked.length);
      if (Array.isArray(d.design.unlocked)) {
        d.design.unlocked.forEach(function (id) {
          if (NINJA_ASSETS[id] && design.unlocked.indexOf(id) < 0) design.unlocked.push(id);
        });
      }
      if (d.design.selected && NINJA_ASSETS[d.design.selected]
          && design.unlocked.indexOf(d.design.selected) >= 0) {
        design.selected = d.design.selected;
      } else {
        design.selected = null;
      }
      designSave();
    }
    saveLocal();
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 8.  IDENTITY / NAME LOCK
  // ───────────────────────────────────────────────────────────────────────
  function setName(name) {
    if (progress.nameLocked) return false;
    var safe = (name || '').replace(/[<>]/g, '').trim().slice(0, 20);
    if (!safe) return false;
    progress.name       = safe;
    progress.nameLocked = true;
    saveLocal();
    return true;
  }
  function touchTrained() {
    progress.lastTrainedAt = Date.now();
    saveLocal();
  }
  function formatTimestamp(ms) {
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
    } catch (e) { return '—'; }
  }

  // ───────────────────────────────────────────────────────────────────────
  // 9.  RESET (原点回帰)
  // ───────────────────────────────────────────────────────────────────────
  function resetProgress() {
    progress.name          = 'Ninja';
    progress.nameLocked    = false;
    progress.exp           = 0;
    progress.level         = 0;
    progress.words         = {};
    progress.globalIndex   = 0;
    progress.totalSessions = 0;
    progress.lastTrainedAt = 0;
    try {
      localStorage.removeItem(profile.storageKey);
      localStorage.removeItem(SHARED_KEY);
      localStorage.removeItem(DESIGN_KEY);
      localStorage.removeItem(HANDOFF_KEY);
    } catch (e) {}
    designReset();
  }

  // ───────────────────────────────────────────────────────────────────────
  // 10.  DESIGN (Character Maker)
  // ───────────────────────────────────────────────────────────────────────
  function designSave() {
    try {
      localStorage.setItem(DESIGN_KEY, JSON.stringify({
        selected: design.selected,
        unlocked: design.unlocked,
        v: 2,
      }));
    } catch (e) {}
  }
  function designLoad() {
    try {
      var raw = localStorage.getItem(DESIGN_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        // Accept both v1 (object map) and v2 (array) — same logic as eigo-ninja.
        if (Array.isArray(d.unlocked)) {
          design.unlocked = d.unlocked.filter(function (id) { return NINJA_ASSETS[id]; });
        } else if (d.unlocked && typeof d.unlocked === 'object') {
          design.unlocked = Object.keys(d.unlocked).filter(function (id) { return d.unlocked[id] && NINJA_ASSETS[id]; });
        }
        if (d.selected && NINJA_ASSETS[d.selected] && design.unlocked.indexOf(d.selected) >= 0) {
          design.selected = d.selected;
        }
        return true;
      }
    } catch (e) {}
    return false;
  }
  function designReset() {
    design.selected = null;
    design.unlocked.splice(0, design.unlocked.length);
    try { designSave(); } catch (e) {}
  }
  function designIsUnlocked(id) { return design.unlocked.indexOf(id) >= 0; }
  function designSelectedFile() {
    var sel = design.selected ? NINJA_ASSETS[design.selected] : null;
    return sel ? (profile.imagePathPrefix + sel.file.replace(/^images\//, '')) : '';
  }
  function designTokensTotal()     { return Math.floor((progress.level || 0) / DESIGN_UNLOCK_EVERY) + 1; }
  function designTokensAvailable() { return Math.max(0, designTokensTotal() - design.unlocked.length); }
  function designXpToNextToken() {
    var lvl = progress.level || 0;
    var nextMilestone = (Math.floor(lvl / DESIGN_UNLOCK_EVERY) + 1) * DESIGN_UNLOCK_EVERY;
    return Math.max(0, expForLevel(nextMilestone) - progress.exp);
  }
  function designSelect(id) {
    if (!NINJA_ASSETS[id])     return false;
    if (!designIsUnlocked(id)) return false;
    design.selected = id;
    designSave();
    return true;
  }
  function designUnlock(id) {
    if (!NINJA_ASSETS[id])              return false;
    if (designIsUnlocked(id))           return false;
    if (designTokensAvailable() <= 0)   return false;
    design.unlocked.push(id);
    design.selected = id;
    designSave();
    return true;
  }
  // designStarter — claim the once-per-ninja FREE starter pick.
  //
  // Hardened against the "defer + import" exploit:
  //   • If `unlocked` already has any entries, the starter slot has
  //     effectively been claimed (in this OR another Ninja game via the
  //     shared design key). Refuse — the user must spend a real token
  //     via designUnlock() to add another design.
  //   • This prevents a player who defers their first-game starter and
  //     then imports state with a starter from getting an extra free
  //     pick on top of the imported one.
  function designStarter(id) {
    if (!NINJA_ASSETS[id])             return false;
    if (designIsUnlocked(id))          return false;
    if (design.unlocked.length > 0)    return false; // starter already used elsewhere
    design.unlocked.push(id);
    design.selected = id;
    designSave();
    return true;
  }
  // designHasStarterAvailable — true only when the player has yet to
  // claim ANY design. Used by the picker UI to gate "free starter" cards.
  function designHasStarterAvailable() {
    return design.unlocked.length === 0;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 11.  WEAK WORDS (Analysis Scroll source list)
  // ───────────────────────────────────────────────────────────────────────
  // The host game passes its catalog through here so we can compute the
  // weak list across whatever entries the player has actually seen.
  // Catalogs come in as arrays of {word|jp|syn|ex|exJP|def, ...}.
  function weakWords(catalogs, limit) {
    // catalogs: [{ namespace, label, entries: [...] }]
    var items = [];
    (catalogs || []).forEach(function (cat) {
      (cat.entries || []).forEach(function (entry) {
        var w = getWord(entry, cat.namespace);
        if (!w.seen)            return;
        if (isMastered(w))      return;
        var total = (w.correct || 0) + (w.wrong || 0);
        var acc   = total > 0 ? w.correct / total : 0;
        var need  = (w.wrong * 3) + (w.lastWrong ? 5 : 0) + (w.slow * 1.5) - (w.correct * 0.5);
        if (need > 0 || w.lastWrong) {
          items.push({ entry: entry, label: cat.label || cat.namespace, w: w, need: need, acc: acc });
        }
      });
    });
    items.sort(function (a, b) { return b.need - a.need; });
    return items.slice(0, limit || 60);
  }
  function masteredCount(catalogs) {
    var n = 0;
    (catalogs || []).forEach(function (cat) {
      (cat.entries || []).forEach(function (entry) {
        if (isMastered(getWord(entry, cat.namespace))) n++;
      });
    });
    return n;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 12.  EXPORT HELPERS  —  CSV escape, status header, share badge
  // ───────────────────────────────────────────────────────────────────────
  function csvEscape(s) {
    if (s == null) return '';
    var t = String(s).replace(/"/g, '""');
    return /[",\n]/.test(t) ? '"' + t + '"' : t;
  }
  function shareCard() {
    return '🥷 ' + (progress.name || 'Ninja')
         + ' | Lv ' + progress.level
         + ' | ' + progress.exp + ' XP'
         + ' | ' + (profile.gameLabel || 'Ninja');
  }
  function statusCSVMeta(scrollLabel) {
    var card = shareCard();
    return [
      '# ' + csvEscape(scrollLabel || 'Ninja Scroll'),
      '# Ninja,'        + csvEscape(progress.name || 'Ninja'),
      '# Level,'        + progress.level,
      '# EXP,'          + progress.exp,
      '# Last trained,' + csvEscape(formatTimestamp(progress.lastTrainedAt)),
      '# Share badge,'  + csvEscape(card),
      '',
    ];
  }
  function statusTextHeader(scrollLabel) {
    var card = shareCard();
    return [
      '═══════════════════════════════════════',
      '🥷 ' + (scrollLabel || 'Ninja Scroll'),
      '═══════════════════════════════════════',
      'Ninja:        ' + (progress.name || 'Ninja') + (progress.nameLocked ? ' 🔒' : ''),
      'Level:        ' + progress.level,
      'EXP:          ' + progress.exp.toLocaleString(),
      'Last trained: ' + formatTimestamp(progress.lastTrainedAt),
      'Badge:        ' + card,
      '═══════════════════════════════════════',
      '',
    ];
  }

  // ───────────────────────────────────────────────────────────────────────
  // 13.  SEAMLESS MIGRATION  —  Other Games handoff
  // ───────────────────────────────────────────────────────────────────────
  // Ninja.armHandoff() writes the current scroll into a one-shot key that
  // the next page reads on boot. Combined with same-origin localStorage,
  // this means Other Games navigation is instant — no paste required.
  function armHandoff() {
    try {
      var token = generateScrollCode(exportData());
      localStorage.setItem(HANDOFF_KEY, JSON.stringify({
        token: token, from: profile.gameId, at: Date.now(),
      }));
    } catch (e) {}
  }
  // consumeHandoff is called by boot() — it absorbs and clears any pending
  // handoff blob.  Idempotent: safe to call twice.
  function consumeHandoff() {
    try {
      var raw = localStorage.getItem(HANDOFF_KEY);
      if (!raw) return false;
      var blob = JSON.parse(raw);
      if (!blob || !blob.token) { localStorage.removeItem(HANDOFF_KEY); return false; }
      // Don't import handoffs from ourselves (avoid feedback loops)
      if (blob.from === profile.gameId) { localStorage.removeItem(HANDOFF_KEY); return false; }
      var data = loadFromScrollCode(blob.token);
      importData(data);
      localStorage.removeItem(HANDOFF_KEY);
      return true;
    } catch (e) {
      try { localStorage.removeItem(HANDOFF_KEY); } catch (_) {}
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // 14.  PUBLIC API
  // ───────────────────────────────────────────────────────────────────────
  function configure(opts) {
    Object.keys(opts || {}).forEach(function (k) { profile[k] = opts[k]; });
    if (!profile.storageKey) profile.storageKey = DEFAULT_STORAGE_KEY;
  }
  function boot() {
    loadLocal();
    designLoad();
    consumeHandoff(); // pulls in cross-game state if the previous page armed one
  }

  global.Ninja = {
    // configuration / lifecycle
    configure: configure,
    boot:      boot,

    // raw state (read-only by convention; mutate via APIs below)
    progress:    progress,
    design:      design,
    profile:     profile,
    assets:      NINJA_ASSETS,
    assetIds:    NINJA_ASSET_IDS,
    constants:   {
      LEVEL_CAP: LEVEL_CAP,
      LEVEL_FACTOR: LEVEL_FACTOR,
      DESIGN_UNLOCK_EVERY: DESIGN_UNLOCK_EVERY,
      MASTERY_THRESHOLD: MASTERY_THRESHOLD,
      SHARED_KEY: SHARED_KEY,
      DESIGN_KEY: DESIGN_KEY,
      HANDOFF_KEY: HANDOFF_KEY,
    },

    // XP / level
    addExp:             addExp,
    levelFromExp:       levelFromExp,
    expForLevel:        expForLevel,
    calculateAnswerExp: calculateAnswerExp,

    // word memory / Analysis Scroll
    recordAnswer:    recordAnswer,
    getWord:         getWord,
    wordKey:         wordKey,
    weight:          weight,
    weightedSample:  weightedSample,
    isMastered:      isMastered,
    weakWords:       weakWords,
    masteredCount:   masteredCount,

    // persistence
    saveLocal:     saveLocal,
    loadLocal:     loadLocal,
    mergeWords:    mergeWords,

    // Shadow Clone Scroll
    generateScrollCode: generateScrollCode,
    loadFromScrollCode: loadFromScrollCode,
    exportData:         exportData,
    importData:         importData,

    // identity
    setName:        setName,
    touchTrained:   touchTrained,
    formatTimestamp:formatTimestamp,

    // reset
    resetProgress: resetProgress,

    // character maker
    designSave:             designSave,
    designLoad:             designLoad,
    designReset:            designReset,
    designIsUnlocked:       designIsUnlocked,
    designSelectedFile:     designSelectedFile,
    designTokensTotal:      designTokensTotal,
    designTokensAvailable:  designTokensAvailable,
    designXpToNextToken:    designXpToNextToken,
    designSelect:           designSelect,
    designUnlock:           designUnlock,
    designStarter:          designStarter,
    designHasStarterAvailable: designHasStarterAvailable,

    // exports / share
    csvEscape:        csvEscape,
    shareCard:        shareCard,
    statusCSVMeta:    statusCSVMeta,
    statusTextHeader: statusTextHeader,

    // seamless migration
    armHandoff:     armHandoff,
    consumeHandoff: consumeHandoff,
  };

})(typeof window !== 'undefined' ? window : this);
