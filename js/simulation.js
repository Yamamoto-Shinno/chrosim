/**
 * simulation.js - 事業シミュレーション・年次決算
 * window.SimulationModule として公開
 *
 * 依存: data.js（DataModule）、org.js（OrgModule）
 * 読み込み順: data.js → org.js → simulation.js
 *
 * 足軽・参 実装担当箇所:
 *   - calcEmployeeRevenue()    : TODO参照
 *   - calcSalary()             : TODO参照
 *   - calcAnnualFinancials()   : TODO参照
 *   - applyExecutiveBuffs()    : TODO参照
 */

'use strict';

// ============================================================
// 定数定義
// ============================================================

/**
 * 固定費（万円/年）
 * 社員数・業績に依らず毎年かかるコスト
 */
const FIXED_COST = 5000;

/**
 * 難易度設定
 * revenueMultiplier: 売上への乗数
 */
const DIFFICULTY_SETTINGS = {
  easy:   { revenueMultiplier: 0.50, label: 'Easy（ゆったりプレイ）' },
  normal: { revenueMultiplier: 0.30, label: 'Normal（標準）' },
  hard:   { revenueMultiplier: 0.20, label: 'Hard（経営難）' },
};

// ============================================================
// 内部ユーティリティ
// ============================================================

function _clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

// ============================================================
// スパン・オブ・コントロール（管理適性人数）
// 中立範囲: 4〜12人（効果なし）
// 最適範囲: 6〜8人（ボーナス）
// 中立範囲外: ペナルティ（外れ具合に比例）
// ============================================================

const SOC_NEUTRAL_MIN = 4;
const SOC_NEUTRAL_MAX = 12;
const SOC_BONUS_MIN   = 6;
const SOC_BONUS_MAX   = 8;

/**
 * 指定した管理職（pos1保持者）の直属部下IDリストを返す。
 * 直属部下の定義:
 *   1. 同部門の pos2 保持者（副X長）
 *   2. 直属子部門の pos1 保持者（各子部門長）
 *      ただし pos2 と同一人物なら重複カウントしない
 *   3. 当該部門に直接所属する一般社員（子部門所属でも pos2 でもない）
 *
 * @param {number}   managerId
 * @param {Array}    orgUnits
 * @param {Array}    employees
 * @returns {number[]}
 */
function _getDirectReportIds(managerId, orgUnits, employees) {
  const reports = new Set();

  for (const unit of orgUnits) {
    if (unit.positionSlots?.[0]?.employeeId !== managerId) continue;

    // 1. pos2（副X長）
    const pos2Id = unit.positionSlots?.[1]?.employeeId;
    if (pos2Id && pos2Id !== managerId) {
      reports.add(pos2Id);
    }

    // 2. 直属子部門の pos1
    const childUnits = orgUnits.filter(c => c.parentId === unit.id);
    const childHeadIds = new Set();
    for (const child of childUnits) {
      const headId = child.positionSlots?.[0]?.employeeId;
      if (headId && headId !== managerId) {
        childHeadIds.add(headId);
        if (!reports.has(headId)) reports.add(headId); // pos2 と重複しない場合のみ追加
      }
    }

    // 3. 当該部門直属の一般社員（子部門ではなく unit.id に直接所属）
    for (const emp of employees) {
      if (emp.unitId !== unit.id) continue;
      if (emp.id === managerId) continue;
      if (pos2Id && emp.id === pos2Id) continue;   // pos2 は追加済み
      if (childHeadIds.has(emp.id)) continue;       // 子部門長は追加済み
      reports.add(emp.id);
    }
  }

  return [...reports];
}

/**
 * 全管理職のスパン・オブ・コントロールによるモチベーション変動量を計算する。
 * 正の値 = ボーナス、負の値 = ペナルティ。
 * @param {Array} orgUnits
 * @param {Array} employees
 * @returns {Map<number, number>}  employeeId → モチベーション変動量（符号付き）
 */
