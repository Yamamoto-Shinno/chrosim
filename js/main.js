/**
 * main.js - ゲームエントリーポイント・状態管理
 *
 * 依存: data.js, org.js, simulation.js, ui.js（全モジュールがロード済みであること）
 * 読み込み順: data.js → org.js → simulation.js → ui.js → main.js（最後）
 *
 * 責務:
 *   - ProjectManager: 複数プロジェクトの localStorage 管理
 *   - GameState:      現在アクティブなプロジェクトの状態
 *   - GameCallbacks:  UIModule / OrgModule から呼ばれるコールバック全登録
 *   - initGame():     ゲーム初期化
 *   - advanceTurn():  年次ターン進行
 */

'use strict';

// ============================================================
// 型定義（JSDoc）
// ============================================================

/**
 * @typedef {Object} Employee
 * @property {number}   id
 * @property {string}   name
 * @property {number}   age
 * @property {string}   jobType        - JOB_TYPES のキー
 * @property {string}   grade          - G1〜G10
 * @property {string}   potential      - C/B/A/S
 * @property {number}   technical      - 1〜100
 * @property {number}   communication  - 1〜100
 * @property {number}   leadership     - 1〜100
 * @property {number}   experience     - 在籍年数
 * @property {number}   motivation     - 1〜100
 * @property {string|null} unitId
 * @property {string[]} positionIds    - 最大3件
 * @property {number}   hireYear
 * @property {number|null} retiredYear
 * @property {string|null} retiredReason
 */

/**
 * @typedef {Object} OrgUnit
 * @property {string}   id
 * @property {string}   name
 * @property {number}   level          - 1〜5
 * @property {string|null} parentId
 * @property {'cogs'|'sga'} costType
 * @property {string|null} locationId
 * @property {string[]} positionSlots  - 長さ2、役職IDまたはnull
 * @property {number[]} employeeIds
 */

/**
 * @typedef {Object} Position
 * @property {string} id
 * @property {string} name
 * @property {number} level      - 1〜5
 * @property {number} allowance  - 万円/年
 */

/**
 * @typedef {Object} Location
 * @property {string} id
 * @property {string} name
 * @property {string} regionType  - REGION_TYPES のキー
 * @property {number} capacity    - 50の倍数
 */

/**
 * @typedef {Object} BoardMember
 * @property {number} employeeId
 * @property {string} attribute    - EXECUTIVE_ATTRIBUTES のキー
 * @property {string|null} role    - EXECUTIVE_ROLES のキー（null可）
 * @property {number} compensation - 役員報酬（万円/年）
 */

/**
 * @typedef {Object} FinanceRecord
 * @property {number} year
 * @property {number} revenue
 * @property {number} laborCostCogs
 * @property {number} laborCostSga
 * @property {number} laborCostTotal
 * @property {number} locationCostTotal
 * @property {number} executiveCompTotal
 * @property {number} fixedCost
 * @property {number} totalCost
 * @property {number} profitBeforeBuffs
 * @property {number} profitAfterBuffs
 */

/**
 * @typedef {Object} HistoryEvent
 * @property {number} year
 * @property {string} type
 * @property {string} message
 * @property {number} [employeeId]
 */

/**
 * @typedef {Object} GameState
 * @property {string}         projectId
 * @property {string}         projectName
 * @property {number}         startYear
 * @property {number}         currentYear
 * @property {number}         nextEmployeeId
 * @property {Employee[]}     employees
 * @property {Employee[]}     retiredEmployees
 * @property {OrgUnit[]}      orgUnits
 * @property {Position[]}     positions
 * @property {Location[]}     locations
 * @property {BoardMember[]}  board
 * @property {Object}         finances
 * @property {number}         finances.cash
 * @property {FinanceRecord[]} finances.history
 * @property {HistoryEvent[]} history
 * @property {Object}         turnActions
 * @property {number}         turnActions.hireCount
 * @property {number}         turnActions.transferCount
 * @property {number}         turnActions.promoteCount
 * @property {Object|null}    lastSimResult
 */

// ============================================================
// ProjectManager - 複数プロジェクトの localStorage 管理
// ============================================================

const PROJECT_INDEX_KEY = 'chrosim_projects';   // プロジェクト一覧インデックス
const PROJECT_DATA_PREFIX = 'chrosim_project_'; // プロジェクトデータのキープレフィックス
const CURRENT_PROJECT_KEY = 'chrosim_current';  // 現在のプロジェクトID

