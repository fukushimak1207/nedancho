'use strict';

/* =========================================================
 * ねだん帳 Ver 1.0
 * データはすべて localStorage(この端末のブラウザ内)に保存。
 * サーバー通信なし = 圏外でも動く。
 * ========================================================= */

const STORAGE_KEY = 'nedancho:data:v1';
const LAST_STORE_KEY = 'nedancho:lastStore';
const SYNC_URL_KEY = 'nedancho:syncUrl';
const SYNC_TIME_KEY = 'nedancho:lastSync';

/* ---------- ユーティリティ ---------- */

function uid() {
  return (crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// 入力日が今日から何日前か(今日=0)。未来日はマイナス。
function daysAgo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((t - d) / 86400000);
}

function fmtPrice(v) {
  if (v == null) return '-';
  const r = Math.round(v * 10) / 10;
  return r.toLocaleString('ja-JP');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- 初期データ ---------- */

// 初期品目・初期店舗の ID は端末間で共通の固定値にする
// (端末ごとにランダムIDだと、同期したとき同じ品目が二重になるため)
const SEED_ITEM_NAMES = [
  '国産鶏むね', '国産鶏もも', '国産ささみ', '国産豚こま', '外国産豚こま',
  '国産豚バラ', '外国産豚バラ', '合い挽き肉', '生たら', '塩サバ', 'サバ缶',
  '卵10個', '豆腐', '納豆', '牛乳1L', 'ヨーグルト', '冷凍ブロッコリー',
  '味噌', '醤油', 'めんつゆ', 'マヨネーズ',
];
const SEED_STORE_NAMES = ['OK', 'ロピア', 'イオン', 'そうてつローゼン', 'サミット', '東急ストア', 'まいばすけっと'];

function seedData() {
  // gram: true = 値段と内容量(g)から 100g あたりの単価を自動計算して記録する品目
  // ord = 表示順 / u = 最終更新時刻(同期でどちらが新しいか比べるのに使う)
  let ord = 0;
  const gItem = (name, category) => ({ id: 'seed-item-' + name, name, category, unit: '100g', gram: true, ord: (ord += 10), u: 0 });
  const uItem = (name, category, unit) => ({ id: 'seed-item-' + name, name, category, unit, gram: false, ord: (ord += 10), u: 0 });
  return {
    version: 3,
    items: [
      gItem('国産鶏むね', '肉類'),
      gItem('国産鶏もも', '肉類'),
      gItem('国産ささみ', '肉類'),
      gItem('国産豚こま', '肉類'),
      gItem('外国産豚こま', '肉類'),
      gItem('国産豚バラ', '肉類'),
      gItem('外国産豚バラ', '肉類'),
      gItem('合い挽き肉', '肉類'),
      gItem('生たら', '魚介'),
      gItem('塩サバ', '魚介'),
      uItem('サバ缶', '魚介', '1缶'),
      uItem('卵10個', '卵・大豆', '1パック'),
      uItem('豆腐', '卵・大豆', '1丁'),
      uItem('納豆', '卵・大豆', '1パック'),
      uItem('牛乳1L', '乳製品', '1本'),
      uItem('ヨーグルト', '乳製品', '1個'),
      gItem('冷凍ブロッコリー', '冷凍食品'),
      uItem('味噌', '調味料', '1個'),
      uItem('醤油', '調味料', '1本'),
      uItem('めんつゆ', '調味料', '1本'),
      uItem('マヨネーズ', '調味料', '1本'),
    ],
    stores: SEED_STORE_NAMES.map(name => ({ id: 'seed-store-' + name, name, u: 0 })),
    // price は判定・相場計算に使う値。gram 品目では「100gあたりの単価」を入れる。
    // gram 品目は rawPrice(支払った値段)と amount(内容量g)も持つ。
    prices: [], // { id, itemId, storeId, price, date, rawPrice?, amount? }
  };
}

// 旧バージョンのデータを新形式に変換する
function migrate(d) {
  if (!d.version || d.version < 2) {
    for (const i of d.items) {
      if (i.gram === undefined) i.gram = (i.unit === '100g');
    }
    for (const p of d.prices) {
      const item = d.items.find(i => i.id === p.itemId);
      if (item && item.gram && p.amount === undefined) {
        // 旧データは 100g 単価を直接入れていたとみなす
        p.rawPrice = p.price;
        p.amount = 100;
      }
    }
    d.version = 2;
  }
  if (d.version < 3) {
    // 初期品目・初期店舗のIDを端末間共通の固定値に置き換える(同期での二重化防止)
    const seedItems = new Set(SEED_ITEM_NAMES);
    for (const i of d.items) {
      const cid = 'seed-item-' + i.name;
      if (seedItems.has(i.name) && i.id !== cid) {
        for (const p of d.prices) if (p.itemId === i.id) p.itemId = cid;
        i.id = cid;
      }
    }
    const seedStores = new Set(SEED_STORE_NAMES);
    for (const s of d.stores) {
      const cid = 'seed-store-' + s.name;
      if (seedStores.has(s.name) && s.id !== cid) {
        for (const p of d.prices) if (p.storeId === s.id) p.storeId = cid;
        s.id = cid;
      }
    }
    // 表示順(ord)と更新時刻(u)を付与
    d.items.forEach((i, idx) => {
      if (i.ord === undefined) i.ord = (idx + 1) * 10;
      if (i.u === undefined) i.u = 0;
    });
    for (const s of d.stores) if (s.u === undefined) s.u = 0;
    for (const p of d.prices) if (p.u === undefined) p.u = 0;
    d.version = 3;
  }
  return d;
}

let data;
try {
  data = JSON.parse(localStorage.getItem(STORAGE_KEY));
} catch (e) {
  data = null;
}
if (!data || !Array.isArray(data.items)) {
  data = seedData();
  save();
} else {
  data = migrate(data);
  save();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  scheduleSync(); // 同期URLが設定されていれば、少し待ってから自動同期
}

function itemById(id) { return data.items.find(i => i.id === id); }
function storeById(id) { return data.stores.find(s => s.id === id); }

// 削除済み(del=true)を除いた一覧。削除は同期のため「印を付けて残す」方式
function live(arr) { return arr.filter(x => !x.del); }
function sortedLiveItems() {
  return live(data.items).sort((a, b) => (a.ord || 0) - (b.ord || 0));
}

/* ---------- 同期(Google ドライブ / Apps Script) ---------- */

var syncTimer = null;
var syncing = false;

function getSyncUrl() { return localStorage.getItem(SYNC_URL_KEY) || ''; }

function scheduleSync() {
  if (!getSyncUrl() || syncing || !navigator.onLine) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(true), 3000);
}

function setSyncStatus(msg) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = msg;
}

