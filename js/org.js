/**
 * org.js - 組織構造・役職・拠点システム
 * window.OrgModule として公開
 *
 * 依存: data.js（DataModule）
 * 読み込み順: data.js → org.js
 *
 * 足軽・弐 実装担当箇所:
 *   - createOrgUnit()                      : TODO参照
 *   - createPosition()                     : TODO参照
 *   - createLocation()                     : TODO参照
 *   - getOrgTree()                         : TODO参照
 *   - getUnitsByLevel()                    : TODO参照
 *   - getPositionsForLevel()               : TODO参照
 *   - calcLocationCost()                   : TODO参照
 *   - calcOvercapacityMotivationPenalty()  : TODO参照
 */

'use strict';

// ============================================================
// 定数定義
// ============================================================

/**
 * 地域区分と年間維持費（万円/年・50人あたり）
 * @type {Object.<string, {label: string, annualCostPer50: number}>}
 */
const REGION_TYPES = {
  metropolitan: { label: '首都圏',     annualCostPer50: 2500 },
  urban:        { label: '地方都市圏', annualCostPer50: 1500 },
  rural:        { label: '地方圏',     annualCostPer50:  800 },
};

/**
 * 拠点定員の単位
 * 定員は 50 の倍数で設定する
 */
const LOCATION_CAPACITY_UNIT = 50;

/**
 * 定員超過ペナルティ設定
 * 超過率10%ごとにその拠点所属社員のモチベーション -2（上限 -20）
 */
const OVERCAPACITY_PENALTY = {
  perTenPercent: -2,
  maxPenalty:    -20,
};

/**
 * 部門種別定義（部門設定のデフォルト）
 * levelNum: 部門の階層番号（1〜5）
 * pos1Name: 部門管理者役職1の名称（null=なし）
 * pos2Name: 部門管理者役職2の名称（null=なし）
 * displayOrder: 表示順
 */
const UNIT_TYPE_DEFS = [
  { id: 'ut_tokkatsu_honbu', name: '統括本部', levelNum: 1, pos1Name: '統括本部長', pos2Name: null,          displayOrder: 11 },
  { id: 'ut_jigyo_honbu',   name: '事業本部', levelNum: 1, pos1Name: '事業本部長', pos2Name: null,          displayOrder: 12 },
  { id: 'ut_honbu',         name: '本部',     levelNum: 2, pos1Name: '本部長',     pos2Name: '副本部長',    displayOrder: 21 },
  { id: 'ut_jigyo_bu',      name: '事業部',   levelNum: 2, pos1Name: '事業部長',   pos2Name: '副事業部長',  displayOrder: 22 },
  { id: 'ut_shisha',        name: '支社',     levelNum: 3, pos1Name: '支社長',     pos2Name: '副支社長',    displayOrder: 31 },
  { id: 'ut_kojo',          name: '工場',     levelNum: 3, pos1Name: '工場長',     pos2Name: '副工場長',    displayOrder: 32 },
  { id: 'ut_bu',            name: '部',       levelNum: 4, pos1Name: '部長',       pos2Name: '副部長',      displayOrder: 41 },
  { id: 'ut_ka',            name: '課',       levelNum: 5, pos1Name: '課長',       pos2Name: null,          displayOrder: 51 },
  { id: 'ut_shitsu',        name: '室',       levelNum: 5, pos1Name: '室長',       pos2Name: null,          displayOrder: 52 },
];

/**
 * 部門階層番号ごとの役職月額手当（万円/月）
 */
const UNIT_LEVEL_ALLOWANCES = {
  1: 25,
  2: 20,
  3: 15,
  4: 10,
  5: 5,
};

/**
 * 階層レベル（1〜5）の表示名
 * @type {Object.<number, string>}
 */
const LEVEL_LABELS = {
  1: '本部',
  2: '部',
  3: '課',
  4: 'チーム',
  5: 'グループ',
};

/**
 * 階層番号から部門種別名ラベルを返す（UNIT_TYPE_DEFS の最初のエントリを使用）
 * @param {number} levelNum - 1〜5
 * @returns {string}
 */
function getLevelLabel(levelNum) {
  const matches = UNIT_TYPE_DEFS.filter(d => d.levelNum === levelNum);
  if (matches.length === 0) return `Lv.${levelNum}`;
  return matches[0].name;
}

