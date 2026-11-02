/*
 * game.js — 深渊回响 ABYSS ECHO · H5 版（v2）
 *
 * 交互核心：开心消消乐式「跟手滑动消除」
 *  1. 按住宝石 → 宝石抬起放大并跟手位移，目标格高亮
 *  2. 松手 → 与相邻宝石弹性交换；不足阈值则回弹
 *  3. 三连 → 闪光 + 爆裂粒子 + 分数跳字 → 重力下落 → 连锁连击
 *  4. 四连生成直线炸弹、拐角生成 3×3 爆破弹
 *  5. 全程 WebAudio 合成音效（无外部音频资源）
 */
(function () {
  'use strict';

  const B = window.BoardLib;
  const Shop = window.AbyssShop;

  /* ============================== 常量 ============================== */
  const ROWS = 8, COLS = 8;
  const CELL_MS_SWAP = 168;
  const EASE_SWAP = 'cubic-bezier(.2,.9,.3,1.18)';
  const EASE_FALL = 'cubic-bezier(.45,.05,.55,1)';
  const EASE_BACK = 'cubic-bezier(.34,1.56,.64,1)';

  const GEM_ICONS = (window.GEM_DATA && window.GEM_DATA.list) || [
    'assets/gem_rune.png',
    'assets/gem_tentacle.png',
    'assets/gem_eye.png',
    'assets/gem_skull.png',
    'assets/gem_spore.png',
  ];

  // 0红符文(伤害3) 1紫触手(伤害2) 2绿眼(伤害2) 3骨颅(回理智2) 4青孢(回生命2)
  const TYPE_META = [
    { name: '血符文', tint: 'rgba(224,100,100,.40)', glow: '#E06464', dmg: 3, life: 0, sanity: 0 },
    { name: '虚空触手', tint: 'rgba(185,139,224,.40)', glow: '#B98BE0', dmg: 2, life: 0, sanity: 0 },
    { name: '深渊之眼', tint: 'rgba(139,212,80,.38)', glow: '#8BD450', dmg: 2, life: 0, sanity: 0 },
    { name: '骨颅', tint: 'rgba(216,210,192,.30)', glow: '#D8D2C0', dmg: 0, life: 0, sanity: 2 },
    { name: '寄生孢子', tint: 'rgba(111,224,200,.40)', glow: '#6FE0C8', dmg: 0, life: 2, sanity: 0 },
  ];

  const WEAPON_DMG = 40;
  const WEAPON_MAX = 100;
  const BOSS_MAX_HP = 320;
  const BOSS_ATTACK_LIFE = 16, BOSS_ATTACK_SANITY = 10;
  const BOSS_NAME = '深渊主宰 · 阿撒托斯之喉';

  // 商店 · 亵渎祭坛

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  /* ============================== 音效 ============================== */
  const Sfx = (function () {
    let ctx = null;
    let enabled = true;

    function ac() {
      if (!enabled) return null;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) { return null; }
    }

    function tone(opt) {
      const c = ac();
      if (!c) return;
      const t0 = c.currentTime + (opt.delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(opt.f, t0);
      if (opt.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opt.f2), t0 + opt.dur);
      const vol = (opt.vol == null ? 0.12 : opt.vol);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + opt.dur + 0.02);
    }

    function noise(dur, vol, hp) {
      const c = ac();
      if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp || 400;
      const g = c.createGain();
      g.gain.value = vol == null ? 0.08 : vol;
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start();
    }

    return {
      unlock: function () { ac(); },
      setEnabled: function (v) { enabled = !!v; },
      swap: function () { tone({ f: 520, f2: 680, type: 'sine', dur: 0.10, vol: 0.07 }); },
      invalid: function () { tone({ f: 190, f2: 130, type: 'triangle', dur: 0.14, vol: 0.08 }); },
      pop: function (combo) {
        const base = 480 * Math.pow(1.09, Math.min(combo - 1, 8));
        tone({ f: base, f2: base * 1.7, type: 'triangle', dur: 0.12, vol: 0.10 });
        noise(0.10, 0.05, 900);
      },
      land: function () { noise(0.05, 0.035, 300); },
      special: function () {
        tone({ f: 300, f2: 900, type: 'sawtooth', dur: 0.22, vol: 0.10 });
        noise(0.18, 0.07, 600);
      },
      boss: function () {
        tone({ f: 110, f2: 55, type: 'sawtooth', dur: 0.5, vol: 0.14 });
        noise(0.4, 0.10, 200);
      },
      win: function () {
        [523, 659, 784, 1047].forEach(function (f, i) {
          tone({ f: f, type: 'triangle', dur: 0.22, vol: 0.11, delay: i * 0.11 });
        });
      },
      lose: function () {
        [330, 262, 196].forEach(function (f, i) {
          tone({ f: f, type: 'sawtooth', dur: 0.3, vol: 0.10, delay: i * 0.14 });
        });
      },
    };
  })();

  /* ============================== 状态 ============================== */
  const S = {
    board: null,          // 逻辑棋盘 [r][c] = {id,type,special}
    grid: null,           // 视图棋盘 [r][c] = tile
    tiles: new Map(),     // id -> tile
    busy: false, paused: false, over: false, started: false,
    boss: null, player: null, weapon: null,
    turn: 1, layer: 7, combo: 0, maxCombo: 1, score: 0,
    lastSwap: null,
    selected: null,
    targetMark: null,
    essence: 80,
    buffs: {},
    aim: null,
    aimFirst: null,
    itemBar: [],
  };

  /* ============================== DOM ============================== */
  const screenBattle = document.getElementById('screen-battle');
  const screenSettle = document.getElementById('screen-settle');
  const screenShop = document.getElementById('screen-shop');
  let el = {};

  function buildShell() {
    screenBattle.innerHTML =
      '<div class="battle-inner">' +
        '<div class="boss-panel">' +
          '<div class="boss-head">' +
            '<span class="boss-name">' + BOSS_NAME + '</span>' +
            '<span class="phase-tag">阶段 1 / 3</span>' +
          '</div>' +
          '<div class="hp-bar"><div class="hp-fill"></div><span class="hp-label">HP 320 / 320</span></div>' +
          '<div class="telegraph">⚠ 深渊凝视蓄力中 · 3 回合后发动</div>' +
        '</div>' +
        '<div class="hud">' +
          '<div class="stat"><span class="stat-label">生命 LIFE</span>' +
            '<div class="mini-bar"><div class="mini-fill life"></div></div>' +
            '<span class="stat-val life-val">100</span></div>' +
          '<div class="stat"><span class="stat-label">理智 SANITY</span>' +
            '<div class="mini-bar"><div class="mini-fill sanity"></div></div>' +
            '<span class="stat-val sanity-val">100</span></div>' +
        '</div>' +
        '<div class="board-wrap">' +
          '<div class="board">' +
            '<div class="board-grid"></div>' +
            '<div class="tile-layer"></div>' +
            '<div class="fx-layer"></div>' +
          '</div>' +
          '<div class="combo-layer"></div>' +
        '</div>' +
        '<div class="tipbar">按住宝石向任意方向滑动 · 三个连成一线即可消除</div>' +
        '<div class="items" id="item-bar" hidden></div>' +
        '<div class="aim-bar" hidden><span class="aim-text"></span><span class="aim-cancel" data-action="cancel-aim">取消</span></div>' +
        '<div class="weapon">' +
          '<div class="weapon-bar"><div class="weapon-fill"></div></div>' +
          '<button class="weapon-btn" data-action="weapon" disabled>释放生物武器（充能 0%）</button>' +
        '</div>' +
        '<div class="footer">' +
          '<span class="turn">第 1 回合</span>' +
          '<span class="score">得分 0</span>' +
          '<button class="pause-btn" data-action="pause">暂停</button>' +
        '</div>' +
        '<div class="overlay" hidden><div class="overlay-panel">' +
          '<span class="overlay-title">暂停</span>' +
          '<span class="overlay-sub">PAUSED · 第 7 层潜入中</span>' +
          '<button class="ov-btn primary" data-action="resume">继续潜入</button>' +
          '<button class="ov-btn" data-action="restart">重新开始本层</button>' +
          '<button class="ov-btn danger" data-action="abandon">放弃潜入</button>' +
        '</div></div>' +
      '</div>';

    el = {
      bossName: screenBattle.querySelector('.boss-name'),
      phase: screenBattle.querySelector('.phase-tag'),
      hpFill: screenBattle.querySelector('.hp-fill'),
      hpLabel: screenBattle.querySelector('.hp-label'),
      telegraph: screenBattle.querySelector('.telegraph'),
      lifeFill: screenBattle.querySelector('.mini-fill.life'),
      sanityFill: screenBattle.querySelector('.mini-fill.sanity'),
      lifeVal: screenBattle.querySelector('.life-val'),
      sanityVal: screenBattle.querySelector('.sanity-val'),
      boardWrap: screenBattle.querySelector('.board-wrap'),
      board: screenBattle.querySelector('.board'),
      gridLayer: screenBattle.querySelector('.board-grid'),
      tileLayer: screenBattle.querySelector('.tile-layer'),
      fxLayer: screenBattle.querySelector('.fx-layer'),
      comboLayer: screenBattle.querySelector('.combo-layer'),
      turn: screenBattle.querySelector('.turn'),
      score: screenBattle.querySelector('.score'),
      weaponFill: screenBattle.querySelector('.weapon-fill'),
      weaponBtn: screenBattle.querySelector('.weapon-btn'),
      overlay: screenBattle.querySelector('.overlay'),
      itemsLayer: screenBattle.querySelector('#item-bar'),
      aimBar: screenBattle.querySelector('.aim-bar'),
      aimText: screenBattle.querySelector('.aim-text'),
    };

    // 底格
    let cellsHtml = '';
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        cellsHtml += '<i class="' + ((r + c) % 2 ? 'alt' : '') + '"></i>';
    el.gridLayer.innerHTML = cellsHtml;
  }

  /* ============================== 棋盘视图 ============================== */
  function tintOf(type) { return TYPE_META[type].tint; }

  function applyLook(t) {
    const m = TYPE_META[t.cell.type];
    t.el.style.setProperty('--tint', m.tint);
    t.el.style.setProperty('--glow', m.glow);
    t.img.src = GEM_ICONS[t.cell.type];
    const special = t.cell.special;
    t.el.classList.toggle('sp-line', special === 'line');
    t.el.classList.toggle('sp-bomb', special === 'bomb');
    t.badge.textContent = special === 'line' ? '↯' : (special === 'bomb' ? '✹' : '');
  }

  function setTransform(t, r, c, dur, ease) {
    if (dur) {
      t.el.style.transition = 'transform ' + dur + 'ms ' + (ease || EASE_SWAP);
    } else {
      t.el.style.transition = 'none';
    }
    t.el.style.transform = 'translate3d(' + (c * 100) + '%,' + (r * 100) + '%,0)';
  }

  function createTile(cell, r, c, spawnRow) {
    const node = document.createElement('div');
    node.className = 'tile';
    node.dataset.id = cell.id;
    node.innerHTML = '<div class="tile-inner"><img alt="" draggable="false"><span class="badge"></span></div>';
    const t = {
      id: cell.id, cell: cell, r: r, c: c,
      el: node,
      inner: node.querySelector('.tile-inner'),
      img: node.querySelector('img'),
      badge: node.querySelector('.badge'),
    };
    S.tiles.set(cell.id, t);
    S.grid[r][c] = t;
    applyLook(t);
    setTransform(t, spawnRow == null ? r : spawnRow, c, 0);
    el.tileLayer.appendChild(node);
    return t;
  }

  function buildTiles() {
    el.tileLayer.innerHTML = '';
    S.tiles.clear();
    const pending = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = createTile(S.board[r][c], r, c, r - ROWS - 1);
        pending.push(t);
      }
    }
    // 依次落入
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (const t of pending) {
          const delay = (t.r + t.c) * 26;
          t.el.style.transitionDelay = delay + 'ms';
          setTransform(t, t.r, t.c, 460, EASE_FALL);
          setTimeout(function () {
            t.el.style.transitionDelay = '';
            squash(t);
          }, delay + 440);
        }
      });
    });
  }

  function squash(t) {
    if (!t.el.isConnected) return;
    t.inner.classList.remove('land');
    void t.inner.offsetWidth;
    t.inner.classList.add('land');
    setTimeout(function () { t.inner.classList.remove('land'); }, 220);
  }

  /* ============================== 特效 ============================== */
  function burst(c, r, color, power) {
    const p = power || 1;
    const n = p > 1 ? 10 : 6;
    const x = ((c + 0.5) / COLS) * 100;
    const y = ((r + 0.5) / ROWS) * 100;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.background = color;
      s.style.left = x + '%';
      s.style.top = y + '%';
      s.style.width = s.style.height = (3 + Math.random() * 4) + 'px';
      el.fxLayer.appendChild(s);
      const ang = Math.random() * Math.PI * 2;
      const dist = (18 + Math.random() * 44) * p;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 8;
      const a = s.animate([
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(0) rotate(' + (Math.random() * 240 - 120) + 'deg)', opacity: 0 },
      ], { duration: 360 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.3,1)' });
      a.onfinish = function () { s.remove(); };
    }
  }

  function scorePop(c, r, text, cls) {
    const d = document.createElement('div');
    d.className = 'score-pop ' + (cls || '');
    d.textContent = text;
    d.style.left = ((c + 0.5) / COLS) * 100 + '%';
    d.style.top = ((r + 0.5) / ROWS) * 100 + '%';
    el.fxLayer.appendChild(d);
    const a = d.animate([
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-72%) scale(1.12)', opacity: 1, offset: 0.22 },
      { transform: 'translate(-50%,-150%) scale(1)', opacity: 0 },
    ], { duration: 780, easing: 'cubic-bezier(.2,.8,.3,1)' });
    a.onfinish = function () { d.remove(); };
  }

  function showCombo(n) {
    const words = { 2: '不错', 3: '漂亮', 4: '太棒了', 5: '不可思议' };
    const w = words[Math.min(n, 5)] || '深渊共鸣';
    const d = document.createElement('div');
    d.className = 'combo-banner';
    d.innerHTML = '<span class="combo-word">' + w + '</span><span class="combo-num">×' + n + '</span>';
    el.comboLayer.appendChild(d);
    const a = d.animate([
      { transform: 'translate(-50%,-50%) scale(.4) rotate(-6deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.15) rotate(2deg)', opacity: 1, offset: 0.28 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%,-62%) scale(1.04)', opacity: 0 },
    ], { duration: 900, easing: 'cubic-bezier(.2,.8,.3,1)' });
    a.onfinish = function () { d.remove(); };
  }

  function shake(kind) {
    el.boardWrap.classList.remove('shake-soft', 'shake-hard');
    void el.boardWrap.offsetWidth;
    el.boardWrap.classList.add(kind === 'hard' ? 'shake-hard' : 'shake-soft');
    setTimeout(function () {
      el.boardWrap.classList.remove('shake-soft', 'shake-hard');
    }, 420);
  }

  function bossFlash() {
    el.bossName.classList.remove('hit');
    void el.bossName.offsetWidth;
    el.bossName.classList.add('hit');
    setTimeout(function () { el.bossName.classList.remove('hit'); }, 400);
  }

  /* ============================== HUD ============================== */
  function updateHUD() {
    const s = S;
    const hpPct = Math.max(0, s.boss.hp / s.boss.maxHp * 100);
    el.hpFill.style.width = hpPct + '%';
    el.hpLabel.textContent = 'HP ' + s.boss.hp + ' / ' + s.boss.maxHp;
    el.phase.textContent = '阶段 ' + s.boss.phase + ' / 3';
    el.telegraph.textContent = '⚠ 深渊凝视蓄力中 · ' + s.boss.attackIn + ' 回合后发动';
    el.lifeFill.style.width = Math.max(0, s.player.life / s.player.maxLife * 100) + '%';
    el.sanityFill.style.width = Math.max(0, s.player.sanity / s.player.maxSanity * 100) + '%';
    el.lifeVal.textContent = Math.round(s.player.life);
    el.sanityVal.textContent = Math.round(s.player.sanity);
    el.turn.textContent = '第 ' + s.turn + ' 回合';
    el.score.textContent = '得分 ' + s.score;
    const wpn = Math.min(100, s.weapon.charge / s.weapon.max * 100);
    el.weaponFill.style.width = wpn + '%';
    if (s.weapon.ready) {
      el.weaponBtn.disabled = false;
      el.weaponBtn.classList.add('ready');
      el.weaponBtn.textContent = '释放生物武器 · 充能完毕';
    } else {
      el.weaponBtn.disabled = true;
      el.weaponBtn.classList.remove('ready');
      el.weaponBtn.textContent = '释放生物武器（充能 ' + Math.floor(wpn) + '%）';
    }
  }

  /* ============================== 开局 ============================== */
  function newBattle(layer) {
    S.boss = { name: BOSS_NAME, hp: BOSS_MAX_HP, maxHp: BOSS_MAX_HP, phase: 1, attackIn: 3 };
    S.player = { life: 100, maxLife: 100, sanity: 100, maxSanity: 100 };
    S.weapon = { charge: 0, max: WEAPON_MAX, ready: false };
    S.turn = 1; S.combo = 0; S.maxCombo = 1; S.score = 0;
    S.busy = false; S.paused = false; S.over = false; S.selected = null; S.abandoned = false;
    S.buffs = Shop.consumeBuffs();
    S.aim = null;
    S.aimFirst = null;
    if (el.aimBar) el.aimBar.hidden = true;
    S.layer = layer || 7;

    let board = B.createBoard(ROWS, COLS);
    let guard = 0;
    while (guard++ < 30 && (B.findMatches(board).length > 0 || !B.hasPossibleMove(board))) {
      board = B.createBoard(ROWS, COLS);
    }
    S.board = board;
    S.grid = [];
    for (let r = 0; r < ROWS; r++) S.grid.push(new Array(COLS).fill(null));

    buildTiles();
    updateHUD();
    el.overlay.hidden = true;
    showScreen('battle');
    S.started = true;
    refreshItems();
    refreshAltarBalance();
    announceBuffs();
    requestAnimationFrame(fitBoard);
  }

  // 棋盘按容器可用高度 / 宽度取正方形
  function fitBoard() {
    if (!el.board || !el.boardWrap) return;
    const rect = el.boardWrap.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const size = Math.max(200, Math.floor(Math.min(rect.width, rect.height)));
    if (el.board.style.width === size + 'px') return;
    el.board.style.width = size + 'px';
    el.board.style.height = size + 'px';
  }

  /* ============================== 交换 ============================== */
  function swapGrid(a, b) {
    const ar = a.r, ac = a.c, br = b.r, bc = b.c;
    S.board[ar][ac] = b.cell;
    S.board[br][bc] = a.cell;
    S.grid[ar][ac] = b;
    S.grid[br][bc] = a;
    a.r = br; a.c = bc;
    b.r = ar; b.c = ac;
  }

  async function animateSwap(a, b, dur) {
    dur = dur || CELL_MS_SWAP;
    swapGrid(a, b);
    a.el.style.zIndex = 6;
    b.el.style.zIndex = 5;
    setTransform(a, a.r, a.c, dur, EASE_SWAP);
    setTransform(b, b.r, b.c, dur, EASE_SWAP);
    Sfx.swap();
    await wait(dur + 12);
    a.el.style.zIndex = '';
    b.el.style.zIndex = '';
  }

  async function attemptSwap(a, b) {
    if (S.busy || S.paused || S.over) return;
    S.busy = true;
    clearSelection();
    S.lastSwap = [{ r: a.r, c: a.c }, { r: b.r, c: b.c }];

    await animateSwap(a, b);

    if (B.findRuns(S.board).length === 0) {
      Sfx.invalid();
      a.el.classList.add('nope');
      b.el.classList.add('nope');
      await animateSwap(a, b);
      setTimeout(function () {
        a.el.classList.remove('nope');
        b.el.classList.remove('nope');
      }, 260);
      S.busy = false;
      return;
    }

    await resolveCascades();
    await finishTurn();
    S.busy = false;
  }

  /* ============================== 消除 ============================== */
  function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

  function collectClear(runs) {
    const set = new Map();
    function add(r, c) {
      if (!inBounds(r, c)) return false;
      const k = r + ',' + c;
      if (set.has(k)) return false;
      set.set(k, { r: r, c: c });
      return true;
    }
    for (const run of runs) for (const p of run.cells) add(p.r, p.c);

    const queue = [];
    set.forEach(function (p) {
      const cell = S.board[p.r][p.c];
      if (cell && cell.special) queue.push({ r: p.r, c: p.c, kind: cell.special });
    });

    const fired = new Set();
    while (queue.length) {
      const q = queue.shift();
      const key = q.r + ',' + q.c;
      if (fired.has(key)) continue;
      fired.add(key);
      const area = [];
      if (q.kind === 'bomb') {
        const rad = (S.buffs && S.buffs.tendril) ? 2 : 1;
        for (let dr = -rad; dr <= rad; dr++)
          for (let dc = -rad; dc <= rad; dc++)
            if (inBounds(q.r + dr, q.c + dc)) area.push({ r: q.r + dr, c: q.c + dc });
      } else {
        for (let c = 0; c < COLS; c++) area.push({ r: q.r, c: c });
        for (let r = 0; r < ROWS; r++) area.push({ r: r, c: q.c });
        if (S.buffs && S.buffs.tendril) {
          if (q.r - 1 >= 0) for (let c = 0; c < COLS; c++) area.push({ r: q.r - 1, c: c });
          if (q.r + 1 < ROWS) for (let c = 0; c < COLS; c++) area.push({ r: q.r + 1, c: c });
        }
      }
      for (const p of area) {
        const isNew = add(p.r, p.c);
        if (isNew) {
          const cell = S.board[p.r][p.c];
          if (cell && cell.special) queue.push({ r: p.r, c: p.c, kind: cell.special });
        }
      }
    }
    return Array.from(set.values());
  }

  function anchorOf(run) {
    if (S.lastSwap) {
      for (const s of S.lastSwap) {
        for (const p of run.cells) if (p.r === s.r && p.c === s.c) return p;
      }
    }
    return run.cells[Math.floor(run.cells.length / 2)];
  }

  function collectSpawns(runs) {
    const spawns = [];
    const byCell = new Map();
    runs.forEach(function (run, i) {
      run.cells.forEach(function (p) {
        const k = p.r + ',' + p.c;
        if (!byCell.has(k)) byCell.set(k, []);
        if (byCell.get(k).indexOf(i) === -1) byCell.get(k).push(i);
      });
    });
    const used = new Set();
    byCell.forEach(function (idxs, k) {
      if (idxs.length >= 2) {
        const parts = k.split(',');
        spawns.push({ r: +parts[0], c: +parts[1], type: runs[idxs[0]].type, special: 'bomb' });
        idxs.forEach(function (i) { used.add(i); });
      }
    });
    runs.forEach(function (run, i) {
      if (used.has(i) || run.len < 4) return;
      const p = anchorOf(run);
      spawns.push({ r: p.r, c: p.c, type: run.type, special: 'line' });
    });
    // 去重
    const seen = new Set();
    return spawns.filter(function (s) {
      const k = s.r + ',' + s.c;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function applySpawn(sp) {
    if (!inBounds(sp.r, sp.c)) return;
    const cell = S.board[sp.r][sp.c];
    const t = S.grid[sp.r][sp.c];
    if (!cell || !t) return;
    cell.special = sp.special;
    cell.type = sp.type;
    applyLook(t);
    t.el.classList.remove('born');
    void t.el.offsetWidth;
    t.el.classList.add('born');
    setTimeout(function () { t.el.classList.remove('born'); }, 520);
  }

  async function clearStep(positions, combo, spawns) {
    const counts = [0, 0, 0, 0, 0];
    const list = [];
    let cx = 0, cy = 0;

    for (const p of positions) {
      const t = S.grid[p.r][p.c];
      if (!t) continue;
      list.push(t);
      counts[t.cell.type]++;
      cx += p.c + 0.5;
      cy += p.r + 0.5;
    }
    if (!list.length) return;
    cx /= list.length; cy /= list.length;

    // 数值结算
    let dmg = 0, healLife = 0, healSanity = 0;
    for (let i = 0; i < 5; i++) {
      const m = TYPE_META[i];
      dmg += counts[i] * m.dmg;
      healLife += counts[i] * m.life;
      healSanity += counts[i] * m.sanity;
    }
    if (S.buffs.spore) healLife += counts[4] * 2; // 孢子扩殖：青孢额外回生命
    const mult = S.buffs.blood ? 1.25 : 1; // 血祭增幅：得分 +25%
    const gain = Math.round(list.length * 10 * combo * mult);
    S.score += gain;
    S.boss.hp = Math.max(0, S.boss.hp - dmg);
    S.boss.phase = S.boss.hp <= S.boss.maxHp * 0.33 ? 3 : (S.boss.hp <= S.boss.maxHp * 0.66 ? 2 : 1);
    S.player.life = Math.min(S.player.maxLife, S.player.life + healLife);
    S.player.sanity = Math.min(S.player.maxSanity, S.player.sanity + healSanity);
    S.weapon.charge = Math.min(S.weapon.max, S.weapon.charge + list.length * 4);
    S.weapon.ready = S.weapon.charge >= S.weapon.max;

    // 视觉
    for (const t of list) {
      t.el.style.zIndex = 9;
      t.el.classList.add('pop');
      burst(t.c, t.r, TYPE_META[t.cell.type].glow, combo > 2 ? 1.3 : 1);
    }
    Sfx.pop(combo);
    if (combo >= 2) showCombo(combo);
    if (dmg > 0) { bossFlash(); scorePop(cx - 0.5, cy - 0.5, '-' + dmg, 'dmg'); }
    else scorePop(cx - 0.5, cy - 0.5, '+' + gain, 'gain');
    if (combo >= 3) shake(combo >= 4 ? 'hard' : 'soft');
    if (spawns && spawns.length) Sfx.special();

    updateHUD();
    await wait(235);

    // 移除
    for (const t of list) {
      if (S.board[t.r] && S.board[t.r][t.c] === t.cell) S.board[t.r][t.c] = null;
      if (S.grid[t.r] && S.grid[t.r][t.c] === t) S.grid[t.r][t.c] = null;
      S.tiles.delete(t.id);
      t.el.remove();
    }

    // 下落补位
    const ms = collapseBoard();
    await wait(ms);

    if (spawns) for (const sp of spawns) applySpawn(sp);
    updateHUD();
  }

  function collapseBoard() {
    const moves = [];
    const fresh = [];

    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const cell = S.board[r][c];
        if (!cell) continue;
        const t = S.tiles.get(cell.id);
        if (write !== r) {
          S.board[write][c] = cell;
          S.board[r][c] = null;
          S.grid[write][c] = t;
          S.grid[r][c] = null;
          if (t) {
            moves.push({ t: t, toR: write, toC: c, dist: write - r });
            t.r = write; t.c = c;
          }
        } else {
          S.grid[r][c] = t;
        }
        write--;
      }

      let above = 1;
      for (let r = write; r >= 0; r--) {
        const cell = B.makeCell(B.randType());
        S.board[r][c] = cell;
        const t = createTile(cell, r, c, -above);
        t.r = r; t.c = c;
        S.grid[r][c] = t;
        fresh.push(t);
        above++;
      }
    }

    let maxDur = 0;
    for (const m of moves) {
      const dur = 150 + m.dist * 42;
      maxDur = Math.max(maxDur, dur);
      setTransform(m.t, m.toR, m.toC, dur, EASE_FALL);
      setTimeout(squash.bind(null, m.t), dur);
    }
    for (const t of fresh) {
      void t.el.offsetWidth;
      const dur = 240 + t.r * 55;
      maxDur = Math.max(maxDur, dur);
      setTransform(t, t.r, t.c, dur, EASE_FALL);
      setTimeout(squash.bind(null, t), dur);
    }
    if (moves.length || fresh.length) {
      setTimeout(function () { Sfx.land(); }, Math.min(200, maxDur * 0.5));
    }
    return Math.max(260, maxDur + 90);
  }

  async function resolveCascades() {
    let combo = 0;
    let runs = B.findRuns(S.board);
    while (runs.length && !S.over) {
      combo++;
      S.combo = combo;
      const spawns = collectSpawns(runs);
      const positions = collectClear(runs);
      await clearStep(positions, combo, spawns);
      await wait(40);
      runs = B.findRuns(S.board);
    }
    S.maxCombo = Math.max(S.maxCombo, combo);
    S.combo = 0;
    await ensurePlayable();
    return combo;
  }

  async function ensurePlayable(force) {
    if (!force && B.hasPossibleMove(S.board)) return;
    B.shuffleBoard(S.board);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = S.grid[r][c];
        if (!t) continue;
        t.cell = S.board[r][c];
        t.cell.special = null;
        applyLook(t);
        t.el.classList.remove('born');
        void t.el.offsetWidth;
        t.el.classList.add('born');
      }
    }
    // 重新绑定 cell 引用
    S.tiles.forEach(function (t) { t.cell = S.board[t.r][t.c]; });
    Sfx.special();
    await wait(420);
  }

  /* ============================== 回合 ============================== */
  async function finishTurn() {
    if (S.over) return;
    S.turn++;
    S.boss.attackIn--;
    if (S.boss.attackIn <= 0) {
      S.boss.attackIn = 3;
      S.player.life = Math.max(0, S.player.life - BOSS_ATTACK_LIFE);
      S.player.sanity = Math.max(0, S.player.sanity - BOSS_ATTACK_SANITY);
      Sfx.boss();
      shake('hard');
      scorePop(3.5, 6, '深渊凝视！', 'danger');
      updateHUD();
      await wait(320);
    }
    updateHUD();
    checkEnd();
  }

  function checkEnd() {
    if (S.over) return;
    if (S.boss.hp <= 0) endBattle(true);
    else if (S.player.life <= 0 || S.player.sanity <= 0) endBattle(false);
  }

  function endBattle(win) {
    if (S.over) return;
    S.over = true;
    if (win) Sfx.win(); else Sfx.lose();
    setTimeout(function () { showSettlement(win); }, 420);
  }

  /* ============================== 手势 ============================== */
  let drag = null;
  let selected = null;

  function cellSize() { return el.board.clientWidth / COLS; }

  function clearSelection() {
    if (selected) {
      selected.el.classList.remove('sel');
      selected = null;
    }
  }

  function clearTargetMark() {
    if (S.targetMark) {
      const tm = S.targetMark;
      S.targetMark = null;
      tm.el.classList.remove('target');
      setTransform(tm, tm.r, tm.c, 150, EASE_BACK);
    }
  }

  function tileFromEvent(e) {
    const node = e.target.closest('.tile');
    if (!node) return null;
    return S.tiles.get(Number(node.dataset.id)) || null;
  }

  function dirOf(dx, dy, cell) {
    if (Math.abs(dx) < cell * 0.12 && Math.abs(dy) < cell * 0.12) return null;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  function neighborOf(t, dir) {
    const d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
    if (!d) return null;
    const r = t.r + d[0], c = t.c + d[1];
    if (!inBounds(r, c)) return null;
    return S.grid[r][c];
  }

  function onDown(e) {
    if (S.busy || S.paused || S.over || e.button === 2) return;
    if (S.aim) { handleAimDown(e); return; }
    const t = tileFromEvent(e);
    if (!t) return;
    Sfx.unlock();
    drag = {
      t: t,
      sx: e.clientX,
      sy: e.clientY,
      cell: cellSize(),
      moved: false,
      dir: null,
      pid: e.pointerId,
    };
    t.el.classList.add('dragging');
    try { el.board.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag || drag.pid !== e.pointerId) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    const cell = drag.cell;
    const max = cell * 0.92;
    const ox = Math.max(-max, Math.min(max, dx));
    const oy = Math.max(-max, Math.min(max, dy));
    drag.moved = drag.moved || Math.abs(dx) > 6 || Math.abs(dy) > 6;

    const t = drag.t;
    t.el.style.transition = 'none';
    t.el.style.transform = 'translate3d(calc(' + (t.c * 100) + '% + ' + ox + 'px),calc(' + (t.r * 100) + '% + ' + oy + 'px),0)';

    const dir = dirOf(dx, dy, cell);
    drag.dir = dir;
    clearTargetMark();
    if (dir) {
      const nb = neighborOf(t, dir);
      if (nb) {
        S.targetMark = nb;
        nb.el.classList.add('target');
        // 邻格反向预位移：手指拖多少，它就让开多少（交换预览）
        nb.el.style.transition = 'none';
        const px = -ox * 0.34;
        const py = -oy * 0.34;
        nb.el.style.transform = 'translate3d(calc(' + (nb.c * 100) + '% + ' + px + 'px),calc(' + (nb.r * 100) + '% + ' + py + 'px),0)';
      }
    }
    e.preventDefault();
  }

  function onUp(e) {
    if (!drag || drag.pid !== e.pointerId) return;
    const t = drag.t;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    const moved = drag.moved;
    const dir = drag.dir;
    const cell = drag.cell;
    drag = null;

    t.el.classList.remove('dragging');
    clearTargetMark();

    if (!moved) {
      // 轻点：选中 / 交换（点选兜底，和滑动一样可用）
      if (!selected) {
        selected = t;
        t.el.classList.add('sel');
        Sfx.swap();
      } else if (selected === t) {
        clearSelection();
      } else {
        const a = selected;
        if (B.isAdjacent(a.r, a.c, t.r, t.c)) {
          clearSelection();
          attemptSwap(a, t);
        } else {
          clearSelection();
          selected = t;
          t.el.classList.add('sel');
        }
      }
      return;
    }

    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > cell * 0.28 && dir) {
      const nb = neighborOf(t, dir);
      if (nb) { attemptSwap(t, nb); return; }
    }
    // 回弹
    setTransform(t, t.r, t.c, 220, EASE_BACK);
    setTimeout(function () { squash(t); }, 200);
  }

  function onCancel() {
    if (!drag) return;
    const t = drag.t;
    drag = null;
    t.el.classList.remove('dragging');
    clearTargetMark();
    setTransform(t, t.r, t.c, 180, EASE_BACK);
  }

  /* ============================== 按钮 ============================== */
  function openPause() {
    if (S.over) return;
    S.paused = true;
    el.overlay.hidden = false;
  }
  function resume() {
    S.paused = false;
    el.overlay.hidden = true;
  }

  async function unleashWeapon() {
    if (S.busy || S.paused || S.over || !S.weapon.ready) return;
    S.busy = true;
    S.weapon.charge = 0;
    S.weapon.ready = false;
    updateHUD();
    Sfx.boss();
    shake('hard');
    S.boss.hp = Math.max(0, S.boss.hp - WEAPON_DMG);
    S.boss.phase = S.boss.hp <= S.boss.maxHp * 0.33 ? 3 : (S.boss.hp <= S.boss.maxHp * 0.66 ? 2 : 1);
    bossFlash();
    scorePop(3.5, 5, '生物武器 -' + WEAPON_DMG, 'dmg');
    for (let i = 0; i < 3; i++) {
      burst(Math.random() * COLS, Math.random() * 6, '#B98BE0', 1.6);
    }
    updateHUD();
    await wait(520);
    S.busy = false;
    checkEnd();
  }

  /* ============================== 祭坛 ============================== */
  let shopCat = 'all';

  function refreshAltarBalance() {
    const st = Shop.load();
    const node = document.getElementById('altar-essence');
    if (node) node.textContent = '◈ ' + st.crystals;
  }

  function showShop() {
    const st = Shop.load();
    const dailyDone = st.daily === Shop.today();

    let tabs = '';
    Shop.CATS.forEach(function (c) {
      tabs += '<div class="shop-tab ' + (shopCat === c.id ? 'active' : '') + '" data-cat="' + c.id + '">' + c.name + '</div>';
    });

    let items = '';
    Shop.ITEMS.forEach(function (it) {
      if (shopCat !== 'all' && it.cat !== shopCat) return;
      const owned = Shop.countOf(st, it.id);
      const afford = st.crystals >= it.price;
      items += '<div class="shop-item">' +
        '<div class="shop-icon" style="border-color:' + it.tint + '"><span class="shop-emoji">' + it.icon + '</span>' +
          (owned > 0 ? '<span class="own-badge">×' + owned + '</span>' : '') + '</div>' +
        '<div class="shop-info"><div class="shop-name">' + it.name + '<span class="shop-en">' + it.en + '</span></div>' +
        '<div class="shop-desc">' + it.desc + '</div></div>' +
        '<div class="buy-btn ' + (afford ? '' : 'poor') + '" data-buy="' + it.id + '">◈ ' + it.price + '</div>' +
        '</div>';
    });

    screenShop.innerHTML =
      '<div class="shop-inner">' +
        '<div class="shop-head"><div class="shop-title">亵渎祭坛</div><div class="shop-en-title">PROFANE ALTAR</div></div>' +
        '<div class="essence-bar"><div class="essence-icon">◈</div><div class="essence-label">深渊精华</div><div class="essence-val">' + st.crystals + '</div></div>' +
        '<div class="daily-card ' + (dailyDone ? 'done' : '') + '" data-daily="1">' +
          '<div class="daily-icon">🕯</div>' +
          '<div class="daily-text"><div class="daily-title">每日祭品<span class="daily-en">DAILY</span></div>' +
          '<div class="daily-desc">深渊精华 ×8 · 窥视之瞳 ×1</div></div>' +
          '<div class="daily-btn">' + (dailyDone ? '已领取' : '领取') + '</div>' +
        '</div>' +
        '<div class="shop-tabs">' + tabs + '</div>' +
        '<div class="shop-list">' + items + '</div>' +
        '<button class="leave-btn" data-act="leave">离开祭坛</button>' +
        '<div class="shop-foot">消耗品收入背包，开局可在战斗页取用；本局强化下一场潜入生效</div>' +
      '</div>';
    showScreen('shop');
  }

  function buyProduct(id) {
    const item = Shop.BY_ID[id];
    if (!item) return;
    const r = Shop.buy(id);
    if (!r.ok) { Sfx.invalid(); return; }
    Sfx.special();
    showShop();
    refreshAltarBalance();
  }

  function claimDaily() {
    const r = Shop.claimDaily();
    if (!r.ok) { Sfx.invalid(); return; }
    Sfx.win();
    showShop();
    refreshAltarBalance();
  }

  /* ============================== 战斗道具 ============================== */
  function refreshItems() {
    if (!el.itemsLayer) return;
    const st = Shop.load();
    const bar = Shop.ITEMS.filter(function (it) {
      return (it.cat === 'tool' || it.cat === 'supply') && (st.inv[it.id] || 0) > 0;
    });
    if (!bar.length) {
      el.itemsLayer.hidden = true;
      el.itemsLayer.innerHTML = '';
      S.itemBar = [];
      return;
    }
    el.itemsLayer.hidden = false;
    el.itemsLayer.innerHTML = bar.map(function (it) {
      return '<button class="item-chip" data-item="' + it.id + '" title="' + it.name + '">' +
        '<span class="item-ico">' + it.icon + '</span>' +
        '<span class="item-count">' + st.inv[it.id] + '</span></button>';
    }).join('');
    S.itemBar = bar.map(function (it) { return it.id; });
  }

  function announceBuffs() {
    const names = [];
    if (S.buffs.blood) names.push('血祭增幅');
    if (S.buffs.spore) names.push('孢子扩殖');
    if (S.buffs.tendril) names.push('触须延展');
    if (!names.length) return;
    setTimeout(function () { scorePop(4, 2, '本局强化 · ' + names.join(' / '), 'gain'); }, 600);
  }

  function useItem(id) {
    if (S.busy || S.paused || S.over) return;
    const item = Shop.BY_ID[id];
    if (!item) return;
    const st = Shop.load();
    if (!(st.inv[id] > 0)) return;

    if (item.target) {
      S.aim = { id: id, type: item.target };
      S.aimFirst = null;
      el.aimBar.hidden = false;
      el.aimText.textContent = item.target === 'swap' ? '依次点击两颗宝石置换' : ('点击棋盘使用「' + item.name + '」');
      Sfx.swap();
      return;
    }
    applyInstant(id);
  }

  function cancelAim() {
    if (S.aimFirst && S.aimFirst.el) S.aimFirst.el.classList.remove('sel');
    S.aimFirst = null;
    S.aim = null;
    if (el.aimBar) el.aimBar.hidden = true;
  }

  function handleAimDown(e) {
    const t = tileFromEvent(e);
    if (!t || !S.aim) return;
    const aim = S.aim;

    if (aim.type === 'swap') {
      if (!S.aimFirst) {
        S.aimFirst = t;
        t.el.classList.add('sel');
        return;
      }
      if (S.aimFirst === t) { cancelAim(); return; }
      const a = S.aimFirst;
      a.el.classList.remove('sel');
      S.aimFirst = null;
      Shop.consume('swap');
      cancelAim();
      refreshItems();
      doToolSwap(a, t);
      return;
    }

    Shop.consume(aim.id);
    const id = aim.id;
    const type = aim.type;
    cancelAim();
    refreshItems();
    doToolAt(id, type, t);
  }

  function applyInstant(id) {
    if (id === 'life' && S.player.life >= S.player.maxLife) return;
    if (id === 'sanity' && S.player.sanity >= S.player.maxSanity) return;
    if (!Shop.consume(id)) return;

    if (id === 'life') {
      S.player.life = Math.min(S.player.maxLife, S.player.life + 30);
      scorePop(4, 3, '生命 +30', 'gain');
    } else if (id === 'sanity') {
      S.player.sanity = Math.min(S.player.maxSanity, S.player.sanity + 30);
      scorePop(4, 3, '理智 +30', 'gain');
    } else if (id === 'core') {
      S.weapon.charge = Math.min(S.weapon.max, S.weapon.charge + 50);
      S.weapon.ready = S.weapon.charge >= S.weapon.max;
      scorePop(4, 3, '武器充能 +50%', 'gain');
    } else if (id === 'stasis') {
      S.boss.attackIn += 2;
      scorePop(4, 3, '深渊凝视延后 2 回合', 'gain');
    } else if (id === 'shuffle') {
      doShuffleTool();
      return;
    } else if (id === 'hint') {
      doHint();
      return;
    }

    Sfx.special();
    updateHUD();
    refreshItems();
  }

  async function doToolAt(id, type, tile) {
    S.busy = true;
    const positions = [];
    if (type === 'single') {
      positions.push({ r: tile.r, c: tile.c });
    } else if (type === 'area') {
      const rad = S.buffs.tendril ? 2 : 1;
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++)
          if (inBounds(tile.r + dr, tile.c + dc)) positions.push({ r: tile.r + dr, c: tile.c + dc });
    } else if (type === 'color') {
      const want = tile.cell.type;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const cell = S.board[r][c];
          if (cell && cell.type === want) positions.push({ r: r, c: c });
        }
    }

    Sfx.special();
    shake('soft');
    await clearStep(positions, 1, []);
    await resolveCascades();
    S.busy = false;
    refreshItems();
  }

  async function doToolSwap(a, b) {
    S.busy = true;
    await animateSwap(a, b);
    if (B.findRuns(S.board).length > 0) {
      await resolveCascades();
    } else {
      scorePop(a.c, a.r, '置换完成', 'gain');
    }
    S.busy = false;
    refreshItems();
  }

  async function doShuffleTool() {
    S.busy = true;
    await ensurePlayable(true);
    S.busy = false;
    refreshItems();
  }

  function doHint() {
    const swap = findHintMove();
    if (!swap) return;
    const a = S.grid[swap.a[0]][swap.a[1]];
    const b = S.grid[swap.b[0]][swap.b[1]];
    if (!a || !b) return;
    a.el.classList.add('hint');
    b.el.classList.add('hint');
    Sfx.swap();
    setTimeout(function () {
      a.el.classList.remove('hint');
      b.el.classList.remove('hint');
    }, 3000);
  }

  function findHintMove() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c + 1 < COLS) {
          B.swapCells(S.board, r, c, r, c + 1);
          const ok1 = B.findRuns(S.board).length > 0;
          B.swapCells(S.board, r, c, r, c + 1);
          if (ok1) return { a: [r, c], b: [r, c + 1] };
        }
        if (r + 1 < ROWS) {
          B.swapCells(S.board, r, c, r + 1, c);
          const ok2 = B.findRuns(S.board).length > 0;
          B.swapCells(S.board, r, c, r + 1, c);
          if (ok2) return { a: [r, c], b: [r + 1, c] };
        }
      }
    }
    return null;
  }

  /* ============================== 结算 ============================== */
  function showSettlement(win) {
    const turns = S.turn;
    const combo = S.maxCombo;
    const life = Math.round(S.player.life);
    const abandon = !win && S.abandoned;
    const gene = win ? (20 + turns) : 0;
    let grade = 'C';
    if (win) grade = turns <= 12 ? 'S' : (turns <= 20 ? 'A' : 'B');

    const loots = win ? [
      { name: '深渊之喉核心', desc: '生物武器 · 主武器升级素材', tag: '传说', cls: 'legend' },
      { name: '寄生孢子样本 ×3', desc: 'Buff 道具 · 提升腐蚀伤害', tag: '史诗', cls: 'epic' },
      { name: '深渊精华', desc: '祭坛供奉货币 · 兑换道具', tag: '精良', cls: 'fine' },
    ] : [];

    const essenceGain = win ? Math.min(40, 10 + Math.floor(S.score / 40)) : 3;
    Shop.gainCrystals(essenceGain);

    let html = '<div class="result-block">' +
      '<div class="result-icon"><span class="result-glyph">' + (win ? '✶' : '☠') + '</span></div>' +
      '<div class="result-title">' + (win ? '潜入成功' : (abandon ? '已放弃潜入' : '潜入失败')) + '</div>' +
      '<div class="result-en">' + (win ? 'VICTORY' : 'DEFEATED') + '</div>' +
      '<div class="result-desc">' + (win ? BOSS_NAME + ' 已被击溃'
        : (abandon ? '你撤离了第 ' + S.layer + ' 层' : '你倒在了第 ' + S.layer + ' 层的深渊中')) + '</div></div>';

    html += '<div class="score-row">' +
      '<div class="grade-card"><span class="grade-label">评级</span>' +
        '<span class="grade-val">' + grade + '</span>' +
        '<span class="grade-stars">' + (win ? '★★★★★' : '☆☆☆☆☆') + '</span></div>' +
      '<div class="stats-stack">' +
        '<div class="stat-line"><span class="sl">抵达层数</span><span class="sv">第 ' + S.layer + ' 层</span></div>' +
        '<div class="stat-line"><span class="sl">潜入回合</span><span class="sv">' + turns + '</span></div>' +
        '<div class="stat-line"><span class="sl">最高连击</span><span class="sv">' + combo + ' 连击</span></div>' +
        '<div class="stat-line"><span class="sl">消除得分</span><span class="sv">' + S.score + '</span></div>' +
      '</div></div>';

    html += '<div class="essence-row"><span class="essence-row-label">深渊精华回收</span>' +
      '<span class="essence-row-val">◈ +' + essenceGain + '</span></div>';

    if (win) {
      html += '<div class="gene-card"><div class="gene-icon">⚜</div>' +
        '<div class="gene-text"><span class="gene-t">基因样本回收</span>' +
        '<span class="gene-d">用于生物武器强化与基因图鉴解锁</span></div>' +
        '<span class="gene-val">+' + gene + '</span></div>';
      html += '<div class="loot-section"><span class="loot-title">战利品 · LOOT</span>';
      for (const it of loots) {
        html += '<div class="loot-card ' + it.cls + '"><div class="loot-icon">◈</div>' +
          '<div class="loot-text"><span class="loot-name">' + it.name + '</span>' +
          '<span class="loot-desc">' + it.desc + '</span></div>' +
          '<span class="loot-tag">' + it.tag + '</span></div>';
      }
      html += '</div>';
    }

    html += '<div class="bottom-btns">' +
      '<button class="btn-primary" data-act="retry">' + (win ? '继续潜入 · 下一层' : '重新挑战本层') + '</button>' +
      (win ? '<button class="btn-ghost" data-act="shop">前往亵渎祭坛</button>' : '') +
      '<button class="btn-ghost" data-act="home">返回深渊</button></div>';

    screenSettle.className = 'screen settle ' + (win ? 'win' : 'lose');
    screenSettle.innerHTML = html;
    showScreen('settle');

    screenSettle.onclick = function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'retry') newBattle(win ? S.layer + 1 : S.layer);
      else if (act === 'shop') showShop();
      else showScreen('title');
    };
  }

  /* ============================== 启动 ============================== */
  function showScreen(name) {
    document.getElementById('screen-title').classList.toggle('active', name === 'title');
    screenBattle.classList.toggle('active', name === 'battle');
    screenSettle.classList.toggle('active', name === 'settle');
    screenShop.classList.toggle('active', name === 'shop');
  }

  buildShell();

  refreshAltarBalance();

  document.getElementById('enter-btn').addEventListener('click', function () {
    Sfx.unlock();
    newBattle(7);
  });

  document.getElementById('altar-btn').addEventListener('click', function () {
    Sfx.unlock();
    showShop();
  });

  screenShop.addEventListener('click', function (e) {
    const catEl = e.target.closest('[data-cat]');
    if (catEl) { shopCat = catEl.getAttribute('data-cat'); showShop(); return; }
    const buyEl = e.target.closest('[data-buy]');
    if (buyEl) { buyProduct(buyEl.getAttribute('data-buy')); return; }
    if (e.target.closest('[data-daily]')) { claimDaily(); return; }
    if (e.target.closest('[data-act="leave"]')) { showScreen('title'); refreshAltarBalance(); }
  });

  el.board.addEventListener('pointerdown', onDown);
  el.board.addEventListener('pointermove', onMove);
  el.board.addEventListener('pointerup', onUp);
  el.board.addEventListener('pointercancel', onCancel);
  el.board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('resize', fitBoard);
  window.addEventListener('orientationchange', function () { setTimeout(fitBoard, 120); });
  if (window.ResizeObserver) {
    new ResizeObserver(fitBoard).observe(el.boardWrap);
  }

  screenBattle.addEventListener('click', function (e) {
    const itemBtn = e.target.closest('[data-item]');
    if (itemBtn) { useItem(itemBtn.getAttribute('data-item')); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.getAttribute('data-action');
    if (a === 'pause') openPause();
    else if (a === 'resume') resume();
    else if (a === 'restart') { resume(); newBattle(S.layer); }
    else if (a === 'abandon') { resume(); S.over = true; S.abandoned = true; showSettlement(false); }
    else if (a === 'weapon') unleashWeapon();
    else if (a === 'cancel-aim') cancelAim();
  });

  // 调试 / 自动化测试钩子
  window.__ABYSS__ = {
    S: S, B: B,
    attemptSwap: attemptSwap,
    newBattle: newBattle,
    tileAt: function (r, c) { return S.grid[r][c]; },
    snapshot: function () {
      return S.board.map(function (row) { return row.map(function (c) { return c ? c.type : -1; }); });
    },
  };
})();