// 2つのデータを合体する。同じIDは更新時刻(u)が新しい方を採用
function mergeEntities(localArr, remoteArr) {
  const map = new Map();
  for (const x of [...localArr, ...remoteArr]) {
    const cur = map.get(x.id);
    if (!cur || (x.u || 0) > (cur.u || 0)) map.set(x.id, x);
  }
  return [...map.values()];
}

function mergeData(local, remote) {
  return {
    version: 3,
    items: mergeEntities(local.items, remote.items),
    stores: mergeEntities(local.stores, remote.stores),
    prices: mergeEntities(local.prices, remote.prices),
  };
}

async function syncNow(silent) {
  const url = getSyncUrl();
  if (!url) {
    if (!silent) setSyncStatus('先に同期用URLを設定してください(設定方法は SYNC_SETUP.md)');
    return;
  }
  if (syncing) return;
  syncing = true;
  setSyncStatus('同期中…');
  try {
    // 1. ドライブ上のデータを取得して手元のデータと合体
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let remote = null;
    try { remote = JSON.parse(text); } catch (e) { /* まだ空 = 初回 */ }
    if (remote && Array.isArray(remote.items)) {
      data = mergeData(data, migrate(remote));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    // 2. 合体結果をドライブへ書き戻す
    //    (Content-Type を text/plain にするのは Apps Script に届かせるためのお作法)
    const res2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
    });
    if (!res2.ok) throw new Error('HTTP ' + res2.status);
    const stamp = new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    localStorage.setItem(SYNC_TIME_KEY, stamp);
    setSyncStatus('✅ 最終同期: ' + stamp);
    refreshViews();
  } catch (err) {
    setSyncStatus('⚠️ 同期できませんでした(オフラインかURLの設定ミスの可能性)');
  } finally {
    syncing = false;
  }
}

// 同期後に表示中の画面を最新データで描き直す
function refreshViews() {
  renderItemList();
  if (!views.history.hidden) renderHistory();
  if (!views.settings.hidden) renderSettings();
  if (!itemDetail.hidden && currentItemId) {
    renderJudge();
    renderStats();
    renderStoreStats();
    renderChart();
    renderRecent();
  }
}

/* ---------- 相場の計算 ---------- */

function pricesForItem(itemId, withinDays) {
  return data.prices.filter(p => {
    if (p.del || p.itemId !== itemId) return false;
    const ago = daysAgo(p.date);
    return ago >= 0 && ago < withinDays;
  });
}

function calcStats(itemId) {
  const avg = arr => arr.length ? arr.reduce((s, p) => s + p.price, 0) / arr.length : null;
  const p30 = pricesForItem(itemId, 30);
  const p90 = pricesForItem(itemId, 90);
  const p365 = pricesForItem(itemId, 365);

  let min = null, max = null;
  for (const p of p365) {
    if (!min || p.price < min.price) min = p;
    if (!max || p.price > max.price) max = p;
  }
  return {
    avg30: avg(p30), n30: p30.length,
    avg90: avg(p90),
    avg365: avg(p365),
    min, max,
    count: p365.length,
  };
}

