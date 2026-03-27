/**
 * ui.js - UI描画モジュール
 * window.UIModule として公開
 *
 * 依存: data.js（DataModule）, org.js（OrgModule）, simulation.js（SimulationModule）
 * 読み込み順: data.js → org.js → simulation.js → ui.js
 *
 * 足軽・四 実装担当箇所:
 *   - renderDashboard()    : 完全実装
 *   - renderOrgChart()     : 完全実装
 *   - renderEmployeeList() : 完全実装
 *   - renderHRActions()    : 完全実装
 *   - renderTurnScreen()   : 完全実装
 *   - renderProjectList()  : 完全実装
 *   - renderSettings()     : 完全実装
 *
 * 規約:
 *   - DOM操作のみを担当し、ゲームロジックは変更しない
 *   - 状態変更が必要な場合は window.GameCallbacks 経由で行う
 *   - innerHTML で生成する場合は XSS に注意（ユーザ入力値は _escape() でエスケープ）
 */

'use strict';

// ============================================================
// 内部ユーティリティ
// ============================================================

/**
 * 数値を万円表記にフォーマット
 * @param {number} value - 万円単位の数値
 * @returns {string} 例: '1,234万円' / '12.3億円'
 */
function _formatMoney(value) {
  if (Math.abs(value) >= 10000) {
    return (value / 10000).toFixed(1) + '億円';
  }
  return value.toLocaleString() + '万円';
}

/**
 * HTMLエスケープ
 * @param {any} str
 * @returns {string}
 */
function _escape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 職種コードを日本語ラベルに変換
 * @param {string} jobType
 * @returns {string}
 */
function _jobTypeLabel(jobType) {
  return window.DataModule?.JOB_TYPES?.[jobType]?.label || _escape(jobType);
}

/**
 * ポテンシャルコードをラベルに変換
 * @param {string} potential
 * @returns {string}
 */
function _potentialLabel(potential) {
  return window.DataModule?.POTENTIAL_TYPES?.[potential]?.label || potential || '-';
}

/**
 * スキルバーHTML生成
 * @param {number} value - 1〜100
 * @param {string} [colorClass] - CSS クラス名
 * @returns {string}
 */
function _skillBarHtml(value, colorClass) {
  const cls = colorClass || '';
  const v = Math.max(0, Math.min(100, value || 0));
  return `<div class="skill-bar">
    <div class="skill-bar-track"><div class="skill-bar-fill ${cls}" style="width:${v}%"></div></div>
    <span class="skill-bar-label">${v}</span>
  </div>`;
}

// ============================================================
// 初期化
// ============================================================

/**
 * UIモジュールを初期化する
 * DOMContentLoaded 後、main.js から呼び出す
 * @returns {void}
 */
function init() {
  _attachFilterListeners();
  _attachModalOverlayListeners();
}

function _attachFilterListeners() {
  ['filter-jobtype', 'filter-grade', 'filter-unit', 'filter-potential', 'filter-position'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._uiListenerAttached) {
      el._uiListenerAttached = true;
      el.addEventListener('change', () => {
        if (window.gameState) renderEmployeeList(window.gameState);
      });
    }
  });
  const kwEl = document.getElementById('filter-keyword');
  if (kwEl && !kwEl._uiListenerAttached) {
    kwEl._uiListenerAttached = true;
    kwEl.addEventListener('input', () => {
      _empFilterKeyword = kwEl.value;
      if (window.gameState) renderEmployeeList(window.gameState);
    });
  }
}

function _attachModalOverlayListeners() {
  // オーバーレイクリックでモーダルを閉じる
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    if (!overlay._uiListenerAttached) {
      overlay._uiListenerAttached = true;
      overlay.addEventListener('click', () => {
        const modal = overlay.closest('.modal');
        if (modal) modal.classList.add('hidden');
      });
    }
  });
}

// ============================================================
// 画面切替
// ============================================================

/**
 * 指定 screenId の画面を表示し、他を非表示にする
 *
 * @param {string} screenId - 画面ID（例: 'dashboard', 'employees', 'settings'）
 * @returns {void}
 */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });

  const target = document.getElementById('screen-' + screenId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  document.querySelectorAll('.nav-link[data-screen]').forEach(link => {
    link.classList.toggle('active', link.dataset.screen === screenId);
  });
}

// ============================================================
// 各画面描画関数
// ============================================================

/**
 * ダッシュボード画面を描画する
 *
 * @param {GameState} state - ゲーム状態
 * @returns {void}
 *
 * 表示内容:
 *   - KPIカード（現在年度・社員数・平均モチベ・平均スキル・当期利益・累積利益）
 *   - 財務推移テーブル（直近5年）
 *   - アラートセクション（75歳以上・低モチベ40以下・定員超過拠点）
 */
// 【2】閲覧中の年度（null = 現在）
let _viewingYear = null;

// 【3】社員一覧ソート状態
let _sortColumn = null;   // ソート対象の列キー
let _sortAsc    = true;   // true=昇順, false=降順

// 組織図：社員一覧展開中の部門ID
let _expandedMemberUnitId = null;

// 【3】ドラッグアンドドロップ：ドラッグ中ユニットID
let _dragUnitId = null;

// 人事アクション画面のアクティブタブ
let _hrActiveTab = 'hr-review';

// 組織図：折りたたみ中の部門IDセット
let _collapsedUnitIds = new Set();

// 社員一覧：キーワード検索
let _empFilterKeyword = '';

// 組織図：複数選択中の社員IDセット
let _selectedEmpIds = new Set();
// 組織図：複数選択DnD中の社員IDリスト
let _dragEmpIds = [];

// 社員カードDnD：ドラッグ中の社員ID・元部門ID
let _dragEmpId = null;
let _dragEmpFromUnitId = null;

function renderDashboard(state) {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  // 【2】閲覧年度の状態を使う
  let displayState = state;
  let isReadOnly   = false;
  if (_viewingYear !== null && _viewingYear !== state.currentYear) {
    const snap = (state.yearSnapshots || []).find(s => s.year === _viewingYear);
    if (snap) {
      displayState = {
        ...state,
        currentYear: snap.year,
        employees:   snap.employees,
        orgUnits:    snap.orgUnits,
        finances:    snap.finances,
      };
      isReadOnly = true;
    }
  }

  const employees = displayState.employees || [];
  const history   = displayState.finances?.history || [];
  const latest    = history[history.length - 1] || null;

  const empCount = employees.length;
  const avgMotiv = empCount > 0
    ? Math.round(employees.reduce((s, e) => s + (e.motivation || 0), 0) / empCount)
    : 0;
  const avgTech  = empCount > 0
    ? Math.round(employees.reduce((s, e) => s + (e.technical || 0), 0) / empCount)
    : 0;
  const avgComm  = empCount > 0
    ? Math.round(employees.reduce((s, e) => s + (e.communication || 0), 0) / empCount)
    : 0;
  const avgLead  = empCount > 0
    ? Math.round(employees.reduce((s, e) => s + (e.leadership || 0), 0) / empCount)
    : 0;

  const profit  = latest?.profitAfterBuffs ?? latest?.profit ?? 0;
  const cumProfit = history.reduce((s, r) => s + (r.profitAfterBuffs ?? r.profit ?? 0), 0);

  // 【2】年度セレクタHTML
  const snapshots    = state.yearSnapshots || [];
  const yearOptions  = [state.currentYear, ...snapshots.map(s => s.year).reverse()]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(y => {
      const isSelected = (_viewingYear === null && y === state.currentYear) ||
                         (_viewingYear === y);
      return `<option value="${y}"${isSelected ? ' selected' : ''}>${y}年度${y === state.currentYear ? '（現在）' : ''}</option>`;
    }).join('');
  const yearSelectorHtml = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <label style="font-size:13px;font-weight:600;">表示年度：</label>
      <select style="width:auto;" id="dashboard-year-selector" onchange="window.UIModule?.switchDashboardYear?.(this.value, window.gameState)">
        ${yearOptions}
      </select>
      ${isReadOnly ? `<button class="btn btn-sm btn-primary" onclick="window.UIModule?.switchDashboardYear?.('current', window.gameState)">最新に戻る</button>` : ''}
    </div>
    ${isReadOnly ? `<div style="background:#fef3c7;border-left:4px solid #d97706;padding:8px 14px;margin-bottom:12px;border-radius:6px;font-size:13px;color:#92400e;font-weight:600;">
      📅 閲覧モード（${_viewingYear}年度）― 過去データを表示中。編集系操作は無効です。</div>` : ''}`;

  // モチベーションカラー
  const motivColor = avgMotiv >= 70 ? 'positive' : avgMotiv <= 40 ? 'negative' : '';
  const profitColor = profit < 0 ? 'negative' : 'positive';
  const cumColor    = cumProfit < 0 ? 'negative' : 'positive';

  // 性別集計（gender フィールドが無い社員は '?' 扱い）
  const maleCount   = employees.filter(e => e.gender === 'M').length;
  const femaleCount = employees.filter(e => e.gender === 'F').length;

  // 管理職（G5以上）
  const managerGrades = ['G5','G6','G7','G8','G9','G10'];
  const managers      = employees.filter(e => managerGrades.includes(e.grade));
  const femaleManagers = managers.filter(e => e.gender === 'F');
  const mgmtRatio     = empCount > 0 ? (managers.length / empCount * 100).toFixed(1) : '0.0';
  const femaleMgmtRatio = managers.length > 0 ? (femaleManagers.length / managers.length * 100).toFixed(1) : '0.0';

  // KPIグリッド
  const kpiHtml = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="card-label">現在年度</div>
        <div class="card-value">${_escape(String(displayState.currentYear))}<span class="card-unit">年度</span></div>
        <div class="card-sub">${_escape(state.projectName || '')}</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">社員数</div>
        <div class="card-value">${empCount}<span class="card-unit">名</span></div>
        <div class="card-sub">取締役除く</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">平均モチベーション</div>
        <div class="card-value ${motivColor}">${avgMotiv}<span class="card-unit">/100</span></div>
        <div class="card-sub">${avgMotiv >= 70 ? '好調' : avgMotiv <= 40 ? '要注意' : '普通'}</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">平均スキル（テクニカル）</div>
        <div class="card-value">${avgTech}<span class="card-unit">/100</span></div>
        <div class="card-sub">コミュ:${avgComm} リーダー:${avgLead}</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">当期利益</div>
        <div class="card-value ${profitColor}">${_formatMoney(profit)}</div>
        <div class="card-sub">${latest ? latest.year + '年度' : '未算出'}</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">累積利益</div>
        <div class="card-value ${cumColor}">${_formatMoney(cumProfit)}</div>
        <div class="card-sub">開始来累計</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">男性 / 女性</div>
        <div class="card-value">${maleCount} <span style="font-size:18px;">/ ${femaleCount}</span><span class="card-unit">名</span></div>
        <div class="card-sub">性別内訳</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">管理職比率</div>
        <div class="card-value">${mgmtRatio}<span class="card-unit">%</span></div>
        <div class="card-sub">G5以上 ${managers.length}名</div>
      </div>
      <div class="kpi-card">
        <div class="card-label">女性管理職比率</div>
        <div class="card-value">${femaleMgmtRatio}<span class="card-unit">%</span></div>
        <div class="card-sub">女性管理職 ${femaleManagers.length}名</div>
      </div>
    </div>`;

  // グレード別人数
  const GRADE_DEFINITIONS = window.DataModule?.GRADE_DEFINITIONS || {};
  const gradeRows = (window.DataModule?.GRADE_ORDER || []).map(g => {
    const cnt = employees.filter(e => e.grade === g).length;
    if (cnt === 0) return '';
    return `<tr><td>${_escape(GRADE_DEFINITIONS[g]?.label || g)}</td><td class="text-right">${cnt}名</td></tr>`;
  }).filter(Boolean).join('');

  // 職種別人数
  const JOB_TYPES = window.DataModule?.JOB_TYPES || {};
  const jobRows = Object.entries(JOB_TYPES).map(([k, v]) => {
    const cnt = employees.filter(e => e.jobType === k).length;
    if (cnt === 0) return '';
    return `<tr><td>${_escape(v.label)}</td><td class="text-right">${cnt}名</td></tr>`;
  }).filter(Boolean).join('');

  const breakdownHtml = `
    <div class="flex gap-4 mt-3" style="flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <h4 class="mb-1" style="font-size:14px;">グレード別人数</h4>
        <table class="table-sm"><tbody>${gradeRows || '<tr><td colspan="2" class="text-muted">データなし</td></tr>'}</tbody></table>
      </div>
      <div style="flex:1;min-width:200px;">
        <h4 class="mb-1" style="font-size:14px;">職種別人数</h4>
        <table class="table-sm"><tbody>${jobRows || '<tr><td colspan="2" class="text-muted">データなし</td></tr>'}</tbody></table>
      </div>
    </div>`;

  // 財務推移テーブル
  const recentHistory = history.slice(-5).reverse();
  let financeHtml = '<p class="text-muted mt-3">まだ決算が行われていません。ターンを進めてください。</p>';
  if (recentHistory.length > 0) {
    const rows = recentHistory.map(rec => {
      const p = rec.profitAfterBuffs ?? rec.profit ?? 0;
      const c = rec.totalCost       ?? rec.costs   ?? 0;
      const r = rec.revenue || 0;
      const rate = r > 0 ? (p / r * 100).toFixed(1) : '0.0';
      // スナップショットから社員数を取得
      const snap = (state.yearSnapshots || []).find(s => s.year === rec.year);
      const empSnap = snap ? snap.employees.length : (rec.year === state.currentYear ? state.employees.length : '-');
      return `<tr>
        <td>${_escape(String(rec.year))}年度</td>
        <td>${_formatMoney(r)}</td>
        <td>${_formatMoney(c)}</td>
        <td class="${p < 0 ? 'negative' : 'positive'}">${_formatMoney(p)}</td>
        <td class="${p < 0 ? 'negative' : ''}">${rate}%</td>
        <td>${empSnap === '-' ? '-' : empSnap + '名'}</td>
      </tr>`;
    }).join('');

    financeHtml = `
      <h3 class="mt-4 mb-2">財務推移（直近5年）</h3>
      <div class="table-container">
        <table>
          <thead><tr>
            <th>年度</th><th>売上</th><th>費用</th><th>利益</th><th>利益率</th><th>従業員数</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // SVGグラフ（売上バー＋利益折れ線）
  let chartHtml = '';
  if (history.length >= 2) {
    const chartData = history.slice(-8); // 最大8年分
    const W = 520, H = 200, PAD = { left: 60, right: 20, top: 20, bottom: 30 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;
    const n = chartData.length;
    const barW = Math.floor(cW / n * 0.55);

    const revenues = chartData.map(r => r.revenue || 0);
    const profits  = chartData.map(r => r.profitAfterBuffs ?? r.profit ?? 0);
    const maxVal   = Math.max(...revenues, 1);
    const minVal   = Math.min(...profits, 0);
    const range    = maxVal - minVal || 1;

    function toY(val) {
      return PAD.top + cH - ((val - minVal) / range) * cH;
    }
    function toX(i) {
      return PAD.left + (i + 0.5) * (cW / n);
    }

    // バー（売上）
    const bars = chartData.map((r, i) => {
      const rv = r.revenue || 0;
      const x  = PAD.left + i * (cW / n) + (cW / n - barW) / 2;
      const y0 = toY(0);
      const y1 = toY(rv);
      return `<rect x="${x}" y="${Math.min(y0,y1)}" width="${barW}" height="${Math.abs(y1-y0)}" fill="#3b82f6" opacity="0.75"/>`;
    }).join('');

    // 折れ線（利益）
    const linePoints = chartData.map((r, i) => {
      const pv = r.profitAfterBuffs ?? r.profit ?? 0;
      return `${toX(i)},${toY(pv)}`;
    }).join(' ');

    // ゼロ基準線
    const zeroY = toY(0);
    const zeroLine = `<line x1="${PAD.left}" y1="${zeroY}" x2="${W - PAD.right}" y2="${zeroY}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4"/>`;

    // X軸ラベル
    const xLabels = chartData.map((r, i) =>
      `<text x="${toX(i)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="#64748b">${r.year}</text>`
    ).join('');

    chartHtml = `
      <h3 class="mt-4 mb-2">財務グラフ（売上・利益）</h3>
      <div style="overflow-x:auto;">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
          ${zeroLine}${bars}
          <polyline points="${linePoints}" fill="none" stroke="#10b981" stroke-width="2"/>
          ${chartData.map((r, i) => {
            const pv = r.profitAfterBuffs ?? r.profit ?? 0;
            return `<circle cx="${toX(i)}" cy="${toY(pv)}" r="3" fill="${pv >= 0 ? '#10b981' : '#ef4444'}"/>`;
          }).join('')}
          ${xLabels}
          <text x="4" y="${PAD.top}" font-size="10" fill="#3b82f6">■ 売上</text>
          <text x="60" y="${PAD.top}" font-size="10" fill="#10b981">● 利益</text>
        </svg>
      </div>`;
  }

  // アラートセクション（75歳以上・低モチベ40以下・定員超過拠点）
  const nearRetirement = employees.filter(e => e.age >= 75);
  const lowMotivation  = employees.filter(e => (e.motivation || 0) <= 40);

  // 定員超過拠点を検出
  const locations = displayState.locations || state.locations || [];
  const orgUnits  = displayState.orgUnits  || [];
  const overcapacityLocations = locations.filter(loc => {
    const locEmpCount = employees.filter(emp => {
      const unit = orgUnits.find(u => u.id === emp.unitId);
      return unit && unit.locationId === loc.id;
    }).length;
    return locEmpCount > loc.capacity;
  }).map(loc => {
    const locEmpCount = employees.filter(emp => {
      const unit = orgUnits.find(u => u.id === emp.unitId);
      return unit && unit.locationId === loc.id;
    }).length;
    return { loc, count: locEmpCount, over: locEmpCount - loc.capacity };
  });

  function unitName(emp) {
    return (orgUnits || []).find(u => u.id === emp.unitId)?.name || '未配属';
  }

  let alertHtml = '<h3 class="mt-4 mb-2">アラート</h3>';
  let hasAlert = false;

  if (nearRetirement.length > 0) {
    hasAlert = true;
    const items = nearRetirement.map(e =>
      `<li>${_escape(e.name)}（${e.age}歳 / ${_escape(unitName(e))}）</li>`
    ).join('');
    alertHtml += `<div class="alert-section alert-danger">
      <strong>定年間近（75歳以上）${nearRetirement.length}名</strong>
      <ul>${items}</ul>
    </div>`;
  }

  if (lowMotivation.length > 0) {
    hasAlert = true;
    const items = lowMotivation.map(e =>
      `<li>${_escape(e.name)}（モチベ: ${e.motivation} / ${_escape(unitName(e))}）</li>`
    ).join('');
    alertHtml += `<div class="alert-section alert-warning">
      <strong>低モチベーション（40以下）${lowMotivation.length}名</strong>
      <ul>${items}</ul>
    </div>`;
  }

  if (overcapacityLocations.length > 0) {
    hasAlert = true;
    const items = overcapacityLocations.map(({ loc, count, over }) =>
      `<li>${_escape(loc.name)}：定員${loc.capacity}名 / 在籍${count}名（<strong>+${over}名超過</strong>）</li>`
    ).join('');
    alertHtml += `<div class="alert-section alert-warning">
      <strong>定員超過拠点（${overcapacityLocations.length}拠点）</strong>
      <ul>${items}</ul>
    </div>`;
  }

  if (!hasAlert) {
    alertHtml += '<p class="text-muted">現在アラートはありません。</p>';
  }

  container.innerHTML = yearSelectorHtml + kpiHtml + breakdownHtml + chartHtml + financeHtml + alertHtml;
}