const ProjectManager = {
  /**
   * 全プロジェクトのサマリー一覧を取得する
   * @returns {Array<{id: string, name: string, startYear: number, currentYear: number, employeeCount: number}>}
   */
  getProjectList() {
    try {
      const raw = localStorage.getItem(PROJECT_INDEX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * プロジェクトサマリーを一覧に保存・更新する
   * @param {GameState} state
   */
  updateProjectIndex(state) {
    try {
      const list = this.getProjectList();
      const existing = list.findIndex(p => p.id === state.projectId);
      const summary = {
        id:            state.projectId,
        name:          state.projectName,
        startYear:     state.startYear,
        currentYear:   state.currentYear,
        employeeCount: state.employees.length,
      };
      if (existing >= 0) {
        list[existing] = summary;
      } else {
        list.push(summary);
      }
      localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(list));
    } catch (e) {
      UIModule.showNotification('プロジェクト一覧の更新に失敗しました: ' + e.message, 'error');
    }
  },

  /**
   * プロジェクトデータを localStorage に保存する
   * @param {GameState} state
   */
  saveProject(state) {
    try {
      localStorage.setItem(PROJECT_DATA_PREFIX + state.projectId, JSON.stringify(state));
      this.updateProjectIndex(state);
    } catch (e) {
      UIModule.showNotification('セーブに失敗しました: ' + e.message, 'error');
    }
  },

  /**
   * プロジェクトデータを localStorage から読み込む
   * @param {string} projectId
   * @returns {GameState|null}
   */
  loadProject(projectId) {
    try {
      const raw = localStorage.getItem(PROJECT_DATA_PREFIX + projectId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      UIModule.showNotification('プロジェクトの読み込みに失敗しました', 'error');
      return null;
    }
  },

  /**
   * プロジェクトを削除する
   * @param {string} projectId
   */
  deleteProject(projectId) {
    try {
      localStorage.removeItem(PROJECT_DATA_PREFIX + projectId);
      const list = this.getProjectList().filter(p => p.id !== projectId);
      localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(list));
      // 現在のプロジェクトを削除した場合は current をクリア
      if (localStorage.getItem(CURRENT_PROJECT_KEY) === projectId) {
        localStorage.removeItem(CURRENT_PROJECT_KEY);
      }
    } catch (e) {
      UIModule.showNotification('プロジェクト削除に失敗しました', 'error');
    }
  },

  /**
   * 現在のアクティブプロジェクトIDを保存する
   * @param {string} projectId
   */
  setCurrentProjectId(projectId) {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  },

  /**
   * 現在のアクティブプロジェクトIDを取得する
   * @returns {string|null}
   */
  getCurrentProjectId() {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  },
};

// ============================================================
// GameState ファクトリ
// ============================================================

/**
 * 新規プロジェクト用 GameState を生成する
 * @param {Object} params
 * @param {string} params.projectName - プロジェクト名（会社名）
 * @param {number} [params.startYear] - 開始年（デフォルト 2025）
 * @returns {GameState}
 */
function createNewGameState(params) {
  const startYear = params.startYear || 2025;
  const projectId = 'proj_' + Date.now();

  return {
    projectId,
    projectName:   params.projectName || '新しい会社',
    startYear,
    currentYear:   startYear,
    nextEmployeeId: 1,
    employees:      [],
    retiredEmployees: [],
    orgUnits:       [],
    positions:      [],
    locations:      [],
    board:          [],
    finances: {
      cash:    10000,  // 初期資金 1億円（万円単位）
      history: [],
    },
    history:      [],
    turnActions: {
      hireCount:     0,
      transferCount: 0,
      promoteCount:  0,
    },
    lastSimResult: null,
    yearSnapshots: [],   // 【2】過去年度スナップショット
    chroName:      '（未設定）',  // 【6】CHRO氏名
    gradeSettings: {},   // 【7】グレード設定カスタム
    difficulty:         'normal',   // 'easy' | 'normal' | 'hard'
    executiveOfficers:  [],         // 執行役員リスト
    trainingSettings:   [           // 研修種別設定（デフォルト5種）
      { id: 'ts_manner',  name: 'ビジネスマナー研修',    effect: 'all' },
      { id: 'ts_career',  name: 'キャリア研修',          effect: 'motivation' },
      { id: 'ts_skill',   name: 'スキルアップ研修',      effect: 'technical' },
      { id: 'ts_comm',    name: 'コミュニケーション研修', effect: 'communication' },
      { id: 'ts_leader',  name: 'リーダーシップ研修',    effect: 'leadership' },
    ],
    currentTrainings:   [],         // 今期の研修計画リスト
  };
}

// ============================================================
// 初期組織・社員生成
// ============================================================

/**
 * 初期組織構造を GameState に構築する
 * @param {GameState} gs
 */
function _initializeOrg(gs) {
  // OrgModule の INITIAL_ORG をフラットリストに展開
  gs.orgUnits = OrgModule.flattenOrgDefs(OrgModule.INITIAL_ORG, null);

  // INITIAL_ORG に isBoard: true があるユニットにフラグを付与する
  // flattenOrgDefs は isBoard を引き継がないため、IDで照合して付与する
  for (const def of OrgModule.INITIAL_ORG) {
    if (def.isBoard) {
      const unit = gs.orgUnits.find(u => u.id === def.id);
      if (unit) unit.isBoard = true;
    }
  }

  // 取締役室がorgUnitsの先頭に来るよう並べ替える
  const boardIdx = gs.orgUnits.findIndex(u => u.isBoard);
  if (boardIdx > 0) {
    const boardUnit = gs.orgUnits.splice(boardIdx, 1)[0];
    gs.orgUnits.unshift(boardUnit);
  }

  // 初期役職を設定
  gs.positions = OrgModule.INITIAL_POSITIONS.map(p => ({ ...p }));

  // 初期拠点を設定
  gs.locations = OrgModule.INITIAL_LOCATIONS.map(l => ({ ...l }));
}

/**
 * 初期30名の社員を生成して配属する
 * @param {GameState} gs
 *
 * 配属先（課ID）と人数・職種対応:
 *   unit_sales_1ka    (第一課/営業部)     : 4名 - 営業職中心
 *   unit_sales_2ka    (第二課/営業部)     : 3名 - 営業職中心
 *   unit_sales_3ka    (第三課/営業部)     : 3名 - 営業職中心
 *   unit_marketing_ka (マーケティング課)  : 3名 - 戦略職中心
 *   unit_dev_1ka      (第一課/開発部)     : 4名 - 技術職中心
 *   unit_dev_2ka      (第二課/開発部)     : 3名 - 技術職中心
 *   unit_ops_ka       (運用課)            : 3名 - 技術職中心
 *   unit_finance_ka   (財務経理課)        : 2名 - 専門職
 *   unit_legal_ka     (法務課)            : 1名 - 専門職
 *   unit_hr_ka        (人事課)            : 2名 - 専門職
 *   unit_is_ka        (情報システム課)    : 2名 - 技術職・事務職
 *   合計: 4+3+3+3+4+3+3+2+1+2+2 = 30名
 */
function _generateInitialEmployees(gs) {
  // 社員ごとの配属先課ID・職種・グレードを個別に定義する
  const initialConfig = [
    // G6（3名）
    { jobType: 'sales',      grade: 'G6', unitId: 'unit_sales_honbu' },
    { jobType: 'engineer',   grade: 'G6', unitId: 'unit_dev_honbu' },
    { jobType: 'specialist', grade: 'G6', unitId: 'unit_kanri_honbu' },
    // G5（3名）
    { jobType: 'strategy',   grade: 'G5', unitId: 'unit_marketing_ka' },
    { jobType: 'engineer',   grade: 'G5', unitId: 'unit_dev_1ka' },
    { jobType: 'specialist', grade: 'G5', unitId: 'unit_hr_ka' },
    // G4（6名）
    { jobType: 'sales',      grade: 'G4', unitId: 'unit_sales_1ka' },
    { jobType: 'strategy',   grade: 'G4', unitId: 'unit_marketing_ka' },
    { jobType: 'engineer',   grade: 'G4', unitId: 'unit_dev_1ka' },
    { jobType: 'engineer',   grade: 'G4', unitId: 'unit_dev_2ka' },
    { jobType: 'specialist', grade: 'G4', unitId: 'unit_finance_ka' },
    { jobType: 'specialist', grade: 'G4', unitId: 'unit_legal_ka' },
    // G3（6名）
    { jobType: 'sales',      grade: 'G3', unitId: 'unit_sales_1ka' },
    { jobType: 'sales',      grade: 'G3', unitId: 'unit_sales_2ka' },
    { jobType: 'strategy',   grade: 'G3', unitId: 'unit_marketing_ka' },
    { jobType: 'engineer',   grade: 'G3', unitId: 'unit_dev_1ka' },
    { jobType: 'engineer',   grade: 'G3', unitId: 'unit_dev_2ka' },
    { jobType: 'specialist', grade: 'G3', unitId: 'unit_hr_ka' },
    // G2（8名）
    { jobType: 'sales',      grade: 'G2', unitId: 'unit_sales_1ka' },
    { jobType: 'sales',      grade: 'G2', unitId: 'unit_sales_2ka' },
    { jobType: 'sales',      grade: 'G2', unitId: 'unit_sales_3ka' },
    { jobType: 'engineer',   grade: 'G2', unitId: 'unit_dev_1ka' },
    { jobType: 'engineer',   grade: 'G2', unitId: 'unit_dev_2ka' },
    { jobType: 'engineer',   grade: 'G2', unitId: 'unit_ops_ka' },
    { jobType: 'specialist', grade: 'G2', unitId: 'unit_finance_ka' },
    { jobType: 'admin',      grade: 'G2', unitId: 'unit_is_ka' },
    // G1（4名）
    { jobType: 'sales',      grade: 'G1', unitId: 'unit_sales_2ka' },
    { jobType: 'sales',      grade: 'G1', unitId: 'unit_sales_3ka' },
    { jobType: 'engineer',   grade: 'G1', unitId: 'unit_ops_ka' },
    { jobType: 'admin',      grade: 'G1', unitId: 'unit_is_ka' },
  ];

  for (const cfg of initialConfig) {
    const emp = DataModule.createEmployee({
      id:       gs.nextEmployeeId,
      jobType:  cfg.jobType,
      grade:    cfg.grade,
      hireYear: gs.startYear,
    });

    gs.nextEmployeeId++;
    gs.employees.push(emp);

    // 指定された課へ配属
    const unit = gs.orgUnits.find(u => u.id === cfg.unitId);
    if (unit) {
      emp.unitId = cfg.unitId;
      unit.employeeIds.push(emp.id);
    }
  }

  // プレイヤー（CHRO）は社員として追加
  const chroEmp = DataModule.createEmployee({
    id:       gs.nextEmployeeId,
    jobType:  'specialist',
    grade:    'G6',
    hireYear: gs.startYear,
    name:     gs.chroName && gs.chroName !== '（未設定）' ? gs.chroName : 'プレイヤー CHRO',
  });
  gs.nextEmployeeId++;
  gs.employees.push(chroEmp);
  gs.board.push({
    employeeId:   chroEmp.id,
    attribute:    'director',
    role:         'CHRO',
    compensation: DataModule.EXECUTIVE_ATTRIBUTES.director.defaultCompensation,
    displayOrder: 41,
  });
}

// ============================================================
// ゲーム初期化
// ============================================================

/**
 * ゲームを初期化する
 * - 現在のプロジェクトIDが localStorage にあれば読み込む
 * - なければプロジェクト選択画面 or 新規作成を促す
 */
function initGame() {
  UIModule.init();

  const currentProjectId = ProjectManager.getCurrentProjectId();
  if (currentProjectId) {
    const saved = ProjectManager.loadProject(currentProjectId);
    if (saved) {
      window.gameState = saved;
      UIModule.showNotification(
        `「${saved.projectName}」を読み込みました（${saved.currentYear}年度）`, 'info'
      );
      _afterStateLoaded();
      return;
    }
  }

  // 既存プロジェクトがある場合はプロジェクト一覧画面を表示
  const projects = ProjectManager.getProjectList();
  if (projects.length > 0) {
    showProjectListScreen();
    return;
  }

  // 何もない場合は新規プロジェクト作成
  _createNewProject({ projectName: '新しい会社', startYear: 2025 });
}

/**
 * 新規プロジェクトを作成してゲームを開始する
 * @param {Object} params
 * @param {string} params.projectName
 * @param {number} [params.startYear]
 */
function _createNewProject(params) {
  const gs = createNewGameState(params);
  _initializeOrg(gs);
  _generateInitialEmployees(gs);
  window.gameState = gs;

  ProjectManager.setCurrentProjectId(gs.projectId);
  ProjectManager.saveProject(gs);

  UIModule.showNotification(
    `「${gs.projectName}」を作成しました（${gs.currentYear}年度）`, 'success'
  );
  _afterStateLoaded();
}

/**
 * GameState が読み込まれた後の共通処理
 */
function _afterStateLoaded() {
  // 旧データに不足フィールドを補完
  const gs = window.gameState;
  if (gs) {
    if (!gs.yearSnapshots) gs.yearSnapshots = [];
    if (!gs.chroName)      gs.chroName      = '（未設定）';
    if (!gs.gradeSettings) gs.gradeSettings = {};
    if (!gs.difficulty)          gs.difficulty          = 'normal';
    if (!gs.executiveOfficers)   gs.executiveOfficers   = [];
    if (!gs.trainingSettings)    gs.trainingSettings    = [
      { id: 'ts_manner',  name: 'ビジネスマナー研修',    effect: 'all' },
      { id: 'ts_career',  name: 'キャリア研修',          effect: 'motivation' },
      { id: 'ts_skill',   name: 'スキルアップ研修',      effect: 'technical' },
      { id: 'ts_comm',    name: 'コミュニケーション研修', effect: 'communication' },
      { id: 'ts_leader',  name: 'リーダーシップ研修',    effect: 'leadership' },
    ];
    if (!gs.currentTrainings)    gs.currentTrainings    = [];
    // isBoardフラグを正規化：取締役室のみ true、それ以外は必ず false にリセット
    // （旧バージョンの修正で誤って isBoard:true が設定された場合に対応）
    if (gs.orgUnits && window.OrgModule?.INITIAL_ORG) {
      const boardIds = new Set();
      (function collectBoardIds(defs) {
        for (const def of defs) {
          if (def.isBoard) boardIds.add(def.id);
          if (def.children) collectBoardIds(def.children);
        }
      })(window.OrgModule.INITIAL_ORG);

      for (const unit of gs.orgUnits) {
        unit.isBoard = boardIds.has(unit.id) ? true : false;
      }
    }
    // 拠点の displayOrder を補完（既存データ対応）
    if (gs.locations) {
      gs.locations.forEach((loc, idx) => {
        if (loc.displayOrder == null) loc.displayOrder = (idx + 1) * 10;
      });
    }
    // 【6】既存boardメンバーにdisplayOrderが無ければデフォルト値を付与
    if (gs.board) {
      for (const member of gs.board) {
        if (member.displayOrder == null) {
          if (member.role === 'CEO')  member.displayOrder = 11;
          else if (member.role === 'CHRO') member.displayOrder = 41;
        }
      }
    }
    // gradeSettings をDataModuleに反映（ロード時）
    if (gs.gradeSettings && window.DataModule?.GRADE_DEFINITIONS) {
      for (const [grade, custom] of Object.entries(gs.gradeSettings)) {
        if (window.DataModule.GRADE_DEFINITIONS[grade] && custom) {
          if (custom.label)           window.DataModule.GRADE_DEFINITIONS[grade].label           = custom.label;
          if (custom.baseAnnualSalary) window.DataModule.GRADE_DEFINITIONS[grade].baseAnnualSalary = custom.baseAnnualSalary;
          if (custom.description !== undefined) window.DataModule.GRADE_DEFINITIONS[grade].description = custom.description;
        }
      }
    }
    // positionIds を positionSlots から再構築（保存データの同期ズレを修正）
    _syncPositionIds(gs);
  }
  _populateFormSelects();
  _refreshProjectListUI();
  UIModule.showScreen('dashboard');
  UIModule.renderDashboard(window.gameState);
  updateNavInfo();
}

// ============================================================
// ターン進行
// ============================================================

/**
 * 年次ターンを進める（4月1日 人事処理）
 * #btn-advance-turn ボタンのハンドラから呼ばれる
 */
function advanceTurn() {
  const gs = window.gameState;
  if (!gs) return;

  // 【2】現在状態のスナップショットを保存（ターン進行前）
  gs.yearSnapshots = gs.yearSnapshots || [];
  gs.yearSnapshots.push({
    year:      gs.currentYear,
    employees: JSON.parse(JSON.stringify(gs.employees)),
    orgUnits:  JSON.parse(JSON.stringify(gs.orgUnits)),
    finances:  JSON.parse(JSON.stringify(gs.finances)),
  });

  // 年次決算計算
  let financials;
  try {
    financials = SimulationModule.calcAnnualFinancials(gs);
    // 注意: 役員バフは calcAnnualFinancials() 内部で適用済みのため、ここでは呼ばない
  } catch (e) {
    console.error('年次計算エラー:', e);
    UIModule.showNotification('年次計算でエラーが発生しました: ' + e.message, 'error');
    // エラーでも年度は進める
    financials = {
      year:              gs.currentYear,
      revenue:           0,
      laborCostCogs:     0,
      laborCostSga:      0,
      laborCostTotal:    0,
      locationCostTotal: 0,
      executiveCompTotal:0,
      fixedCost:         SimulationModule.FIXED_COST || 5000,
      totalCost:         SimulationModule.FIXED_COST || 5000,
      profitBeforeBuffs: -(SimulationModule.FIXED_COST || 5000),
      profitAfterBuffs:  -(SimulationModule.FIXED_COST || 5000),
      revenueByJobType:  {},
      laborCostByUnit:   {},
      retiredEmployees:  [],
      events:            [],
    };
  }

  // 財務履歴に記録
  gs.finances = gs.finances || { cash: 0, history: [] };
  gs.finances.history.push({
    year:                financials.year,
    revenue:             financials.revenue,
    laborCostCogs:       financials.laborCostCogs,
    laborCostSga:        financials.laborCostSga,
    laborCostTotal:      financials.laborCostTotal,
    locationCostTotal:   financials.locationCostTotal,
    executiveCompTotal:  financials.executiveCompTotal,
    fixedCost:           financials.fixedCost,
    totalCost:           financials.totalCost,
    profitBeforeBuffs:   financials.profitBeforeBuffs,
    profitAfterBuffs:    financials.profitAfterBuffs,
    // 後方互換のため
    costs:  financials.totalCost,
    profit: financials.profitAfterBuffs,
  });
  gs.finances.cash += financials.profitAfterBuffs;

  // 年度を進める
  gs.currentYear += 1;
  gs.turnActions = { hireCount: 0, transferCount: 0, promoteCount: 0 };
  gs.lastSimResult = financials;

  // 研修リストを新しいターン用にリセット（実行済みを含めクリア）
  gs.currentTrainings = [];

  // 保存・UI更新
  saveProject();
  updateNavInfo();
  UIModule.showScreen('turn');
  UIModule.renderTurnScreen(gs, financials);

  UIModule.showNotification(
    `${gs.currentYear - 1}年度の人事処理が完了しました（${gs.currentYear}年度 開始）`,
    'success',
    5000
  );
}

// ============================================================
// 保存・読み込み
// ============================================================

/**
 * 現在の GameState を保存する
 */
function saveProject() {
  if (window.gameState) {
    ProjectManager.saveProject(window.gameState);
  }
}

/**
 * 指定プロジェクトIDのデータを読み込んでアクティブにする
 * @param {string} projectId
 */
function loadProject(projectId) {
  const saved = ProjectManager.loadProject(projectId);
  if (!saved) {
    UIModule.showNotification('プロジェクトが見つかりません', 'error');
    return;
  }
  window.gameState = saved;
  ProjectManager.setCurrentProjectId(projectId);
  UIModule.showNotification(
    `「${saved.projectName}」を読み込みました（${saved.currentYear}年度）`, 'info'
  );
  _afterStateLoaded();
}

// ============================================================
// 人事アクションハンドラ
// ============================================================

/**
 * 採用処理
 * @param {{jobType: string, unitId?: string, gradeCounts?: Array<{grade:string,count:number}>, grade?: string}} params
 */
function handleHire(params) {
  const gs = window.gameState;
  if (!gs) return;

  // gradeCounts形式（新モーダル）またはgrade形式（レガシー）
  const hires = params.gradeCounts && params.gradeCounts.length > 0
    ? params.gradeCounts
    : (params.grade ? [{ grade: params.grade, count: 1 }] : []);

  const totalCount = hires.reduce((s, h) => s + h.count, 0);
  if (totalCount === 0) {
    UIModule.showNotification('採用人数が0です。グレード別の人数を入力してください。', 'error');
    return;
  }

  let totalHired = 0;
  let lastEmpName = '';
  for (const { grade, count } of hires) {
    for (let i = 0; i < count; i++) {
      const emp = DataModule.createEmployee({
        id:       gs.nextEmployeeId,
        jobType:  params.jobType,
        grade,
        hireYear: gs.currentYear,
      });

      gs.nextEmployeeId++;
      gs.employees.push(emp);
      gs.turnActions.hireCount++;

      // 配属先決定
      const allUnits = gs.orgUnits;
      let targetUnit = null;
      if (params.unitId) {
        targetUnit = allUnits.find(u => u.id === params.unitId) || null;
      }
      if (!targetUnit && allUnits.length > 0) {
        targetUnit = allUnits.reduce((a, b) =>
          (a.employeeIds.length <= b.employeeIds.length) ? a : b
        );
      }
      if (targetUnit) {
        emp.unitId = targetUnit.id;
        targetUnit.employeeIds.push(emp.id);
      }

      totalHired++;
      lastEmpName = emp.name;
    }
  }

  saveProject();
  refreshAllScreens();
  updateNavInfo();
  if (totalHired === 1) {
    UIModule.showNotification(
      `${lastEmpName} を採用しました（${DataModule.JOB_TYPES[params.jobType]?.label || params.jobType}）`,
      'success'
    );
  } else {
    UIModule.showNotification(`${totalHired}名を採用しました`, 'success');
  }
}

/**
 * 昇格処理
 * @param {number} employeeId
 * @param {string} newGrade
 */
function handlePromote(employeeId, newGrade) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === employeeId);
  if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

  const GRADE_ORDER = DataModule.GRADE_ORDER;
  const newIndex     = GRADE_ORDER.indexOf(newGrade);
  const currentIndex = GRADE_ORDER.indexOf(emp.grade);

  if (newIndex <= currentIndex) {
    UIModule.showNotification('現在より上のグレードを指定してください', 'warning');
    return;
  }

  const oldGrade = emp.grade;
  emp.grade      = newGrade;
  emp.motivation = Math.min(100, (emp.motivation || 50) + 15);
  gs.turnActions.promoteCount++;

  gs.history.push({
    year:    gs.currentYear,
    type:    'promote',
    message: `${emp.name} を ${oldGrade} → ${newGrade} に昇格しました`,
    employeeId,
  });

  saveProject();
  refreshAllScreens();
  UIModule.showNotification(`${emp.name} を ${oldGrade} → ${newGrade} に昇格しました`, 'success');
}