// 価格判定: 直近30日平均と比較。30日内のデータが3件未満なら判定なし。
function judgePrice(itemId, price) {
  const s = calcStats(itemId);
  if (s.n30 < 3) {
    return { verdict: null, stats: s };
  }
  // 0.1% 単位に丸めて浮動小数点誤差を消す(90/100-1 が -0.0999... になる対策)
  const ratio = Math.round((price / s.avg30 - 1) * 1000) / 1000;
  let verdict;
  if (ratio <= -0.10) verdict = '安い';
  else if (ratio >= 0.10) verdict = '高い';
  else verdict = '普通';
  return { verdict, ratio, stats: s };
}

/* ---------- タブ切り替え ---------- */

const views = {
  check: document.getElementById('view-check'),
  history: document.getElementById('view-history'),
  settings: document.getElementById('view-settings'),
};

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    const st = history.state || {};
    // 同じ画面を重ねて履歴に積まない
    if (st.tab !== name || st.item) history.pushState({ tab: name }, '');
    switchTab(name);
  });
});

// スマホの「戻る」で、アプリ内の前の画面(タブ・品目詳細)にもどす
history.replaceState({ tab: 'check' }, '');
window.addEventListener('popstate', e => {
  const st = e.state || { tab: 'check' };
  switchTab(st.tab || 'check');
  if (st.item && itemById(st.item)) openItemDetail(st.item, true);
});

function closeItemDetail() {
  itemDetail.hidden = true;
  checkHome.hidden = false;
  currentItemId = null;
}

function switchTab(name) {
  // 「しらべる」タブを押したら、詳細を開いていても品目一覧にもどす
  if (name === 'check') closeItemDetail();
  for (const [key, el] of Object.entries(views)) el.hidden = (key !== name);
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'check') renderItemList();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

/* ---------- しらべる: 品目一覧 ---------- */

const searchBox = document.getElementById('search-box');
const itemListEl = document.getElementById('item-list');
const checkHome = document.getElementById('check-home');
const itemDetail = document.getElementById('item-detail');
let currentItemId = null;

searchBox.addEventListener('input', renderItemList);

// 並び順: manual = 設定タブの並べ替え順 / popular = 記録回数の多い順
const SORT_KEY = 'nedancho:sortMode';
let sortMode = localStorage.getItem(SORT_KEY) === 'popular' ? 'popular' : 'manual';

document.getElementById('sort-manual').addEventListener('click', () => setSortMode('manual'));
document.getElementById('sort-popular').addEventListener('click', () => setSortMode('popular'));

function setSortMode(mode) {
  sortMode = mode;
  localStorage.setItem(SORT_KEY, mode);
  renderItemList();
}

function renderItemList() {
  document.getElementById('sort-manual').classList.toggle('active', sortMode === 'manual');
  document.getElementById('sort-popular').classList.toggle('active', sortMode === 'popular');

  const q = searchBox.value.trim().toLowerCase();
  const items = sortedLiveItems().filter(i =>
    !q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));

  if (items.length === 0) {
    itemListEl.innerHTML = '<p class="empty">該当する品目がありません。<br>設定タブから品目を追加できます。</p>';
    return;
  }

  let html = '';
  if (sortMode === 'popular') {
    // 365日間の記録回数が多い順(同数なら登録順を維持)
    const count = new Map(items.map(i => [i.id, pricesForItem(i.id, 365).length]));
    const sorted = [...items].sort((a, b) => count.get(b.id) - count.get(a.id));
    for (const i of sorted) {
      const n = count.get(i.id);
      html += `<button class="item-btn" data-id="${i.id}" type="button">
        <span>${esc(i.name)}</span><span class="unit">${n ? n + '回・' : ''}${esc(i.unit)}</span>
      </button>`;
    }
  } else {
    // カテゴリごとにまとめて表示
    const byCat = new Map();
    for (const i of items) {
      if (!byCat.has(i.category)) byCat.set(i.category, []);
      byCat.get(i.category).push(i);
    }
    for (const [cat, list] of byCat) {
      html += `<div class="category-name">${esc(cat)}</div>`;
      for (const i of list) {
        html += `<button class="item-btn" data-id="${i.id}" type="button">
          <span>${esc(i.name)}</span><span class="unit">${esc(i.unit)}</span>
        </button>`;
      }
    }
  }
  itemListEl.innerHTML = html;
}

itemListEl.addEventListener('click', e => {
  const btn = e.target.closest('.item-btn');
  if (btn) openItemDetail(btn.dataset.id);
});