/**
 * 初期組織定義（新仕様: 最大5階層・costType・locationId付き）
 * main.js の initGame() から参照して GameState に展開する。
 *
 * OrgUnit 型定義（GameState.orgUnits のフラットリストに格納）:
 * {
 *   id:            string,
 *   name:          string,
 *   level:         number,        // 1〜5
 *   parentId:      string|null,
 *   costType:      'cogs'|'sga',  // 原価部門 or 販管部門
 *   locationId:    string|null,   // 拠点ID
 *   positionSlots: string[],      // 役職スロット（最大2件、役職IDを格納）
 *   employeeIds:   number[],      // 所属社員IDリスト
 * }
 *
 * @type {Array}
 */
const INITIAL_ORG = [
  // ── 取締役室（ルート・level=0）──────────────────────────────
  {
    id: 'unit_torishimariyaku',
    name: '取締役室',
    level: 0,
    parentId: null,
    costType: 'sga',
    locationId: 'loc_tokyo',
    positionSlots: [],
    isBoard: true,
    children: [

      // ── 営業部（level=1, 部）──────────────────────────────
      {
        id: 'unit_sales_bu', name: '営業部', level: 1,
        unitTypeId: 'ut_bu', costType: 'sga', locationId: 'loc_tokyo',
        positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
        children: [
          {
            id: 'unit_sales_1ka', name: '第一課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
          {
            id: 'unit_sales_2ka', name: '第二課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
        ],
      },

      // ── マーケティング部（level=1, 部）────────────────────
      {
        id: 'unit_mktg_bu', name: 'マーケティング部', level: 1,
        unitTypeId: 'ut_bu', costType: 'sga', locationId: 'loc_tokyo',
        positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
        children: [
          {
            id: 'unit_mktg_ka', name: 'マーケティング課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
        ],
      },

      // ── 開発部（level=1, 部）──────────────────────────────
      {
        id: 'unit_dev_bu', name: '開発部', level: 1,
        unitTypeId: 'ut_bu', costType: 'cogs', locationId: 'loc_tokyo',
        positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
        children: [
          {
            id: 'unit_dev_1ka', name: '第一課', level: 2,
            unitTypeId: 'ut_ka', costType: 'cogs', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
          {
            id: 'unit_dev_2ka', name: '第二課', level: 2,
            unitTypeId: 'ut_ka', costType: 'cogs', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
        ],
      },

      // ── 運用部（level=1, 部）──────────────────────────────
      {
        id: 'unit_ops_bu', name: '運用部', level: 1,
        unitTypeId: 'ut_bu', costType: 'cogs', locationId: 'loc_tokyo',
        positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
        children: [
          {
            id: 'unit_ops_ka', name: '運用課', level: 2,
            unitTypeId: 'ut_ka', costType: 'cogs', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
        ],
      },

      // ── 経営管理部（level=1, 部）──────────────────────────
      {
        id: 'unit_kanri_bu', name: '経営管理部', level: 1,
        unitTypeId: 'ut_bu', costType: 'sga', locationId: 'loc_tokyo',
        positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
        children: [
          {
            id: 'unit_finance_ka', name: '財務経理課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
          {
            id: 'unit_legal_ka', name: '法務課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
          {
            id: 'unit_hr_ka', name: '人事課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
          {
            id: 'unit_is_ka', name: '情報システム課', level: 2,
            unitTypeId: 'ut_ka', costType: 'sga', locationId: 'loc_tokyo',
            positionSlots: [{ slotIndex: 0, positionId: null, employeeId: null }, { slotIndex: 1, positionId: null, employeeId: null }],
            children: [],
          },
        ],
      },

    ],
  },
];

/**
 * 初期拠点定義
 * @type {Array}
 */
const INITIAL_LOCATIONS = [{
  id: 'loc_tokyo',
  name: '東京本社',
  regionType: 'metropolitan',
  capacity: 200
}];

/**
 * 初期役職定義
 * Position 型定義:
 * {
 *   id:        string,
 *   name:      string,
 *   level:     number,   // 対応する組織階層レベル（1〜5）
 *   allowance: number,   // 標準役職手当（万円/月）※simulation.js で ×12 して年額換算
 * }
 * @type {Array}
 */
// INITIAL_POSITIONSをUNIT_TYPE_DEFSから自動生成
const INITIAL_POSITIONS = (function() {
  const positions = [];
  for (const def of UNIT_TYPE_DEFS) {
    const allowance = UNIT_LEVEL_ALLOWANCES[def.levelNum] || 5;
    if (def.pos1Name) {
      positions.push({
        id:           `pos_${def.id}_1`,
        name:         def.pos1Name,
        level:        def.levelNum,
        allowance:    allowance,
        displayOrder: def.displayOrder,
        unitTypeId:   def.id,
        slotIndex:    0,
      });
    }
    if (def.pos2Name) {
      positions.push({
        id:           `pos_${def.id}_2`,
        name:         def.pos2Name,
        level:        def.levelNum,
        allowance:    allowance,
        displayOrder: def.displayOrder + 0.5,
        unitTypeId:   def.id,
        slotIndex:    1,
      });
    }
  }
  return positions;
})();

// ============================================================
// 内部ユーティリティ
// ============================================================

function _generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

// ============================================================
// 関数定義（骨格＋シグネチャ）
// ============================================================

/**
 * 部門オブジェクトを生成する（GameState.orgUnits に追加する前のファクトリ）
 *
 * @param {Object} params
 * @param {string}       [params.id]         - ID（省略時は自動生成）
 * @param {string}       params.name         - 部門名
 * @param {number}       params.level        - 階層レベル 1〜5
 * @param {string|null}  [params.parentId]   - 親部門ID
 * @param {'cogs'|'sga'} [params.costType]   - 原価/販管（省略時 'sga'）
 * @param {string|null}  [params.locationId] - 紐付け拠点ID
 * @returns {OrgUnit} 部門オブジェクト
 *
 * TODO（足軽・弐）: バリデーション実装
 *   - level は 1〜5 の整数であること
 *   - costType は 'cogs' または 'sga' であること
 *   - positionSlots は [null, null] で初期化
 *   - employeeIds は [] で初期化
 */
function createOrgUnit(params) {
  if (!params.name) throw new Error('createOrgUnit: name は必須です');
  if (params.level === undefined || params.level === null ||
      params.level < 0 || params.level > 5 || !Number.isInteger(params.level)) {
    throw new Error('createOrgUnit: level は 0〜5 の整数が必要です');
  }
  const costType = params.costType || 'sga';
  if (costType !== 'cogs' && costType !== 'sga') {
    throw new Error("createOrgUnit: costType は 'cogs' または 'sga' である必要があります");
  }
  const parentId = (params.parentId !== undefined ? params.parentId : null);
  if (params.level === 0 && parentId !== null) {
    throw new Error('createOrgUnit: level=0（取締役室）のユニットは parentId が null である必要があります');
  }

  return {
    id:            params.id || _generateId('unit'),
    name:          params.name,
    level:         params.level,
    parentId:      parentId,
    costType:      costType,
    locationId:    params.locationId || null,
    unitTypeId:    params.unitTypeId || null,
    positionSlots: [
      { slotIndex: 0, positionId: null, employeeId: null },
      { slotIndex: 1, positionId: null, employeeId: null },
    ],
    children:    [],
    employeeIds: [],
  };
}

/**
 * 役職オブジェクトを生成する（GameState.positions に追加する前のファクトリ）
 *
 * @param {Object} params
 * @param {string} [params.id]        - ID（省略時自動生成）
 * @param {string} params.name        - 役職名
 * @param {number} params.level       - 対応する組織階層レベル（1〜5）
 * @param {number} [params.allowance] - 役職手当（万円/年）デフォルト 0
 * @returns {Position} 役職オブジェクト
 *
 * TODO（足軽・弐）: バリデーション実装
 *   - name は空文字列不可
 *   - level は 1〜5
 *   - allowance は 0 以上
 */
function createPosition(params) {
  if (!params.name) throw new Error('createPosition: name は必須です');
  if (params.level === undefined || params.level === null ||
      params.level < 1 || params.level > 5 || !Number.isInteger(params.level)) {
    throw new Error('createPosition: level は 1〜5 の整数が必要です');
  }
  const allowance = (params.allowance !== undefined ? params.allowance : 0);
  if (allowance < 0) throw new Error('createPosition: allowance は 0 以上の値が必要です');

  return {
    id:           params.id || _generateId('pos'),
    name:         params.name,
    level:        params.level,
    allowance:    allowance,
    displayOrder: params.displayOrder ?? 99,
  };
}

/**
 * 拠点オブジェクトを生成する（GameState.locations に追加する前のファクトリ）
 *
 * @param {Object} params
 * @param {string}  [params.id]           - ID（省略時自動生成）
 * @param {string}  params.name           - 拠点名
 * @param {string}  [params.regionType]   - 地域区分キー（REGION_TYPES のキー）デフォルト 'metropolitan'
 * @param {number}  [params.capacity]     - 定員（50の倍数）デフォルト 50
 * @returns {Location} 拠点オブジェクト
 *
 * TODO（足軽・弐）: バリデーション実装
 *   - capacity は LOCATION_CAPACITY_UNIT（50）の倍数であること
 *   - regionType は REGION_TYPES のキーであること
 */
function createLocation(params) {
  if (!params.name) throw new Error('createLocation: name は必須です');

  const regionType = params.regionType || 'metropolitan';
  if (!REGION_TYPES[regionType]) {
    throw new Error('createLocation: regionType は ' + Object.keys(REGION_TYPES).join('/') + ' のいずれかである必要があります');
  }

  const rawCapacity = (params.capacity !== undefined ? params.capacity : LOCATION_CAPACITY_UNIT);
  const capacity = Math.max(LOCATION_CAPACITY_UNIT, Math.round(rawCapacity / LOCATION_CAPACITY_UNIT) * LOCATION_CAPACITY_UNIT);

  return {
    id:         params.id || _generateId('loc'),
    name:       params.name,
    regionType: regionType,
    capacity:   capacity,
  };
}

/**
 * フラットな orgUnits リストからツリー構造を生成する
 *
 * @param {OrgUnit[]} units - GameState.orgUnits（フラットリスト）
 * @returns {OrgTreeNode[]} ルートノード配列
 *
 * OrgTreeNode 型定義:
 * {
 *   ...OrgUnit,
 *   children:      OrgTreeNode[],
 *   employeeCount: number,  // 子孫ユニット含む合計社員数
 * }
 *
 * TODO（足軽・弐）: 実装方針
 *   1. parentId === null のノードがルート
 *   2. 再帰で children を組み立てる
 *   3. employeeCount = 自ユニットの employeeIds.length + 子孫の合計
 *   4. level 順（昇順）でソートすること
 */
function getOrgTree(units) {
  // 配列内インデックスマップ（handleReorderUnit が制御する並び順を尊重する）
  const idxMap = new Map(units.map((u, i) => [u.id, i]));

  function buildNode(unit) {
    const children = units
      .filter(u => u.parentId === unit.id)
      .sort((a, b) => (idxMap.get(a.id) ?? Infinity) - (idxMap.get(b.id) ?? Infinity))
      .map(u => buildNode(u));

    const childEmployeeCount = children.reduce((sum, c) => sum + c.employeeCount, 0);

    return {
      ...unit,
      children,
      employeeCount: (unit.employeeIds || []).length + childEmployeeCount,
    };
  }

  return units
    .filter(u => u.parentId === null)
    .sort((a, b) => {
      // isBoard=true（取締役室）を常に先頭に配置する
      if (a.isBoard && !b.isBoard) return -1;
      if (!a.isBoard && b.isBoard) return 1;
      return (idxMap.get(a.id) ?? Infinity) - (idxMap.get(b.id) ?? Infinity);
    })
    .map(u => buildNode(u));
}

/**
 * 階層レベルで部門リストを絞り込む
 *
 * @param {OrgUnit[]} units - フラットな部門リスト
 * @param {number}    level - 階層レベル（1〜5）
 * @returns {OrgUnit[]} 該当レベルの部門リスト
 *
 * TODO（足軽・弐）: units.filter で level === level のものを返すだけでOK
 */
function getUnitsByLevel(units, level) {
  // TODO（足軽・弐）: 実装
  return units.filter(u => u.level === level);
}

/**
 * 階層レベルに応じた役職候補リストを返す
 *
 * @param {Position[]} positions - 全役職リスト（GameState.positions）
 * @param {number}     level     - 組織階層レベル（1〜5）
 * @returns {Position[]} そのレベルで設定可能な役職リスト
 *
 * TODO（足軽・弐）: positions.filter(p => p.level === level) を返す
 *   補足: UI で部門の役職スロット編集時に呼び出す
 */
function getPositionsForLevel(positions, level) {
  // TODO（足軽・弐）: 実装
  return positions.filter(p => p.level === level);
}

/**
 * 拠点の年間維持費を計算する
 *
 * @param {Location} location - 拠点オブジェクト
 * @returns {number} 年間維持費（万円）
 *
 * 計算式:
 *   維持費 = REGION_TYPES[regionType].annualCostPer50 × (capacity / 50)
 *
 * TODO（足軽・弐）: 実装
 *   例: 首都圏・定員200人 → 2500 × (200/50) = 10000万円
 */
function calcLocationCost(location) {
  if (!location || location.capacity <= 0) return 0;

  const regionDef = REGION_TYPES[location.regionType];
  if (!regionDef) return 0;

  const unitCount = location.capacity / LOCATION_CAPACITY_UNIT;
  return regionDef.annualCostPer50 * unitCount;
}

/**
 * 定員超過時のモチベーションペナルティを計算する
 *
 * @param {Location} location      - 拠点オブジェクト
 * @param {number}   employeeCount - その拠点に所属する社員数
 * @returns {number} モチベーションペナルティ（0以下の整数、下限 -20）
 *
 * 計算式:
 *   超過率 = (employeeCount - capacity) / capacity
 *   超過率 <= 0 の場合: 0（ペナルティなし）
 *   超過率 > 0 の場合: floor(超過率 / 0.10) × (-2)
 *   下限: -20
 *
 * TODO（足軽・弐）: 実装
 *   例: 定員100・社員125人 → 超過率25% → floor(0.25/0.10)=2 → -4
 *   例: 定員100・社員160人 → 超過率60% → floor(0.60/0.10)=6 → -12
 *   例: 定員100・社員220人 → 超過率120% → floor(1.20/0.10)=12 → -24 → 上限 -20
 */
function calcOvercapacityMotivationPenalty(location, employeeCount) {
  if (!location || employeeCount <= location.capacity) return 0;

  const overcapacityRate = (employeeCount - location.capacity) / location.capacity;
  // Math.ceil を使用し、超過率 10% ごとにペナルティを加算
  const steps = Math.ceil(overcapacityRate / 0.1);
  // 正の整数で返す（UIでモチベから引く用）
  const penalty = Math.min(20, steps * 2);

  return penalty;
}

/**
 * INITIAL_ORG の入れ子構造を GameState.orgUnits 用のフラットリストに展開するユーティリティ
 *
 * @param {Array}        orgDefs  - INITIAL_ORG のような入れ子構造
 * @param {string|null}  parentId - 親ユニットID（ルート呼び出し時は null）
 * @returns {OrgUnit[]} フラットなOrgUnitリスト
 */
function flattenOrgDefs(orgDefs, parentId = null) {
  const result = [];
  for (const def of orgDefs) {
    const unit = createOrgUnit({
      id:         def.id,
      name:       def.name,
      level:      def.level,
      parentId:   parentId || def.parentId || null,
      costType:   def.costType   || 'sga',
      locationId: def.locationId || null,
      unitTypeId: def.unitTypeId || null,
    });
    // isBoard フラグを定義から引き継ぐ（createOrgUnit は isBoard を付与しないため）
    if (def.isBoard) unit.isBoard = true;
    result.push(unit);
    if (def.children && def.children.length > 0) {
      result.push(...flattenOrgDefs(def.children, unit.id));
    }
  }
  return result;
}

// ============================================================
// モジュール公開
// ============================================================

window.OrgModule = {
  // 定数
  REGION_TYPES,
  LOCATION_CAPACITY_UNIT,
  OVERCAPACITY_PENALTY,
  LEVEL_LABELS,
  UNIT_TYPE_DEFS,
  UNIT_LEVEL_ALLOWANCES,
  INITIAL_ORG,
  INITIAL_LOCATIONS,
  INITIAL_POSITIONS,

  // 関数
  createOrgUnit,
  createPosition,
  createLocation,
  getOrgTree,
  getUnitsByLevel,
  getPositionsForLevel,
  calcLocationCost,
  calcOvercapacityMotivationPenalty,
  flattenOrgDefs,
  getLevelLabel,
};