/**
 * 異動処理（異動先未指定の場合はモーダルを開く）
 * @param {number}  employeeId
 * @param {string} [targetUnitId]
 */
function handleTransfer(employeeId, targetUnitId) {
  const gs = window.gameState;
  if (!gs) return;

  if (!targetUnitId) {
    // モーダルを開く
    const emp = gs.employees.find(e => e.id === employeeId);
    if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

    const nameEl = document.getElementById('transfer-employee-name');
    if (nameEl) nameEl.textContent = emp.name;

    const unitSelect = document.getElementById('transfer-unit-select');
    if (unitSelect) {
      unitSelect.innerHTML = gs.orgUnits.map(u =>
        `<option value="${u.id}"${emp.unitId === u.id ? ' disabled' : ''}>
          ${u.name}${emp.unitId === u.id ? '（現在）' : ''}
        </option>`
      ).join('');
    }

    const confirmBtn = document.getElementById('transfer-confirm-btn');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        const selected = unitSelect?.value;
        if (!selected) { UIModule.showNotification('異動先を選択してください', 'warning'); return; }
        UIModule.hideModal('modal-transfer');
        handleTransfer(employeeId, selected);
      };
    }

    UIModule.showModal('modal-transfer');
    return;
  }

  const emp     = gs.employees.find(e => e.id === employeeId);
  const newUnit = gs.orgUnits.find(u => u.id === targetUnitId);
  if (!emp || !newUnit) {
    UIModule.showNotification('社員または部門が見つかりません', 'error');
    return;
  }
  if (emp.unitId === targetUnitId) {
    UIModule.showNotification('同じ部門への異動です', 'warning');
    return;
  }

  // 旧部門から除去
  if (emp.unitId) {
    const oldUnit = gs.orgUnits.find(u => u.id === emp.unitId);
    if (oldUnit) oldUnit.employeeIds = oldUnit.employeeIds.filter(id => id !== employeeId);
  }

  emp.unitId = targetUnitId;
  newUnit.employeeIds.push(employeeId);
  const mot = emp.motivation || 50;
  const motDelta = mot <= 40 ? 10 : mot >= 70 ? -10 : -3;
  emp.motivation = Math.min(100, Math.max(1, mot + motDelta));
  gs.turnActions.transferCount++;

  gs.history.push({
    year:    gs.currentYear,
    type:    'transfer',
    message: `${emp.name} を ${newUnit.name} へ異動しました`,
    employeeId,
  });

  saveProject();
  refreshAllScreens();
  UIModule.showNotification(`${emp.name} を ${newUnit.name} へ異動しました`, 'info');
}

/**
 * 【4】降格処理
 * @param {number} employeeId
 */
function handleDemote(employeeId) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === employeeId);
  if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

  const GRADE_ORDER    = DataModule.GRADE_ORDER;
  const currentIndex   = GRADE_ORDER.indexOf(emp.grade);
  if (currentIndex <= 0) {
    UIModule.showNotification('これ以上降格できません（G1が最低グレード）', 'warning');
    return;
  }

  const prevGrade  = GRADE_ORDER[currentIndex - 1];
  const oldGrade   = emp.grade;
  emp.grade        = prevGrade;
  emp.motivation   = Math.max(1, (emp.motivation || 50) - 15);

  gs.history.push({
    year:    gs.currentYear,
    type:    'demote',
    message: `${emp.name} を ${oldGrade} → ${prevGrade} に降格しました`,
    employeeId,
  });

  saveProject();
  refreshAllScreens();
  UIModule.showNotification(`${emp.name} を ${oldGrade} → ${prevGrade} に降格しました`, 'warning');
}

/**
 * 退職処理
 * @param {number} employeeId
 */
function handleRetire(employeeId) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === employeeId);
  if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

  // 部門から除去
  if (emp.unitId) {
    const unit = gs.orgUnits.find(u => u.id === emp.unitId);
    if (unit) unit.employeeIds = unit.employeeIds.filter(id => id !== employeeId);
  }

  // 取締役ボードから除去
  gs.board = (gs.board || []).filter(b => b.employeeId !== employeeId);

  emp.retiredYear   = gs.currentYear;
  emp.retiredReason = 'voluntary';
  gs.employees        = gs.employees.filter(e => e.id !== employeeId);
  gs.retiredEmployees = gs.retiredEmployees || [];
  gs.retiredEmployees.push(emp);

  gs.history.push({
    year:    gs.currentYear,
    type:    'retire',
    message: `${emp.name} が退職しました`,
    employeeId,
  });

  saveProject();
  refreshAllScreens();
  updateNavInfo();
  UIModule.showNotification(`${emp.name} が退職しました`, 'info');
}

// ============================================================
// 設定系ハンドラ
// ============================================================

/**
 * 役職を追加する
 * @param {{name: string, level: number, allowance: number}} params
 */
function handleAddPosition(params) {
  const gs = window.gameState;
  if (!gs) return;

  const pos = OrgModule.createPosition(params);
  gs.positions = gs.positions || [];
  gs.positions.push(pos);

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`役職「${pos.name}」を追加しました`, 'success');
}

/**
 * 役職を削除する
 * @param {string} positionId
 */
function handleDeletePosition(positionId) {
  const gs = window.gameState;
  if (!gs) return;

  // 社員の positionIds から除去
  for (const emp of gs.employees) {
    emp.positionIds = (emp.positionIds || []).filter(id => id !== positionId);
  }
  // 部門の positionSlots から除去
  // positionSlots はオブジェクト配列 {slotIndex, positionId, employeeId} の形式
  for (const unit of gs.orgUnits) {
    unit.positionSlots = (unit.positionSlots || [
      { slotIndex: 0, positionId: null, employeeId: null },
      { slotIndex: 1, positionId: null, employeeId: null },
    ]).map(slot => {
      if (!slot || typeof slot !== 'object') return slot;
      if (slot.positionId === positionId) {
        return { slotIndex: slot.slotIndex, positionId: null, employeeId: null };
      }
      return slot;
    });
  }

  gs.positions = gs.positions.filter(p => p.id !== positionId);
  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification('役職を削除しました', 'info');
}

/**
 * 拠点を追加する
 * @param {{name: string, regionType: string, capacity: number}} params
 */
function handleAddLocation(params) {
  const gs = window.gameState;
  if (!gs) return;

  const loc = OrgModule.createLocation(params);
  gs.locations = gs.locations || [];
  if (loc.displayOrder == null) loc.displayOrder = (gs.locations.length + 1) * 10;
  gs.locations.push(loc);

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`拠点「${loc.name}」を追加しました`, 'success');
}

/**
 * 拠点を削除する
 * @param {string} locationId
 */
function handleDeleteLocation(locationId) {
  const gs = window.gameState;
  if (!gs) return;

  // 使用中の部門を確認
  const usingUnit = gs.orgUnits.find(u => u.locationId === locationId);
  if (usingUnit) {
    UIModule.showNotification(
      `「${usingUnit.name}」が使用中のため削除できません`, 'error'
    );
    return;
  }

  gs.locations = gs.locations.filter(l => l.id !== locationId);
  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification('拠点を削除しました', 'info');
}

/**
 * 取締役に任命する
 * @param {{employeeId: number, attribute: string, role: string|null, compensation: number}} params
 */
function handleAddBoardMember(params) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === params.employeeId);
  if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

  // 既に登録済みなら更新
  const existing = (gs.board || []).findIndex(b => b.employeeId === params.employeeId);
  const member = {
    employeeId:   params.employeeId,
    attribute:    params.attribute,
    role:         params.role || null,
    compensation: params.compensation ||
      DataModule.EXECUTIVE_ATTRIBUTES[params.attribute]?.defaultCompensation || 0,
  };

  if (existing >= 0) {
    gs.board[existing] = member;
  } else {
    gs.board = gs.board || [];
    gs.board.push(member);
  }

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`${emp.name} を取締役に任命しました`, 'success');
}

/**
 * 執行役員を任命・更新する
 * @param {{employeeId: number, type: string, domain: string, compensation: number, displayOrder: number}} params
 */
function handleAddExecutiveOfficer(params) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === params.employeeId);
  if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

  gs.executiveOfficers = gs.executiveOfficers || [];
  const existing = gs.executiveOfficers.findIndex(eo => eo.employeeId === params.employeeId);
  const member = {
    employeeId:   params.employeeId,
    type:         params.type || 'regular',   // 'senior' or 'regular'
    domain:       params.domain || '',
    compensation: params.compensation !== undefined ? params.compensation
      : (params.type === 'senior' ? 30 : 20),
    displayOrder: params.displayOrder || 99,
  };

  if (existing >= 0) {
    gs.executiveOfficers[existing] = member;
  } else {
    gs.executiveOfficers.push(member);
  }

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`${emp.name} を執行役員に任命しました`, 'success');
}