function _buildSocDeltaMap(orgUnits, employees) {
  const deltaMap = new Map();

  for (const unit of orgUnits) {
    const managerId = unit.positionSlots?.[0]?.employeeId;
    if (!managerId) continue;

    const directReports = _getDirectReportIds(managerId, orgUnits, employees);
    const count = directReports.length;

    if (count === 0) continue;

    if (count >= SOC_BONUS_MIN && count <= SOC_BONUS_MAX) {
      // 最適範囲（6〜8人）: ボーナス
      deltaMap.set(managerId, (deltaMap.get(managerId) || 0) + 3);
      for (const subId of directReports) {
        deltaMap.set(subId, (deltaMap.get(subId) || 0) + 2);
      }
    } else if (count < SOC_NEUTRAL_MIN) {
      // 少なすぎ（≤3人）: ペナルティ
      const deviation = SOC_NEUTRAL_MIN - count;
      const mgrPenalty = Math.min(deviation * 2, 10);
      const subPenalty = Math.min(deviation * 2, 5);
      deltaMap.set(managerId, (deltaMap.get(managerId) || 0) - mgrPenalty);
      for (const subId of directReports) {
        deltaMap.set(subId, (deltaMap.get(subId) || 0) - subPenalty);
      }
    } else if (count > SOC_NEUTRAL_MAX) {
      // 多すぎ（≥13人）: ペナルティ
      const deviation = count - SOC_NEUTRAL_MAX;
      const mgrPenalty = Math.min(deviation * 2, 10);
      const subPenalty = Math.min(deviation, 5);
      deltaMap.set(managerId, (deltaMap.get(managerId) || 0) - mgrPenalty);
      for (const subId of directReports) {
        deltaMap.set(subId, (deltaMap.get(subId) || 0) - subPenalty);
      }
    }
    // 中立範囲（4〜5人 or 9〜12人）: 変動なし
  }

  return deltaMap;
}

/**
 * 当期の採用コストを計算する
 * 当期採用者（hireYear === currentYear）のグレード年俸 × 採用コスト率
 *
 * @param {Employee[]} employees - 全社員リスト
 * @param {number}     currentYear - 現在年度
 * @param {Position[]} positions   - 役職リスト
 * @param {number}     costRate    - 採用コスト率（0.30〜0.35）
 * @returns {number} 採用コスト合計（万円）
 */
function calcHiringCost(employees, currentYear, positions, costRate) {
  const newHires = employees.filter(e => e.hireYear === currentYear);
  let total = 0;
  for (const emp of newHires) {
    const salary = calcSalary(emp, positions);
    total += Math.round(salary * costRate);
  }
  return total;
}

// ============================================================
// 関数定義
// ============================================================

/**
 * 社員1人の年間売上寄与額を計算する
 *
 * @param {Employee} employee - 社員オブジェクト（DataModule.createEmployee の戻り値）
 * @returns {number} 売上寄与額（万円、小数点以下あり）
 *
 * 計算式（仕様確定）:
 *   score = (technical × 0.5 + communication × 0.3 + leadership × 0.2)
 *           × (motivation / 100)
 *           × (1 + experience / 500)
 *           × 職種係数（DataModule.JOB_TYPES[jobType].coefficient）
 */
function calcEmployeeRevenue(employee) {
  const JOB_TYPES = window.DataModule?.JOB_TYPES || {};
  const coeff     = JOB_TYPES[employee.jobType]?.coefficient || 0;
  const exp       = employee.experience || 0;

  const skillScore = employee.technical     * 0.5
                   + employee.communication * 0.3
                   + employee.leadership    * 0.2;

  return skillScore
    * (employee.motivation / 100)
    * (1 + exp / 500)
    * coeff;
}

/**
 * 社員1人の年間人件費（グレード給与 + 役職手当合計）を計算する
 *
 * @param {Employee}   employee  - 社員オブジェクト
 * @param {Position[]} positions - 全役職リスト（GameState.positions）
 * @returns {number} 年間人件費（万円）
 *
 * 計算式:
 *   人件費 = GRADE_DEFINITIONS[grade].baseAnnualSalary
 *            + Σ positions.find(p => p.id === posId).allowance
 *              （employee.positionIds の各役職手当を合算）
 */