document.getElementById('btn-back').addEventListener('click', () => {
  // 詳細を開いたときに履歴へ積んでいるので、戻るボタンも履歴で1つもどる
  if (history.state && history.state.item) history.back();
  else closeItemDetail();
});

/* ---------- しらべる: 品目詳細(判定 + 登録) ---------- */

const dPrice = document.getElementById('d-price');
const dAmount = document.getElementById('d-amount');
const dUnitPrice = document.getElementById('d-unitprice');
const dJudge = document.getElementById('d-judge');
const dStore = document.getElementById('d-store');
const dDate = document.getElementById('d-date');
const dBanner = document.getElementById('d-banner');

// 入力欄から「判定・記録に使う価格」を計算する。
// gram 品目: 値段と内容量(g)の両方が必要 → 100g あたりの単価を返す
// それ以外: 値段をそのまま返す
function currentEntry() {
  const item = itemById(currentItemId);
  const price = parseFloat(dPrice.value);
  if (!(price >= 0) || dPrice.value === '') return { ok: false };
  if (item && item.gram) {
    const amount = parseFloat(dAmount.value);
    if (!(amount > 0)) return { ok: false, needAmount: true };
    const unitPrice = Math.round(price / amount * 100 * 100) / 100;
    return { ok: true, gram: true, price: unitPrice, rawPrice: price, amount };
  }
  return { ok: true, gram: false, price };
}