/**
 * 執行役員から外す
 * @param {number} employeeId
 */
function handleRemoveExecutiveOfficer(employeeId) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === employeeId);
  gs.executiveOfficers = (gs.executiveOfficers || []).filter(eo => eo.employeeId !== employeeId);

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`${emp?.name || '社員'} を執行役員から外しました`, 'info');
}

/**
 * 研修種別を追加する
 * @param {{name: string, effect: string}} params
 */
function handleAddTrainingType(params) {
  const gs = window.gameState;
  if (!gs) return;
  if (!params.name?.trim()) { UIModule.showNotification('研修名を入力してください', 'error'); return; }

  gs.trainingSettings = gs.trainingSettings || [];
  const id = 'ts_' + Date.now();
  gs.trainingSettings.push({ id, name: params.name.trim(), effect: params.effect || 'all' });

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`研修「${params.name}」を追加しました`, 'success');
}

/**
 * 研修種別を削除する
 * @param {string} trainingTypeId
 */
function handleDeleteTrainingType(trainingTypeId) {
  const gs = window.gameState;
  if (!gs) return;
  gs.trainingSettings = (gs.trainingSettings || []).filter(t => t.id !== trainingTypeId);
  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification('研修を削除しました', 'info');
}

/**
 * 今期の研修計画を追加する
 * @param {{trainingTypeId: string, level: number, targetGroup: string}} params
 */
function handlePlanTraining(params) {
  const gs = window.gameState;
  if (!gs) return;

  const type = (gs.trainingSettings || []).find(t => t.id === params.trainingTypeId);
  if (!type) { UIModule.showNotification('研修種別が見つかりません', 'error'); return; }

  const TRAINING_LEVEL_DEFS = {
    1: { costPerPerson: 1 },
    2: { costPerPerson: 3 },
    3: { costPerPerson: 8 },
    4: { costPerPerson: 20 },
    5: { costPerPerson: 50 },
  };

  const level       = params.level || 1;
  const targetGroup = params.targetGroup || 'all';
  const lvDef       = TRAINING_LEVEL_DEFS[level] || TRAINING_LEVEL_DEFS[1];
  const targets     = _getTrainingTargets(targetGroup, gs.employees || []);
  const affectedCount = targets.length;
  const totalCost     = affectedCount * lvDef.costPerPerson;

  gs.currentTrainings = gs.currentTrainings || [];
  const id = 'ct_' + Date.now();
  gs.currentTrainings.push({
    id,
    trainingTypeId: params.trainingTypeId,
    trainingName:   type.name,
    effect:         type.effect,
    level,
    targetGroup,
    status:         'pending',
    totalCost,
    affectedCount,
  });

  saveProject();
  UIModule.renderHRActions(gs);
  UIModule.showNotification(`研修「${type.name}」を計画に追加しました`, 'success');
}

/**
 * 研修を実行する（対象社員にステータス変動を適用）
 * @param {string} trainingId
 */
function handleExecuteTraining(trainingId) {
  const gs = window.gameState;
  if (!gs) return;

  const training = (gs.currentTrainings || []).find(t => t.id === trainingId);
  if (!training) { UIModule.showNotification('研修が見つかりません', 'error'); return; }
  if (training.status === 'executed') { UIModule.showNotification('既に実行済みです', 'warning'); return; }

  const TRAINING_LEVEL_DEFS = {
    1: { minEffect: 1, maxEffect: 3,  costPerPerson: 1 },
    2: { minEffect: 2, maxEffect: 4,  costPerPerson: 3 },
    3: { minEffect: 3, maxEffect: 6,  costPerPerson: 5 },
    4: { minEffect: 4, maxEffect: 8,  costPerPerson: 7 },
    5: { minEffect: 5, maxEffect: 10, costPerPerson: 10 },
  };

  const levelDef = TRAINING_LEVEL_DEFS[training.level] || TRAINING_LEVEL_DEFS[1];
  const targets  = _getTrainingTargets(training.targetGroup, gs.employees);

  for (const emp of targets) {
    const growthMult = DataModule.POTENTIAL_TYPES[emp.potential]?.growthMultiplier || 1.0;
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // モチベーション微増（全研修共通）
    emp.motivation = Math.min(100, emp.motivation + rand(1, 3));

    const effect = training.effect;

    if (effect === 'all') {
      const base = rand(levelDef.minEffect, levelDef.maxEffect);
      const grow = Math.round(base * growthMult);
      emp.technical     = Math.min(100, emp.technical     + grow);
      emp.communication = Math.min(100, emp.communication + grow);
      emp.leadership    = Math.min(100, emp.leadership    + grow);
    } else if (effect === 'motivation') {
      emp.motivation = Math.min(100, emp.motivation + rand(levelDef.minEffect * 3, levelDef.maxEffect * 3));
    } else if (effect === 'technical') {
      const grow = Math.round(rand(levelDef.minEffect * 3, levelDef.maxEffect * 3) * growthMult);
      emp.technical = Math.min(100, emp.technical + grow);
    } else if (effect === 'communication') {
      const grow = Math.round(rand(levelDef.minEffect * 3, levelDef.maxEffect * 3) * growthMult);
      emp.communication = Math.min(100, emp.communication + grow);
    } else if (effect === 'leadership') {
      const grow = Math.round(rand(levelDef.minEffect * 3, levelDef.maxEffect * 3) * growthMult);
      emp.leadership = Math.min(100, emp.leadership + grow);
    }
  }

  training.affectedCount = targets.length;
  training.totalCost     = targets.length * levelDef.costPerPerson;
  training.status        = 'executed';

  saveProject();
  refreshAllScreens();
  UIModule.showNotification(
    `「${training.trainingName}」を実行しました（${targets.length}名 / ${training.totalCost}万円）`,
    'success'
  );
}

/**
 * 全未実行研修を一括実行する
 */
function handleExecuteAllTrainings() {
  const gs = window.gameState;
  if (!gs) return;
  const pending = (gs.currentTrainings || []).filter(t => t.status === 'pending');
  if (pending.length === 0) { UIModule.showNotification('実行待ちの研修がありません', 'warning'); return; }
  for (const t of pending) handleExecuteTraining(t.id);
  UIModule.showNotification('全研修を一括実行しました', 'success');
}

/**
 * 研修計画を削除する
 * @param {string} trainingId
 */
function handleDeleteTraining(trainingId) {
  const gs = window.gameState;
  if (!gs) return;
  const t = (gs.currentTrainings || []).find(x => x.id === trainingId);
  gs.currentTrainings = (gs.currentTrainings || []).filter(x => x.id !== trainingId);
  saveProject();
  UIModule.renderHRActions(gs);
  UIModule.showNotification(`研修「${t?.trainingName || ''}」を削除しました`, 'info');
}

/**
 * 難易度を変更する
 * @param {'easy'|'normal'|'hard'} difficulty
 */
function handleUpdateDifficulty(difficulty) {
  const gs = window.gameState;
  if (!gs) return;
  gs.difficulty = difficulty;
  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`難易度を「${difficulty}」に変更しました`, 'success');
}

/**
 * 研修対象者を取得する内部ヘルパー
 * @param {string}     targetGroup
 * @param {Employee[]} employees
 * @returns {Employee[]}
 */
function _getTrainingTargets(targetGroup, employees) {
  const gs = window.gameState;
  switch (targetGroup) {
    case 'all':         return employees;
    case 'executive':   return employees.filter(e => ['G6','G7','G8','G9','G10'].includes(e.grade));
    case 'g5':          return employees.filter(e => e.grade === 'G5');
    case 'senior50':    return employees.filter(e => e.age >= 50);
    case 'middle':      return employees.filter(e => e.age >= 30 && e.age < 50);
    case 'junior':      return employees.filter(e => e.age >= 20 && e.age < 30);
    case 'position':    return employees.filter(e => (e.positionIds || []).length > 0);
    case 'no_position': return employees.filter(e => (e.positionIds || []).length === 0);
    case 'sales':       return employees.filter(e => e.jobType === 'sales');
    case 'engineer':    return employees.filter(e => e.jobType === 'engineer');
    case 'strategy':    return employees.filter(e => e.jobType === 'strategy');
    case 'specialist':  return employees.filter(e => e.jobType === 'specialist');
    case 'admin':       return employees.filter(e => e.jobType === 'admin');
    default:            return employees;
  }
}

/**
 * 取締役から外す
 * @param {number} employeeId
 */
function handleRemoveBoardMember(employeeId) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === employeeId);
  gs.board = (gs.board || []).filter(b => b.employeeId !== employeeId);

  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`${emp?.name || '社員'} を取締役から外しました`, 'info');
}

/**
 * 社員に役職を割り当てる（positionIds を更新）
 * @param {number}   employeeId
 * @param {string[]} positionIds - 新しい役職IDリスト（最大3件）
 */
/**
 * unit.positionSlots を唯一の正として emp.positionIds を全社員分再構築する
 * @param {GameState} gs
 */
function _syncPositionIds(gs) {
  for (const emp of gs.employees) {
    emp.positionIds = [];
  }
  for (const unit of gs.orgUnits || []) {
    for (const slot of unit.positionSlots || []) {
      if (slot && slot.employeeId && slot.positionId) {
        const emp = gs.employees.find(e => e.id === Number(slot.employeeId));
        if (emp && !emp.positionIds.includes(slot.positionId)) {
          emp.positionIds.push(slot.positionId);
        }
      }
    }
  }
}

function handleAssignPositions(employeeId, newPositionIds) {
  const gs = window.gameState;
  if (!gs) return;

  const emp = gs.employees.find(e => e.id === employeeId);
  if (!emp) { UIModule.showNotification('社員が見つかりません', 'error'); return; }

  if (newPositionIds.length > 3) {
    UIModule.showNotification('役職は最大3つまでです', 'warning');
    return;
  }

  const oldPositionIds = emp.positionIds || [];
  const wasNoPosition  = oldPositionIds.length === 0;
  const oldMinLevel    = oldPositionIds.reduce((min, pid) => {
    const p = (gs.positions || []).find(q => q.id === pid);
    return p ? Math.min(min, p.level) : min;
  }, Infinity);

  // 削除された役職: 対応スロットをクリア
  for (const removedId of oldPositionIds.filter(pid => !newPositionIds.includes(pid))) {
    for (const unit of gs.orgUnits || []) {
      for (const slot of unit.positionSlots || []) {
        if (slot && slot.positionId === removedId && Number(slot.employeeId) === employeeId) {
          slot.employeeId = null;
          slot.positionId = null;
        }
      }
    }
  }

  // 追加された役職: 対応スロットに設定（社員所属部門を優先）
  for (const addedId of newPositionIds.filter(pid => !oldPositionIds.includes(pid))) {
    const pos = (gs.positions || []).find(p => p.id === addedId);
    if (!pos) continue;
    const targetUnit = gs.orgUnits.find(u => u.id === emp.unitId && u.unitTypeId === pos.unitTypeId)
                    || gs.orgUnits.find(u => u.unitTypeId === pos.unitTypeId);
    if (!targetUnit) continue;
    if (!targetUnit.positionSlots) targetUnit.positionSlots = [
      { slotIndex: 0, positionId: null, employeeId: null },
      { slotIndex: 1, positionId: null, employeeId: null },
    ];
    const slot = targetUnit.positionSlots[pos.slotIndex];
    if (!slot) continue;
    slot.employeeId = employeeId;
    slot.positionId = addedId;
  }

  // positionIds を slots から再構築（単一ソース確保）
  _syncPositionIds(gs);

  // モチベーションボーナス判定
  if (newPositionIds.length > 0) {
    const newMinLevel = newPositionIds.reduce((min, pid) => {
      const p = (gs.positions || []).find(q => q.id === pid);
      return p ? Math.min(min, p.level) : min;
    }, Infinity);
    if (wasNoPosition) {
      emp.motivation = Math.min(100, (emp.motivation || 50) + 8);
    } else if (newMinLevel < oldMinLevel) {
      emp.motivation = Math.min(100, (emp.motivation || 50) + 5);
    }
  }

  const labels = newPositionIds
    .map(pid => (gs.positions || []).find(p => p.id === pid)?.name || pid)
    .join('、') || 'なし';

  saveProject();
  refreshAllScreens();
  UIModule.showNotification(`${emp.name} の役職を「${labels}」に設定しました`, 'success');
}