/**
 * 【2】ダッシュボードの表示年度を切り替える
 * @param {string|number} year - 'current' または年度数値文字列
 * @param {GameState} state
 */
function switchDashboardYear(year, state) {
  if (year === 'current' || Number(year) === state.currentYear) {
    _viewingYear = null;
  } else {
    _viewingYear = Number(year);
  }
  renderDashboard(state);
}

/**
 * 組織図画面を描画する
 *
 * @param {GameState} state - ゲーム状態
 * @returns {void}
 */
function renderOrgChart(state) {
  const container = document.getElementById('orgchart-content');
  if (!container) return;

  const tree = window.OrgModule?.getOrgTree(state.orgUnits || []) || [];

  // 兼任チェック用マップ構築
  function buildDualPostMap(orgUnits) {
    const empSlotCount = {};
    for (const u of (orgUnits || [])) {
      for (const slot of (u.positionSlots || [])) {
        if (slot && typeof slot === 'object' && slot.employeeId) {
          empSlotCount[slot.employeeId] = (empSlotCount[slot.employeeId] || 0) + 1;
        }
      }
    }
    return empSlotCount;
  }
  const dualPostMap = buildDualPostMap(state.orgUnits);

  // スロット表示
  // ルール: slot[0]未割当 → "⚠ 管理者未設定"、slot[1]未割当 → 非表示、割当済み → "役職名:氏名"
  function getSlotLabels(node) {
    const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
    const utDef = node.unitTypeId ? UNIT_TYPE_DEFS.find(d => d.id === node.unitTypeId) : null;
    const slots = node.positionSlots || [];
    const items = [];
    let primaryUnassigned = false;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      // このスロットに対応する役職名（UNIT_TYPE_DEFSから取得）
      const posName = i === 0 ? utDef?.pos1Name : utDef?.pos2Name;
      if (!posName) continue; // 定義なしスロットはスキップ

      const empId = slot?.employeeId;
      if (!empId) {
        if (i === 0) primaryUnassigned = true;
        // slot[1]以降は未割当なら何も表示しない
        continue;
      }

      const emp = (state.employees || []).find(e => e.id === Number(empId));
      if (!emp) continue; // 社員が見つからない場合もスキップ
      const isDual = (dualPostMap[Number(empId)] || 0) >= 2;
      const dualMark = isDual ? '<span style="color:#0891b2;font-weight:700;">(兼)</span>' : '';
      items.push(`<span class="badge badge-position">${_escape(posName)}: ${_escape(emp.name)}${dualMark}</span>`);
    }

    // slot[0]が未割当なら先頭に警告を表示
    if (primaryUnassigned) {
      const warning = '<span style="color:#dc2626;font-weight:600;font-size:11px;">⚠ 管理者未設定</span>';
      return items.length > 0 ? warning + ' ' + items.join(' ') : warning;
    }
    // 全スロットが定義なし or posName なし → 警告
    if (items.length === 0 && utDef?.pos1Name) {
      return '<span style="color:#dc2626;font-weight:600;font-size:11px;">⚠ 管理者未設定</span>';
    }
    return items.join(' ');
  }

  // 部門所属メンバーパネルのHTML生成
  function getMemberPanelHtml(node) {
    if (node.isBoard) {
      const board     = state.board || [];
      const employees = state.employees || [];
      const EXEC_ATTRIBUTES = window.DataModule?.EXECUTIVE_ATTRIBUTES || {};
      const EXEC_ROLES      = window.DataModule?.EXECUTIVE_ROLES      || {};
      if (board.length === 0) return '<div class="org-member-panel">取締役は任命されていません。</div>';
      const items = board.map(member => {
        const emp       = employees.find(e => e.id === member.employeeId);
        const attrLabel = EXEC_ATTRIBUTES[member.attribute]?.label || member.attribute;
        const roleLabel = member.role ? (EXEC_ROLES[member.role]?.label || member.role) : '';
        return `<div class="org-emp-row">
          <span class="org-emp-name">${_escape(emp?.name || '不明')}</span>
          <span class="badge badge-warning">${_escape(attrLabel)}</span>
          ${roleLabel ? `<span class="badge badge-info">${_escape(roleLabel)}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="org-member-panel">${items}</div>`;
    }

    // 通常部門：所属社員をグレード高い順に表示
    const GRADE_ORDER  = window.DataModule?.GRADE_ORDER || [];
    const JOB_TYPES    = window.DataModule?.JOB_TYPES || {};
    const unitId       = node.id;
    const positions    = state.positions || [];
    const orgUnitsAll  = state.orgUnits || [];

    // 自部門の直接所属社員
    const directEmployees = (state.employees || [])
      .filter(e => e.unitId === unitId)
      .sort((a, b) => {
        const ai = GRADE_ORDER.indexOf(a.grade);
        const bi = GRADE_ORDER.indexOf(b.grade);
        return (bi === -1 ? -999 : bi) - (ai === -1 ? -999 : ai);
      });

    // 役職任命候補: 自部門 + 全上位部門の社員（兼任対応）
    const ancestorUnitIds = [];
    let cur = orgUnitsAll.find(u => u.id === unitId);
    const seen = new Set([unitId]);
    while (cur && cur.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      ancestorUnitIds.push(cur.parentId);
      cur = orgUnitsAll.find(u => u.id === cur.parentId);
    }
    const ancestorEmployees = ancestorUnitIds.length > 0
      ? (state.employees || []).filter(e => ancestorUnitIds.includes(e.unitId))
          .sort((a, b) => {
            const ai = GRADE_ORDER.indexOf(a.grade);
            const bi = GRADE_ORDER.indexOf(b.grade);
            return (bi === -1 ? -999 : bi) - (ai === -1 ? -999 : ai);
          })
      : [];

    const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
    const unitTypeDef = node.unitTypeId
      ? UNIT_TYPE_DEFS.find(d => d.id === node.unitTypeId)
      : null;

    function makeEmpRow(emp, fromUnitId, isAncestor) {
      const jobLabel  = JOB_TYPES[emp.jobType]?.label || emp.jobType;
      const empPositions = (emp.positionIds || [])
        .map(pid => positions.find(p => p.id === pid)?.name)
        .filter(Boolean)
        .join('・');
      const motivColor = emp.motivation <= 30 ? 'color:#dc2626;'
                       : emp.motivation <= 50 ? 'color:#d97706;' : '';
      const isSelected = _selectedEmpIds.has(emp.id);

      // 役職任命ボタン
      const unitSlots = node.positionSlots || [];
      const slotBtns = unitTypeDef ? unitSlots.map((slot, idx) => {
        const posName = idx === 0 ? unitTypeDef.pos1Name : unitTypeDef.pos2Name;
        if (!posName) return '';
        const isAssigned = (slot?.employeeId === emp.id);
        return `<button class="btn btn-sm ${isAssigned ? 'btn-warning' : 'btn-outline'}"
          data-assign-slot="${_escape(node.id)}:${idx}:${emp.id}"
          title="${isAssigned ? '任命解除' : _escape(posName) + 'に任命'}"
          style="font-size:10px;padding:2px 6px;">${isAssigned ? '★' + _escape(posName) : _escape(posName)}</button>`;
      }).filter(Boolean).join('') : '';

      // 上位部門社員はドラッグ・詳細・異動は自部門行と同様
      const ancestorBadge = isAncestor
        ? `<span style="font-size:9px;color:#7c3aed;background:#ede9fe;padding:1px 4px;border-radius:3px;">
            ${_escape(orgUnitsAll.find(u => u.id === fromUnitId)?.name || '上位')}
           </span>`
        : '';

      // 昇格・降格ボタン（自部門所属社員のみ）
      const gradeIdx  = GRADE_ORDER.indexOf(emp.grade);
      const nextGrade = gradeIdx >= 0 && gradeIdx < GRADE_ORDER.length - 1 ? GRADE_ORDER[gradeIdx + 1] : null;
      const prevGrade = gradeIdx > 0 ? GRADE_ORDER[gradeIdx - 1] : null;
      const promoteBtn = (!isAncestor && nextGrade)
        ? `<button class="btn btn-sm btn-success" data-emp-promote="${emp.id}:${nextGrade}"
             style="font-size:10px;padding:2px 6px;" title="${_escape(emp.grade)}→${_escape(nextGrade)}に昇格">昇格${_escape(nextGrade)}</button>`
        : '';
      const demoteBtn = (!isAncestor && prevGrade)
        ? `<button class="btn btn-sm btn-warning" data-emp-demote="${emp.id}"
             style="font-size:10px;padding:2px 6px;" title="${_escape(emp.grade)}→${_escape(prevGrade)}に降格">降格${_escape(prevGrade)}</button>`
        : '';

      return `<div class="org-emp-row${isSelected ? ' emp-row-selected' : ''}" draggable="true"
          data-emp-id="${emp.id}" data-emp-unit="${_escape(fromUnitId)}">
        <input type="checkbox" class="org-emp-check" data-emp-check="${emp.id}"
          ${isSelected ? 'checked' : ''} style="margin-right:2px;cursor:pointer;">
        <span class="org-emp-name">${_escape(emp.name)}</span>
        ${ancestorBadge}
        <span class="badge badge-grade" style="font-size:10px;">${_escape(emp.grade)}</span>
        <span class="org-emp-meta">${_escape(jobLabel)}</span>
        ${empPositions ? `<span class="badge badge-secondary org-emp-meta" style="font-size:10px;">${_escape(empPositions)}</span>` : ''}
        <span class="org-emp-meta" style="${motivColor}">モチベ:${emp.motivation}</span>
        <div class="org-emp-row-actions">
          ${slotBtns}
          <button class="btn btn-sm btn-info" data-emp-detail="${emp.id}" style="font-size:10px;padding:2px 6px;">詳細</button>
          ${isAncestor ? '' : `<button class="btn btn-sm btn-secondary" data-emp-transfer="${emp.id}" style="font-size:10px;padding:2px 6px;">異動</button>`}
          ${promoteBtn}
          ${demoteBtn}
        </div>
      </div>`;
    }

    if (directEmployees.length === 0 && ancestorEmployees.length === 0) {
      return '<div class="org-member-panel text-muted">所属社員はいません。</div>';
    }

    const directRows = directEmployees.map(e => makeEmpRow(e, unitId, false)).join('');
    const ancestorRows = ancestorEmployees.length > 0
      ? `<div style="border-top:1px dashed #c4b5fd;margin-top:3px;padding-top:3px;">
           <div style="font-size:10px;color:#7c3aed;padding:1px 4px;margin-bottom:2px;">▲ 上位部門（役職任命のみ）</div>
           ${ancestorEmployees.map(e => makeEmpRow(e, e.unitId, true)).join('')}
         </div>`
      : '';

    return `<div class="org-member-panel">${directRows}${ancestorRows}</div>`;
  }

  function renderNode(node) {
    const locationName = (() => {
      const loc = (state.locations || []).find(l => l.id === node.locationId);
      return loc ? _escape(loc.name) : null;
    })();

    let slots;
    if (node.isBoard) {
      // 取締役室はCEOを表示
      const ceoMember = (state.board || []).find(b => b.role === 'CEO');
      const ceoEmp    = ceoMember ? (state.employees || []).find(e => e.id === ceoMember.employeeId) : null;
      const ceoName   = ceoEmp ? _escape(ceoEmp.name) : '未任命';
      const ceoStyle  = ceoEmp ? '' : 'color:#dc2626;font-weight:600;';
      slots = `<span style="font-size:12px;${ceoStyle}">CEO: ${ceoName}</span>`;
    } else {
      slots = getSlotLabels(node);
    }

    const costBadge = node.costType === 'cogs'
      ? '<span class="badge badge-info">原価</span>'
      : '<span class="badge badge-success">販管</span>';

    const levelLabel = (() => {
      if (node.isBoard) return '取締役室';
      // unitTypeIdがあればそのname、なければgetLevelLabel
      const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
      const typeDef = node.unitTypeId
        ? UNIT_TYPE_DEFS.find(d => d.id === node.unitTypeId)
        : null;
      if (typeDef) return typeDef.name;
      return window.OrgModule?.getLevelLabel?.(node.level) || `Lv.${node.level}`;
    })();

    const hasChildren = (node.children || []).length > 0;

    // 三角アイコン（折りたたみ）
    const isCollapsed = _collapsedUnitIds.has(node.id);
    const toggleBtn = hasChildren
      ? `<button class="org-toggle-btn" draggable="false" data-toggle-unit="${_escape(node.id)}" title="${isCollapsed ? '展開' : '折りたたむ'}">${isCollapsed ? '▶' : '▼'}</button>`
      : `<span style="width:18px;display:inline-block;"></span>`;

    // 編集ボタン
    const editBtn = `<button class="org-edit-btn" draggable="false" data-edit-unit="${_escape(node.id)}">編集</button>`;

    // 採用ボタン（取締役室以外）
    const hireBtn = node.isBoard
      ? ''
      : `<button class="org-hire-btn" draggable="false" data-hire-unit="${_escape(node.id)}" title="この部門に採用">＋採用</button>`;

    const isExpanded = _expandedMemberUnitId === node.id;
    const memberPanel = isExpanded ? getMemberPanelHtml(node) : '';

    const locationHtml = locationName
      ? `<span class="org-node-location text-muted" style="font-size:11px;">${locationName}</span>`
      : '';

    // 並び替えボタン（取締役室以外）
    const shiftBtns = node.isBoard ? '' : `
      <button class="org-shift-btn" draggable="false" data-shift-unit="${_escape(node.id)}:top"    title="同階層内で先頭へ">⇈</button>
      <button class="org-shift-btn" draggable="false" data-shift-unit="${_escape(node.id)}:up"     title="同階層内で一つ上へ">↑</button>
      <button class="org-shift-btn" draggable="false" data-shift-unit="${_escape(node.id)}:down"   title="同階層内で一つ下へ">↓</button>
      <button class="org-shift-btn" draggable="false" data-shift-unit="${_escape(node.id)}:bottom" title="同階層内で末尾へ">⇊</button>`;

    // +部門ボタン
    const addChildBtn = `<button class="org-add-child-btn" draggable="false" data-add-child-unit="${_escape(node.id)}" title="この部門の配下に部門を追加">＋部門</button>`;

    // CSSレベル: unitTypeId の levelNum を優先（ツリー深度でなく部門種別基準で色を決定）
    const cssLevel = (() => {
      if (node.isBoard) return 0;
      const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
      const td = node.unitTypeId ? UNIT_TYPE_DEFS.find(d => d.id === node.unitTypeId) : null;
      return td ? td.levelNum : node.level;
    })();

    const childrenList = node.children || [];
    const childrenHtml = childrenList.length > 0
      ? `<div class="org-children" data-children-of="${_escape(node.id)}"${isCollapsed ? ' style="display:none"' : ''}>
           ${childrenList.map(c => renderNode(c)).join('')}
         </div>`
      : `<div class="org-children org-children-empty" data-children-of="${_escape(node.id)}"></div>`;

    return `
      <div class="org-node">
        <div class="org-node-header level-${cssLevel}" data-unit-id="${_escape(node.id)}" ${node.isBoard ? '' : 'draggable="true"'}>
          ${toggleBtn}
          <div class="org-node-header-body" data-member-unit="${_escape(node.id)}">
            <span class="org-node-level-badge">${_escape(levelLabel)}</span>
            <span class="org-node-name">${_escape(node.name)}</span>
            <span class="org-node-count">${node.employeeCount}名</span>
            ${costBadge}
            ${locationHtml}
            <span class="org-node-slots">${slots}</span>
          </div>
          ${editBtn}
          ${hireBtn}
          ${addChildBtn}
          ${shiftBtns}
        </div>
        ${memberPanel}
        ${childrenHtml}
      </div>`;
  }

  const toolbarHtml = `
    <div class="org-edit-toolbar">
      <button class="btn btn-sm btn-primary" data-action="add-unit">
        ＋ 部門を追加
      </button>
    </div>`;

  const treeHtml = tree.length > 0
    ? tree.map(n => renderNode(n)).join('')
    : '<p class="text-muted">組織が設定されていません。</p>';

  container.innerHTML = toolbarHtml + `<div class="org-tree">${treeHtml}</div>`;

  // ツールバー「部門追加」ボタン
  container.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.dataset.action === 'add-unit') {
        _populateAddUnitModal(state);
        window.GameCallbacks?.openModal?.('modal-add-unit');
      }
    });
  });

  // 三角アイコン（折りたたみ）— _collapsedUnitIds で状態保持
  container.querySelectorAll('[data-toggle-unit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const unitId = btn.dataset.toggleUnit;
      if (_collapsedUnitIds.has(unitId)) {
        _collapsedUnitIds.delete(unitId);
      } else {
        _collapsedUnitIds.add(unitId);
      }
      renderOrgChart(state);
    });
  });

  // 編集ボタン
  container.querySelectorAll('[data-edit-unit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const unitId = btn.dataset.editUnit;
      if (unitId) window.GameCallbacks?.openEditUnitModal?.(unitId);
    });
  });

  // ヘッダー本体クリック → 社員一覧トグル
  container.querySelectorAll('[data-member-unit]').forEach(body => {
    body.addEventListener('click', e => {
      e.stopPropagation();
      const unitId = body.dataset.memberUnit;
      if (_expandedMemberUnitId === unitId) {
        _expandedMemberUnitId = null;
      } else {
        _expandedMemberUnitId = unitId;
      }
      renderOrgChart(state);
    });
  });

  // 【3】ドラッグアンドドロップイベント
  // ヘッダー全体をドラッグ可能とする（_unitDragAllowed フラグ機構を廃止）
  container.querySelectorAll('[data-unit-id][draggable="true"]').forEach(header => {
    header.addEventListener('dragstart', e => {
      const unitId = header.dataset.unitId;
      const unit = (state.orgUnits || []).find(u => u.id === unitId);
      if (!unit || unit.isBoard) { e.preventDefault(); return; }
      _dragUnitId = unitId;
      header.classList.add('dragging');
      container.classList.add('org-dragging-unit');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', unitId);
    });
    header.addEventListener('dragend', () => {
      _dragUnitId = null;
      header.classList.remove('dragging');
      container.classList.remove('org-dragging-unit');
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  });

  // +部門ボタン（配下に子部門追加）
  container.querySelectorAll('[data-add-child-unit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const parentId = btn.dataset.addChildUnit;
      if (parentId) window.GameCallbacks?.openAddUnitModal?.(parentId);
    });
  });

  // 並び替えボタン（⇈ ↑ ↓ ⇊）
  container.querySelectorAll('[data-shift-unit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const parts = btn.dataset.shiftUnit.split(':');
      const unitId = parts[0];
      const direction = parts[1];
      if (unitId && direction) window.GameCallbacks?.handleShiftUnit?.(unitId, direction);
    });
  });

  // 社員カードDnD: 開始（重複登録防止）
  if (container._empDragStartHandler) container.removeEventListener('dragstart', container._empDragStartHandler, true);
  container._empDragStartHandler = e => {
    const card = e.target.closest('[data-emp-id]');
    if (!card) return;
    const empId = parseInt(card.dataset.empId, 10);
    // チェック済みの社員が複数いる場合は複数選択DnD
    if (_selectedEmpIds.size > 0 && _selectedEmpIds.has(empId)) {
      _dragEmpIds = [..._selectedEmpIds];
    } else {
      _dragEmpIds = [empId];
    }
    _dragEmpId = empId;
    _dragEmpFromUnitId = card.dataset.empUnit || null;
    _dragUnitId = null;
    card.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'emp:' + empId);
  };
  container.addEventListener('dragstart', container._empDragStartHandler, true);

  // 社員カードDnD: 終了（重複登録防止）
  if (container._empDragEndHandler) container.removeEventListener('dragend', container._empDragEndHandler, true);
  container._empDragEndHandler = e => {
    const card = e.target.closest('[data-emp-id]');
    if (card) card.style.opacity = '';
    _dragEmpId = null;
    _dragEmpIds = [];
    _dragEmpFromUnitId = null;
  };
  container.addEventListener('dragend', container._empDragEndHandler, true);

  // DnD オートスクロール（画面上端・下端付近で自動スクロール）
  if (!container._dndScrollHandler) {
    container._dndScrollHandler = e => {
      const SCROLL_ZONE = 80;  // 端から80px以内でスクロール開始
      const SCROLL_SPEED = 12;
      const y = e.clientY;
      const viewH = window.innerHeight;
      if (y < SCROLL_ZONE) {
        window.scrollBy(0, -SCROLL_SPEED * (1 - y / SCROLL_ZONE));
      } else if (y > viewH - SCROLL_ZONE) {
        window.scrollBy(0, SCROLL_SPEED * (1 - (viewH - y) / SCROLL_ZONE));
      }
    };
    document.addEventListener('dragover', container._dndScrollHandler);
  }

  // ドラッグオーバー（ドロップ先ハイライト）
  container.querySelectorAll('[data-unit-id]').forEach(header => {
    header.addEventListener('dragover', e => {
      // 社員カードのドラッグ中は部門ヘッダーをドロップターゲットにする
      if (_dragEmpId || _dragEmpIds.length > 0) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        header.classList.add('drag-over');
        return;
      }
      if (!_dragUnitId) return;
      e.preventDefault();
      const targetId = header.dataset.unitId;
      if (!targetId || targetId === _dragUnitId) return;
      const targetUnit = (state.orgUnits || []).find(u => u.id === targetId);
      if (!targetUnit) return;
      // isBoard はドロップ先OK（取締役室直下に部門を移動可能）
      // 子孫チェック：ドラッグ元がドロップ先の祖先かどうか
      if (_isAncestor(_dragUnitId, targetId, state.orgUnits || [])) return;
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      header.classList.add('drag-over');
    });

    header.addEventListener('dragleave', () => {
      header.classList.remove('drag-over');
    });

    header.addEventListener('drop', e => {
      e.preventDefault();
      header.classList.remove('drag-over');
      // 社員を異動（複数選択対応）
      if (_dragEmpId || _dragEmpIds.length > 0) {
        const targetUnitId = header.dataset.unitId;
        const ids = _dragEmpIds.length > 0 ? [..._dragEmpIds] : [_dragEmpId];
        _dragEmpId = null;
        _dragEmpIds = [];
        _dragEmpFromUnitId = null;
        if (targetUnitId) {
          ids.forEach(id => window.GameCallbacks?.handleTransferToUnit?.(id, targetUnitId));
          // 選択状態をクリア
          _selectedEmpIds.clear();
        }
        return;
      }
      if (!_dragUnitId) return;
      const targetId = header.dataset.unitId;
      if (!targetId || targetId === _dragUnitId) return;
      const targetUnit = (state.orgUnits || []).find(u => u.id === targetId);
      if (!targetUnit) return;
      // isBoard はドロップ先OK
      // 子孫チェック
      if (_isAncestor(_dragUnitId, targetId, state.orgUnits || [])) return;
      const dragId = _dragUnitId;
      _dragUnitId = null;
      window.GameCallbacks?.handleMoveUnit?.(dragId, targetId);
    });
  });

  // 採用ボタン（部門指定採用）
  container.querySelectorAll('[data-hire-unit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const unitId = btn.dataset.hireUnit;
      // openModal を先に呼ぶ（内部で hire-unit が再描画されるため、後からunitIdをセット）
      window.GameCallbacks?.openModal?.('modal-hire');
      if (unitId) {
        const hireUnitEl = document.getElementById('hire-unit');
        if (hireUnitEl) hireUnitEl.value = unitId;
      }
      document.querySelectorAll('.hire-grade-count').forEach(inp => { inp.value = '0'; });
    });
  });

  // 社員カード: 詳細・異動・チェック・スロット任命ボタン（イベントデリゲーション・重複登録防止）
  if (container._empClickHandler) container.removeEventListener('click', container._empClickHandler);
  container._empClickHandler = e => {
    // チェックボックス
    const chk = e.target.closest('[data-emp-check]');
    if (chk) {
      e.stopPropagation();
      const empId = parseInt(chk.dataset.empCheck, 10);
      if (_selectedEmpIds.has(empId)) {
        _selectedEmpIds.delete(empId);
        chk.checked = false;
      } else {
        _selectedEmpIds.add(empId);
        chk.checked = true;
      }
      // 行の選択スタイルを更新
      const row = chk.closest('[data-emp-id]');
      if (row) row.classList.toggle('emp-row-selected', _selectedEmpIds.has(empId));
      return;
    }
    const detailBtn = e.target.closest('[data-emp-detail]');
    if (detailBtn) {
      e.stopPropagation();
      window.GameCallbacks?.showEmployeeDetail?.(parseInt(detailBtn.dataset.empDetail, 10));
      return;
    }
    const transferBtn = e.target.closest('[data-emp-transfer]');
    if (transferBtn) {
      e.stopPropagation();
      window.GameCallbacks?.handleTransfer?.(parseInt(transferBtn.dataset.empTransfer, 10));
      return;
    }
    const slotBtn = e.target.closest('[data-assign-slot]');
    if (slotBtn) {
      e.stopPropagation();
      const [unitId, slotIdx, empId] = slotBtn.dataset.assignSlot.split(':');
      window.GameCallbacks?.handleOrgSlotAssign?.(unitId, parseInt(slotIdx, 10), parseInt(empId, 10));
      return;
    }
    const promoteBtn = e.target.closest('[data-emp-promote]');
    if (promoteBtn) {
      e.stopPropagation();
      const [empId, newGrade] = promoteBtn.dataset.empPromote.split(':');
      window.GameCallbacks?.handlePromote?.(parseInt(empId, 10), newGrade);
      return;
    }
    const demoteBtn = e.target.closest('[data-emp-demote]');
    if (demoteBtn) {
      e.stopPropagation();
      const empId = parseInt(demoteBtn.dataset.empDemote, 10);
      const gs = window.gameState;
      const emp = gs?.employees?.find(e => e.id === empId);
      if (emp) {
        const GRADE_ORDER = window.DataModule?.GRADE_ORDER || [];
        const idx = GRADE_ORDER.indexOf(emp.grade);
        const prevGrade = idx > 0 ? GRADE_ORDER[idx - 1] : null;
        if (prevGrade && confirm(`${emp.name} を ${emp.grade} → ${prevGrade} に降格しますか？`)) {
          window.GameCallbacks?.handleDemote?.(empId);
        }
      }
      return;
    }
  };
  container.addEventListener('click', container._empClickHandler);
}

/**
 * 【3】unitId が targetId の祖先かどうか（循環防止チェック）
 * @param {string} unitId   - ドラッグ元のユニットID
 * @param {string} targetId - ドロップ先のユニットID
 * @param {Array}  orgUnits
 * @returns {boolean}
 */
function _isAncestor(unitId, targetId, orgUnits) {
  // targetId の先祖を辿り unitId が含まれていれば true
  let current = orgUnits.find(u => u.id === targetId);
  const visited = new Set();
  while (current && current.parentId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (current.parentId === unitId) return true;
    current = orgUnits.find(u => u.id === current.parentId);
  }
  return false;
}

/**
 * orgUnits を組織図と同じ表示順（DFS）に並び替えて返す
 * @param {Array} orgUnits
 * @returns {Array<{unit: Object, depth: number}>}
 */
function _getOrgUnitsInChartOrder(orgUnits) {
  const byParent = {};
  orgUnits.forEach((u, idx) => {
    const key = u.parentId == null ? '__root__' : u.parentId;
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push({ unit: u, idx });
  });
  const result = [];
  function walk(parentId, depth) {
    const key = parentId == null ? '__root__' : parentId;
    (byParent[key] || []).sort((a, b) => a.idx - b.idx).forEach(({ unit }) => {
      result.push({ unit, depth });
      walk(unit.id, depth + 1);
    });
  }
  walk(null, 0);
  return result;
}

/**
 * 部門追加モーダルの選択肢を更新する
 * @param {GameState} state
 */
function _populateAddUnitModal(state) {
  const orgUnits  = state.orgUnits  || [];
  const locations = state.locations || [];

  // 親部門選択肢（取締役室をデフォルト選択）
  const boardUnit = orgUnits.find(u => u.isBoard);
  const parentSelect = document.getElementById('add-unit-parent');
  if (parentSelect) {
    const chartOrder = _getOrgUnitsInChartOrder(orgUnits);
    parentSelect.innerHTML = '<option value="">（なし：ルート部門）</option>' +
      chartOrder.map(({ unit: u, depth }) => {
        const selected = (boardUnit && u.id === boardUnit.id) ? ' selected' : '';
        const typeDef = (window.OrgModule?.UNIT_TYPE_DEFS || []).find(d => d.id === u.unitTypeId);
        const levelLabel = typeDef ? typeDef.name : (u.isBoard ? '取締役室' : `Lv.${u.level}`);
        const indent = '\u3000'.repeat(depth);
        return `<option value="${_escape(u.id)}"${selected}>${indent}[${_escape(levelLabel)}] ${_escape(u.name)}</option>`;
      }).join('');
  }

  // 親部門選択時に costType と locationId をデフォルト設定
  if (parentSelect && !parentSelect._addUnitParentListenerAttached) {
    parentSelect._addUnitParentListenerAttached = true;
    parentSelect.addEventListener('change', () => {
      const selectedParentId = parentSelect.value;
      if (!selectedParentId) return;
      const parentUnit = (state.orgUnits || []).find(u => u.id === selectedParentId);
      if (!parentUnit) return;
      // costType を親に合わせる
      const costEl = document.getElementById('add-unit-costtype');
      if (costEl && parentUnit.costType) costEl.value = parentUnit.costType;
      // locationId を親に合わせる
      const locEl = document.getElementById('add-unit-location');
      if (locEl && parentUnit.locationId) locEl.value = parentUnit.locationId;
    });
  }

  // 部門種別セレクト: デフォルト選択をリセット（ut_bu）
  const unittypeSelect = document.getElementById('add-unit-unittype');
  if (unittypeSelect) unittypeSelect.value = 'ut_ka';

  // 拠点選択肢を更新
  const locSelect = document.getElementById('add-unit-location');
  if (locSelect) {
    locSelect.innerHTML = '<option value="">（未設定）</option>' +
      locations.map(l => `<option value="${_escape(l.id)}">${_escape(l.name)}</option>`).join('');
  }
}

/**
 * 社員一覧画面を描画する
 *
 * @param {GameState} state - ゲーム状態
 * @returns {void}
 */
function renderEmployeeList(state) {
  const container = document.getElementById('employees-content');
  if (!container) return;

  const employees = state.employees || [];
  const orgUnits  = state.orgUnits  || [];
  const positions = state.positions || [];

  // フィルタ値取得
  const fJobType   = document.getElementById('filter-jobtype')?.value || '';
  const fGrade     = document.getElementById('filter-grade')?.value   || '';
  const fUnit      = document.getElementById('filter-unit')?.value    || '';
  const fPotential = document.getElementById('filter-potential')?.value || '';
  const fPosition  = document.getElementById('filter-position')?.value || '';
  const fKeyword   = _empFilterKeyword.trim().toLowerCase();

  // filter-unit の選択肢を更新
  const filterUnitEl = document.getElementById('filter-unit');
  if (filterUnitEl) {
    const current = filterUnitEl.value;
    filterUnitEl.innerHTML = '<option value="">全部門</option>' +
      orgUnits.map(u => `<option value="${_escape(u.id)}"${current === u.id ? ' selected' : ''}>${_escape(u.name)}</option>`).join('');
  }

  // filter-position の選択肢を更新
  const filterPositionEl = document.getElementById('filter-position');
  if (filterPositionEl) {
    const currentPos = filterPositionEl.value;
    filterPositionEl.innerHTML = '<option value="">全役職</option>' +
      '<option value="__none__">役職なし</option>' +
      (positions || []).sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999))
        .map(p => `<option value="${_escape(p.id)}"${currentPos === p.id ? ' selected' : ''}>${_escape(p.name)}</option>`)
        .join('');
    if (currentPos && filterPositionEl.value !== currentPos) filterPositionEl.value = currentPos;
  }

  // フィルタ適用
  let filtered = employees;
  if (fJobType)   filtered = filtered.filter(e => e.jobType   === fJobType);
  if (fGrade)     filtered = filtered.filter(e => e.grade     === fGrade);
  if (fUnit)      filtered = filtered.filter(e => e.unitId    === fUnit);
  if (fPotential) filtered = filtered.filter(e => e.potential === fPotential);
  if (fPosition === '__none__') {
    filtered = filtered.filter(e => !e.positionIds || e.positionIds.length === 0);
  } else if (fPosition) {
    filtered = filtered.filter(e => (e.positionIds || []).includes(fPosition));
  }
  if (fKeyword) {
    filtered = filtered.filter(e => {
      const unitName = orgUnits.find(u => u.id === e.unitId)?.name || '';
      return (e.name || '').toLowerCase().includes(fKeyword)
          || unitName.toLowerCase().includes(fKeyword);
    });
  }

  function getUnitName(emp) {
    return orgUnits.find(u => u.id === emp.unitId)?.name || '未配属';
  }

  function getPosLabels(emp) {
    if (!emp.positionIds || emp.positionIds.length === 0) return '-';
    return emp.positionIds
      .map(pid => positions.find(p => p.id === pid)?.name || pid)
      .join('、');
  }

  const GRADE_ORDER = window.DataModule?.GRADE_ORDER || [];

  // ソート処理
  const SORT_KEYS = {
    name:         (e) => e.name || '',
    age:          (e) => e.age || 0,
    jobType:      (e) => _jobTypeLabel(e.jobType),
    grade:        (e) => GRADE_ORDER.indexOf(e.grade),
    potential:    (e) => ['C','B','A','S'].indexOf(e.potential || 'C'),
    technical:    (e) => e.technical || 0,
    communication:(e) => e.communication || 0,
    leadership:   (e) => e.leadership || 0,
    experience:   (e) => e.experience || 0,
    motivation:   (e) => e.motivation || 0,
  };
  if (_sortColumn && SORT_KEYS[_sortColumn]) {
    const fn = SORT_KEYS[_sortColumn];
    filtered = [...filtered].sort((a, b) => {
      const va = fn(a); const vb = fn(b);
      if (va < vb) return _sortAsc ? -1 : 1;
      if (va > vb) return _sortAsc ? 1 : -1;
      return 0;
    });
  }

  function _thSort(label, key) {
    const isActive = _sortColumn === key;
    const indicator = isActive ? `<span class="sort-indicator">${_sortAsc ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th" data-sort-key="${key}">${label}${indicator}</th>`;
  }

  const hireBtn = `
    <div class="flex items-center gap-2 mb-3">
      <button class="btn btn-primary" onclick="window.GameCallbacks?.openModal?.('modal-hire')">
        ＋ 採用する
      </button>
      <span class="text-muted">${filtered.length}名表示 / 全${employees.length}名</span>
    </div>`;

  let tableHtml = '';
  if (filtered.length === 0) {
    tableHtml = '<p class="text-muted">条件に一致する社員はいません。</p>';
  } else {
    const rows = filtered.map(emp => {
      const isLowMotiv = (emp.motivation || 0) <= 40;
      const rowClass = isLowMotiv ? ' class="low-motivation"' : '';
      const unitNameStr = _escape(getUnitName(emp));
      const posLabels   = _escape(getPosLabels(emp));
      const jobLabel    = _escape(_jobTypeLabel(emp.jobType));

      // 年齢バッジ
      let ageBadge = '';
      if (emp.age >= 75) ageBadge = '<span class="badge badge-danger">定年間近</span>';
      else if (emp.age >= 60) ageBadge = '<span class="badge badge-warning">高齢</span>';

      // 兼任マーク（役職を複数持つ場合）
      const isDouble = emp.positionIds && emp.positionIds.length >= 2;
      const doubleMark = isDouble ? ' <span class="badge badge-info">兼任</span>' : '';

      const currentGradeIndex = GRADE_ORDER.indexOf(emp.grade);
      const nextGrade         = currentGradeIndex >= 0 && currentGradeIndex < GRADE_ORDER.length - 1
        ? GRADE_ORDER[currentGradeIndex + 1]
        : null;

      // 【4】昇格ボタン統一（「昇格G○」に統一、G10は非表示）
      const promoteBtn = (() => {
        if (!nextGrade) return '';  // G10は昇格ボタンなし
        return `<button class="btn btn-sm btn-success"
          onclick="window.GameCallbacks?.handlePromote?.(${emp.id}, '${nextGrade}')">昇格${_escape(nextGrade)}</button>`;
      })();

      // 【4】降格ボタン（G1は非表示）
      const currentGradeIdx2 = GRADE_ORDER.indexOf(emp.grade);
      const prevGrade = currentGradeIdx2 > 0 ? GRADE_ORDER[currentGradeIdx2 - 1] : null;
      const demoteBtn = prevGrade
        ? `<button class="btn btn-sm btn-warning"
            onclick="if(confirm('${_escape(emp.name)} を ${_escape(emp.grade)} → ${_escape(prevGrade)} に降格しますか？')) window.GameCallbacks?.handleDemote?.(${emp.id})">降格${_escape(prevGrade)}</button>`
        : '';

      return `<tr${rowClass}>
        <td>${_escape(emp.name)}${ageBadge}</td>
        <td>${emp.age}</td>
        <td><span class="badge badge-jobtype">${jobLabel}</span></td>
        <td><span class="badge badge-grade">${_escape(emp.grade)}</span></td>
        <td><span class="badge">${_escape(emp.potential || '-')}</span></td>
        <td>${_skillBarHtml(emp.technical || 0)}</td>
        <td>${_skillBarHtml(emp.communication || 0)}</td>
        <td>${_skillBarHtml(emp.leadership || 0)}</td>
        <td>${emp.experience !== undefined ? Math.floor(emp.experience) : 0}</td>
        <td>${_skillBarHtml(emp.motivation || 0, 'motivation')}</td>
        <td>${posLabels}${doubleMark}</td>
        <td>${unitNameStr}</td>
        <td>
          ${promoteBtn}
          ${demoteBtn}
          <button class="btn btn-sm btn-info"
            onclick="window.GameCallbacks?.handleTransfer?.(${emp.id})">異動</button>
          <button class="btn btn-sm btn-danger"
            onclick="if(confirm('${_escape(emp.name)} を退職させますか？')) window.GameCallbacks?.handleRetire?.(${emp.id})">退職</button>
          <button class="btn btn-sm btn-secondary"
            onclick="window.GameCallbacks?.showEmployeeDetail?.(${emp.id})">詳細</button>
        </td>
      </tr>`;
    }).join('');

    tableHtml = `
      <div class="table-container">
        <table class="employee-table" id="employee-sort-table">
          <thead><tr>
            ${_thSort('氏名','name')}
            ${_thSort('年齢','age')}
            ${_thSort('職種','jobType')}
            ${_thSort('グレード','grade')}
            ${_thSort('ポテンシャル','potential')}
            ${_thSort('スキル','technical')}
            ${_thSort('コミュニケーション','communication')}
            ${_thSort('リーダーシップ','leadership')}
            ${_thSort('経験値','experience')}
            ${_thSort('モチベーション','motivation')}
            <th>役職</th><th>所属部門</th><th>アクション</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  container.innerHTML = hireBtn + tableHtml;

  // ソートヘッダーのクリックイベント
  container.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (_sortColumn === key) {
        _sortAsc = !_sortAsc;
      } else {
        _sortColumn = key;
        _sortAsc = true;
      }
      renderEmployeeList(state);
    });
  });
}

/**
 * 人事アクション画面を描画する
 *
 * @param {GameState} state - ゲーム状態
 * @returns {void}
 */
function renderHRActions(state) {
  const container = document.getElementById('hr-actions-content');
  if (!container) return;

  const employees = state.employees || [];
  const orgUnits  = state.orgUnits  || [];

  function getUnitName(emp) {
    return orgUnits.find(u => u.id === emp.unitId)?.name || '未配属';
  }

  // ============================================================
  // タブ 1: 人事考課（G6以上昇格候補）
  // ============================================================

  const manualPromotionTargets = ['G6','G7','G8','G9','G10'];
  let reviewSections = '';
  for (const targetGrade of manualPromotionTargets) {
    const candidates = window.DataModule?.getPromotionCandidates(employees, targetGrade) || [];
    if (candidates.length === 0) continue;
    const cards = candidates.map(emp => {
      const score = Math.round(emp.totalScore || 0);
      const scoreBar = _skillBarHtml(Math.min(score, 100));
      return `
        <div class="candidate-card">
          <div class="candidate-name">${_escape(emp.name)}</div>
          <div class="candidate-info" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <span>${_escape(emp.grade)} → <strong>${_escape(targetGrade)}</strong></span>
            <span>年齢: ${emp.age}</span>
            <span>経験: ${Math.floor(emp.experience || 0)}年</span>
            <span>モチベ: ${emp.motivation || 0}</span>
            <span style="display:flex;align-items:center;gap:4px;">総合スコア: ${scoreBar}</span>
            <span class="text-muted">${_escape(getUnitName(emp))}</span>
          </div>
          <div style="font-size:11px;color:#64748b;margin:4px 0;">
            推薦理由: 技術${emp.technical || 0}／コミュ${emp.communication || 0}／リーダー${emp.leadership || 0}
          </div>
          <button class="btn btn-sm btn-success"
            onclick="window.GameCallbacks?.handlePromote?.(${emp.id}, '${targetGrade}')">
            ${_escape(targetGrade)}へ昇格
          </button>
        </div>`;
    }).join('');
    reviewSections += `
      <div class="hr-panel">
        <h3 class="hr-panel-title">${_escape(targetGrade)} 昇格候補
          <span class="badge badge-success">${candidates.length}名</span>
        </h3>
        ${cards}
      </div>`;
  }
  if (!reviewSections) {
    reviewSections = '<p class="text-muted">手動昇格候補者はいません。</p>';
  }

  const tabReviewHtml = `<div class="hr-panels">${reviewSections}</div>`;

  // ============================================================
  // タブ 2: 人事異動
  // ============================================================

  // --- 異動推奨（モチベ40以下） ---
  const transferCandidates = employees.filter(e => (e.motivation || 0) <= 40);
  const transferContent = transferCandidates.length === 0
    ? '<p class="text-muted">異動推奨者はいません。</p>'
    : transferCandidates.map(emp => `
        <div class="candidate-card">
          <div class="candidate-name">${_escape(emp.name)}</div>
          <div class="candidate-info">
            モチベ: <strong class="negative">${emp.motivation}</strong>
            ／ ${_escape(emp.grade)} ／ ${_escape(getUnitName(emp))}
          </div>
          <button class="btn btn-sm btn-info"
            onclick="window.GameCallbacks?.handleTransfer?.(${emp.id})">異動する</button>
        </div>`).join('');

  // --- 退職勧奨（75歳以上） ---
  const retireCandidates = employees.filter(e => e.age >= 75);
  const retireContent = retireCandidates.length === 0
    ? '<p class="text-muted">退職勧奨対象者はいません。</p>'
    : retireCandidates.map(emp => `
        <div class="candidate-card">
          <div class="candidate-name">${_escape(emp.name)}</div>
          <div class="candidate-info">
            ${emp.age}歳 ／ ${_escape(emp.grade)} ／ ${_escape(getUnitName(emp))}
          </div>
          <button class="btn btn-sm btn-danger"
            onclick="if(confirm('${_escape(emp.name)} を退職させますか？')) window.GameCallbacks?.handleRetire?.(${emp.id})">
            退職
          </button>
        </div>`).join('');

  const tabTransferHtml = `
    <div class="hr-panels">
      <div class="hr-panel">
        <h3 class="hr-panel-title">異動推奨
          <span class="badge badge-info">${transferCandidates.length}名</span>
        </h3>
        <p class="hr-panel-desc">モチベーション40以下の社員（環境変化で改善を狙う）</p>
        ${transferContent}
      </div>
      <div class="hr-panel">
        <h3 class="hr-panel-title">退職勧奨
          <span class="badge badge-danger">${retireCandidates.length}名</span>
        </h3>
        <p class="hr-panel-desc">75歳以上（次ターンで強制退職）</p>
        ${retireContent}
      </div>
    </div>`;

  // ============================================================
  // タブ 2: 研修計画
  // ============================================================
  const currentTrainings = state.currentTrainings || [];
  const trainingSettings = state.trainingSettings || [];

  const TRAINING_LEVEL_DEFS = {
    1: { label: 'Lv.1', costPerPerson: 1,  effectRange: '1〜3pt' },
    2: { label: 'Lv.2', costPerPerson: 3,  effectRange: '2〜4pt' },
    3: { label: 'Lv.3', costPerPerson: 8,  effectRange: '3〜6pt' },
    4: { label: 'Lv.4', costPerPerson: 20, effectRange: '5〜10pt' },
    5: { label: 'Lv.5', costPerPerson: 50, effectRange: '8〜15pt' },
  };

  const EFFECT_LABELS = {
    all: '全ステータスUP', motivation: 'モチベーションUP',
    technical: 'スキルUP', communication: 'コミュニケーションUP', leadership: 'リーダーシップUP',
  };

  const TARGET_GROUP_LABELS = {
    all: '全社員', executive: '経営幹部(G6+)', g5: '幹部候補(G5)',
    senior50: 'シニア社員(50歳+)', middle: 'ミドル(30-49歳)', junior: 'ジュニア(20-29歳)',
    position: '役職者', no_position: '非役職者',
    sales: '営業職', engineer: '技術職', strategy: '戦略職', specialist: '専門職', admin: '事務職',
  };

  const trainingRows = currentTrainings.map(t => {
    const lvDef = TRAINING_LEVEL_DEFS[t.level] || TRAINING_LEVEL_DEFS[1];
    const tgLabel = TARGET_GROUP_LABELS[t.targetGroup] || t.targetGroup;
    const statusBadge = t.status === 'executed'
      ? '<span class="badge badge-success">実行済</span>'
      : '<span class="badge badge-secondary">未実行</span>';
    const actionBtns = t.status === 'executed' ? '' : `
      <button class="btn btn-sm btn-primary"
        onclick="window.GameCallbacks?.handleExecuteTraining?.('${_escape(t.id)}')">実行</button>
      <button class="btn btn-sm btn-danger"
        onclick="window.GameCallbacks?.handleDeleteTraining?.('${_escape(t.id)}')">削除</button>`;
    return `<tr>
      <td>${_escape(t.trainingName)}</td>
      <td>${_escape(String(t.level))}</td>
      <td>${_escape(EFFECT_LABELS[t.effect] || t.effect)} ${_escape(lvDef.effectRange)}</td>
      <td class="text-right">${lvDef.costPerPerson}万円/人</td>
      <td>${_escape(tgLabel)}</td>
      <td>${t.affectedCount || '-'}名</td>
      <td class="text-right">${t.totalCost ? t.totalCost + '万円' : '-'}</td>
      <td>${statusBadge}</td>
      <td>${actionBtns}</td>
    </tr>`;
  }).join('');

  const typeOptions = trainingSettings.map(ts =>
    `<option value="${_escape(ts.id)}">${_escape(ts.name)}</option>`
  ).join('');
  const targetOptions = Object.entries(TARGET_GROUP_LABELS).map(([k, v]) =>
    `<option value="${k}">${_escape(v)}</option>`
  ).join('');
  const levelOptions = Object.entries(TRAINING_LEVEL_DEFS).map(([k, v]) =>
    `<option value="${k}">${v.label}（${v.effectRange} / ${v.costPerPerson}万円/人）</option>`
  ).join('');

  const tabTrainingHtml = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
      <h4 style="font-size:14px;margin-bottom:10px;">研修を追加</h4>
      <p class="text-muted" style="font-size:12px;margin-bottom:10px;">研修費はターン終了時に確定します。</p>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;">
        <label style="min-width:180px;">研修メニュー
          <select id="plan-training-type">${typeOptions || '<option value="">（研修設定で追加してください）</option>'}</select>
        </label>
        <label style="min-width:140px;">レベル
          <select id="plan-training-level">${levelOptions}</select>
        </label>
        <label style="min-width:180px;">対象者
          <select id="plan-training-target">${targetOptions}</select>
        </label>
        <button class="btn btn-primary" onclick="(function(){
          const tid = document.getElementById('plan-training-type')?.value;
          const lv  = parseInt(document.getElementById('plan-training-level')?.value || '1', 10);
          const tg  = document.getElementById('plan-training-target')?.value;
          if (!tid) { alert('研修メニューを選択してください'); return; }
          window.GameCallbacks?.handlePlanTraining?.({ trainingTypeId: tid, level: lv, targetGroup: tg });
        })()">追加</button>
      </div>
    </div>
    <div class="flex items-center gap-2 mb-2">
      <span style="font-weight:600;">今期の研修一覧（${currentTrainings.length}件）</span>
      ${currentTrainings.filter(t => t.status !== 'executed').length > 0
        ? `<button class="btn btn-sm btn-primary" onclick="window.GameCallbacks?.handleExecuteAllTrainings?.()">一括実行</button>` : ''}
    </div>
    ${currentTrainings.length > 0 ? `
    <div class="table-container">
      <table>
        <thead><tr>
          <th>研修名</th><th>Lv</th><th>効果範囲</th><th class="text-right">単価</th>
          <th>対象者</th><th>対象人数</th><th class="text-right">研修費計</th><th>状態</th><th>操作</th>
        </tr></thead>
        <tbody>${trainingRows}</tbody>
      </table>
    </div>` : '<p class="text-muted">研修が追加されていません。</p>'}`;

  // ============================================================
  // タブ構造を組み立て描画（3タブ）
  // ============================================================
  const tabs = [
    { id: 'hr-review',   label: '人事考課' },
    { id: 'hr-transfer', label: '人事異動' },
    { id: 'hr-training', label: `研修計画${currentTrainings.length > 0 ? ` (${currentTrainings.length})` : ''}` },
  ];

  const tabBtns = tabs.map(t =>
    `<button class="settings-tab${_hrActiveTab === t.id ? ' active' : ''}"
      data-hr-tab="${t.id}">${_escape(t.label)}</button>`
  ).join('');

  const activeContent = _hrActiveTab === 'hr-training' ? tabTrainingHtml
    : _hrActiveTab === 'hr-transfer' ? tabTransferHtml
    : tabReviewHtml;

  container.innerHTML = `
    <div class="settings-tabs">${tabBtns}</div>
    <div class="settings-tab-content">${activeContent}</div>`;

  // タブ切替リスナー
  container.querySelectorAll('[data-hr-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _hrActiveTab = btn.dataset.hrTab;
      renderHRActions(state);
    });
  });
}

/**
 * ターン進行画面を描画する
 *
 * @param {GameState}            state  - ゲーム状態
 * @param {AnnualFinancials|null} result - calcAnnualFinancials() の戻り値（未実施の場合 null）
 * @returns {void}
 */
function renderTurnScreen(state, result) {
  const container = document.getElementById('turn-content');
  if (!container) return;

  if (!result) {
    container.innerHTML = `
      <div class="turn-guide">
        <p class="text-muted mb-3">まだターンが進んでいません。下のボタンで年次人事処理を実行してください。</p>
        <div class="kpi-grid" style="max-width:600px;">
          <div class="kpi-card">
            <div class="card-label">現在年度</div>
            <div class="card-value">${_escape(String(state.currentYear))}<span class="card-unit">年度</span></div>
          </div>
          <div class="kpi-card">
            <div class="card-label">社員数</div>
            <div class="card-value">${(state.employees || []).length}<span class="card-unit">名</span></div>
          </div>
        </div>
      </div>`;
    return;
  }

  const revenue       = result.revenue            || 0;
  const laborCogs     = result.laborCostCogs       || 0;
  const laborSga      = result.laborCostSga        || 0;
  const laborTotal    = result.laborCostTotal      || 0;
  const locationCost  = result.locationCostTotal   || 0;
  const execComp      = result.executiveCompTotal  || 0;
  const fixedCost     = result.fixedCost           || 0;
  const totalCost     = result.totalCost           || 0;
  const profitBefore  = result.profitBeforeBuffs   ?? 0;
  const profit        = result.profitAfterBuffs    ?? profitBefore;
  const profitRate    = revenue > 0 ? (profit / revenue * 100).toFixed(1) : '0.0';
  const buffDiff      = profit - profitBefore;

  const resultYear = result.year || (state.currentYear - 1);

  // 季節変動・難易度情報
  const diffLabel = result.difficulty === 'easy' ? 'Easy' : result.difficulty === 'hard' ? 'Hard' : 'Normal';
  const seasonPct = result.seasonalMultiplier ? `（季節変動：×${result.seasonalMultiplier}）` : '';

  // 費用行の追加
  let costRows = '';
  if (result.hiringCost > 0) {
    costRows += `<tr><td>採用コスト（${Math.round((result.hiringCostRate || 0.32) * 100)}%）</td>
      <td class="text-right">${_formatMoney(result.hiringCost)}</td></tr>`;
  }
  if (result.trainingCost > 0) {
    costRows += `<tr><td>研修コスト</td>
      <td class="text-right">${_formatMoney(result.trainingCost)}</td></tr>`;
  }
  if (result.executiveOfficerCompTotal > 0) {
    costRows += `<tr><td>執行役員手当</td>
      <td class="text-right">${_formatMoney(result.executiveOfficerCompTotal)}</td></tr>`;
  }

  const financeHtml = `
    <h3 class="mb-2">財務結果（${_escape(String(resultYear))}年度）</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:8px;">難易度: ${_escape(diffLabel)}${_escape(seasonPct)}</p>
    <div class="turn-summary">
      <div class="finance-row">
        <span class="finance-label">売上</span>
        <span class="finance-value positive">${_formatMoney(revenue)}</span>
      </div>
      <div class="finance-row">
        <span class="finance-label">原価人件費</span>
        <span class="finance-value">&minus; ${_formatMoney(laborCogs)}</span>
      </div>
      <div class="finance-row">
        <span class="finance-label">販管人件費</span>
        <span class="finance-value">&minus; ${_formatMoney(laborSga)}</span>
      </div>
      <div class="finance-row" style="padding-left:12px;font-size:12px;color:#64748b;">
        <span class="finance-label">人件費合計</span>
        <span class="finance-value">&minus; ${_formatMoney(laborTotal)}</span>
      </div>
      <div class="finance-row">
        <span class="finance-label">拠点維持費</span>
        <span class="finance-value">&minus; ${_formatMoney(locationCost)}</span>
      </div>
      <div class="finance-row">
        <span class="finance-label">役員報酬</span>
        <span class="finance-value">&minus; ${_formatMoney(execComp)}</span>
      </div>
      <div class="finance-row">
        <span class="finance-label">固定費</span>
        <span class="finance-value">&minus; ${_formatMoney(fixedCost)}</span>
      </div>
      ${costRows ? `<div class="finance-row"><div class="table-container" style="margin:4px 0;"><table style="font-size:12px;">${costRows}</table></div></div>` : ''}
      <div class="finance-row" style="font-weight:700;">
        <span class="finance-label">費用合計</span>
        <span class="finance-value">&minus; ${_formatMoney(totalCost)}</span>
      </div>
      <div class="finance-row" style="font-size:13px;color:#64748b;">
        <span class="finance-label">役員バフ適用前利益</span>
        <span class="finance-value ${profitBefore < 0 ? 'negative' : ''}">${_formatMoney(profitBefore)}</span>
      </div>
      ${buffDiff !== 0 ? `
      <div class="finance-row" style="font-size:13px;color:#64748b;">
        <span class="finance-label">役員バフ効果</span>
        <span class="finance-value ${buffDiff > 0 ? 'positive' : 'negative'}">${buffDiff > 0 ? '+' : ''}${_formatMoney(buffDiff)}</span>
      </div>` : ''}
      <div class="finance-row" style="font-size:18px;font-weight:800;border-top:2px solid #e2e8f0;padding-top:10px;margin-top:6px;">
        <span class="finance-label">当期利益（バフ適用後）</span>
        <span class="finance-value ${profit < 0 ? 'negative' : 'positive'}">${_formatMoney(profit)}</span>
      </div>
      <div class="finance-row">
        <span class="finance-label">利益率</span>
        <span class="finance-value ${profit < 0 ? 'negative' : ''}">${profitRate}%</span>
      </div>
    </div>`;

  // 退職者
  const retired = result.retiredEmployees || [];
  const retireHtml = `
    <h3 class="mt-4 mb-2">退職者（${retired.length}名）</h3>
    ${retired.length === 0
      ? '<p class="text-muted">今期の強制退職者はいません。</p>'
      : `<ul class="event-list">${retired.map(e =>
          `<li class="event-retire">${_escape(e.name)}（${e.age}歳 / 80歳定年退職）</li>`
        ).join('')}</ul>`}`;

  // 離職者表示
  let resignedHtml = '';
  if ((result.resignedEmployees || []).length > 0) {
    const names = result.resignedEmployees.map(e => _escape(e.name)).join('、');
    resignedHtml = `<div class="alert-section alert-warning" style="margin-top:8px;">
      <strong>自主退職 ${result.resignedEmployees.length}名：</strong>${names}
    </div>`;
  }

  // イベントリスト（退職以外）
  const events = (result.events || []).filter(ev => ev.type !== 'retire');
  const eventsHtml = events.length === 0 ? '' : `
    <h3 class="mt-4 mb-2">発生イベント（${events.length}件）</h3>
    <ul class="event-list">
      ${events.map(ev => {
        const cls = ev.type === 'promote' ? 'event-promote'
          : ev.type === 'warn' ? 'event-warn'
          : 'event-info';
        return `<li class="${cls}">${_escape(ev.message)}</li>`;
      }).join('')}
    </ul>`;

  // 次の年へボタン（ダッシュボードへ戻る誘導）
  const nextYearHtml = `
    <div class="mt-4 flex gap-2">
      <button class="btn btn-primary" onclick="
        window.GameCallbacks?.switchScreen?.('dashboard')">
        ダッシュボードを確認する
      </button>
      <button class="btn btn-secondary" onclick="
        window.GameCallbacks?.switchScreen?.('hr-actions')">
        人事アクションへ
      </button>
    </div>`;

  container.innerHTML = financeHtml + retireHtml + resignedHtml + eventsHtml + nextYearHtml;
}

/**
 * プロジェクト一覧を描画する
 *
 * @param {ProjectSummary[]} projects        - 全プロジェクトリスト
 * @param {string}           currentProjectId - 現在アクティブなプロジェクトID
 * @returns {void}
 */
function renderProjectList(projects, currentProjectId) {
  const container = document.getElementById('project-list-area');
  if (!container) return;

  const projectItems = (projects || []).map(p => {
    const isActive = p.id === currentProjectId;
    const elapsed  = p.currentYear - p.startYear;
    return `
      <div class="project-item ${isActive ? 'active' : ''}">
        <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-small"
          onclick="window.GameCallbacks?.loadProject?.('${_escape(p.id)}')">
          ${_escape(p.name)}
        </button>
        <span class="text-muted" style="font-size:12px;">
          ${p.startYear}年〜 ${p.currentYear}年（${elapsed}年経過）/ ${p.employeeCount}名
        </span>
        ${isActive
          ? '<span class="badge badge-success">現在</span>'
          : `<button class="btn btn-small btn-danger"
              onclick="if(confirm('「${_escape(p.name)}」を削除しますか？')) window.GameCallbacks?.deleteProject?.('${_escape(p.id)}')">
              削除
            </button>`}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="project-list">
      ${projectItems || '<p class="text-muted">プロジェクトがありません。</p>'}
      <div class="mt-3">
        <button class="btn btn-success btn-small"
          onclick="window.GameCallbacks?.openModal?.('modal-new-project')">
          ＋ 新規プロジェクト（会社）を作成
        </button>
      </div>
    </div>`;
}

/**
 * 設定画面を描画する
 *
 * @param {GameState} state - ゲーム状態
 * @returns {void}
 */
function renderSettings(state) {
  const container = document.getElementById('settings-content');
  if (!container) return;

  const activeTab = container.dataset.activeTab || 'unittypes';

  const tabs = [
    { id: 'unittypes',          label: '部門設定' },
    { id: 'positions',          label: '役職設定' },
    { id: 'executive_officers', label: '執行役員設定' },
    { id: 'locations',          label: '拠点設定' },
    { id: 'board',              label: '取締役設定' },
    { id: 'grades',             label: 'グレード設定' },
    { id: 'training',           label: '研修設定' },
    { id: 'player',             label: 'プレイヤー設定' },
  ];

  const tabBar = `
    <div class="settings-tabs">
      ${tabs.map(t => `
        <button class="settings-tab ${activeTab === t.id ? 'active' : ''}"
          onclick="window.UIModule?.switchSettingsTab?.('${t.id}', window.gameState)">
          ${_escape(t.label)}
        </button>`).join('')}
    </div>`;

  let tabContent = '';
  switch (activeTab) {
    case 'unittypes':        tabContent = _renderSettingsUnitTypes();              break;
    case 'positions':        tabContent = _renderSettingsPositions(state);         break;
    case 'executive_officers': tabContent = _renderSettingsExecutiveOfficers(state); break;
    case 'locations':        tabContent = _renderSettingsLocations(state);         break;
    case 'board':            tabContent = _renderSettingsBoard(state);             break;
    case 'grades':           tabContent = _renderSettingsGrades(state);            break;
    case 'training':         tabContent = _renderSettingsTraining(state);          break;
    case 'player':           tabContent = _renderSettingsPlayer(state);            break;
    default: tabContent = '<p class="text-muted">タブを選択してください。</p>';
  }

  container.innerHTML = tabBar + `<div class="settings-tab-content">${tabContent}</div>`;
}

/**
 * 設定タブを切り替えて再描画する
 * @param {string}    tabName
 * @param {GameState} state
 */
function switchSettingsTab(tabName, state) {
  const container = document.getElementById('settings-content');
  if (!container) return;
  container.dataset.activeTab = tabName;
  renderSettings(state);
}

// --- 設定画面サブレンダラ ---

/**
 * 部門設定タブのHTML
 * @returns {string}
 */
function _renderSettingsUnitTypes() {
  const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
  const UNIT_LEVEL_ALLOWANCES = window.OrgModule?.UNIT_LEVEL_ALLOWANCES || {};

  const rows = UNIT_TYPE_DEFS.map(def => {
    const allowance = UNIT_LEVEL_ALLOWANCES[def.levelNum] || 0;
    return `<tr>
      <td>${_escape(def.name)}</td>
      <td class="text-right">${def.levelNum}</td>
      <td>${_escape(def.pos1Name || '—')}</td>
      <td>${_escape(def.pos2Name || '—')}</td>
      <td class="text-right">${allowance}万円/月</td>
      <td class="text-right">${def.displayOrder}</td>
    </tr>`;
  }).join('');

  return `
    <h3 class="mb-2">部門設定</h3>
    <p class="text-muted mb-3" style="font-size:13px;">部門種別と紐づく役職を定義します。ここで設定された役職が役職設定タブに反映されます。</p>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>部門階層名</th><th class="text-right">階層番号</th>
          <th>部門役職1</th><th>部門役職2</th>
          <th class="text-right">役職手当/月</th><th class="text-right">表示番号</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="text-muted text-center">部門設定がありません</td></tr>'}</tbody>
      </table>
    </div>
    <p class="text-muted mt-3" style="font-size:12px;">※ 部門設定の編集機能は今後のアップデートで追加予定です。</p>`;
}

/**
 * 執行役員設定タブのHTML
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsExecutiveOfficers(state) {
  const executiveOfficers = state.executiveOfficers || [];
  const employees = state.employees || [];

  // G6以上の社員リスト（グレード降順）
  const GRADE_ORDER = window.DataModule?.GRADE_ORDER || [];
  const eligibleEmps = employees
    .filter(e => ['G6','G7','G8','G9','G10'].includes(e.grade))
    .sort((a, b) => GRADE_ORDER.indexOf(b.grade) - GRADE_ORDER.indexOf(a.grade));

  const eoIds = executiveOfficers.map(eo => eo.employeeId);

  const rows = executiveOfficers
    .slice()
    .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99))
    .map(eo => {
      const emp = employees.find(e => e.id === eo.employeeId);
      if (!emp) return '';
      const typeLabel = eo.type === 'senior' ? '上席執行役員' : '執行役員';
      const buffPct   = eo.type === 'senior' ? '2%×(モチベ/100)' : '1%×(モチベ/100)';
      return `<tr>
        <td>${_escape(emp.name)}</td>
        <td>${_escape(emp.grade)}</td>
        <td>${_escape(typeLabel)}</td>
        <td>${_escape(eo.domain || '—')}</td>
        <td>売上+${_escape(buffPct)}</td>
        <td class="text-right">${eo.compensation || (eo.type === 'senior' ? 30 : 20)}万円/月</td>
        <td>
          <button class="btn btn-sm btn-danger"
            onclick="if(confirm('${_escape(emp.name)}を執行役員から外しますか？'))
              window.GameCallbacks?.handleRemoveExecutiveOfficer?.(${emp.id})">外す</button>
        </td>
        <td><input type="number" style="width:60px;" value="${eo.displayOrder || 99}"
          onchange="(function(v){
            const gs=window.gameState;
            const eo=(gs.executiveOfficers||[]).find(x=>x.employeeId===${emp.id});
            if(eo){eo.displayOrder=parseInt(v)||99;window.GameCallbacks?.saveProject?.();window.UIModule?.renderSettings?.(gs);}
          })(this.value)"></td>
      </tr>`;
    }).filter(Boolean).join('');

  // 任命フォーム
  const empOptions = eligibleEmps.map(e =>
    `<option value="${e.id}"${eoIds.includes(e.id) ? ' disabled' : ''}>${_escape(e.name)}（${e.grade}）${eoIds.includes(e.id) ? '（任命済）' : ''}</option>`
  ).join('');

  return `
    <div class="flex items-center gap-2 mb-3">
      <h3>執行役員（${executiveOfficers.length}名）</h3>
    </div>
    <div class="table-container mb-4">
      <table>
        <thead><tr>
          <th>氏名</th><th>グレード</th><th>役員種別</th><th>担当職域</th>
          <th>任命効果</th><th class="text-right">手当/月</th><th>操作</th><th>表示番号</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="text-muted text-center">執行役員がいません</td></tr>'}</tbody>
      </table>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
      <h4 style="font-size:14px;margin-bottom:10px;">執行役員を任命</h4>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;">
        <label style="min-width:200px;">社員（G6以上）
          <select id="eo-employee-id">
            <option value="">社員を選択</option>
            ${empOptions}
          </select>
        </label>
        <label>役員種別
          <select id="eo-type">
            <option value="regular">執行役員（手当20万/月）</option>
            <option value="senior">上席執行役員（手当30万/月）</option>
          </select>
        </label>
        <label>担当職域
          <input type="text" id="eo-domain" placeholder="例: 技術戦略" style="width:150px;">
        </label>
        <button class="btn btn-primary" onclick="(function(){
          const empId = parseInt(document.getElementById('eo-employee-id')?.value||'0',10);
          const type  = document.getElementById('eo-type')?.value || 'regular';
          const domain = document.getElementById('eo-domain')?.value || '';
          if (!empId) { alert('社員を選択してください'); return; }
          window.GameCallbacks?.handleAddExecutiveOfficer?.({
            employeeId: empId, type, domain,
            compensation: type === 'senior' ? 30 : 20,
            displayOrder: 99
          });
        })()">任命</button>
      </div>
    </div>`;
}

/**
 * 研修設定タブのHTML
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsTraining(state) {
  const trainingSettings = state.trainingSettings || [];

  const EFFECT_LABELS = {
    all: '全ステータスUP', motivation: 'モチベーションUP',
    technical: 'スキルUP', communication: 'コミュニケーションUP', leadership: 'リーダーシップUP',
  };

  const rows = trainingSettings.map(ts => `
    <tr>
      <td>${_escape(ts.name)}</td>
      <td>${_escape(EFFECT_LABELS[ts.effect] || ts.effect)}</td>
      <td>
        <button class="btn btn-sm btn-danger"
          onclick="if(confirm('研修「${_escape(ts.name)}」を削除しますか？'))
            window.GameCallbacks?.handleDeleteTrainingType?.('${_escape(ts.id)}')">削除</button>
      </td>
    </tr>`).join('');

  const effectOptions = Object.entries(EFFECT_LABELS).map(([k, v]) =>
    `<option value="${k}">${_escape(v)}</option>`
  ).join('');

  return `
    <div class="flex items-center gap-2 mb-3">
      <h3>研修設定（${trainingSettings.length}件）</h3>
    </div>
    <div class="table-container mb-4">
      <table>
        <thead><tr><th>研修名</th><th>研修効果</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="text-muted text-center">研修がありません</td></tr>'}</tbody>
      </table>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
      <h4 style="font-size:14px;margin-bottom:10px;">研修を追加</h4>
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:flex-end;">
        <label style="min-width:200px;">研修名
          <input type="text" id="add-training-name" placeholder="例: OJT研修" style="width:200px;">
        </label>
        <label>研修効果
          <select id="add-training-effect">${effectOptions}</select>
        </label>
        <button class="btn btn-primary" onclick="(function(){
          const name   = document.getElementById('add-training-name')?.value?.trim();
          const effect = document.getElementById('add-training-effect')?.value || 'all';
          if (!name) { alert('研修名を入力してください'); return; }
          window.GameCallbacks?.handleAddTrainingType?.({ name, effect });
          document.getElementById('add-training-name').value = '';
        })()">追加</button>
      </div>
    </div>
    <p class="text-muted mt-3" style="font-size:12px;">
      ※ モチベーションUP効果の有無にかかわらず、研修を受けた社員はすべてモチベーションが微増します。
    </p>`;
}

/**
 * 役職設定タブのHTML
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsPositions(state) {
  const positions = (state.positions || []).slice().sort((a, b) => {
    const da = a.displayOrder ?? 9999;
    const db = b.displayOrder ?? 9999;
    return da - db;
  });

  const rows = positions.map(p => {
    return `
      <tr>
        <td>${_escape(p.name)}</td>
        <td>${_escape(String(p.level))}</td>
        <td class="text-right">${p.allowance}万円/月</td>
        <td>
          <button class="btn btn-sm btn-secondary"
            onclick="window.GameCallbacks?.openEditPositionModal?.('${_escape(p.id)}')">編集</button>
          <button class="btn btn-sm btn-danger"
            onclick="if(confirm('役職「${_escape(p.name)}」を削除しますか？')) window.GameCallbacks?.handleDeletePosition?.('${_escape(p.id)}')">削除</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="flex items-center gap-2 mb-3">
      <h3>役職一覧（${positions.length}件）</h3>
      <button class="btn btn-primary btn-small"
        onclick="window.GameCallbacks?.openModal?.('modal-add-position')">＋ 役職追加</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>役職名</th><th>階層</th><th class="text-right">役職手当</th><th>操作</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="text-muted" style="text-align:center;">役職がありません</td></tr>'}</tbody>
      </table>
    </div>`;
}

/**
 * 拠点設定タブのHTML
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsLocations(state) {
  const locations = (state.locations || [])
    .slice()
    .sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999));
  const REGION_TYPES = window.OrgModule?.REGION_TYPES || {};

  const rows = locations.map(loc => {
    const regionLabel = REGION_TYPES[loc.regionType]?.label || loc.regionType;
    const cost = window.OrgModule?.calcLocationCost(loc) || 0;
    const locEmpCount = (state.employees || []).filter(e => {
      const unit = (state.orgUnits || []).find(u => u.id === e.unitId);
      return unit && unit.locationId === loc.id;
    }).length;
    const isOver = locEmpCount > loc.capacity;
    const capacityCell = isOver
      ? `${loc.capacity}名 <span class="badge badge-danger">定員超過 +${locEmpCount - loc.capacity}</span>`
      : `${loc.capacity}名`;

    return `
      <tr>
        <td><input type="number" class="inline-edit" style="width:56px;text-align:center;"
          value="${loc.displayOrder ?? ''}" min="0" step="1"
          onchange="window.GameCallbacks?.handleUpdateLocationDisplayOrder?.('${_escape(loc.id)}', this.value)"></td>
        <td>${_escape(loc.name)}</td>
        <td>${_escape(regionLabel)}</td>
        <td>${capacityCell}</td>
        <td class="${isOver ? 'negative' : ''}">${locEmpCount}名</td>
        <td class="text-right">${_formatMoney(cost)}/年</td>
        <td>
          <button class="btn btn-sm btn-secondary"
            onclick="window.GameCallbacks?.openEditLocationModal?.('${_escape(loc.id)}')">編集</button>
          <button class="btn btn-sm btn-danger"
            onclick="if(confirm('拠点「${_escape(loc.name)}」を削除しますか？')) window.GameCallbacks?.handleDeleteLocation?.('${_escape(loc.id)}')">削除</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="flex items-center gap-2 mb-3">
      <h3>拠点一覧（${locations.length}拠点）</h3>
      <button class="btn btn-primary btn-small"
        onclick="window.GameCallbacks?.openModal?.('modal-add-location')">＋ 拠点追加</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>表示番号</th><th>拠点名</th><th>地域区分</th><th>定員</th><th>在籍数</th><th class="text-right">年間維持費</th><th>操作</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="text-muted" style="text-align:center;">拠点がありません</td></tr>'}</tbody>
      </table>
    </div>`;
}

/**
 * 取締役設定タブのHTML
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsBoard(state) {
  const board     = (state.board || []).slice().sort((a, b) => {
    const da = a.displayOrder ?? 9999;
    const db = b.displayOrder ?? 9999;
    return da - db;
  });
  const employees = state.employees || [];
  const EXEC_ATTRIBUTES = window.DataModule?.EXECUTIVE_ATTRIBUTES || {};
  const EXEC_ROLES      = window.DataModule?.EXECUTIVE_ROLES      || {};

  // CEO・CHRO 設置チェック
  const hasCEO  = board.some(b => b.role === 'CEO');
  const hasCHRO = board.some(b => b.role === 'CHRO');
  const warnings = [];
  if (!hasCEO)  warnings.push('CEOが設置されていません（必須）');
  if (!hasCHRO) warnings.push('CHROが設置されていません（必須）');

  const warningHtml = warnings.length > 0
    ? `<div class="alert-section alert-danger mb-3">${warnings.map(w => `<p>&#x26A0; ${_escape(w)}</p>`).join('')}</div>`
    : '';

  // 合計役員報酬
  const totalComp = board.reduce((s, b) => s + (b.compensation || 0), 0);

  const rows = board.map(member => {
    const emp       = employees.find(e => e.id === member.employeeId);
    const isCHRO    = member.role === 'CHRO';
    // 【6】CHROバッジを「プレイヤー」に変更
    const chroDisp  = isCHRO ? ` <span class="badge badge-info">プレイヤー</span>` : '';
    const attrLabel = EXEC_ATTRIBUTES[member.attribute]?.label || member.attribute;
    const roleLabel = member.role ? (EXEC_ROLES[member.role]?.label || member.role) : '（なし）';
    const buff      = member.role ? EXEC_ROLES[member.role]?.buff : null;
    // バフ表示：日本語に変換
    let buffLabel = 'なし';
    if (buff) {
      const pct = Math.abs(Math.round(buff.value * 100));
      const sign = buff.value > 0 ? '+' : '−';
      const buffTypeMap = {
        revenue_pct:           `売上 ${sign}${pct}%`,
        revenue_up:            `売上 ${sign}${pct}%`,
        cost_pct:              `全費用 ${sign}${pct}%`,
        cost_down:             `全費用 ${sign}${pct}%`,
        cost_cogs_labor_pct:   `原価人件費 ${sign}${pct}%`,
        cogs_labor_down:       `原価人件費 ${sign}${pct}%`,
        cost_sga_labor_pct:    `販管人件費 ${sign}${pct}%`,
        sga_labor_down:        `販管人件費 ${sign}${pct}%`,
        cost_labor_pct:        `人件費全体 ${sign}${pct}%`,
        total_labor_down:      `人件費全体 ${sign}${pct}%`,
      };
      buffLabel = buffTypeMap[buff.type] || `${buff.type}: ${sign}${pct}%`;
    }

    return `
      <tr>
        <td>${_escape(emp?.name || '不明')}${chroDisp}</td>
        <td><span class="badge badge-grade">${_escape(emp?.grade || '-')}</span></td>
        <td>${_escape(attrLabel)}</td>
        <td>${member.role ? `<span class="badge badge-warning">${_escape(member.role)}</span>` : '<span class="text-muted">なし</span>'}</td>
        <td style="font-size:11px;">${_escape(roleLabel)}</td>
        <td style="font-size:11px;">${_escape(buffLabel)}</td>
        <td class="text-right">${member.compensation}万円</td>
        <td>
          <button class="btn btn-sm btn-secondary"
            onclick="window.GameCallbacks?.openEditBoardMemberModal?.(${member.employeeId})">編集</button>
          <button class="btn btn-sm btn-danger"
            onclick="if(confirm('取締役から外しますか？')) window.GameCallbacks?.handleRemoveBoardMember?.(${member.employeeId})">外す</button>
        </td>
        <td><input type="number" style="width:60px;" value="${member.displayOrder ?? ''}" placeholder="番号"
          onchange="window.GameCallbacks?.handleUpdateBoardMemberDisplayOrder?.(${member.employeeId}, this.value)"></td>
      </tr>`;
  }).join('');

  return `
    ${warningHtml}
    <div class="flex items-center gap-2 mb-3">
      <h3>取締役ボード（${board.length}名）</h3>
      <span class="text-muted" style="font-size:12px;">合計報酬: ${_formatMoney(totalComp)}/年</span>
      <button class="btn btn-primary btn-small"
        onclick="window.GameCallbacks?.openModal?.('modal-add-board-member')">
        ＋ 取締役任命
      </button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>氏名</th><th>グレード</th><th>役員種別</th><th>役割</th><th>役職名</th><th>任命効果</th><th class="text-right">報酬/年</th><th>操作</th><th>表示番号</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="text-muted" style="text-align:center;">取締役が任命されていません</td></tr>'}</tbody>
      </table>
    </div>`;
}

// 【7】インライン編集中のグレード
let _editingGrade = null;

/**
 * グレード設定タブのHTML（【7】インライン編集対応）
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsGrades(state) {
  const GRADE_DEFINITIONS = window.DataModule?.GRADE_DEFINITIONS || {};
  const GRADE_ORDER       = window.DataModule?.GRADE_ORDER       || [];
  const AUTO_MAX_INDEX    = window.DataModule?.AUTO_PROMOTION_MAX_INDEX ?? 4;
  // gradeSettings によるカスタム上書き
  const gradeSettings     = state.gradeSettings || {};

  // ラベルから "G1  / " などのプレフィックスを除去して名称のみ取得
  function stripGradePrefix(label) {
    if (!label) return label;
    return label.replace(/^G\d+\s*\/\s*/, '').trim();
  }

  const rows = GRADE_ORDER.map((g, idx) => {
    const baseDef = GRADE_DEFINITIONS[g];
    const custom  = gradeSettings[g];
    const def     = custom ? { ...baseDef, ...custom } : baseDef;
    const isAuto  = idx < AUTO_MAX_INDEX;
    const count   = (state.employees || []).filter(e => e.grade === g).length;

    const displayLabel = stripGradePrefix(def?.label) || (def?.label || g);

    if (_editingGrade === g) {
      // 編集モード行
      return `
        <tr style="background:#fffbeb;">
          <td class="grade-nowrap"><span class="badge badge-grade">${_escape(g)}</span></td>
          <td class="grade-nowrap"><input type="text" id="grade-edit-name-${g}" value="${_escape(displayLabel)}" style="width:100px;"></td>
          <td class="text-right grade-nowrap"><input type="number" id="grade-edit-salary-${g}" value="${def?.baseAnnualSalary || 0}" style="width:90px;"></td>
          <td class="text-center">${isAuto ? '<span class="badge badge-success">自動</span>' : '<span class="badge badge-warning">手動</span>'}</td>
          <td class="text-center">${count}名</td>
          <td><input type="text" id="grade-edit-desc-${g}" value="${_escape(def?.description || '')}" style="width:180px;"></td>
          <td>
            <button class="btn btn-sm btn-primary"
              onclick="window.GameCallbacks?.handleUpdateGrade?.('${g}', {
                name: document.getElementById('grade-edit-name-${g}')?.value,
                salary: document.getElementById('grade-edit-salary-${g}')?.value,
                description: document.getElementById('grade-edit-desc-${g}')?.value
              }); window.UIModule?.cancelGradeEdit?.();">保存</button>
            <button class="btn btn-sm btn-secondary"
              onclick="window.UIModule?.cancelGradeEdit?.();">キャンセル</button>
          </td>
        </tr>`;
    }

    return `
      <tr>
        <td class="grade-nowrap"><span class="badge badge-grade">${_escape(g)}</span></td>
        <td class="grade-nowrap">${_escape(displayLabel)}</td>
        <td class="text-right grade-nowrap">${_formatMoney(def?.baseAnnualSalary || 0)}</td>
        <td class="text-center">${isAuto
          ? '<span class="badge badge-success">自動</span>'
          : '<span class="badge badge-warning">手動</span>'}
        </td>
        <td class="text-center">${count}名</td>
        <td class="text-muted" style="font-size:12px;">${_escape(def?.description || '')}</td>
        <td>
          <button class="btn btn-sm btn-secondary"
            onclick="window.UIModule?.startGradeEdit?.('${g}', window.gameState)">編集</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <h3 class="mb-3">グレード定義（G1〜G10）</h3>
    <p class="text-muted mb-3" style="font-size:12px;">
      G1〜G5は自動昇格対象。G6以上は人事アクション画面から${_escape((window.gameState?.chroName) || 'CHRO')}が手動判断します。
    </p>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>グレード</th><th>名称</th><th class="text-right">標準年俸</th><th class="text-center">昇格方式</th><th class="text-center">在籍数</th><th>説明</th><th>操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * プレイヤー設定タブのHTML
 * @param {GameState} state
 * @returns {string}
 */
function _renderSettingsPlayer(state) {
  const chroName = state.chroName || '（未設定）';

  // プロジェクト名変更フォーム
  const projectNameSection = `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
      <h4 style="font-size:14px;margin-bottom:10px;">プロジェクト名（会社名）</h4>
      <div class="flex gap-2 items-center">
        <input type="text" id="player-project-name" value="${_escape(state.projectName || '')}" style="width:250px;" placeholder="会社名を入力">
        <button class="btn btn-primary" onclick="(function(){
          const n = document.getElementById('player-project-name')?.value?.trim();
          if (!n) { alert('プロジェクト名を入力してください'); return; }
          window.GameCallbacks?.renameProject?.('${_escape(state.projectId)}', n);
        })()">変更</button>
      </div>
    </div>`;

  // 難易度設定
  const diffOptions = [
    { id: 'easy',   label: 'Easy（ゆったりプレイ）― 売上×50%' },
    { id: 'normal', label: 'Normal（標準）― 売上×30%' },
    { id: 'hard',   label: 'Hard（経営難）― 売上×20%' },
  ].map(d => `<option value="${d.id}"${(state.difficulty || 'normal') === d.id ? ' selected' : ''}>${d.label}</option>`).join('');

  const difficultySection = `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
      <h4 style="font-size:14px;margin-bottom:10px;">ゲーム難易度</h4>
      <select id="player-difficulty" onchange="window.GameCallbacks?.handleUpdateDifficulty?.(this.value)">${diffOptions}</select>
      <p class="text-muted mt-1" style="font-size:12px;">売上の実力値に乗算する係数を変更します。</p>
    </div>`;

  return `
    <h3 class="mb-3">プレイヤー設定</h3>
    <div class="card" style="max-width:400px;">
      <div class="card-label mb-2">CHRO氏名</div>
      <div class="flex gap-2">
        <input type="text" id="player-chro-name-input" value="${_escape(chroName)}" placeholder="CHRO氏名を入力" style="flex:1;">
        <button class="btn btn-primary btn-sm"
          onclick="window.GameCallbacks?.handleUpdateChroName?.(document.getElementById('player-chro-name-input')?.value)">保存</button>
      </div>
      <p class="text-muted mt-2" style="font-size:12px;">社員一覧・人事アクション画面の「CHRO」「プレイヤー」表示に使用されます。</p>
      ${projectNameSection}
      ${difficultySection}
    </div>`;
}

// ============================================================
// モーダル制御
// ============================================================

/**
 * モーダルを表示する
 *
 * @param {string} modalId - モーダルのDOM ID
 * @param {Object} [data]  - モーダルに渡す初期データ（任意）
 * @returns {void}
 */
function showModal(modalId, data) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('hidden');

  // data がある場合は各モーダルに応じた初期化
  if (data && modalId === 'modal-employee-detail') {
    _populateEmployeeDetailModal(data);
  }
  // 採用モーダルの場合、部門選択肢を最新化
  if (modalId === 'modal-hire' && window.gameState) {
    _refreshHireModalUnits(window.gameState);
  }
  // 取締役モーダルの場合、社員選択肢を最新化
  if (modalId === 'modal-add-board-member' && window.gameState) {
    _populateBoardModal(window.gameState);
  }
  // 部門追加モーダルの場合、親部門・拠点選択肢を最新化
  if (modalId === 'modal-add-unit' && window.gameState) {
    _populateAddUnitModal(window.gameState);
  }
  // 部門編集モーダルの場合、拠点選択肢を最新化
  if (modalId === 'modal-edit-unit' && window.gameState) {
    _populateEditUnitLocationSelect(window.gameState);
  }
}

/**
 * モーダルを非表示にする
 *
 * @param {string} modalId - モーダルのDOM ID
 * @returns {void}
 */
function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

/**
 * 部門編集モーダルの拠点選択肢を更新する
 * @param {GameState} state
 */
function _populateEditUnitLocationSelect(state) {
  const locations = state.locations || [];
  const locSelect = document.getElementById('edit-unit-location');
  if (locSelect) {
    const current = locSelect.value;
    locSelect.innerHTML = '<option value="">（未設定）</option>' +
      locations.map(l =>
        `<option value="${_escape(l.id)}"${current === l.id ? ' selected' : ''}>${_escape(l.name)}</option>`
      ).join('');
  }
}

/**
 * 採用モーダルの部門選択肢を更新する
 * @param {GameState} state
 */
function _refreshHireModalUnits(state) {
  const hireUnit = document.getElementById('hire-unit');
  if (hireUnit) {
    const chartOrder = _getOrgUnitsInChartOrder(state.orgUnits || []);
    hireUnit.innerHTML = '<option value="">自動配属（最少人数の部門）</option>' +
      chartOrder.map(({ unit: u, depth }) => {
        const indent = '\u3000'.repeat(depth);
        return `<option value="${_escape(u.id)}">${indent}${_escape(u.name)}（${(u.employeeIds || []).length}名）</option>`;
      }).join('');
  }
}

/**
 * 取締役任命モーダルの社員選択肢を更新する
 * @param {GameState} state
 */
function _populateBoardModal(state) {
  const select = document.getElementById('board-employee-id');
  if (!select) return;
  // 取締役任命済み社員IDリスト
  const boardIds = (state.board || []).map(b => b.employeeId);
  // G6以上の社員をグレード降順で取得
  const GRADE_ORDER = window.DataModule?.GRADE_ORDER || [];
  const eligibleForBoard = (state.employees || [])
    .filter(e => ['G6','G7','G8','G9','G10'].includes(e.grade))
    .sort((a, b) => GRADE_ORDER.indexOf(b.grade) - GRADE_ORDER.indexOf(a.grade));
  select.innerHTML = '<option value="">社員を選択</option>' +
    eligibleForBoard.map(emp => {
      const inBoard = boardIds.includes(emp.id) ? '（既に取締役）' : '';
      return `<option value="${emp.id}"${boardIds.includes(emp.id) ? ' disabled' : ''}>${_escape(emp.name)} ${_escape(emp.grade)} ${inBoard}</option>`;
    }).join('');
}

/**
 * 社員詳細モーダルのコンテンツを生成する
 * @param {Employee} employee
 */
function _populateEmployeeDetailModal(employee) {
  const nameEl = document.getElementById('modal-employee-name');
  const bodyEl = document.getElementById('modal-employee-body');
  if (!nameEl || !bodyEl) return;

  const gs = window.gameState;
  const unitName   = gs ? (gs.orgUnits || []).find(u => u.id === employee.unitId)?.name || '未配属' : '未配属';
  const posLabels  = gs
    ? (employee.positionIds || [])
        .map(pid => (gs.positions || []).find(p => p.id === pid)?.name || pid)
        .join('、') || 'なし'
    : 'なし';
  const hireYear   = employee.hireYear || '-';
  const tenure     = gs ? gs.currentYear - (employee.hireYear || gs.currentYear) : 0;
  const jobLabel   = _jobTypeLabel(employee.jobType);
  const potential  = _potentialLabel(employee.potential);

  nameEl.textContent = employee.name || '社員詳細';

  bodyEl.innerHTML = `
    <div class="employee-detail-grid">
      <div class="detail-section">
        <h4 class="detail-section-title">基本情報</h4>
        <table class="detail-table">
          <tr><th>氏名</th><td>${_escape(employee.name)}</td></tr>
          <tr><th>年齢</th><td>${employee.age}歳</td></tr>
          <tr><th>職種</th><td>${_escape(jobLabel)}</td></tr>
          <tr><th>グレード</th><td><span class="badge badge-grade">${_escape(employee.grade)}</span></td></tr>
          <tr><th>ポテンシャル</th><td>${_escape(potential)}</td></tr>
          <tr><th>所属部門</th><td>${_escape(unitName)}</td></tr>
          <tr><th>役職</th><td>${_escape(posLabels)}</td></tr>
          <tr><th>入社年</th><td>${hireYear}年（在籍${tenure}年）</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <h4 class="detail-section-title">スキル・状態</h4>
        <table class="detail-table">
          <tr><th>テクニカル</th><td>${_skillBarHtml(employee.technical || 0)}</td></tr>
          <tr><th>コミュニケーション</th><td>${_skillBarHtml(employee.communication || 0)}</td></tr>
          <tr><th>リーダーシップ</th><td>${_skillBarHtml(employee.leadership || 0)}</td></tr>
          <tr><th>モチベーション</th><td>${_skillBarHtml(employee.motivation || 0, 'motivation')}</td></tr>
          <tr><th>経験値</th><td>${Math.floor(employee.experience || 0)}</td></tr>
        </table>
      </div>
    </div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-info btn-small"
        onclick="window.GameCallbacks?.handleTransfer?.(${employee.id}); window.UIModule?.hideModal?.('modal-employee-detail')">
        異動
      </button>
      <button class="btn btn-secondary btn-small"
        onclick="window.GameCallbacks?.openPositionModal?.(${employee.id}); window.UIModule?.hideModal?.('modal-employee-detail')">
        役職設定
      </button>
      <button class="btn btn-danger btn-small"
        onclick="if(confirm('${_escape(employee.name)} を退職させますか？')) { window.GameCallbacks?.handleRetire?.(${employee.id}); window.UIModule?.hideModal?.('modal-employee-detail'); }">
        退職
      </button>
    </div>`;
}

// ============================================================
// 通知
// ============================================================

/**
 * 画面右下に通知トーストを表示する
 *
 * @param {string} message - 通知メッセージ
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - 通知種別
 * @param {number} [duration=3000] - 表示時間（ミリ秒）
 * @returns {void}
 */
function showNotification(message, type = 'info', duration = 3000) {
  const area = document.getElementById('notification-area');
  if (!area) return;

  const existing = area.querySelectorAll('.notification');
  if (existing.length >= 5) existing[0].remove();

  const div = document.createElement('div');
  div.className = `notification notification-${type}`;
  div.textContent = message;
  area.appendChild(div);

  setTimeout(() => {
    div.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => div.remove(), 300);
  }, duration);
}

// ============================================================
// モジュール公開
// ============================================================

window.UIModule = {
  // 初期化
  init,

  // 画面制御
  showScreen,

  // 各画面描画
  renderDashboard,
  renderOrgChart,
  renderEmployeeList,
  renderHRActions,
  renderTurnScreen,
  renderProjectList,
  renderSettings,

  // 設定タブ切り替え
  switchSettingsTab,

  // 【2】年度切替
  switchDashboardYear,

  // 【7】グレード編集
  startGradeEdit(grade, state) {
    _editingGrade = grade;
    renderSettings(state);
  },
  cancelGradeEdit() {
    _editingGrade = null;
    if (window.gameState) renderSettings(window.gameState);
  },

  // 部門追加モーダル準備
  populateAddUnitModal: _populateAddUnitModal,

  // モーダル
  showModal,
  hideModal,

  // 通知
  showNotification,
};