function calcSalary(employee, positions) {
  const baseSalary = window.DataModule?.getGradeSalary(employee.grade) || 0;

  let allowanceTotal = 0;
  for (const posId of (employee.positionIds || [])) {
    const pos = (positions || []).find(p => p.id === posId);
    if (pos) allowanceTotal += (pos.allowance || 0) * 12;
  }

  return baseSalary + allowanceTotal;
}

/**
 * 年次決算計算
 *
 * @param {GameState} gameState - ゲーム状態オブジェクト
 * @returns {AnnualFinancials} 年次財務計算結果
 */
function calcAnnualFinancials(gameState) {
  const year      = gameState.currentYear;
  const employees = gameState.employees || [];
  const orgUnits  = gameState.orgUnits  || [];
  const locations = gameState.locations || [];
  const positions = gameState.positions || [];
  const board     = gameState.board     || [];

  const events = [];

  // 難易度係数
  const difficulty = gameState.difficulty || 'normal';
  const diffMultiplier = (window.SimulationModule?.DIFFICULTY_SETTINGS || DIFFICULTY_SETTINGS)[difficulty]?.revenueMultiplier ?? 0.30;

  // 季節変動（±10%）
  const seasonalMultiplier = 0.90 + Math.random() * 0.20;

  // --- 拠点超過ペナルティマップを事前計算 ---
  const locationEmployeeCountMap = {};
  for (const emp of employees) {
    const unit = orgUnits.find(u => u.id === emp.unitId);
    if (!unit || !unit.locationId) continue;
    locationEmployeeCountMap[unit.locationId] =
      (locationEmployeeCountMap[unit.locationId] || 0) + 1;
  }

  const locationPenaltyMap = {};
  for (const loc of locations) {
    const count = locationEmployeeCountMap[loc.id] || 0;
    locationPenaltyMap[loc.id] =
      window.OrgModule?.calcOvercapacityMotivationPenalty(loc, count) || 0;
  }

  // --- スパン・オブ・コントロール変動マップを事前計算 ---
  const socDeltaMap = _buildSocDeltaMap(orgUnits, employees);

  // --- 1. 年次ステータス変動 ---
  for (const emp of employees) {
    const unit = orgUnits.find(u => u.id === emp.unitId);
    const locPenalty = (unit && unit.locationId)
      ? (locationPenaltyMap[unit.locationId] || 0)
      : 0;
    const concurrentRoleBonus = (emp.positionIds?.length || 0) >= 2;
    const spanOfControlDelta  = socDeltaMap.get(emp.id) || 0;

    window.DataModule?.applyYearlyStatusChange(emp, {
      overcapacityPenalty: locPenalty,
      concurrentRoleBonus,
      spanOfControlDelta,
    });
  }

  // --- 2. 定年退職（80歳以上） ---
  const retiredEmployees  = [];
  const survivingEmployees = [];

  for (const emp of employees) {
    if (emp.age >= 80) {
      emp.retiredYear   = year;
      emp.retiredReason = 'mandatory';
      gameState.retiredEmployees = gameState.retiredEmployees || [];
      gameState.retiredEmployees.push(emp);
      retiredEmployees.push(emp);
      events.push({
        type:       'retire',
        message:    `${emp.name}（${emp.age}歳）が定年退職しました`,
        employeeId: emp.id,
      });
      if (emp.unitId) {
        const unit = orgUnits.find(u => u.id === emp.unitId);
        if (unit) unit.employeeIds = unit.employeeIds.filter(id => id !== emp.id);
      }
    } else {
      survivingEmployees.push(emp);
    }
  }
  gameState.employees = survivingEmployees;

  // --- 3. 自動離職（低モチベーション社員） ---
  const resignedEmployees = [];
  const afterResignEmployees = [];

  for (const emp of gameState.employees) {
    // isExecutive フラグがある社員は離職対象外
    if (emp.isExecutive) { afterResignEmployees.push(emp); continue; }

    let resignChance = 0;
    if (emp.motivation <= 20) resignChance = 0.40;
    else if (emp.motivation <= 30) resignChance = 0.20;
    else if (emp.motivation <= 40) resignChance = 0.05;

    if (resignChance > 0 && Math.random() < resignChance) {
      emp.retiredYear   = year;
      emp.retiredReason = 'voluntary_resign';
      gameState.retiredEmployees = gameState.retiredEmployees || [];
      gameState.retiredEmployees.push(emp);
      resignedEmployees.push(emp);
      events.push({
        type:       'resign',
        message:    `${emp.name}（モチベ${emp.motivation}）が自主退職しました`,
        employeeId: emp.id,
      });
      // 部門・ボードから除去
      if (emp.unitId) {
        const unit = orgUnits.find(u => u.id === emp.unitId);
        if (unit) unit.employeeIds = unit.employeeIds.filter(id => id !== emp.id);
      }
      gameState.board = (gameState.board || []).filter(b => b.employeeId !== emp.id);
      gameState.executiveOfficers = (gameState.executiveOfficers || []).filter(eo => eo.employeeId !== emp.id);
    } else {
      afterResignEmployees.push(emp);
    }
  }
  gameState.employees = afterResignEmployees;

  // --- 4. 自動昇格処理（G1〜G5） ---
  const GRADE_ORDER = window.DataModule?.GRADE_ORDER || [];
  for (const emp of gameState.employees) {
    if (window.DataModule?.calcAutoPromotion(emp)) {
      const currentIndex = GRADE_ORDER.indexOf(emp.grade);
      if (currentIndex >= 0 && currentIndex < GRADE_ORDER.length - 1) {
        const oldGrade = emp.grade;
        emp.grade      = GRADE_ORDER[currentIndex + 1];
        emp.motivation = Math.min(100, (emp.motivation || 50) + 15);
        events.push({
          type:       'promote',
          message:    `${emp.name} が ${oldGrade} → ${emp.grade} に自動昇格しました`,
          employeeId: emp.id,
        });
      }
    }
  }

  // --- 5. 売上計算 ---
  let revenueRaw = 0;
  const revenueByJobType = {};
  for (const emp of gameState.employees) {
    const contribution = calcEmployeeRevenue(emp);
    revenueRaw += contribution;
    revenueByJobType[emp.jobType] = (revenueByJobType[emp.jobType] || 0) + contribution;
  }
  // 難易度・季節変動を適用
  let revenue = Math.round(revenueRaw * diffMultiplier * seasonalMultiplier);
  for (const k of Object.keys(revenueByJobType)) {
    revenueByJobType[k] = Math.round(revenueByJobType[k] * diffMultiplier * seasonalMultiplier);
  }

  // --- 6. 人件費計算 ---
  const unitCostTypeMap = {};
  for (const u of orgUnits) {
    unitCostTypeMap[u.id] = u.costType || 'sga';
  }

  let laborCostCogs = 0;
  let laborCostSga  = 0;
  const laborCostByUnit = {};

  for (const emp of gameState.employees) {
    const salary   = calcSalary(emp, positions);
    const costType = emp.unitId ? (unitCostTypeMap[emp.unitId] || 'sga') : 'sga';
    if (costType === 'cogs') {
      laborCostCogs += salary;
    } else {
      laborCostSga  += salary;
    }
    laborCostByUnit[emp.unitId || 'unassigned'] =
      (laborCostByUnit[emp.unitId || 'unassigned'] || 0) + salary;
  }
  const laborCostTotal = laborCostCogs + laborCostSga;

  // --- 7. 拠点維持費 ---
  let locationCostTotal = 0;
  for (const loc of locations) {
    locationCostTotal += window.OrgModule?.calcLocationCost(loc) || 0;
  }

  // --- 8. 役員報酬 ---
  let executiveCompTotal = 0;
  for (const boardMember of board) {
    executiveCompTotal += boardMember.compensation || 0;
  }

  // --- 9. 執行役員手当 ---
  let executiveOfficerCompTotal = 0;
  const executiveOfficers = gameState.executiveOfficers || [];
  for (const eo of executiveOfficers) {
    executiveOfficerCompTotal += (eo.compensation || 0) * 12; // 月額 × 12
  }

  // --- 10. 採用コスト ---
  const hiringCostRate = 0.30 + Math.random() * 0.05; // 30〜35%
  const hiringCost = calcHiringCost(gameState.employees, year, positions, hiringCostRate);

  // --- 11. 研修コスト ---
  let trainingCost = 0;
  const currentTrainings = gameState.currentTrainings || [];
  for (const t of currentTrainings) {
    if (t.status === 'executed') {
      trainingCost += (t.totalCost || 0);
    }
  }

  // --- 12. 費用合計・利益計算（バフ前） ---
  const totalCost = laborCostTotal + locationCostTotal + executiveCompTotal
                  + executiveOfficerCompTotal + FIXED_COST + hiringCost + trainingCost;
  const profitBeforeBuffs = revenue - totalCost;

  // --- 財務オブジェクト構築 ---
  const financials = {
    year,
    revenue,
    revenueBeforeMultiplier: Math.round(revenueRaw),
    laborCostCogs,
    laborCostSga,
    laborCostTotal,
    locationCostTotal,
    executiveCompTotal,
    executiveOfficerCompTotal,
    fixedCost:        FIXED_COST,
    hiringCost,
    trainingCost,
    totalCost,
    profitBeforeBuffs,
    profitAfterBuffs: profitBeforeBuffs,
    revenueByJobType,
    laborCostByUnit,
    retiredEmployees,
    resignedEmployees,
    events,
    buffsApplied:     [],
    seasonalMultiplier: Math.round(seasonalMultiplier * 100) / 100,
    difficulty,
    hiringCostRate:   Math.round(hiringCostRate * 1000) / 1000,
  };

  // --- 13. 役員バフ適用 ---
  applyExecutiveBuffs(financials, board);

  // --- 14. 執行役員バフ適用 ---
  applyExecutiveOfficerBuffs(financials, executiveOfficers, gameState.employees);

  return financials;
}