// ============================================================
// 部門操作ハンドラ
// ============================================================

/**
 * 部門を追加する
 * @param {{name: string, level: number, unitTypeId?: string, parentId?: string, costType?: string, locationId?: string}} params
 */
function handleAddUnit(params) {
  const gs = window.gameState;
  if (!gs) return;
  if (!params.name?.trim()) { UIModule.showNotification('部門名を入力してください', 'error'); return; }

  const unit = OrgModule.createOrgUnit({
    name:       params.name.trim(),
    level:      params.level,
    parentId:   params.parentId   || null,
    costType:   params.costType   || 'sga',
    locationId: params.locationId || null,
  });
  // unitTypeId は createOrgUnit が返すオブジェクトには含まれないので後付けで追加
  if (params.unitTypeId) unit.unitTypeId = params.unitTypeId;

  gs.orgUnits.push(unit);
  gs.history.push({
    year:    gs.currentYear,
    type:    'org_create',
    message: `「${unit.name}」を追加しました`,
  });

  saveProject();
  UIModule.renderOrgChart(gs);
  UIModule.showNotification(`「${unit.name}」を追加しました`, 'success');
}

/**
 * 【3】部門編集処理
 * @param {string} unitId
 * @param {{name: string, costType: string, locationId: string|null, positionSlots: Array}} formData
 */
function handleEditUnit(unitId, formData) {
  const gs = window.gameState;
  if (!gs) return;

  const unit = (gs.orgUnits || []).find(u => u.id === unitId);
  if (!unit) { UIModule.showNotification('部門が見つかりません', 'error'); return; }
  if (!formData.name?.trim()) { UIModule.showNotification('部門名を入力してください', 'error'); return; }

  unit.name       = formData.name.trim();
  unit.costType   = formData.costType   || unit.costType;
  unit.locationId = formData.locationId || null;
  // 取締役室（isBoard）でなければ parentId・unitTypeId も更新
  if (!unit.isBoard && 'parentId' in formData) {
    unit.parentId = formData.parentId || null;
  }
  if (!unit.isBoard && formData.unitTypeId) {
    const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
    const utDef = UNIT_TYPE_DEFS.find(d => d.id === formData.unitTypeId);
    unit.unitTypeId = formData.unitTypeId;
    if (utDef) unit.level = utDef.levelNum;
  }

  // 役職スロット更新
  if (formData.positionSlots) {
    unit.positionSlots = formData.positionSlots;
    // positionIds を slots から再構築（全社員一括）
    _syncPositionIds(gs);
  }

  // 兼任フラグの付与：同じ社員IDが複数の orgUnit.positionSlots に存在する場合
  const empSlotCount = {};
  for (const u of gs.orgUnits) {
    for (const slot of (u.positionSlots || [])) {
      if (slot && slot.employeeId) {
        empSlotCount[slot.employeeId] = (empSlotCount[slot.employeeId] || 0) + 1;
      }
    }
  }
  for (const emp of gs.employees) {
    emp.isDouble = (empSlotCount[emp.id] || 0) >= 2;
  }

  saveProject();
  UIModule.renderOrgChart(gs);
  UIModule.showNotification(`「${unit.name}」を更新しました`, 'success');
}

/**
 * 【1】プロジェクト名を変更する
 * @param {string} id
 * @param {string} newName
 */
function renameProject(id, newName) {
  const gs = window.gameState;
  if (!gs || gs.projectId !== id) return;
  if (!newName?.trim()) { UIModule.showNotification('名前を入力してください', 'error'); return; }
  gs.projectName = newName.trim();
  saveProject();
  updateNavInfo();
  refreshAllScreens();
  UIModule.showNotification(`プロジェクト名を「${gs.projectName}」に変更しました`, 'success');
}

/**
 * 【6】CHRO氏名を更新する
 * @param {string} name
 */
function handleUpdateChroName(name) {
  const gs = window.gameState;
  if (!gs) return;
  const newName = name?.trim() || '（未設定）';
  gs.chroName = newName;
  // CHRO役のboard memberに紐づく社員の氏名も更新する
  const chroMember = (gs.board || []).find(b => b.role === 'CHRO');
  if (chroMember) {
    const emp = (gs.employees || []).find(e => e.id === chroMember.employeeId);
    if (emp) emp.name = newName;
  }
  saveProject();
  refreshAllScreens();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`CHRO氏名を「${gs.chroName}」に設定しました`, 'success');
}

/**
 * 【7】グレード設定を更新する
 * @param {string} grade - 'G1'〜'G10'
 * @param {{name: string, salary: number, description: string}} params
 */
function handleUpdateGrade(grade, params) {
  const gs = window.gameState;
  if (!gs) return;
  gs.gradeSettings = gs.gradeSettings || {};
  gs.gradeSettings[grade] = {
    label:           params.name,
    baseAnnualSalary: parseInt(params.salary, 10) || 0,
    description:     params.description || '',
  };
  // DataModule の GRADE_DEFINITIONS を上書き（このセッション中有効）
  if (window.DataModule && window.DataModule.GRADE_DEFINITIONS && window.DataModule.GRADE_DEFINITIONS[grade]) {
    if (params.name)       window.DataModule.GRADE_DEFINITIONS[grade].label           = params.name;
    if (params.salary)     window.DataModule.GRADE_DEFINITIONS[grade].baseAnnualSalary = parseInt(params.salary, 10);
    if (params.description !== undefined) window.DataModule.GRADE_DEFINITIONS[grade].description = params.description;
  }
  saveProject();
  UIModule.renderSettings(gs);
  UIModule.showNotification(`${grade}の設定を更新しました`, 'success');
}

/**
 * 社員を指定部門へ直接異動（組織図DnD用）
 * @param {number} employeeId
 * @param {string} targetUnitId
 */
function handleTransferToUnit(employeeId, targetUnitId) {
  const gs = window.gameState;
  if (!gs) return;
  const emp = (gs.employees || []).find(e => e.id === employeeId);
  if (!emp) return;
  const targetUnit = (gs.orgUnits || []).find(u => u.id === targetUnitId);
  if (!targetUnit) return;
  if (emp.unitId === targetUnitId) return; // 同部門は何もしない

  // 旧部門から除去
  const oldUnit = (gs.orgUnits || []).find(u => u.id === emp.unitId);
  if (oldUnit) {
    oldUnit.employeeIds = (oldUnit.employeeIds || []).filter(id => id !== employeeId);
  }
  // 新部門に追加
  emp.unitId = targetUnitId;
  if (!targetUnit.employeeIds) targetUnit.employeeIds = [];
  if (!targetUnit.employeeIds.includes(employeeId)) {
    targetUnit.employeeIds.push(employeeId);
  }
  // モチベーション変動（低モチベ→+10、中間→−3、高モチベ→−10）
  const mot = emp.motivation || 50;
  const motDelta = mot <= 40 ? 10 : mot >= 70 ? -10 : -3;
  emp.motivation = Math.min(100, Math.max(1, mot + motDelta));
  gs.turnActions.transferCount++;

  saveProject();
  refreshAllScreens();
  updateNavInfo();
  UIModule.showNotification(
    `${emp.name} を ${targetUnit.name} へ異動しました`,
    'success'
  );
}

/**
 * 【3】部門の親部門を変更する（ドラッグアンドドロップ）
 * @param {string} unitId     - 移動するユニットID
 * @param {string} newParentId - 新しい親ユニットID
 */
function handleMoveUnit(unitId, newParentId) {
  const gs = window.gameState;
  if (!gs) return;

  const unit = (gs.orgUnits || []).find(u => u.id === unitId);
  if (!unit) { UIModule.showNotification('部門が見つかりません', 'error'); return; }

  // 自己ドロップ禁止
  if (unitId === newParentId) { UIModule.showNotification('自分自身へはドロップできません', 'warning'); return; }

  const newParent = (gs.orgUnits || []).find(u => u.id === newParentId);
  if (!newParent) { UIModule.showNotification('移動先部門が見つかりません', 'warning'); return; }
  // isBoard（取締役室）直下へのドロップはOK

  // 子孫チェック：unitId が newParentId の祖先なら禁止
  let current = gs.orgUnits.find(u => u.id === newParentId);
  const visited = new Set();
  while (current && current.parentId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (current.parentId === unitId) {
      UIModule.showNotification('子孫部門への移動は禁止されています', 'warning');
      return;
    }
    current = gs.orgUnits.find(u => u.id === current.parentId);
  }

  unit.parentId = newParentId;
  // Bug③修正: 移動先親の level に基づいて level を更新
  unit.level = newParent.isBoard ? 1 : Math.min(newParent.level + 1, 5);

  gs.history.push({
    year:    gs.currentYear,
    type:    'org_move',
    message: `「${unit.name}」を「${newParent.name}」配下に移動しました`,
  });

  saveProject();
  UIModule.renderOrgChart(gs);
  UIModule.showNotification(`「${unit.name}」を「${newParent.name}」配下に移動しました`, 'success');
}

/**
 * 部門を兄弟間で並び替える（ドロップゾーン間ドロップ）
 * @param {string} dragId       - 移動するユニットID
 * @param {string} newParentId  - ドロップ先の親ユニットID
 * @param {string} insertBefore - この兄弟の直前に挿入（'END'なら末尾）
 */
function handleReorderUnit(dragId, newParentId, insertBefore) {
  const gs = window.gameState;
  if (!gs || !gs.orgUnits) return;

  const unit = gs.orgUnits.find(u => u.id === dragId);
  if (!unit || unit.isBoard) return;
  if (dragId === newParentId) return;

  // 子孫への移動禁止
  let cur = gs.orgUnits.find(u => u.id === newParentId);
  const vis = new Set();
  while (cur && cur.parentId) {
    if (vis.has(cur.id)) break;
    vis.add(cur.id);
    if (cur.parentId === dragId) {
      UIModule.showNotification('子孫部門への移動は禁止されています', 'warning');
      return;
    }
    cur = gs.orgUnits.find(u => u.id === cur.parentId);
  }

  // 配列から取り出す
  const idx = gs.orgUnits.indexOf(unit);
  if (idx < 0) return;
  gs.orgUnits.splice(idx, 1);

  // 親と level を更新（Bug③修正）
  const newParentUnit = gs.orgUnits.find(u => u.id === newParentId);
  unit.parentId = newParentId;
  if (newParentUnit) {
    unit.level = newParentUnit.isBoard ? 1 : Math.min(newParentUnit.level + 1, 5);
  }

  // 挿入位置を決定
  if (insertBefore && insertBefore !== 'END') {
    const beforeIdx = gs.orgUnits.findIndex(u => u.id === insertBefore);
    if (beforeIdx >= 0) {
      gs.orgUnits.splice(beforeIdx, 0, unit);
    } else {
      gs.orgUnits.push(unit);
    }
  } else {
    // 同じ親の最後の兄弟の直後に挿入
    let lastSibIdx = -1;
    for (let i = 0; i < gs.orgUnits.length; i++) {
      if (gs.orgUnits[i].parentId === newParentId) lastSibIdx = i;
    }
    gs.orgUnits.splice(lastSibIdx + 1, 0, unit);
  }

  const newParent = gs.orgUnits.find(u => u.id === newParentId);
  saveProject();
  UIModule.renderOrgChart(gs);
  UIModule.showNotification(`「${unit.name}」の並び順を変更しました`, 'success');
}

/**
 * 【5a】並び替えボタンによる兄弟間の表示順変更
 * @param {string} unitId
 * @param {'top'|'up'|'down'|'bottom'} direction
 */
