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
 *          xpMultiplier:  1.0,               // all games use 1.0 (XP calibrated per-char)
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
  // Clan (忍者の里) system — up to 10 ninjas, Bloodline Scroll
  var CLAN_KEY                = 'ninja_clan_v1';
  var MAX_CLAN_SIZE           = 10;

  var LEVEL_CAP               = 1000;
  var LEVEL_FACTOR            = 50;     // level = floor(sqrt(exp / 50)) → Lv1000 = 50,000,000 XP
  var LEVEL_FACTOR_LEGACY     = 10;     // Patch1 test builds used lf:10 — scale on import
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
    sessionPending: false,  // true from first answer until touchTrained() — local only, never in scroll
  };

  var design = {
    selected: null,   // id of the currently active design (null = no pick yet)
    unlocked: [],     // ordered list of unlocked design ids
  };

  var _clanActiveSlot = 0;   // in-memory cache of the active clan slot index

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

  // calculateAnswerExp — per-question XP for Word Ninja (and similar choice games).
  //
  //   exp = base × streakMul  (+5 firstTimeCorrect, +8 recovered)
  //
  // Word Ninja base values by difficulty:
  //   Easy=20, Normal=28, Hard=36, Very Hard=46, Ninja/Phantom=56, Speedster=12
  //
  // Streak: +0.5% per no-miss streak, capped at +20%.
  //   streakMul = 1 + min(streak × 0.005, 0.20)
  //
  // xpMultiplier (1.0 for all games) is applied inside addExp().
  function calculateAnswerExp(opts) {
    opts = opts || {};
    if (!opts.isCorrect) return 0;
    var base = Math.max(0, +(opts.base) || 0);
    if (!base) return 0;
    var streakMul = 1 + Math.min((opts.streak || 0) * 0.005, 0.20);
    var exp = base * streakMul;
    if (opts.firstTimeCorrect) exp += 5;
    if (opts.recovered)        exp += 8;
    return Math.round(exp);
  }

  // ninjaLevelPenalty — early-game XP gate for Spelling / Sentence / Word Ninja.
  // Prevents brand-new players from grinding the highest-XP-per-minute modes.
  //
  //   Lv  < 15 : × 0.85  (15% cut — noticeable but not punishing)
  //   Lv ≥ 15  : × 1.00  (full rate — reached after ~2–3 weeks of daily play)
  function ninjaLevelPenalty(level) {
    if (level < 15) return 0.85;
    return 1.0;
  }

  // ninjaEigoLevelPenalty — same threshold, kept separate so eigo-ninja.html
  // can override independently if the game designer wants finer control later.
  function ninjaEigoLevelPenalty(level) {
    if (level < 15) return 0.85;
    return 1.0;
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
    // Stamp session-start time on the very first answer of a new session so
    // "Last trained" reflects when the user began, not when they finished.
    if (!progress.sessionPending) {
      progress.lastTrainedAt  = Date.now();
      progress.sessionPending = true;
    }
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
        name:           progress.name,
        nameLocked:     progress.nameLocked,
        exp:            progress.exp,
        level:          progress.level,
        words:          progress.words,
        globalIndex:    progress.globalIndex,
        totalSessions:  progress.totalSessions,
        lastTrainedAt:  progress.lastTrainedAt,
        sessionPending: progress.sessionPending,  // local-only; not in scroll or SHARED_KEY
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
      // Per-slot clan save — keeps the active slot in sync on every write
      _saveSlotProgress(_clanActiveSlot, {
        name:          progress.name,
        nameLocked:    progress.nameLocked,
        exp:           progress.exp,
        level:         progress.level,
        words:         progress.words,
        globalIndex:   progress.globalIndex,
        totalSessions: progress.totalSessions,
        lastTrainedAt: progress.lastTrainedAt,
      });
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
        progress.lastTrainedAt  = d.lastTrainedAt  || 0;
        progress.sessionPending = d.sessionPending || false;
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
      lf:            LEVEL_FACTOR,   // scroll version stamp — used for XP migration
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
    if (typeof d.exp === 'number') {
      var importedExp = d.exp;
      // Legacy scroll migration: if the scroll was generated with LEVEL_FACTOR=50
      // (old system), scale XP down so the player's level stays the same.
      // New scrolls carry lf:10; old scrolls have no lf field (or lf:50).
      var scrollLF = typeof d.lf === 'number' ? d.lf : LEVEL_FACTOR_LEGACY;
      if (scrollLF !== LEVEL_FACTOR && scrollLF > 0) {
        importedExp = Math.round(importedExp * LEVEL_FACTOR / scrollLF);
      }
      progress.exp = Math.max(progress.exp, importedExp);
    }
    progress.level = levelFromExp(progress.exp);
    if (d.words) mergeWords(d.words);
    if (typeof d.lastTrainedAt === 'number' && d.lastTrainedAt > (progress.lastTrainedAt || 0)) {
      progress.lastTrainedAt = d.lastTrainedAt;
    }
    // Scroll represents a known-complete state — clear any in-progress flag.
    progress.sessionPending = false;
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
    // lastTrainedAt is already set at session-start by recordAnswer().
    // Here we only clear the pending flag to signal the session completed.
    progress.sessionPending = false;
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
    progress.name           = 'Ninja';
    progress.nameLocked     = false;
    progress.exp            = 0;
    progress.level          = 0;
    progress.words          = {};
    progress.globalIndex    = 0;
    progress.totalSessions  = 0;
    progress.lastTrainedAt  = 0;
    progress.sessionPending = false;
    try {
      localStorage.removeItem(profile.storageKey);
      localStorage.removeItem(SHARED_KEY);
      localStorage.removeItem(DESIGN_KEY);
      localStorage.removeItem(HANDOFF_KEY);
      // Clear only the active clan slot — other members are unaffected
      localStorage.removeItem(_slotProgressKey(_clanActiveSlot));
      localStorage.removeItem(_slotDesignKey(_clanActiveSlot));
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
      // Also persist to the per-slot design key
      _saveSlotDesign(_clanActiveSlot, { selected: design.selected, unlocked: design.unlocked.slice(), v: 2 });
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
  // 15.  CLAN SYSTEM  —  忍者の里 (up to 10 ninjas, Bloodline Scroll)
  // ───────────────────────────────────────────────────────────────────────
  function _slotProgressKey(n) { return 'ninja_clan_slot_'   + n + '_v1'; }
  function _slotDesignKey(n)   { return 'ninja_clan_design_' + n + '_v1'; }

  function clanGetMeta() {
    try {
      var raw = localStorage.getItem(CLAN_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d === 'object' && Array.isArray(d.slots) && d.slots.length > 0) return d;
      }
    } catch (e) {}
    return null;
  }
  function clanSaveMeta(meta) {
    try { localStorage.setItem(CLAN_KEY, JSON.stringify(meta)); } catch (e) {}
  }
  function getClanName() {
    var meta = clanGetMeta();
    return (meta && meta.name) ? meta.name : '';
  }
  function setClanName(name) {
    var meta = clanGetMeta() || { activeSlot: _clanActiveSlot, slots: [_clanActiveSlot] };
    meta.name = (name || '').trim().slice(0, 30);
    clanSaveMeta(meta);
  }
  function _loadSlotProgress(n) {
    try { var r = localStorage.getItem(_slotProgressKey(n)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function _loadSlotDesign(n) {
    try { var r = localStorage.getItem(_slotDesignKey(n)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function _saveSlotProgress(n, data) {
    try { localStorage.setItem(_slotProgressKey(n), JSON.stringify(data)); } catch (e) {}
  }
  function _saveSlotDesign(n, d) {
    try { localStorage.setItem(_slotDesignKey(n), JSON.stringify(d)); } catch (e) {}
  }

  // _captureCurrentToSlot — snapshot current in-memory state into a slot
  function _captureCurrentToSlot(n) {
    _saveSlotProgress(n, {
      name: progress.name, nameLocked: progress.nameLocked,
      exp: progress.exp, level: progress.level, words: progress.words,
      globalIndex: progress.globalIndex, totalSessions: progress.totalSessions,
      lastTrainedAt: progress.lastTrainedAt, sessionPending: progress.sessionPending,
    });
    _saveSlotDesign(n, { selected: design.selected, unlocked: design.unlocked.slice(), v: 2 });
  }

  // _applySlotToMemory — load a slot's data into progress/design state
  function _applySlotToMemory(n) {
    var d = _loadSlotProgress(n);
    if (d) {
      progress.name          = d.name          || 'Ninja';
      progress.nameLocked    = !!d.nameLocked;
      progress.exp           = d.exp           || 0;
      progress.level         = levelFromExp(progress.exp);
      progress.words         = d.words         || {};
      progress.globalIndex   = d.globalIndex   || 0;
      progress.totalSessions = d.totalSessions || 0;
      progress.lastTrainedAt  = d.lastTrainedAt  || 0;
      progress.sessionPending = d.sessionPending || false;
    } else {
      // Brand-new empty slot
      progress.name = 'Ninja'; progress.nameLocked = false;
      progress.exp = 0; progress.level = 0; progress.words = {};
      progress.globalIndex = 0; progress.totalSessions = 0;
      progress.lastTrainedAt = 0; progress.sessionPending = false;
    }
    var des = _loadSlotDesign(n);
    design.selected = null;
    design.unlocked.splice(0, design.unlocked.length);
    if (des && Array.isArray(des.unlocked)) {
      des.unlocked.forEach(function (id) {
        if (NINJA_ASSETS[id] && design.unlocked.indexOf(id) < 0) design.unlocked.push(id);
      });
      if (des.selected && NINJA_ASSETS[des.selected] && design.unlocked.indexOf(des.selected) >= 0) {
        design.selected = des.selected;
      }
    }
    _clanActiveSlot = n;
  }

  // clanBoot — called by boot() to initialise the clan system.
  //   • If clan meta exists → load active slot (overrides loadLocal data)
  //   • If no meta          → first-run: register current state as slot 0
  function clanBoot() {
    var meta = clanGetMeta();
    if (meta) {
      var active = typeof meta.activeSlot === 'number' ? meta.activeSlot : meta.slots[0];
      if (meta.slots.indexOf(active) < 0) active = meta.slots[0];
      _applySlotToMemory(active);
      if (meta.activeSlot !== active) { meta.activeSlot = active; clanSaveMeta(meta); }
    } else {
      // Migrate current data (from loadLocal / legacy shared key) to slot 0
      _captureCurrentToSlot(0);
      clanSaveMeta({ activeSlot: 0, slots: [0] });
      _clanActiveSlot = 0;
    }
  }

  // clanSetActiveSlot — save current slot then switch to slot n
  function clanSetActiveSlot(n) {
    var meta = clanGetMeta();
    if (!meta || meta.slots.indexOf(n) < 0) return false;
    _captureCurrentToSlot(_clanActiveSlot);
    meta.activeSlot = n;
    clanSaveMeta(meta);
    _applySlotToMemory(n);
    saveLocal(); // mirror to SHARED_KEY so cross-game nav stays correct
    return true;
  }

  // clanAddMember — allocate the next free slot (up to MAX_CLAN_SIZE)
  function clanAddMember() {
    var meta = clanGetMeta();
    if (!meta || meta.slots.length >= MAX_CLAN_SIZE) return -1;
    var n = 0; while (meta.slots.indexOf(n) >= 0) n++;
    meta.slots.push(n); meta.slots.sort(function (a, b) { return a - b; });
    clanSaveMeta(meta);
    return n;
  }

  // clanRemoveMember — delete slot n (cannot remove if it is the only member)
  function clanRemoveMember(n) {
    var meta = clanGetMeta();
    if (!meta || meta.slots.length <= 1) return false;
    var idx = meta.slots.indexOf(n); if (idx < 0) return false;
    try { localStorage.removeItem(_slotProgressKey(n)); } catch (e) {}
    try { localStorage.removeItem(_slotDesignKey(n));   } catch (e) {}
    meta.slots.splice(idx, 1);
    if (meta.activeSlot === n) {
      meta.activeSlot = meta.slots[0];
      clanSaveMeta(meta);
      _applySlotToMemory(meta.activeSlot);
      saveLocal();
    } else { clanSaveMeta(meta); }
    return true;
  }

  // clanMembers — summary array for UI rendering (name / level / design)
  function clanMembers() {
    var meta   = clanGetMeta();
    var slots  = meta ? meta.slots  : [_clanActiveSlot];
    var active = meta ? meta.activeSlot : _clanActiveSlot;
    return slots.map(function (n) {
      if (n === active) {
        return { slot: n, active: true,
                 name: progress.name, nameLocked: progress.nameLocked,
                 exp: progress.exp, level: progress.level,
                 lastTrainedAt: progress.lastTrainedAt,
                 designSelected: design.selected, designUnlocked: design.unlocked.slice() };
      }
      var d = _loadSlotProgress(n) || {}, des = _loadSlotDesign(n) || {};
      return { slot: n, active: false,
               name: d.name || 'Ninja', nameLocked: !!d.nameLocked,
               exp: d.exp || 0, level: levelFromExp(d.exp || 0),
               lastTrainedAt: d.lastTrainedAt || 0,
               designSelected: des.selected || null, designUnlocked: des.unlocked || [] };
    });
  }
  function clanGetActiveSlot() { return _clanActiveSlot; }
  function clanSlotCount()     { var m = clanGetMeta(); return m ? m.slots.length : 1; }

  // ── Bloodline Scroll codec ──────────────────────────────────────────────
  // CLAN2 (current)  — compact JSON, ~60 % smaller than CLAN1.
  // CLAN1 (legacy)   — still parsed for backward compatibility.
  //
  // Compact format rules (CLAN2):
  //   Outer:   { as, m[] }                 (activeSlot, members)
  //   Member:  { sl,n,nl?,e,gi,ts,lt,d?,lf,w }
  //              slot, name, nameLocked(omit if false), exp,
  //              globalIndex, totalSessions, lastTrainedAt,
  //              design(omit if empty), lf, words
  //   Word key: namespace abbreviated (see _C2NS), e.g. "W2::apple"
  //   Word val: { c?,w?,s?,lw?,li? }       zeros/false omitted; seen=true implied

  var _C2NS = {                              // full namespace → 2-char code
    'word-ninja-v2':  'W2', 'word-ninja-v1': 'W1',
    'eigo-ninja':     'EN', 'spelling-ninja':'SP', 'sentence-ninja':'SN',
  };
  var _C2NSR = (function () {               // reverse map
    var r = {};
    for (var k in _C2NS) r[_C2NS[k]] = k;
    return r;
  }());

  function _c2WordKey(full) {
    var i = full.indexOf('::');
    if (i < 0) return full;
    var ns = full.slice(0, i), word = full.slice(i + 2);
    return (_C2NS[ns] || ns) + '::' + word;
  }
  function _c2WordKeyR(compact) {
    var i = compact.indexOf('::');
    if (i < 0) return compact;
    var ns = compact.slice(0, i), word = compact.slice(i + 2);
    return (_C2NSR[ns] || ns) + '::' + word;
  }
  function _c2PackWords(words) {
    var out = {};
    for (var k in words) {
      var w = words[k]; var e = {};
      if (w.correct)                              e.c  = w.correct;
      if (w.wrong)                                e.w  = w.wrong;
      if (w.slow)                                 e.s  = w.slow;
      if (w.lastWrong)                            e.lw = true;
      if (w.lastSeenIndex && w.lastSeenIndex > -990) e.li = w.lastSeenIndex;
      out[_c2WordKey(k)] = e;
    }
    return out;
  }
  function _c2UnpackWords(packed) {
    var out = {};
    for (var k in packed) {
      var e = packed[k];
      out[_c2WordKeyR(k)] = {
        correct:       e.c  || 0,
        wrong:         e.w  || 0,
        slow:          e.s  || 0,
        seen:          true,
        lastWrong:     !!e.lw,
        lastSeenIndex: e.li != null ? e.li : -999,
      };
    }
    return out;
  }
  function _c2PackMember(d, des, slot) {
    var m = {
      sl: slot,
      n:  d.name || 'Ninja',
      e:  d.exp  || 0,
      gi: d.globalIndex    || 0,
      ts: d.totalSessions  || 0,
      lt: d.lastTrainedAt  || 0,
      lf: LEVEL_FACTOR,
      w:  _c2PackWords(d.words || {}),
    };
    if (d.nameLocked) m.nl = true;
    if (des && (des.selected || (des.unlocked && des.unlocked.length))) {
      m.d = {};
      if (des.selected)                           m.d.s = des.selected;
      if (des.unlocked && des.unlocked.length)    m.d.u = des.unlocked;
    }
    return m;
  }
  function _c2UnpackMember(m) {
    var scrollLF = m.lf || LEVEL_FACTOR;
    var exp = m.e || 0;
    if (scrollLF !== LEVEL_FACTOR && scrollLF > 0)
      exp = Math.round(exp * LEVEL_FACTOR / scrollLF);
    return {
      slot:          m.sl,
      name:          m.n  || 'Ninja',
      nameLocked:    !!m.nl,
      exp:           exp,
      level:         levelFromExp(exp),
      words:         _c2UnpackWords(m.w || {}),
      globalIndex:   m.gi || 0,
      totalSessions: m.ts || 0,
      lastTrainedAt: m.lt || 0,
      design: { selected: (m.d && m.d.s) || null, unlocked: (m.d && m.d.u) || [] },
      lf:            LEVEL_FACTOR,   // already migrated above
    };
  }

  function generateBloodlineScroll() {
    _captureCurrentToSlot(_clanActiveSlot);   // flush in-memory state first
    var meta = clanGetMeta() || { activeSlot: _clanActiveSlot, slots: [_clanActiveSlot] };
    var members = meta.slots.map(function (n) {
      return _c2PackMember(_loadSlotProgress(n) || {}, _loadSlotDesign(n) || {}, n);
    });
    var inner = { as: meta.activeSlot, m: members };
    if (meta.name) inner.cn = meta.name;
    var payload = JSON.stringify(inner);
    var sum  = ninjaChecksum(payload);
    var wrap = JSON.stringify({ v: 2, sum: sum, payload: payload });
    return 'CLAN2.' + _utf8Btoa(wrap);
  }

  function parseBloodlineScroll(code) {
    if (typeof code !== 'string') throw new Error('scroll code missing');
    var t = code.trim();

    if (t.indexOf('CLAN2.') === 0) {
      // ── Current compact format ──
      var w2;
      try { w2 = JSON.parse(_utf8Atob(t.slice(6))); } catch (e) { throw new Error('cannot decode bloodline scroll'); }
      if (!w2 || w2.v !== 2)                    throw new Error('unsupported bloodline scroll version');
      if (ninjaChecksum(w2.payload) !== w2.sum) throw new Error('checksum mismatch');
      var c2 = JSON.parse(w2.payload);
      // Expand to the shape importBloodlineScroll expects
      var result2 = {
        clanV:      1,
        activeSlot: c2.as,
        members:    (c2.m || []).map(_c2UnpackMember),
      };
      if (c2.cn) result2.clanName = c2.cn;
      return result2;
    }

    if (t.indexOf('CLAN1.') === 0) {
      // ── Legacy format — kept for backward compatibility ──
      var w1;
      try { w1 = JSON.parse(_utf8Atob(t.slice(6))); } catch (e) { throw new Error('cannot decode bloodline scroll'); }
      if (!w1 || w1.v !== 1)                    throw new Error('unsupported bloodline scroll version');
      if (ninjaChecksum(w1.payload) !== w1.sum) throw new Error('checksum mismatch');
      var c1 = JSON.parse(w1.payload);
      // CLAN1 stored lf per-member; migrate XP here so importBloodlineScroll
      // can treat every member uniformly (lf already = LEVEL_FACTOR).
      if (Array.isArray(c1.members)) {
        c1.members = c1.members.map(function (m) {
          var scrollLF = typeof m.lf === 'number' ? m.lf : LEVEL_FACTOR;
          if (scrollLF !== LEVEL_FACTOR && scrollLF > 0)
            m.exp = Math.round((m.exp || 0) * LEVEL_FACTOR / scrollLF);
          m.lf = LEVEL_FACTOR;
          m.level = levelFromExp(m.exp || 0);
          return m;
        });
      }
      return c1;
    }

    throw new Error('invalid bloodline scroll header');
  }

  // importBloodlineScroll — restore all members; XP scaled via lf if needed
  function importBloodlineScroll(data) {
    if (!data || !Array.isArray(data.members) || !data.members.length) return false;
    data.members.forEach(function (m) {
      var n = m.slot;
      if (typeof n !== 'number' || n < 0 || n >= MAX_CLAN_SIZE) return;
      var importedExp = m.exp || 0;
      var scrollLF    = typeof m.lf === 'number' ? m.lf : LEVEL_FACTOR;
      if (scrollLF !== LEVEL_FACTOR && scrollLF > 0)
        importedExp = Math.round(importedExp * LEVEL_FACTOR / scrollLF);
      _saveSlotProgress(n, {
        name: m.name || 'Ninja', nameLocked: !!m.nameLocked,
        exp: importedExp, level: levelFromExp(importedExp),
        words: m.words || {}, globalIndex: m.globalIndex || 0,
        totalSessions: m.totalSessions || 0, lastTrainedAt: m.lastTrainedAt || 0,
      });
      if (m.design) _saveSlotDesign(n, { selected: m.design.selected || null, unlocked: m.design.unlocked || [], v: 2 });
    });
    var newSlots = data.members
      .map(function (m) { return m.slot; })
      .filter(function (n) { return typeof n === 'number' && n >= 0 && n < MAX_CLAN_SIZE; })
      .sort(function (a, b) { return a - b; });
    var activeSlot = typeof data.activeSlot === 'number' ? data.activeSlot : newSlots[0];
    if (newSlots.indexOf(activeSlot) < 0) activeSlot = newSlots[0];
    var newMeta = { activeSlot: activeSlot, slots: newSlots };
    if (data.clanName) newMeta.name = data.clanName;
    clanSaveMeta(newMeta);
    _applySlotToMemory(activeSlot);
    saveLocal();
    return true;
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
    clanBoot();       // clan init — migrates legacy data or loads active slot
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
      CLAN_KEY: CLAN_KEY,
      MAX_CLAN_SIZE: MAX_CLAN_SIZE,
    },

    // XP / level
    addExp:                addExp,
    levelFromExp:          levelFromExp,
    expForLevel:           expForLevel,
    calculateAnswerExp:    calculateAnswerExp,
    ninjaLevelPenalty:     ninjaLevelPenalty,
    ninjaEigoLevelPenalty: ninjaEigoLevelPenalty,

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

    // clan system (忍者の里)
    clanMembers:             clanMembers,
    clanGetActiveSlot:       clanGetActiveSlot,
    clanSlotCount:           clanSlotCount,
    clanSetActiveSlot:       clanSetActiveSlot,
    clanAddMember:           clanAddMember,
    clanRemoveMember:        clanRemoveMember,
    getClanName:             getClanName,
    setClanName:             setClanName,
    generateBloodlineScroll:   generateBloodlineScroll,
    parseBloodlineScroll:      parseBloodlineScroll,
    importBloodlineScroll:     importBloodlineScroll,
  };

})(typeof window !== 'undefined' ? window : this);