/**
 * 役員バフを財務計算結果に適用する
 *
 * @param {AnnualFinancials} financials  - calcAnnualFinancials() の戻り値（直接変更）
 * @param {BoardMember[]}    boardMembers - GameState.board
 * @returns {AnnualFinancials} バフ適用後の financials（同一オブジェクトを返す）
 *
 * バフ処理仕様（DataModule.EXECUTIVE_ROLES[role].buff を参照）:
 *   buff.type = 'revenue_pct'          → financials.revenue を (1 + value) 倍
 *   buff.type = 'cost_pct'             → 全費用項目を (1 + value) 倍
 *   buff.type = 'cost_labor_pct'       → laborCostCogs + laborCostSga を (1 + value) 倍
 *   buff.type = 'cost_cogs_labor_pct'  → laborCostCogs のみ (1 + value) 倍
 *   buff.type = 'cost_sga_labor_pct'   → laborCostSga  のみ (1 + value) 倍
 * バフ適用後:
 *   laborCostTotal を再計算
 *   totalCost を laborCostTotal + locationCostTotal + executiveCompTotal + fixedCost で再計算
 *   profitAfterBuffs = revenue - totalCost
 */
function applyExecutiveBuffs(financials, boardMembers) {
  const EXECUTIVE_ROLES = window.DataModule?.EXECUTIVE_ROLES || {};

  for (const member of (boardMembers || [])) {
    if (!member.role) continue;
    const roleDef = EXECUTIVE_ROLES[member.role];
    if (!roleDef || !roleDef.buff) continue;

    const { type, value } = roleDef.buff;
    const mult = 1 + value;

    switch (type) {
      case 'revenue_pct':
        financials.revenue = Math.round(financials.revenue * mult);
        financials.buffsApplied.push({
          role: member.role, type, value,
          description: `売上 × ${mult}`,
        });
        break;

      case 'cost_pct':
        // 全費用項目に同率を適用
        financials.laborCostCogs      = Math.round(financials.laborCostCogs      * mult);
        financials.laborCostSga       = Math.round(financials.laborCostSga       * mult);
        financials.locationCostTotal  = Math.round(financials.locationCostTotal  * mult);
        financials.executiveCompTotal = Math.round(financials.executiveCompTotal * mult);
        financials.fixedCost          = Math.round(financials.fixedCost          * mult);
        financials.buffsApplied.push({
          role: member.role, type, value,
          description: `全費用 × ${mult}`,
        });
        break;

      case 'cost_labor_pct':
        financials.laborCostCogs = Math.round(financials.laborCostCogs * mult);
        financials.laborCostSga  = Math.round(financials.laborCostSga  * mult);
        financials.buffsApplied.push({
          role: member.role, type, value,
          description: `人件費全体 × ${mult}`,
        });
        break;

      case 'cost_cogs_labor_pct':
        financials.laborCostCogs = Math.round(financials.laborCostCogs * mult);
        financials.buffsApplied.push({
          role: member.role, type, value,
          description: `原価人件費 × ${mult}`,
        });
        break;

      case 'cost_sga_labor_pct':
        financials.laborCostSga = Math.round(financials.laborCostSga * mult);
        financials.buffsApplied.push({
          role: member.role, type, value,
          description: `販管人件費 × ${mult}`,
        });
        break;

      default:
        // 未知のバフタイプは無視
        break;
    }
  }

  // laborCostTotal 再計算
  financials.laborCostTotal = financials.laborCostCogs + financials.laborCostSga;

  // totalCost 再計算
  financials.totalCost = financials.laborCostTotal
    + financials.locationCostTotal
    + financials.executiveCompTotal
    + financials.fixedCost;

  // バフ適用後利益
  financials.profitAfterBuffs = financials.revenue - financials.totalCost;

  return financials;
}