function handleShiftUnit(unitId, direction) {
  const gs = window.gameState;
  if (!gs?.orgUnits) return;
  const unit = gs.orgUnits.find(u => u.id === unitId);
  if (!unit || unit.isBoard) return;

  // 同じ parentId を持つ兄弟を配列順で取得
  const siblings = gs.orgUnits
    .filter(u => u.parentId === unit.parentId)
    .sort((a, b) => gs.orgUnits.indexOf(a) - gs.orgUnits.indexOf(b));

  if (siblings.length <= 1) return;

  const sibIdx = siblings.findIndex(s => s.id === unitId);
  let targetSib;
  switch (direction) {
    case 'top':    if (sibIdx === 0) return; targetSib = siblings[0]; break;
    case 'up':     if (sibIdx === 0) return; targetSib = siblings[sibIdx - 1]; break;
    case 'down':   if (sibIdx === siblings.length - 1) return; targetSib = siblings[sibIdx + 1]; break;
    case 'bottom': if (sibIdx === siblings.length - 1) return; targetSib = siblings[siblings.length - 1]; break;
    default: return;
  }

  // 配列から取り出して targetSib の前後に挿入
  const unitOrgIdx = gs.orgUnits.indexOf(unit);
  gs.orgUnits.splice(unitOrgIdx, 1);
  const targetOrgIdx = gs.orgUnits.indexOf(targetSib);
  if (direction === 'top' || direction === 'up') {
    gs.orgUnits.splice(targetOrgIdx, 0, unit);
  } else {
    gs.orgUnits.splice(targetOrgIdx + 1, 0, unit);
  }

  saveProject();
  UIModule.renderOrgChart(gs);
  UIModule.showNotification(`「${unit.name}」の並び順を変更しました`, 'success');
}

/**
 * 【5】役職の表示番号を更新する
 * @param {string} positionId
 * @param {string|number} value
 */
function handleUpdatePositionDisplayOrder(positionId, value) {
  const gs = window.gameState;
  if (!gs) return;
  const pos = (gs.positions || []).find(p => p.id === positionId);
  if (!pos) return;
  const num = parseInt(value, 10);
  pos.displayOrder = isNaN(num) ? null : num;
  saveProject();
  UIModule.renderSettings(gs);
}

/**
 * 【6】取締役の表示番号を更新する
 * @param {number} employeeId
 * @param {string|number} value
 */
function handleUpdateBoardMemberDisplayOrder(employeeId, value) {
  const gs = window.gameState;
  if (!gs) return;
  const member = (gs.board || []).find(b => b.employeeId === Number(employeeId));
  if (!member) return;
  const num = parseInt(value, 10);
  member.displayOrder = isNaN(num) ? null : num;
  saveProject();
  UIModule.renderSettings(gs);
}

function handleUpdateLocationDisplayOrder(locationId, value) {
  const gs = window.gameState;
  if (!gs) return;
  const loc = (gs.locations || []).find(l => l.id === locationId);
  if (!loc) return;
  const num = parseInt(value, 10);
  loc.displayOrder = isNaN(num) ? null : num;
  saveProject();
  UIModule.renderSettings(gs);
}

/**
 * 部門を削除する
 * @param {string} unitId
 */
function handleDeleteUnit(unitId) {
  const gs = window.gameState;
  if (!gs) return;

  const unit = gs.orgUnits.find(u => u.id === unitId);
  if (!unit) return;

  if ((unit.employeeIds || []).length > 0) {
    UIModule.showNotification('社員が在籍中のため削除できません', 'error');
    return;
  }
  if (gs.orgUnits.some(u => u.parentId === unitId)) {
    UIModule.showNotification('子部門が存在するため削除できません', 'error');
    return;
  }

  gs.orgUnits = gs.orgUnits.filter(u => u.id !== unitId);
  saveProject();
  UIModule.renderOrgChart(gs);
  UIModule.showNotification(`「${unit.name}」を削除しました`, 'success');
}

// ============================================================
// 画面制御
// ============================================================

/**
 * プロジェクト一覧画面を表示する
 */
function showProjectListScreen() {
  const projects = ProjectManager.getProjectList();
  const currentId = ProjectManager.getCurrentProjectId() || '';
  UIModule.renderProjectList(projects, currentId);
  UIModule.showScreen('project-list');
}

/**
 * 全画面を現在の状態で再描画する（アクティブ画面のみ）
 */
function refreshAllScreens() {
  const gs = window.gameState;
  if (!gs) return;
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) return;
  const screenId = activeScreen.id.replace('screen-', '');
  _renderScreen(screenId, gs);
}

/**
 * 指定画面を描画する
 * @param {string}    screenId
 * @param {GameState} gs
 */
function _renderScreen(screenId, gs) {
  switch (screenId) {
    case 'dashboard':
      UIModule.renderDashboard(gs);
      break;
    case 'orgchart':
      UIModule.renderOrgChart(gs);
      break;
    case 'employees':
      UIModule.renderEmployeeList(gs);
      break;
    case 'hr-actions':
      UIModule.renderHRActions(gs);
      break;
    case 'turn':
      UIModule.renderTurnScreen(gs, gs.lastSimResult);
      break;
    case 'settings':
      UIModule.renderSettings(gs);
      break;
    case 'project-list':
      UIModule.renderProjectList(ProjectManager.getProjectList(), gs?.projectId || '');
      break;
  }
}

// ============================================================
// ナビゲーション情報更新
// ============================================================

function updateNavInfo() {
  const gs = window.gameState;
  if (!gs) return;

  const yearEl    = document.getElementById('nav-year');
  const companyEl = document.getElementById('nav-company');
  const balanceEl = document.getElementById('nav-balance');
  const projEl    = document.getElementById('nav-project');

  if (yearEl)    yearEl.textContent    = `${gs.currentYear}年度`;
  if (companyEl) companyEl.textContent = `社員数: ${gs.employees.length}名`;
  if (projEl)    projEl.textContent    = gs.projectName || '';
  if (balanceEl) {
    const cash = gs.finances?.cash || 0;
    balanceEl.textContent = `資金: ${cash >= 0 ? '' : '-'}${Math.abs(cash).toLocaleString()}万円`;
    balanceEl.style.background = cash >= 0
      ? 'rgba(255,255,255,0.15)'
      : 'rgba(220,38,38,0.4)';
  }
}

// ============================================================
// フォーム選択肢の動的生成
// ============================================================