function openItemDetail(itemId, fromHistory) {
  if (!fromHistory) history.pushState({ tab: 'check', item: itemId }, '');
  currentItemId = itemId;
  const item = itemById(itemId);
  if (!item) return;

  document.getElementById('d-title').textContent = item.name;
  document.getElementById('wrap-amount').hidden = !item.gram;
  document.getElementById('lbl-price').textContent =
    item.gram ? '値段(円)' : `値段(円 / ${item.unit})`;
  dPrice.value = '';
  dAmount.value = '';
  dDate.value = todayStr();
  dBanner.hidden = true;

  // 店舗セレクト(前回使った店舗を初期選択)
  const lastStore = localStorage.getItem(LAST_STORE_KEY);
  dStore.innerHTML = live(data.stores).map(s =>
    `<option value="${s.id}" ${s.id === lastStore ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  renderJudge();
  renderStats();
  renderStoreStats();
  renderChart();
  renderRecent();

  checkHome.hidden = true;
  itemDetail.hidden = false;
  window.scrollTo(0, 0);
  dPrice.focus();
}

dPrice.addEventListener('input', renderJudge);
dAmount.addEventListener('input', renderJudge);

function renderJudge() {
  const item = itemById(currentItemId);
  const entry = currentEntry();

  // gram 品目: 100g あたりの単価をリアルタイム表示
  if (item && item.gram && entry.ok) {
    dUnitPrice.hidden = false;
    dUnitPrice.textContent = `100gあたり ${fmtPrice(entry.price)}円`;
  } else {
    dUnitPrice.hidden = true;
  }

  if (!entry.ok) {
    dJudge.className = 'judge-badge judge-none';
    dJudge.textContent = entry.needAmount
      ? '内容量(g)も入力すると判定します'
      : '価格を入力すると判定します';
    return;
  }
  const suffix = entry.gram ? '円/100g' : '円';
  const r = judgePrice(currentItemId, entry.price);
  if (r.verdict === null) {
    dJudge.className = 'judge-badge judge-none';
    dJudge.innerHTML = '判定なし<small>直近30日の記録が3件未満のため判定できません</small>';
    return;
  }
  const pct = Math.abs(Math.round(r.ratio * 100));
  const cls = { '安い': 'judge-cheap', '普通': 'judge-normal', '高い': 'judge-expensive' }[r.verdict];
  const dir = r.ratio < 0 ? '安い' : '高い';
  dJudge.className = 'judge-badge ' + cls;
  dJudge.innerHTML = `${r.verdict}<small>30日平均 ${fmtPrice(r.stats.avg30)}${suffix} より ${pct}% ${dir}</small>`;
}

function renderStats() {
  const item = itemById(currentItemId);
  const suffix = (item && item.gram) ? '円/100g' : '円';
  const s = calcStats(currentItemId);
  const minText = s.min
    ? `${fmtPrice(s.min.price)}${suffix} <span class="sub">(${esc(s.min.date)}・${esc(storeName(s.min.storeId))})</span>`
    : '-';
  const maxText = s.max
    ? `${fmtPrice(s.max.price)}${suffix} <span class="sub">(${esc(s.max.date)}・${esc(storeName(s.max.storeId))})</span>`
    : '-';
  document.getElementById('d-stats').innerHTML = `
    <tr><td>30日平均</td><td>${s.avg30 != null ? fmtPrice(s.avg30) + suffix : '-'}</td></tr>
    <tr><td>90日平均</td><td>${s.avg90 != null ? fmtPrice(s.avg90) + suffix : '-'}</td></tr>
    <tr><td>365日平均</td><td>${s.avg365 != null ? fmtPrice(s.avg365) + suffix : '-'}</td></tr>
    <tr><td>365日最安値</td><td>${minText}</td></tr>
    <tr><td>365日最高値</td><td>${maxText}</td></tr>
    <tr><td>記録件数(365日)</td><td>${s.count}件</td></tr>`;
}

function storeName(id) {
  const s = storeById(id);
  return s ? s.name : '(削除済み店舗)';
}

// 店舗ごとの平均・最安・件数(365日)。平均の安い順に表示し、先頭に「最安」バッジ
function renderStoreStats() {
  const el = document.getElementById('d-stores');
  const item = itemById(currentItemId);
  const suffix = (item && item.gram) ? '円/100g' : '円';
  const p365 = pricesForItem(currentItemId, 365);
  if (p365.length === 0) {
    el.innerHTML = '<p class="empty">まだ記録がありません</p>';
    return;
  }
  const byStore = new Map();
  for (const p of p365) {
    if (!byStore.has(p.storeId)) byStore.set(p.storeId, []);
    byStore.get(p.storeId).push(p.price);
  }
  const rows = [...byStore.entries()].map(([storeId, prices]) => ({
    name: storeName(storeId),
    avg: prices.reduce((s, v) => s + v, 0) / prices.length,
    min: Math.min(...prices),
    count: prices.length,
  })).sort((a, b) => a.avg - b.avg);

  el.innerHTML = `
  <p class="table-unit">単位: ${suffix}</p>
  <table class="stats-table store-table">
    <tr class="head"><td>店舗</td><td>平均</td><td>最安</td></tr>
    ${rows.map((r, idx) => `
    <tr class="${idx === 0 && rows.length > 1 ? 'best-row' : ''}">
      <td>${idx === 0 && rows.length > 1 ? '<span class="best-badge">最安</span>' : ''}${esc(r.name)}<span class="sub">${r.count}件</span></td>
      <td>${fmtPrice(r.avg)}</td>
      <td>${fmtPrice(r.min)}</td>
    </tr>`).join('')}
  </table>`;
}

// 365日分の記録を折れ線グラフで表示(SVG手描き・ライブラリなし)
function renderChart() {
  const el = document.getElementById('d-chart');
  const pts = pricesForItem(currentItemId, 365)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) {
    el.innerHTML = '<p class="empty">記録が2件以上たまるとグラフを表示します</p>';
    return;
  }
  const W = 320, H = 140, L = 46, R = 12, T = 14, B = 24;
  const prices = pts.map(p => p.price);
  let min = Math.min(...prices), max = Math.max(...prices);
  if (min === max) { min -= 10; max += 10; }
  else {
    const pad = (max - min) * 0.12;
    min -= pad; max += pad;
  }
  const times = pts.map(p => new Date(p.date + 'T00:00:00').getTime());
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const X = i => (t1 === t0)
    ? L + (W - L - R) * (i / (pts.length - 1))
    : L + (W - L - R) * ((times[i] - t0) / (t1 - t0));
  const Y = v => T + (H - T - B) * (1 - (v - min) / (max - min));

  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.price).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) =>
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.price).toFixed(1)}" r="3.2"/>`).join('');
  const md = s => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
  const yMaxV = Math.max(...prices), yMinV = Math.min(...prices);

  el.innerHTML = `
  <svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="価格の推移グラフ">
    <line x1="${L}" y1="${Y(yMaxV)}" x2="${W - R}" y2="${Y(yMaxV)}" class="grid"/>
    <line x1="${L}" y1="${Y(yMinV)}" x2="${W - R}" y2="${Y(yMinV)}" class="grid"/>
    <text x="${L - 5}" y="${Y(yMaxV) + 4}" class="ylabel">${fmtPrice(yMaxV)}円</text>
    <text x="${L - 5}" y="${Y(yMinV) + 4}" class="ylabel">${fmtPrice(yMinV)}円</text>
    <text x="${L}" y="${H - 6}" class="xlabel">${md(pts[0].date)}</text>
    <text x="${W - R}" y="${H - 6}" class="xlabel end">${md(pts[pts.length - 1].date)}</text>
    <polyline points="${line}" class="line"/>
    <g class="dots">${dots}</g>
  </svg>`;
}

function priceText(p) {
  // gram 記録は「100g単価」をメインに、支払った値段と内容量を添えて表示
  if (p.amount != null) {
    return {
      main: `${fmtPrice(p.price)}円/100g`,
      // ちょうど100gの記録はメイン表示と同じ内容になるので添え書きは省略
      detail: (p.amount === 100) ? '' : `${fmtPrice(p.rawPrice)}円/${fmtPrice(p.amount)}g`,
    };
  }
  return { main: `${fmtPrice(p.price)}円`, detail: '' };
}