/**
 * 執行役員バフを財務計算結果に適用する
 * バフ = 基準レート × (モチベーション / 100)
 *   上席執行役員: 基準レート 2%
 *   執行役員:     基準レート 1%
 *
 * @param {AnnualFinancials} financials
 * @param {Array}            executiveOfficers - gameState.executiveOfficers
 * @param {Employee[]}       employees
 * @returns {AnnualFinancials}
 */
function applyExecutiveOfficerBuffs(financials, executiveOfficers, employees) {
  if (!executiveOfficers || executiveOfficers.length === 0) return financials;
  for (const eo of executiveOfficers) {
    const emp = employees.find(e => e.id === eo.employeeId);
    if (!emp) continue;
    const baseRate  = eo.type === 'senior' ? 0.02 : 0.01;
    const buffValue = baseRate * (emp.motivation / 100);
    const buffAmount = Math.round(financials.revenue * buffValue);
    financials.revenue += buffAmount;
    financials.buffsApplied = financials.buffsApplied || [];
    financials.buffsApplied.push({
      role: `執行役員(${eo.type === 'senior' ? '上席' : '通常'})`,
      type: 'revenue_eo',
      value: buffValue,
      description: `${emp.name} 売上+${Math.round(buffValue * 100 * 10) / 10}%（モチベ${emp.motivation}）`,
    });
  }
  // profitAfterBuffs を再計算
  financials.profitAfterBuffs = financials.revenue - financials.totalCost;
  return financials;
}

// ============================================================
// モジュール公開
// ============================================================

window.SimulationModule = {
  // 定数
  FIXED_COST,
  DIFFICULTY_SETTINGS,

  // 関数
  calcEmployeeRevenue,
  calcSalary,
  calcHiringCost,
  calcAnnualFinancials,
  applyExecutiveBuffs,
  applyExecutiveOfficerBuffs,
};
