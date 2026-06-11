'use strict';

/* =========================================================
 * ねだん帳 Ver 1.0
 * データはすべて localStorage(この端末のブラウザ内)に保存。
 * サーバー通信なし = 圏外でも動く。
 * ========================================================= */

const STORAGE_KEY = 'nedancho:data:v1';
const LAST_STORE_KEY = 'nedancho:lastStore';

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

// 購入日が今日から何日前か(今日=0)。未来日はマイナス。
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

function seedData() {
  const item = (name, category, unit) => ({ id: uid(), name, category, unit });
  return {
    version: 1,
    items: [
      item('国産鶏むね', '肉類', '100g'),
      item('国産鶏もも', '肉類', '100g'),
      item('国産ささみ', '肉類', '100g'),
      item('国産豚こま', '肉類', '100g'),
      item('外国産豚こま', '肉類', '100g'),
      item('国産豚バラ', '肉類', '100g'),
      item('外国産豚バラ', '肉類', '100g'),
      item('合い挽き肉', '肉類', '100g'),
      item('生たら', '魚介', '100g'),
      item('塩サバ', '魚介', '1枚'),
      item('サバ缶', '魚介', '1缶'),
      item('卵10個', '卵・大豆', '1パック'),
      item('豆腐', '卵・大豆', '1丁'),
      item('納豆', '卵・大豆', '1パック'),
      item('牛乳1L', '乳製品', '1本'),
      item('ヨーグルト', '乳製品', '1個'),
      item('冷凍ブロッコリー', '冷凍食品', '1袋'),
      item('味噌', '調味料', '1個'),
      item('醤油', '調味料', '1本'),
      item('めんつゆ', '調味料', '1本'),
      item('マヨネーズ', '調味料', '1本'),
    ],
    stores: ['OK', 'ロピア', 'イオン', 'そうてつローゼン', 'サミット', '東急ストア', 'まいばすけっと']
      .map(name => ({ id: uid(), name })),
    prices: [], // { id, itemId, storeId, price, date }
  };
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
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function itemById(id) { return data.items.find(i => i.id === id); }
function storeById(id) { return data.stores.find(s => s.id === id); }

/* ---------- 相場の計算 ---------- */

function pricesForItem(itemId, withinDays) {
  return data.prices.filter(p => {
    if (p.itemId !== itemId) return false;
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
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
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

function renderItemList() {
  const q = searchBox.value.trim().toLowerCase();
  const items = data.items.filter(i =>
    !q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));

  if (items.length === 0) {
    itemListEl.innerHTML = '<p class="empty">該当する品目がありません。<br>設定タブから品目を追加できます。</p>';
    return;
  }
  // カテゴリごとにまとめて表示
  const byCat = new Map();
  for (const i of items) {
    if (!byCat.has(i.category)) byCat.set(i.category, []);
    byCat.get(i.category).push(i);
  }
  let html = '';
  for (const [cat, list] of byCat) {
    html += `<div class="category-name">${esc(cat)}</div>`;
    for (const i of list) {
      html += `<button class="item-btn" data-id="${i.id}" type="button">
        <span>${esc(i.name)}</span><span class="unit">${esc(i.unit)}</span>
      </button>`;
    }
  }
  itemListEl.innerHTML = html;
}

itemListEl.addEventListener('click', e => {
  const btn = e.target.closest('.item-btn');
  if (btn) openItemDetail(btn.dataset.id);
});

document.getElementById('btn-back').addEventListener('click', () => {
  itemDetail.hidden = true;
  checkHome.hidden = false;
  currentItemId = null;
});

/* ---------- しらべる: 品目詳細(判定 + 登録) ---------- */

const dPrice = document.getElementById('d-price');
const dJudge = document.getElementById('d-judge');
const dStore = document.getElementById('d-store');
const dDate = document.getElementById('d-date');
const dBanner = document.getElementById('d-banner');

function openItemDetail(itemId) {
  currentItemId = itemId;
  const item = itemById(itemId);
  if (!item) return;

  document.getElementById('d-title').textContent = item.name;
  document.getElementById('d-unit').textContent = item.unit;
  dPrice.value = '';
  dDate.value = todayStr();
  dBanner.hidden = true;

  // 店舗セレクト(前回使った店舗を初期選択)
  const lastStore = localStorage.getItem(LAST_STORE_KEY);
  dStore.innerHTML = data.stores.map(s =>
    `<option value="${s.id}" ${s.id === lastStore ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  renderJudge();
  renderStats();
  renderRecent();

  checkHome.hidden = true;
  itemDetail.hidden = false;
  window.scrollTo(0, 0);
  dPrice.focus();
}

dPrice.addEventListener('input', renderJudge);

function renderJudge() {
  const price = parseFloat(dPrice.value);
  if (!(price >= 0) || dPrice.value === '') {
    dJudge.className = 'judge-badge judge-none';
    dJudge.textContent = '価格を入力すると判定します';
    return;
  }
  const r = judgePrice(currentItemId, price);
  if (r.verdict === null) {
    dJudge.className = 'judge-badge judge-none';
    dJudge.innerHTML = '判定なし<small>直近30日の記録が3件未満のため判定できません</small>';
    return;
  }
  const pct = Math.abs(Math.round(r.ratio * 100));
  const cls = { '安い': 'judge-cheap', '普通': 'judge-normal', '高い': 'judge-expensive' }[r.verdict];
  const dir = r.ratio < 0 ? '安い' : '高い';
  dJudge.className = 'judge-badge ' + cls;
  dJudge.innerHTML = `${r.verdict}<small>30日平均 ${fmtPrice(r.stats.avg30)}円 より ${pct}% ${dir}</small>`;
}

function renderStats() {
  const s = calcStats(currentItemId);
  const minText = s.min
    ? `${fmtPrice(s.min.price)}円 <span class="sub">(${esc(s.min.date)}・${esc(storeName(s.min.storeId))})</span>`
    : '-';
  const maxText = s.max
    ? `${fmtPrice(s.max.price)}円 <span class="sub">(${esc(s.max.date)}・${esc(storeName(s.max.storeId))})</span>`
    : '-';
  document.getElementById('d-stats').innerHTML = `
    <tr><td>30日平均</td><td>${s.avg30 != null ? fmtPrice(s.avg30) + '円' : '-'}</td></tr>
    <tr><td>90日平均</td><td>${s.avg90 != null ? fmtPrice(s.avg90) + '円' : '-'}</td></tr>
    <tr><td>365日平均</td><td>${s.avg365 != null ? fmtPrice(s.avg365) + '円' : '-'}</td></tr>
    <tr><td>365日最安値</td><td>${minText}</td></tr>
    <tr><td>365日最高値</td><td>${maxText}</td></tr>
    <tr><td>記録件数(365日)</td><td>${s.count}件</td></tr>`;
}

function storeName(id) {
  const s = storeById(id);
  return s ? s.name : '(削除済み店舗)';
}

function renderRecent() {
  const recent = data.prices
    .filter(p => p.itemId === currentItemId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  document.getElementById('d-recent').innerHTML = recent.length
    ? recent.map(p => `
      <div class="record-row">
        <div class="info">
          <div class="main-line">${esc(storeName(p.storeId))}</div>
          <div class="sub-line">${esc(p.date)}</div>
        </div>
        <div class="price">${fmtPrice(p.price)}円</div>
      </div>`).join('')
    : '<p class="empty">まだ記録がありません</p>';
}

document.getElementById('btn-register').addEventListener('click', () => {
  const price = parseFloat(dPrice.value);
  if (!(price >= 0) || dPrice.value === '') {
    alert('価格を入力してください');
    return;
  }
  if (!dDate.value) {
    alert('購入日を入力してください');
    return;
  }
  if (!dStore.value) {
    alert('店舗がありません。設定タブから店舗を追加してください');
    return;
  }

  // 登録前の365日最安値と比較(最安値更新判定)
  const before = calcStats(currentItemId);
  const isNewLow = before.min != null && price < before.min.price;

  data.prices.push({
    id: uid(),
    itemId: currentItemId,
    storeId: dStore.value,
    price,
    date: dDate.value,
  });
  save();
  localStorage.setItem(LAST_STORE_KEY, dStore.value);

  dBanner.hidden = false;
  if (isNewLow) {
    dBanner.className = 'banner record';
    dBanner.textContent = '🎉 最安値更新！';
  } else {
    dBanner.className = 'banner';
    dBanner.textContent = '登録しました';
  }
  dPrice.value = '';
  renderJudge();
  renderStats();
  renderRecent();
});

/* ---------- 履歴 ---------- */

const historyList = document.getElementById('history-list');

function renderHistory() {
  const records = [...data.prices].sort((a, b) =>
    b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (records.length === 0) {
    historyList.innerHTML = '<p class="empty">まだ記録がありません。<br>「しらべる」タブから価格を登録できます。</p>';
    return;
  }
  historyList.innerHTML = records.map(p => {
    const item = itemById(p.itemId);
    return `
    <div class="record-row" data-id="${p.id}">
      <div class="info">
        <div class="main-line">${esc(item ? item.name : '(削除済み品目)')}</div>
        <div class="sub-line">${esc(p.date)}・${esc(storeName(p.storeId))}</div>
      </div>
      <div class="price">${fmtPrice(p.price)}円</div>
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
      data.prices = data.prices.filter(x => x.id !== id);
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

function openPriceDialog(id) {
  const p = data.prices.find(x => x.id === id);
  if (!p) return;
  editingPriceId = id;
  document.getElementById('f-price-item').innerHTML = data.items.map(i =>
    `<option value="${i.id}" ${i.id === p.itemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  document.getElementById('f-price-store').innerHTML = data.stores.map(s =>
    `<option value="${s.id}" ${s.id === p.storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  document.getElementById('f-price-price').value = p.price;
  document.getElementById('f-price-date').value = p.date;
  dlgPrice.showModal();
}

document.getElementById('form-price').addEventListener('submit', e => {
  e.preventDefault();
  const p = data.prices.find(x => x.id === editingPriceId);
  if (p) {
    p.itemId = document.getElementById('f-price-item').value;
    p.storeId = document.getElementById('f-price-store').value;
    p.price = parseFloat(document.getElementById('f-price-price').value);
    p.date = document.getElementById('f-price-date').value;
    save();
  }
  dlgPrice.close();
  renderHistory();
});

/* ---------- 設定: 品目管理 ---------- */

const dlgItem = document.getElementById('dlg-item');
let editingItemId = null;

function renderSettings() {
  document.getElementById('settings-items').innerHTML = data.items.map(i => `
    <div class="record-row" data-id="${i.id}">
      <div class="info">
        <div class="main-line">${esc(i.name)}</div>
        <div class="sub-line">${esc(i.category)}・${esc(i.unit)}</div>
      </div>
      <button class="mini-btn" data-act="edit" type="button">編集</button>
      <button class="mini-btn danger" data-act="del" type="button">削除</button>
    </div>`).join('');

  document.getElementById('settings-stores').innerHTML = data.stores.map(s => `
    <div class="record-row" data-id="${s.id}">
      <div class="info"><div class="main-line">${esc(s.name)}</div></div>
      <button class="mini-btn" data-act="edit" type="button">編集</button>
      <button class="mini-btn danger" data-act="del" type="button">削除</button>
    </div>`).join('');
}

document.getElementById('btn-add-item').addEventListener('click', () => openItemDialog(null));

document.getElementById('settings-items').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.record-row').dataset.id;
  if (btn.dataset.act === 'del') {
    const item = itemById(id);
    const n = data.prices.filter(p => p.itemId === id).length;
    if (confirm(`「${item.name}」を削除しますか?\n価格記録 ${n}件 も一緒に削除されます。`)) {
      data.items = data.items.filter(i => i.id !== id);
      data.prices = data.prices.filter(p => p.itemId !== id);
      save();
      renderSettings();
    }
  } else {
    openItemDialog(id);
  }
});

function openItemDialog(id) {
  editingItemId = id;
  const item = id ? itemById(id) : null;
  document.getElementById('dlg-item-title').textContent = item ? '品目を編集' : '品目を追加';
  document.getElementById('f-item-name').value = item ? item.name : '';
  document.getElementById('f-item-category').value = item ? item.category : '';
  document.getElementById('f-item-unit').value = item ? item.unit : '';
  // 既存カテゴリを入力候補に
  const cats = [...new Set(data.items.map(i => i.category))];
  document.getElementById('category-list').innerHTML =
    cats.map(c => `<option value="${esc(c)}">`).join('');
  dlgItem.showModal();
}

document.getElementById('form-item').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('f-item-name').value.trim();
  const category = document.getElementById('f-item-category').value.trim();
  const unit = document.getElementById('f-item-unit').value.trim();
  if (!name || !category || !unit) return;
  if (editingItemId) {
    const item = itemById(editingItemId);
    Object.assign(item, { name, category, unit });
  } else {
    data.items.push({ id: uid(), name, category, unit });
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
    const n = data.prices.filter(p => p.storeId === id).length;
    if (confirm(`「${store.name}」を削除しますか?\nこの店舗の価格記録 ${n}件 も一緒に削除されます。`)) {
      data.stores = data.stores.filter(s => s.id !== id);
      data.prices = data.prices.filter(p => p.storeId !== id);
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
    storeById(editingStoreId).name = name;
  } else {
    data.stores.push({ id: uid(), name });
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
        data = imported;
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

/* ---------- 起動 ---------- */

renderItemList();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // 登録に失敗してもアプリ自体は動く(file:// で開いた場合など)
  });
}