function renderRecent() {
  const recent = data.prices
    .filter(p => !p.del && p.itemId === currentItemId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  document.getElementById('d-recent').innerHTML = recent.length
    ? recent.map(p => {
      const t = priceText(p);
      return `
      <div class="record-row">
        <div class="info">
          <div class="main-line">${esc(storeName(p.storeId))}</div>
          <div class="sub-line">${esc(p.date)}${t.detail ? '・' + t.detail : ''}</div>
        </div>
        <div class="price">${t.main}</div>
      </div>`;
    }).join('')
    : '<p class="empty">まだ記録がありません</p>';
}

document.getElementById('btn-register').addEventListener('click', () => {
  const entry = currentEntry();
  if (!entry.ok) {
    alert(entry.needAmount ? '内容量(g)を入力してください' : '価格を入力してください');
    return;
  }
  if (!dDate.value) {
    alert('入力日を入力してください');
    return;
  }
  if (!dStore.value) {
    alert('店舗がありません。設定タブから店舗を追加してください');
    return;
  }

  // 登録前の365日最安値と比較(最安値更新判定)
  const before = calcStats(currentItemId);
  const isNewLow = before.min != null && entry.price < before.min.price;

  const record = {
    id: uid(),
    itemId: currentItemId,
    storeId: dStore.value,
    price: entry.price,
    date: dDate.value,
    u: Date.now(),
  };
  if (entry.gram) {
    record.rawPrice = entry.rawPrice;
    record.amount = entry.amount;
  }
  data.prices.push(record);
  save();
  localStorage.setItem(LAST_STORE_KEY, dStore.value);

  dBanner.hidden = false;
  if (isNewLow) {
    dBanner.className = 'banner record';
    dBanner.textContent = '🎉 最安値更新！';
  } else {
    dBanner.className = 'banner';
    dBanner.textContent = entry.gram
      ? `登録しました(100gあたり ${fmtPrice(entry.price)}円)`
      : '登録しました';
  }
  dPrice.value = '';
  dAmount.value = '';
  renderJudge();
  renderStats();
  renderStoreStats();
  renderChart();
  renderRecent();
});

/* ---------- 履歴 ---------- */

const historyList = document.getElementById('history-list');

function renderHistory() {
  const records = live(data.prices).sort((a, b) =>
    b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (records.length === 0) {
    historyList.innerHTML = '<p class="empty">まだ記録がありません。<br>「しらべる」タブから価格を登録できます。</p>';
    return;
  }
  historyList.innerHTML = records.map(p => {
    const item = itemById(p.itemId);
    const t = priceText(p);
    return `
    <div class="record-row" data-id="${p.id}">
      <div class="info">
        <div class="main-line">${esc(item ? item.name : '(削除済み品目)')}</div>
        <div class="sub-line">${esc(p.date)}・${esc(storeName(p.storeId))}${t.detail ? '・' + t.detail : ''}</div>
      </div>
      <div class="price">${t.main}</div>
      <button class="mini-btn" data-act="edit" type="button">編集</button>
      <button class="mini-btn danger" data-act="del" type="button">削除</button>
    </div>`;
  }).join('');
}

historyList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.record-row').dataset.id;
  if (btn.dataset.act === 'del') {
    const p = data.prices.find(x => x.id === id);
    const item = p && itemById(p.itemId);
    if (confirm(`この記録を削除しますか?\n${item ? item.name : ''} ${p ? fmtPrice(p.price) + '円 (' + p.date + ')' : ''}`)) {
      // 同期のため、消すのではなく削除印を付けて残す
      p.del = true;
      p.u = Date.now();
      save();
      renderHistory();
    }
  } else {
    openPriceDialog(id);
  }
});

/* ---------- 履歴: 編集ダイアログ ---------- */

const dlgPrice = document.getElementById('dlg-price');
let editingPriceId = null;

// 選択中の品目が gram 品目かどうかで内容量欄を出し分ける
function syncEditAmountField() {
  const item = itemById(document.getElementById('f-price-item').value);
  document.getElementById('wrap-edit-amount').hidden = !(item && item.gram);
}
document.getElementById('f-price-item').addEventListener('change', syncEditAmountField);