function _populateFormSelects() {
  const gs = window.gameState;
  if (!gs) return;

  const JOB_TYPES        = DataModule.JOB_TYPES;
  const GRADE_ORDER      = DataModule.GRADE_ORDER;
  const GRADE_DEFINITIONS = DataModule.GRADE_DEFINITIONS;
  const POTENTIAL_TYPES  = DataModule.POTENTIAL_TYPES;

  // 採用フォーム: 職種
  const hireJobType = document.getElementById('hire-jobtype');
  if (hireJobType) {
    hireJobType.innerHTML = Object.entries(JOB_TYPES)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  }

  // 採用フォーム: グレード別採用人数テーブル
  const hireGradeRows = document.getElementById('hire-grade-rows');
  if (hireGradeRows) {
    hireGradeRows.innerHTML = GRADE_ORDER.map(g => {
      const label = GRADE_DEFINITIONS[g]?.label || g;
      return `<tr data-grade="${g}">
        <td><span class="badge badge-grade">${g}</span></td>
        <td>${label}</td>
        <td><input type="number" class="hire-grade-count" data-grade="${g}" min="0" max="50" value="0" style="width:60px;"></td>
      </tr>`;
    }).join('');
  }

  // フィルタ: 職種
  const filterJobType = document.getElementById('filter-jobtype');
  if (filterJobType) {
    filterJobType.innerHTML = '<option value="">全職種</option>' +
      Object.entries(JOB_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  }

  // フィルタ: グレード
  const filterGrade = document.getElementById('filter-grade');
  if (filterGrade) {
    filterGrade.innerHTML = '<option value="">全グレード</option>' +
      GRADE_ORDER.map(g => `<option value="${g}">${g}</option>`).join('');
  }

  // フィルタ: ポテンシャル
  const filterPotential = document.getElementById('filter-potential');
  if (filterPotential) {
    filterPotential.innerHTML = '<option value="">全ポテンシャル</option>' +
      Object.entries(POTENTIAL_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  }

  // フィルタ: 部門（全部門）
  const filterUnit = document.getElementById('filter-unit');
  if (filterUnit) {
    filterUnit.innerHTML = '<option value="">全部門</option>' +
      (gs.orgUnits || []).map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  }

  // 採用フォーム: 配属先部門
  const hireUnit = document.getElementById('hire-unit');
  if (hireUnit) {
    hireUnit.innerHTML = '<option value="">自動配属（最少人数の部門）</option>' +
      (gs.orgUnits || []).map(u =>
        `<option value="${u.id}">${u.name}（${(u.employeeIds || []).length}名）</option>`
      ).join('');
  }
}

// ============================================================
// プロジェクト一覧UIの更新
// ============================================================

function _refreshProjectListUI() {
  const gs = window.gameState;
  const projects = ProjectManager.getProjectList();
  UIModule.renderProjectList(projects, gs?.projectId || '');
}

// ============================================================
// GlobalCallbacks の登録
// ============================================================

window.GameCallbacks = {
  // プロジェクト管理
  loadProject,
  deleteProject(projectId) {
    if (!confirm('このプロジェクトを削除しますか？')) return;
    ProjectManager.deleteProject(projectId);
    const projects = ProjectManager.getProjectList();
    if (projects.length === 0) {
      _createNewProject({ projectName: '新しい会社' });
    } else {
      loadProject(projects[0].id);
    }
    _refreshProjectListUI();
  },
  openModal(modalId) {
    // 【6】取締役任命モーダルは社員セレクトを動的初期化
    if (modalId === 'modal-add-board-member') {
      const gs = window.gameState;
      if (gs) {
        const select = document.getElementById('board-employee-id');
        if (select) {
          const boardIds = (gs.board || []).map(b => b.employeeId);
          select.innerHTML = '<option value="">社員を選択</option>' +
            (gs.employees || []).map(emp => {
              const inBoard = boardIds.includes(emp.id) ? '（既に取締役）' : '';
              return `<option value="${emp.id}">${emp.name} ${emp.grade} ${inBoard}</option>`;
            }).join('');
          select.disabled = false;
        }
        // ヘッダー・ボタンを追加モードにリセット
        const hdr = document.querySelector('#modal-add-board-member .modal-header h3');
        if (hdr) hdr.textContent = '取締役を任命';
        const btn = document.getElementById('add-board-member-confirm');
        if (btn) btn.textContent = '任命する';
      }
    }
    UIModule.showModal(modalId);
  },
  closeModal(modalId) { UIModule.hideModal(modalId); },

  // 人事アクション
  handleHire,
  handlePromote,
  handleDemote,
  handleTransfer,
  handleRetire,
  renameProject,

  // 役職割り当て
  openPositionModal(employeeId) {
    const gs  = window.gameState;
    if (!gs) return;
    const emp = gs.employees.find(e => e.id === employeeId);
    if (!emp) return;

    const nameEl = document.getElementById('modal-position-employee-name');
    const bodyEl  = document.getElementById('modal-position-body');
    if (nameEl) nameEl.textContent =
      `${emp.name}（${emp.grade} / 現在: ${(emp.positionIds || []).length === 0 ? 'なし' :
        emp.positionIds.map(pid => (gs.positions || []).find(p => p.id === pid)?.name || pid).join('、')}）`;
    if (bodyEl) {
      // 役職チェックボックスリスト（最大3件）
      const positions = gs.positions || [];
      bodyEl.innerHTML = positions.map(p => {
        const checked = (emp.positionIds || []).includes(p.id) ? 'checked' : '';
        return `<label><input type="checkbox" name="positionId" value="${p.id}" ${checked}>
          ${p.name}（Lv.${p.level} / 手当 ${p.allowance}万円）
        </label>`;
      }).join('<br>');
    }

    document.getElementById('modal-position-employee-id').value = employeeId;
    UIModule.showModal('modal-assign-position');
  },

  handleAssignPositions,

  // 組織操作
  handleAddUnit,
  handleDeleteUnit,
  handleEditUnit,

  openEditUnitModal(unitId) {
    const gs   = window.gameState;
    const unit = (gs?.orgUnits || []).find(u => u.id === unitId);
    if (!unit) return;

    const idEl   = document.getElementById('edit-unit-id');
    const nameEl = document.getElementById('edit-unit-name');
    const costEl = document.getElementById('edit-unit-costtype');
    const locEl  = document.getElementById('edit-unit-location');
    const parentEl = document.getElementById('edit-unit-parent');
    const slotsContainer = document.getElementById('edit-unit-slots-container');

    if (idEl)   idEl.value   = unit.id;
    if (nameEl) nameEl.value = unit.name;
    if (costEl) costEl.value = unit.costType || 'sga';

    // 拠点選択肢
    if (locEl) {
      const locations = gs.locations || [];
      locEl.innerHTML = '<option value="">（未設定）</option>' +
        locations.map(l =>
          `<option value="${l.id}"${unit.locationId === l.id ? ' selected' : ''}>${l.name}</option>`
        ).join('');
    }

    // 親部門選択肢（isBoard の場合は非表示に）
    const parentRow = parentEl?.closest('label');
    if (unit.isBoard) {
      if (parentRow) parentRow.style.display = 'none';
      // 部門区分も非表示
      if (costEl) costEl.closest('label').style.display = 'none';
    } else {
      if (parentRow) parentRow.style.display = '';
      if (costEl) costEl.closest('label').style.display = '';
      if (parentEl) {
        const orgUnits = gs.orgUnits || [];
        parentEl.innerHTML = '<option value="">（ルート部門 / 独立）</option>' +
          orgUnits
            .filter(u => u.id !== unitId) // 自分自身は除外
            .map(u => {
              const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
              const typeDef = u.unitTypeId ? UNIT_TYPE_DEFS.find(d => d.id === u.unitTypeId) : null;
              const lbl = u.isBoard ? '取締役室' : (typeDef ? typeDef.name : `Lv.${u.level}`);
              const selected = unit.parentId === u.id ? ' selected' : '';
              return `<option value="${u.id}"${selected}>[${lbl}] ${u.name}</option>`;
            }).join('');
      }
    }

    // 部門種別セレクト
    const unitTypeEl  = document.getElementById('edit-unit-unittype');
    const unitTypeRow = document.getElementById('edit-unit-unittype-row');
    if (unit.isBoard) {
      if (unitTypeRow) unitTypeRow.style.display = 'none';
    } else {
      if (unitTypeRow) unitTypeRow.style.display = '';
      if (unitTypeEl)  unitTypeEl.value = unit.unitTypeId || 'ut_bu';
    }

    // 役職スロット（unitTypeId から自動判定）
    if (slotsContainer) {
      if (unit.isBoard) {
        slotsContainer.innerHTML = ''; // 取締役室はスロット不要
      } else {
        const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
        const utDef = unit.unitTypeId ? UNIT_TYPE_DEFS.find(d => d.id === unit.unitTypeId) : null;
        const slots = unit.positionSlots || [];
        const GRADE_ORDER = window.DataModule?.GRADE_ORDER || [];

        // この部門に所属している社員（グレード降順）
        const unitEmps = (gs.employees || [])
          .filter(e => e.unitId === unit.id)
          .sort((a, b) => GRADE_ORDER.indexOf(b.grade) - GRADE_ORDER.indexOf(a.grade));

        const empOptions = '<option value="">（未割当）</option>' +
          unitEmps.map(e => `<option value="${e.id}">${e.name}（${e.grade}）</option>`).join('');

        // slot0
        const s0 = slots[0] || { slotIndex: 0, positionId: null, employeeId: null };
        // slot1
        const s1 = slots[1] || { slotIndex: 1, positionId: null, employeeId: null };

        const pos1Name = utDef?.pos1Name || '部門管理者1';
        const pos2Name = utDef?.pos2Name || null;

        // 対応する役職ID（INITIAL_POSITIONS から）
        const pos1 = utDef ? (gs.positions || []).find(p => p.unitTypeId === utDef.id && p.slotIndex === 0) : null;
        const pos2 = utDef ? (gs.positions || []).find(p => p.unitTypeId === utDef.id && p.slotIndex === 1) : null;

        let html = `
          <div style="border-top:1px solid #e2e8f0;margin-top:12px;padding-top:12px;">
            <p style="font-size:13px;font-weight:600;margin-bottom:8px;">${pos1Name}</p>
            <label>担当者
              <select id="edit-unit-slot0-employee">
                ${empOptions}
              </select>
            </label>
            <input type="hidden" id="edit-unit-slot0-position" value="${pos1?.id || ''}">
          </div>`;

        if (pos2Name) {
          html += `
            <div style="margin-top:8px;">
              <p style="font-size:13px;font-weight:600;margin-bottom:8px;">${pos2Name}</p>
              <label>担当者
                <select id="edit-unit-slot1-employee">
                  ${empOptions}
                </select>
              </label>
              <input type="hidden" id="edit-unit-slot1-position" value="${pos2?.id || ''}">
            </div>`;
        } else {
          html += `<input type="hidden" id="edit-unit-slot1-employee" value="">
                   <input type="hidden" id="edit-unit-slot1-position" value="">`;
        }

        slotsContainer.innerHTML = html;

        // 既存の割当を反映
        const slot0EmpEl = document.getElementById('edit-unit-slot0-employee');
        const slot1EmpEl = document.getElementById('edit-unit-slot1-employee');
        if (slot0EmpEl && s0.employeeId) slot0EmpEl.value = String(s0.employeeId);
        if (slot1EmpEl && s1.employeeId) slot1EmpEl.value = String(s1.employeeId);
      }
    }

    UIModule.showModal('modal-edit-unit');
  },

  // 設定系
  handleAddPosition,
  handleDeletePosition,
  openEditPositionModal(positionId) {
    const gs  = window.gameState;
    const pos = (gs?.positions || []).find(p => p.id === positionId);
    if (!pos) { UIModule.showNotification('役職が見つかりません', 'error'); return; }
    // add-position モーダルを編集用に流用
    const nameEl      = document.getElementById('add-position-name');
    const levelEl     = document.getElementById('add-position-level');
    const allowanceEl = document.getElementById('add-position-allowance');
    if (nameEl)      nameEl.value      = pos.name;
    if (levelEl)     levelEl.value     = pos.level;
    if (allowanceEl) allowanceEl.value = pos.allowance;
    // 確定ボタンの挙動を編集用に切り替え
    const confirmBtn = document.getElementById('add-position-confirm');
    if (confirmBtn) {
      confirmBtn.dataset.editPositionId = positionId;
      confirmBtn.textContent = '変更';
    }
    // ヘッダーも変更
    const header = document.querySelector('#modal-add-position .modal-header h3');
    if (header) header.textContent = '役職を編集';
    UIModule.showModal('modal-add-position');
  },

  handleAddLocation,
  handleDeleteLocation,
  openEditLocationModal(locationId) {
    const gs  = window.gameState;
    const loc = (gs?.locations || []).find(l => l.id === locationId);
    if (!loc) { UIModule.showNotification('拠点が見つかりません', 'error'); return; }
    // add-location モーダルを編集用に流用
    const nameEl     = document.getElementById('add-location-name');
    const regionEl   = document.getElementById('add-location-region');
    const capacityEl = document.getElementById('add-location-capacity');
    if (nameEl)     nameEl.value     = loc.name;
    if (regionEl)   regionEl.value   = loc.regionType;
    if (capacityEl) capacityEl.value = loc.capacity;
    // 確定ボタンの挙動を編集用に切り替え
    const confirmBtn = document.getElementById('add-location-confirm');
    if (confirmBtn) {
      confirmBtn.dataset.editLocationId = locationId;
      confirmBtn.textContent = '変更';
    }
    const header = document.querySelector('#modal-add-location .modal-header h3');
    if (header) header.textContent = '拠点を編集';
    UIModule.showModal('modal-add-location');
  },

  handleUpdateChroName,
  handleUpdateGrade,
  handleUpdatePositionDisplayOrder,
  handleUpdateBoardMemberDisplayOrder,
  handleUpdateLocationDisplayOrder,
  handleMoveUnit,
  handleReorderUnit,
  handleShiftUnit,
  handleTransferToUnit,

  openAddUnitModal(parentId) {
    const gs = window.gameState;
    if (!gs) return;
    // showModal が内部で _populateAddUnitModal を呼ぶので先に開く
    UIModule.showModal('modal-add-unit');
    // showModal 後にparentIdをセット（先にセットしても showModal 内で上書きされるため）
    if (parentId) {
      const parentSelect = document.getElementById('add-unit-parent');
      if (parentSelect) {
        parentSelect.value = parentId;
        const parentUnit = (gs.orgUnits || []).find(u => u.id === parentId);
        if (parentUnit) {
          const costEl = document.getElementById('add-unit-costtype');
          if (costEl && parentUnit.costType) costEl.value = parentUnit.costType;
          const locEl = document.getElementById('add-unit-location');
          if (locEl && parentUnit.locationId) locEl.value = parentUnit.locationId;
        }
      }
    }
  },

  handleAddBoardMember,
  handleRemoveBoardMember,

  // 執行役員
  handleAddExecutiveOfficer,
  handleRemoveExecutiveOfficer,

  // 研修
  handleAddTrainingType,
  handleDeleteTrainingType,
  handlePlanTraining,
  handleExecuteTraining,
  handleExecuteAllTrainings,
  handleDeleteTraining,

  // 難易度
  handleUpdateDifficulty,

  openEditBoardMemberModal(employeeId) {
    const gs     = window.gameState;
    const member = (gs?.board || []).find(b => b.employeeId === employeeId);
    if (!member) { UIModule.showNotification('取締役が見つかりません', 'error'); return; }
    // add-board-member モーダルを編集用に流用
    const empSelect    = document.getElementById('board-employee-id');
    const attrSelect   = document.getElementById('board-attribute');
    const roleSelect   = document.getElementById('board-role');
    const compInput    = document.getElementById('board-compensation');
    // 社員選択肢を更新してから値をセット
    UIModule.showModal('modal-add-board-member');
    if (empSelect)  { empSelect.value  = employeeId; empSelect.disabled = true; }
    if (attrSelect) attrSelect.value   = member.attribute;
    if (roleSelect) roleSelect.value   = member.role || '';
    if (compInput)  compInput.value    = member.compensation;
    const header = document.querySelector('#modal-add-board-member .modal-header h3');
    if (header) header.textContent = '取締役情報を編集';
    const confirmBtn = document.getElementById('add-board-member-confirm');
    if (confirmBtn) confirmBtn.textContent = '更新する';
  },

  // プロモーション候補モーダル（G6以上）
  openPromotionModal(employeeId) {
    const gs  = window.gameState;
    const emp = (gs?.employees || []).find(e => e.id === employeeId);
    if (!emp) return;
    // 昇格先グレード選択モーダル
    const GRADE_ORDER = DataModule.GRADE_ORDER;
    const currentIdx  = GRADE_ORDER.indexOf(emp.grade);
    if (currentIdx < 0 || currentIdx >= GRADE_ORDER.length - 1) return;
    const nextGrades  = GRADE_ORDER.slice(currentIdx + 1);

    const bodyEl  = document.getElementById('modal-promote-body');
    const nameEl  = document.getElementById('modal-promote-employee-name');
    if (nameEl) nameEl.textContent = `${emp.name}（${emp.grade}）`;
    if (bodyEl) {
      bodyEl.innerHTML = nextGrades.map(g => `
        <button class="btn btn-success mb-2"
          onclick="window.GameCallbacks.handlePromote(${emp.id}, '${g}'); window.UIModule.hideModal('modal-promote');">
          ${g}（${DataModule.GRADE_DEFINITIONS[g]?.label || g}）へ昇格
        </button><br>`).join('');
    }
    UIModule.showModal('modal-promote');
  },

  // 社員詳細
  showEmployeeDetail(employeeId) {
    const gs  = window.gameState;
    const emp = (gs?.employees || []).find(e => e.id === employeeId);
    if (!emp) return;
    UIModule.showModal('modal-employee-detail', emp);
  },

  // 組織図採用ボタン用：部門指定でモーダルを開く準備
  _populateHireModalForUnit(unitId) {
    const gs = window.gameState;
    if (!gs) return;
    _populateFormSelects(); // job type / unit選択肢を再生成
    const hireUnit = document.getElementById('hire-unit');
    if (hireUnit) hireUnit.value = unitId || '';
    // グレードカウントをリセット
    document.querySelectorAll('.hire-grade-count').forEach(inp => { inp.value = '0'; });
  },

  // 組織図内スロット任命
  handleOrgSlotAssign(unitId, slotIndex, employeeId) {
    const gs = window.gameState;
    if (!gs) return;
    const unit = (gs.orgUnits || []).find(u => u.id === unitId);
    if (!unit) return;
    if (!unit.positionSlots) unit.positionSlots = [
      { slotIndex: 0, positionId: null, employeeId: null },
      { slotIndex: 1, positionId: null, employeeId: null },
    ];

    const slot = unit.positionSlots[slotIndex];
    if (!slot) return;

    if (slot.employeeId === employeeId) {
      // 既に任命済み → 解除
      slot.employeeId = null;
      slot.positionId = null;
      _syncPositionIds(gs);
      UIModule.showNotification('役職を解除しました', 'info');
    } else {
      // 対応する役職IDを解決
      const pos = (gs.positions || []).find(p => p.unitTypeId === unit.unitTypeId && p.slotIndex === slotIndex);
      // モチベーションボーナス計算用に任命前の状態を保存
      const emp = (gs.employees || []).find(e => e.id === employeeId);
      const wasNoPosition = emp ? (emp.positionIds || []).length === 0 : false;
      const oldMinLevel   = wasNoPosition ? Infinity : (emp?.positionIds || []).reduce((min, pid) => {
        const p = (gs.positions || []).find(q => q.id === pid);
        return p ? Math.min(min, p.level) : min;
      }, Infinity);
      // スロット更新（前任者含め _syncPositionIds で一括処理）
      slot.employeeId = employeeId;
      slot.positionId = pos ? pos.id : null;
      _syncPositionIds(gs);
      // モチベーションボーナス
      if (emp && pos) {
        if (wasNoPosition) {
          emp.motivation = Math.min(100, (emp.motivation || 50) + 8);
        } else if (pos.level < oldMinLevel) {
          emp.motivation = Math.min(100, (emp.motivation || 50) + 5);
        }
      }
      UIModule.showNotification(`${emp?.name || '社員'} を任命しました`, 'success');
    }

    saveProject();
    UIModule.renderOrgChart(gs);
  },

  // 画面切替
  switchScreen(screenId) {
    const gs = window.gameState;
    UIModule.showScreen(screenId);
    if (gs) _renderScreen(screenId, gs);
  },

  saveProject,
};

// ============================================================
// イベントリスナー設定
// ============================================================

function _setupEventListeners() {
  // ナビゲーションリンク
  document.querySelectorAll('.nav-link[data-screen]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const screenId = link.dataset.screen;
      const gs = window.gameState;
      UIModule.showScreen(screenId);
      if (gs) _renderScreen(screenId, gs);
    });
  });

  // プロジェクト管理ボタン
  const btnProject = document.getElementById('btn-project-list');
  if (btnProject) {
    btnProject.addEventListener('click', () => showProjectListScreen());
  }

  // ターン進行ボタン
  const btnAdvance = document.getElementById('btn-advance-turn');
  if (btnAdvance) {
    btnAdvance.addEventListener('click', () => advanceTurn());
  }

  // 設定メニュー
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', e => {
      e.preventDefault();
      const gs = window.gameState;
      UIModule.showScreen('settings');
      if (gs) UIModule.renderSettings(gs);
    });
  }

  // モーダルを閉じる（.modal-close / .modal-overlay）
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', () => {
      const modal = el.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  // 採用フォーム送信
  const hireForm = document.getElementById('form-hire');
  if (hireForm) {
    hireForm.addEventListener('submit', e => {
      e.preventDefault();
      const jobType = document.getElementById('hire-jobtype')?.value;
      const unitId  = document.getElementById('hire-unit')?.value || null;
      const gradeCounts = [];
      document.querySelectorAll('#hire-grade-rows tr').forEach(tr => {
        const grade = tr.dataset.grade;
        const input = tr.querySelector('.hire-grade-count');
        const count = parseInt(input?.value || '0', 10);
        if (grade && count > 0) gradeCounts.push({ grade, count });
      });
      handleHire({ jobType, unitId, gradeCounts });
      // グレードカウントをリセット
      document.querySelectorAll('.hire-grade-count').forEach(inp => { inp.value = '0'; });
      UIModule.hideModal('modal-hire');
    });
  }

  // 役職割り当て確定ボタン
  const assignPositionConfirm = document.getElementById('assign-position-confirm');
  if (assignPositionConfirm) {
    assignPositionConfirm.addEventListener('click', () => {
      const employeeId = parseInt(document.getElementById('modal-position-employee-id').value, 10);
      const checked    = Array.from(
        document.querySelectorAll('#modal-position-body input[name="positionId"]:checked')
      ).map(el => el.value);
      handleAssignPositions(employeeId, checked);
      UIModule.hideModal('modal-assign-position');
    });
  }

  // 新規プロジェクト作成フォーム
  const newProjectForm = document.getElementById('form-new-project');
  if (newProjectForm) {
    newProjectForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(newProjectForm);
      const name      = fd.get('projectName')?.trim() || '新しい会社';
      const startYear = parseInt(fd.get('startYear') || '2025', 10);
      _createNewProject({ projectName: name, startYear });
      UIModule.hideModal('modal-new-project');
    });
  }

  // 部門追加フォーム（modal-add-unit）
  const addUnitConfirm = document.getElementById('add-unit-confirm');
  if (addUnitConfirm) {
    addUnitConfirm.addEventListener('click', () => {
      const name       = document.getElementById('add-unit-name')?.value?.trim();
      const unitTypeId = document.getElementById('add-unit-unittype')?.value || 'ut_bu';
      const UNIT_TYPE_DEFS = window.OrgModule?.UNIT_TYPE_DEFS || [];
      const utDef = UNIT_TYPE_DEFS.find(d => d.id === unitTypeId);
      const level  = utDef ? utDef.levelNum : 4;
      const parentId   = document.getElementById('add-unit-parent')?.value || null;
      const costType   = document.getElementById('add-unit-costtype')?.value || 'sga';
      const locationId = document.getElementById('add-unit-location')?.value || null;

      handleAddUnit({ name, level, unitTypeId, parentId, costType, locationId });
      UIModule.hideModal('modal-add-unit');
    });
  }

  // 役職追加/編集フォーム（modal-add-position）共用
  const addPositionConfirm = document.getElementById('add-position-confirm');
  if (addPositionConfirm) {
    addPositionConfirm.addEventListener('click', () => {
      const name      = document.getElementById('add-position-name')?.value?.trim();
      const level     = parseInt(document.getElementById('add-position-level')?.value || '4', 10);
      const allowance = parseInt(document.getElementById('add-position-allowance')?.value || '0', 10);
      const editId    = addPositionConfirm.dataset.editPositionId || '';

      if (editId) {
        // 編集モード：既存の役職を更新
        const gs = window.gameState;
        if (gs) {
          const pos = (gs.positions || []).find(p => p.id === editId);
          if (pos) { pos.name = name; pos.level = level; pos.allowance = allowance; }
          saveProject();
          UIModule.renderSettings(gs);
          UIModule.showNotification(`役職「${name}」を更新しました`, 'success');
        }
        // 次回は追加モードに戻す
        delete addPositionConfirm.dataset.editPositionId;
        addPositionConfirm.textContent = '追加';
        const hdr = document.querySelector('#modal-add-position .modal-header h3');
        if (hdr) hdr.textContent = '役職を追加';
      } else {
        handleAddPosition({ name, level, allowance });
      }
      UIModule.hideModal('modal-add-position');
    });
  }

  // 拠点追加/編集フォーム（modal-add-location）共用
  const addLocationConfirm = document.getElementById('add-location-confirm');
  if (addLocationConfirm) {
    addLocationConfirm.addEventListener('click', () => {
      const name       = document.getElementById('add-location-name')?.value?.trim();
      const regionType = document.getElementById('add-location-region')?.value || 'metropolitan';
      const capacity   = parseInt(document.getElementById('add-location-capacity')?.value || '50', 10);
      const editId     = addLocationConfirm.dataset.editLocationId || '';

      if (editId) {
        // 編集モード：既存の拠点を更新
        const gs = window.gameState;
        if (gs) {
          const loc = (gs.locations || []).find(l => l.id === editId);
          if (loc) { loc.name = name; loc.regionType = regionType; loc.capacity = capacity; }
          saveProject();
          UIModule.renderSettings(gs);
          UIModule.showNotification(`拠点「${name}」を更新しました`, 'success');
        }
        // 次回は追加モードに戻す
        delete addLocationConfirm.dataset.editLocationId;
        addLocationConfirm.textContent = '追加';
        const hdr = document.querySelector('#modal-add-location .modal-header h3');
        if (hdr) hdr.textContent = '拠点を追加';
      } else {
        handleAddLocation({ name, regionType, capacity });
      }
      UIModule.hideModal('modal-add-location');
    });
  }

  // 取締役追加/編集フォーム（modal-add-board-member）共用
  const addBoardConfirm = document.getElementById('add-board-member-confirm');
  if (addBoardConfirm) {
    addBoardConfirm.addEventListener('click', () => {
      const empSelect   = document.getElementById('board-employee-id');
      const employeeId  = parseInt(empSelect?.value || '0', 10);
      const attribute   = document.getElementById('board-attribute')?.value;
      const role        = document.getElementById('board-role')?.value || null;
      const compensation = parseInt(document.getElementById('board-compensation')?.value || '0', 10);
      handleAddBoardMember({ employeeId, attribute, role, compensation });
      // 編集モード解除
      if (empSelect) empSelect.disabled = false;
      const hdr = document.querySelector('#modal-add-board-member .modal-header h3');
      if (hdr) hdr.textContent = '取締役を任命';
      addBoardConfirm.textContent = '任命する';
      UIModule.hideModal('modal-add-board-member');
    });
  }

  // 部門編集フォーム（modal-edit-unit）
  const editUnitConfirm = document.getElementById('edit-unit-confirm');
  if (editUnitConfirm) {
    editUnitConfirm.addEventListener('click', () => {
      const unitId     = document.getElementById('edit-unit-id')?.value;
      const name       = document.getElementById('edit-unit-name')?.value?.trim();
      const costType   = document.getElementById('edit-unit-costtype')?.value || 'sga';
      const locId      = document.getElementById('edit-unit-location')?.value || null;
      const parentId   = document.getElementById('edit-unit-parent')?.value || null;
      const unitTypeId = document.getElementById('edit-unit-unittype')?.value || null;

      const slot0posId = document.getElementById('edit-unit-slot0-position')?.value || null;
      const slot0empId = document.getElementById('edit-unit-slot0-employee')?.value || null;
      const slot1posId = document.getElementById('edit-unit-slot1-position')?.value || null;
      const slot1empId = document.getElementById('edit-unit-slot1-employee')?.value || null;

      const positionSlots = [
        { slotIndex: 0, positionId: slot0posId || null, employeeId: slot0empId ? parseInt(slot0empId, 10) : null },
        { slotIndex: 1, positionId: slot1posId || null, employeeId: slot1empId ? parseInt(slot1empId, 10) : null },
      ];

      handleEditUnit(unitId, { name, costType, locationId: locId, parentId, unitTypeId, positionSlots });
      UIModule.hideModal('modal-edit-unit');
    });
  }

  // 部門編集：削除ボタン（modal-edit-unit内）
  const editUnitDelete = document.getElementById('edit-unit-delete');
  if (editUnitDelete) {
    editUnitDelete.addEventListener('click', () => {
      const unitId = document.getElementById('edit-unit-id')?.value;
      const gs     = window.gameState;
      if (!gs || !unitId) return;
      const unit = gs.orgUnits.find(u => u.id === unitId);
      if (unit && confirm(`「${unit.name}」を削除しますか？`)) {
        UIModule.hideModal('modal-edit-unit');
        handleDeleteUnit(unitId);
      }
    });
  }
}

// ============================================================
// エントリポイント
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  _setupEventListeners();
  initGame();
});
