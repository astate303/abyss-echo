/* shop.js — 亵渎祭坛：商品 / 深渊精华 / 背包（H5 版，localStorage 持久化） */
(function (global) {
  'use strict';

  const STORE_KEY = 'abyss_shop_v1';

  const CATS = [
    { id: 'all', name: '全部' },
    { id: 'tool', name: '消除道具' },
    { id: 'supply', name: '战斗补给' },
    { id: 'buff', name: '本局强化' },
    { id: 'gift', name: '礼包' },
  ];

  const ITEMS = [
    { id: 'hammer', cat: 'tool', name: '碎骨锤', en: 'HAMMER', icon: '🔨', tint: '#E06464', desc: '点碎任意一颗宝石', long: '点击棋盘上任意一颗宝石，直接击碎它，不消耗回合。', price: 12, target: 'single' },
    { id: 'bomb', cat: 'tool', name: '深渊炸弹', en: 'BOMB', icon: '💣', tint: '#F0A050', desc: '炸掉 3×3 范围', long: '点击棋盘任意位置，以该点为中心炸掉 3×3 范围。', price: 20, target: 'area' },
    { id: 'rainbow', cat: 'tool', name: '彩虹之眼', en: 'RAINBOW', icon: '🌈', tint: '#B98BE0', desc: '消除全场同色', long: '点击一颗宝石，消除全场与它同色的所有宝石。', price: 35, target: 'color' },
    { id: 'swap', cat: 'tool', name: '虚空置换', en: 'SWAP', icon: '⇄', tint: '#6FE0C8', desc: '任意两颗直接交换', long: '依次点击两颗宝石，无视相邻限制直接交换。', price: 15, target: 'swap' },
    { id: 'shuffle', cat: 'tool', name: '混沌重排', en: 'SHUFFLE', icon: '🌀', tint: '#8BD450', desc: '立即重排棋盘', long: '把当前棋盘彻底打乱，并保证有解。', price: 18, target: null },
    { id: 'hint', cat: 'tool', name: '窥视之瞳', en: 'HINT', icon: '👁', tint: '#9AD0FF', desc: '高亮一步可行走法', long: '高亮一组可以消除的宝石，持续 3 秒。', price: 8, target: null },

    { id: 'life', cat: 'supply', name: '生命药剂', en: 'LIFE', icon: '❤', tint: '#E06464', desc: '生命 +30', long: '立即回复 30 点生命，不超过上限。', price: 15, target: null },
    { id: 'sanity', cat: 'supply', name: '理智药剂', en: 'SANITY', icon: '🧠', tint: '#9A6FD0', desc: '理智 +30', long: '立即回复 30 点理智，不超过上限。', price: 15, target: null },
    { id: 'core', cat: 'supply', name: '武器核心', en: 'CORE', icon: '⚡', tint: '#C9B6F0', desc: '武器充能 +50%', long: '生物武器充能进度直接 +50%。', price: 25, target: null },
    { id: 'stasis', cat: 'supply', name: '静滞符', en: 'STASIS', icon: '❄', tint: '#8FE0C8', desc: '深渊凝视延后 2 回合', long: 'BOSS 的下一次攻击延后 2 个回合。', price: 22, target: null },

    { id: 'blood', cat: 'buff', name: '血祭增幅', en: 'BLOOD', icon: '🩸', tint: '#B8402E', desc: '本局消除得分 +25%', long: '下一局战斗开始时生效，本局所有消除得分 ×1.25。', price: 30 },
    { id: 'spore', cat: 'buff', name: '孢子扩殖', en: 'SPORE', icon: '🌱', tint: '#6FE0C8', desc: '本局消除额外回 1 生命', long: '下一局战斗中，每次消除额外回复 1 点生命。', price: 28 },
    { id: 'tendril', cat: 'buff', name: '触须延展', en: 'TENDRIL', icon: '🐙', tint: '#B98BE0', desc: '本局特殊宝石范围 +1', long: '下一局战斗中，直线炸弹与爆破弹的作用范围 +1。', price: 26 },

    { id: 'starter', cat: 'gift', name: '新人祭品', en: 'STARTER', icon: '🎁', tint: '#E0B05A', desc: '锤子×2 + 炸弹×1 + 置换×1', long: '原价 59 精华，新晋信徒的第一次献祭。', price: 40, gift: { hammer: 2, bomb: 1, swap: 1 } },
    { id: 'abyss', cat: 'gift', name: '深渊大礼包', en: 'ABYSS', icon: '📦', tint: '#E0B05A', desc: '消除道具各 ×2', long: '锤子 / 炸弹 / 彩虹 / 置换 / 重排 / 提示 各 2 个，原价 216。', price: 120, gift: { hammer: 2, bomb: 2, rainbow: 2, swap: 2, shuffle: 2, hint: 2 } },
  ];

  const BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  function defaultState() {
    return { crystals: 80, inv: {}, daily: '', totalBuy: 0 };
  }

  function load() {
    let s = null;
    try {
      const raw = global.localStorage.getItem(STORE_KEY);
      s = raw ? JSON.parse(raw) : null;
    } catch (e) { s = null; }
    if (!s || typeof s !== 'object') {
      s = defaultState();
      save(s);
      return s;
    }
    const d = defaultState();
    return {
      crystals: typeof s.crystals === 'number' ? s.crystals : d.crystals,
      inv: s.inv || {},
      daily: s.daily || '',
      totalBuy: s.totalBuy || 0,
    };
  }

  function save(s) {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* noop */ }
  }

  function today() {
    const d = new Date();
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function countOf(s, id) { return (s.inv && s.inv[id]) || 0; }

  function buy(id) {
    const item = BY_ID[id];
    if (!item) return { ok: false, reason: 'unknown' };
    const s = load();
    if (s.crystals < item.price) return { ok: false, reason: 'poor', state: s };
    s.crystals -= item.price;
    if (item.gift) {
      Object.keys(item.gift).forEach(function (k) { s.inv[k] = (s.inv[k] || 0) + item.gift[k]; });
    } else {
      s.inv[id] = (s.inv[id] || 0) + 1;
    }
    s.totalBuy += 1;
    save(s);
    return { ok: true, state: s };
  }

  function claimDaily() {
    const s = load();
    const t = today();
    if (s.daily === t) return { ok: false, reason: 'done', state: s };
    s.daily = t;
    s.crystals += 8;
    s.inv.hint = (s.inv.hint || 0) + 1;
    save(s);
    return { ok: true, state: s };
  }

  function gainCrystals(n) {
    const s = load();
    s.crystals = Math.max(0, s.crystals + (n || 0));
    save(s);
    return s;
  }

  function consumeBuffs() {
    const s = load();
    const active = {};
    let changed = false;
    ['blood', 'spore', 'tendril'].forEach(function (id) {
      if ((s.inv[id] || 0) > 0) { active[id] = true; s.inv[id] -= 1; changed = true; }
    });
    if (changed) save(s);
    return active;
  }

  function consume(id) {
    const s = load();
    if (!s.inv[id] || s.inv[id] <= 0) return false;
    s.inv[id] -= 1;
    save(s);
    return true;
  }

  global.AbyssShop = {
    CATS: CATS, ITEMS: ITEMS, BY_ID: BY_ID,
    load: load, save: save, today: today, countOf: countOf,
    buy: buy, claimDaily: claimDaily, gainCrystals: gainCrystals,
    consumeBuffs: consumeBuffs, consume: consume,
  };
})(window);