function openPriceDialog(id) {
  const p = data.prices.find(x => x.id === id);
  if (!p) return;
  editingPriceId = id;
  document.getElementById('f-price-item').innerHTML = sortedLiveItems().map(i =>
    `<option value="${i.id}" ${i.id === p.itemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  document.getElementById('f-price-store').innerHTML = live(data.stores).map(s =>
    `<option value="${s.id}" ${s.id === p.storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  // gram 記録は「支払った値段」を編集させる(100g単価は保存時に再計算)
  document.getElementById('f-price-price').value = (p.rawPrice != null) ? p.rawPrice : p.price;
  document.getElementById('f-price-amount').value = (p.amount != null) ? p.amount : '';
  document.getElementById('f-price-date').value = p.date;
  syncEditAmountField();
  dlgPrice.showModal();
}

document.getElementById('form-price').addEventListener('submit', e => {
  e.preventDefault();
  const p = data.prices.find(x => x.id === editingPriceId);
  if (p) {
    const itemId = document.getElementById('f-price-item').value;
    const item = itemById(itemId);
    const price = parseFloat(document.getElementById('f-price-price').value);
    if (item && item.gram) {
      const amount = parseFloat(document.getElementById('f-price-amount').value);
      if (!(amount > 0)) {
        alert('内容量(g)を入力してください');
        return;
      }
      p.rawPrice = price;
      p.amount = amount;
      p.price = Math.round(price / amount * 100 * 100) / 100;
    } else {
      p.price = price;
      delete p.rawPrice;
      delete p.amount;
    }
    p.itemId = itemId;
    p.storeId = document.getElementById('f-price-store').value;
    p.date = document.getElementById('f-price-date').value;
    p.u = Date.now();
    save();
  }
  dlgPrice.close();
  renderHistory();
});

/* ---------- 設定: 品目管理 ---------- */

const dlgItem = document.getElementById('dlg-item');
let editingItemId = null;

function renderSettings() {
  const items = sortedLiveItems();
  const last = items.length - 1;
  document.getElementById('settings-items').innerHTML = items.map((i, idx) => `
    <div class="record-row" data-id="${i.id}">
      <div class="move-btns">
        <button class="mini-btn move" data-act="up" type="button" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="mini-btn move" data-act="down" type="button" ${idx === last ? 'disabled' : ''}>▼</button>
      </div>
      <div class="info">
        <div class="main-line">${esc(i.name)}</div>
        <div class="sub-line">${esc(i.category)}・${esc(i.unit)}${i.gram ? '(値段+内容量で入力)' : ''}</div>
      </div>
      <button class="mini-btn" data-act="edit" type="button">編集</button>
      <button class="mini-btn danger" data-act="del" type="button">削除</button>
    </div>`).join('');

  document.getElementById('settings-stores').innerHTML = live(data.stores).map(s => `
    <div class="record-row" data-id="${s.id}">
      <div class="info"><div class="main-line">${esc(s.name)}</div></div>
      <button class="mini-btn" data-act="edit" type="button">編集</button>
      <button class="mini-btn danger" data-act="del" type="button">削除</button>
    </div>`).join('');

  // 同期設定の表示
  document.getElementById('sync-url').value = getSyncUrl();
  const stamp = localStorage.getItem(SYNC_TIME_KEY);
  setSyncStatus(getSyncUrl()
    ? (stamp ? '✅ 最終同期: ' + stamp : '未同期(「今すぐ同期」を押してください)')
    : '未設定(同期しなくてもアプリは使えます)');
}

document.getElementById('btn-add-item').addEventListener('click', () => openItemDialog(null));

document.getElementById('settings-items').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.record-row').dataset.id;
  if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
    const items = sortedLiveItems();
    const idx = items.findIndex(i => i.id === id);
    const to = btn.dataset.act === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || to < 0 || to >= items.length) return;
    // 表示順(ord)を隣と入れ替え
    [items[idx].ord, items[to].ord] = [items[to].ord, items[idx].ord];
    items[idx].u = Date.now();
    items[to].u = Date.now();
    save();
    renderSettings();
    return;
  }
  if (btn.dataset.act === 'del') {
    const item = itemById(id);
    const targets = data.prices.filter(p => !p.del && p.itemId === id);
    if (confirm(`「${item.name}」を削除しますか?\n価格記録 ${targets.length}件 も一緒に削除されます。`)) {
      const now = Date.now();
      item.del = true;
      item.u = now;
      for (const p of targets) { p.del = true; p.u = now; }
      save();
      renderSettings();
    }
  } else {
    openItemDialog(id);
  }
});

// チェック中は単位を 100g に固定する
const fItemGram = document.getElementById('f-item-gram');
const fItemUnit = document.getElementById('f-item-unit');
fItemGram.addEventListener('change', syncItemUnitField);

function syncItemUnitField() {
  if (fItemGram.checked) {
    fItemUnit.value = '100g';
    fItemUnit.disabled = true;
  } else {
    fItemUnit.disabled = false;
  }
}

function openItemDialog(id) {
  editingItemId = id;
  const item = id ? itemById(id) : null;
  document.getElementById('dlg-item-title').textContent = item ? '品目を編集' : '品目を追加';
  document.getElementById('f-item-name').value = item ? item.name : '';
  document.getElementById('f-item-category').value = item ? item.category : '';
  fItemGram.checked = item ? !!item.gram : true; // 新規は100g管理を初期値に
  fItemUnit.value = item ? item.unit : '100g';
  syncItemUnitField();
  // 既存カテゴリを入力候補に
  const cats = [...new Set(live(data.items).map(i => i.category))];
  document.getElementById('category-list').innerHTML =
    cats.map(c => `<option value="${esc(c)}">`).join('');
  dlgItem.showModal();
}

document.getElementById('form-item').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('f-item-name').value.trim();
  const category = document.getElementById('f-item-category').value.trim();
  const gram = fItemGram.checked;
  const unit = gram ? '100g' : fItemUnit.value.trim();
  if (!name || !category || !unit) {
    alert('品目名・カテゴリ・単位を入力してください');
    return;
  }
  if (editingItemId) {
    const item = itemById(editingItemId);
    Object.assign(item, { name, category, unit, gram, u: Date.now() });
  } else {
    const maxOrd = Math.max(0, ...data.items.map(i => i.ord || 0));
    data.items.push({ id: uid(), name, category, unit, gram, ord: maxOrd + 10, u: Date.now() });
  }
  save();
  dlgItem.close();
  renderSettings();
});

/* ---------- 設定: 店舗管理 ---------- */

const dlgStore = document.getElementById('dlg-store');
let editingStoreId = null;

document.getElementById('btn-add-store').addEventListener('click', () => openStoreDialog(null));

document.getElementById('settings-stores').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.record-row').dataset.id;
  if (btn.dataset.act === 'del') {
    const store = storeById(id);
    const targets = data.prices.filter(p => !p.del && p.storeId === id);
    if (confirm(`「${store.name}」を削除しますか?\nこの店舗の価格記録 ${targets.length}件 も一緒に削除されます。`)) {
      const now = Date.now();
      store.del = true;
      store.u = now;
      for (const p of targets) { p.del = true; p.u = now; }
      save();
      renderSettings();
    }
  } else {
    openStoreDialog(id);
  }
});

function openStoreDialog(id) {
  editingStoreId = id;
  const store = id ? storeById(id) : null;
  document.getElementById('dlg-store-title').textContent = store ? '店舗を編集' : '店舗を追加';
  document.getElementById('f-store-name').value = store ? store.name : '';
  dlgStore.showModal();
}

document.getElementById('form-store').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('f-store-name').value.trim();
  if (!name) return;
  if (editingStoreId) {
    const store = storeById(editingStoreId);
    store.name = name;
    store.u = Date.now();
  } else {
    data.stores.push({ id: uid(), name, u: Date.now() });
  }
  save();
  dlgStore.close();
  renderSettings();
});

/* ---------- ダイアログ共通: キャンセルボタン ---------- */

document.querySelectorAll('dialog [data-close]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

/* ---------- バックアップ ---------- */

document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nedancho-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

const importFile = document.getElementById('import-file');
document.getElementById('btn-import').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', () => {
  const file = importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.items) || !Array.isArray(imported.stores) || !Array.isArray(imported.prices)) {
        throw new Error('形式が違います');
      }
      if (confirm(`バックアップを読み込みますか?\n品目 ${imported.items.length}件 / 店舗 ${imported.stores.length}件 / 価格記録 ${imported.prices.length}件\n\n※ いまのデータはすべて置き換えられます`)) {
        data = migrate(imported);
        save();
        renderSettings();
        alert('インポートしました');
      }
    } catch (err) {
      alert('読み込めませんでした。ねだん帳のバックアップファイル(.json)を選んでください。');
    }
    importFile.value = '';
  };
  reader.readAsText(file);
});

/* ---------- 同期設定のUI ---------- */

document.getElementById('btn-sync-save').addEventListener('click', () => {
  const url = document.getElementById('sync-url').value.trim();
  if (url && !url.startsWith('https://script.google.com/')) {
    alert('Apps Script のウェブアプリURL(https://script.google.com/macros/s/…/exec)を貼り付けてください');
    return;
  }
  localStorage.setItem(SYNC_URL_KEY, url);
  if (url) {
    setSyncStatus('URLを保存しました。同期を開始します…');
    syncNow(false);
  } else {
    setSyncStatus('未設定(同期しなくてもアプリは使えます)');
  }
});

document.getElementById('btn-sync-now').addEventListener('click', () => syncNow(false));

/* ---------- 起動 ---------- */

renderItemList();

// 起動時に自動同期(URL設定済み & オンラインのときだけ)
if (getSyncUrl() && navigator.onLine) {
  syncNow(true);
}
// 圏外から復帰したときも同期
window.addEventListener('online', () => scheduleSync());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // 登録に失敗してもアプリ自体は動く(file:// で開いた場合など)
  });
}
