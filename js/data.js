/**
 * data.js - 社員データ・グレード・ポテンシャル・役員定義
 * window.DataModule として公開
 *
 * 依存: なし（他モジュールから参照される基盤モジュール）
 * 読み込み順: 最初（data.js → org.js → simulation.js → ui.js → main.js）
 *
 * 足軽・壱 実装担当箇所:
 *   - createEmployee()        : TODO参照
 *   - calcAutoPromotion()     : TODO参照
 *   - getPromotionCandidates(): TODO参照
 *   - applyYearlyStatusChange(): TODO参照
 */

'use strict';

// ============================================================
// 定数定義（完全実装）
// ============================================================

/**
 * グレード定義 G1〜G10
 * baseAnnualSalary: 万円/年（標準年俸）
 * @type {Object.<string, {label: string, baseAnnualSalary: number, description: string}>}
 */
const GRADE_DEFINITIONS = {
  G1:  { label: 'G1  / アソシエイト',   baseAnnualSalary:  300, description: '入社から数年の若手社員。基礎スキルを習得しながら業務を担う。先輩社員のサポートのもと、一人前を目指すフェーズ。' },
  G2:  { label: 'G2  / ミドル',         baseAnnualSalary:  380, description: '独立して業務を遂行できる中堅社員。担当領域において着実な成果を上げ、後輩への指導も期待される。' },
  G3:  { label: 'G3  / シニア',         baseAnnualSalary:  470, description: '専門性が高く、複雑な課題に自力で対処できる上級社員。プロジェクトの中核を担い、周囲への影響力も大きい。' },
  G4:  { label: 'G4  / リード',         baseAnnualSalary:  580, description: 'チームや業務領域をリードする存在。技術・業務の深い専門知識に加え、後進育成や横断的な課題解決を主導する。' },
  G5:  { label: 'G5  / マネジャー',     baseAnnualSalary:  700, description: '組織・チームを管理・運営する管理職。メンバーのパフォーマンスに責任を持ち、業務目標の達成を牽引する。' },
  G6:  { label: 'G6  / シニアマネジャー', baseAnnualSalary:  860, description: '複数チームや広い領域を統括するシニア管理職。経営方針を現場に落とし込み、組織の成果最大化を担う。' },
  G7:  { label: 'G7  / ディレクター',   baseAnnualSalary: 1050, description: '部門全体の方針・戦略策定に携わる。事業・機能の責任者として、経営層との連携のもと組織を統率する。' },
  G8:  { label: 'G8  / パートナー',     baseAnnualSalary: 1280, description: '会社の事業・文化・価値観を体現するリーダー。複数部門・事業にまたがる重要テーマを主導し、組織の方向性に影響を与える。' },
  G9:  { label: 'G9  / シニアパートナー', baseAnnualSalary: 1550, description: '経営に直結する高度な判断・意思決定を行うエグゼクティブ層の一角。事業成長・組織変革を強力に推進する。' },
  G10: { label: 'G10 / エグゼクティブ', baseAnnualSalary: 1900, description: '会社の最上位グレード。経営戦略の中枢を担い、取締役会と連携しながら企業価値の最大化に貢献する。' },
};

/**
 * グレード順序配列（昇順）
 * @type {string[]}
 */
const GRADE_ORDER = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'];

/**
 * 自動昇格対象グレード（G1〜G5）
 * G6以上はCHROが手動判断
 */
const AUTO_PROMOTION_MAX_GRADE = 'G5';
const AUTO_PROMOTION_MAX_INDEX = GRADE_ORDER.indexOf(AUTO_PROMOTION_MAX_GRADE); // 4

/**
 * 職種定義（5種）
 * coefficient: 売上計算用係数（仕様: 技術200/営業180/戦略160/専門80/事務40）
 * initialStats: 初期ステータス傾向（base値 ± range でランダム生成）
 *
 * @type {Object.<string, {
 *   label: string,
 *   description: string,
 *   coefficient: number,
 *   costType: 'cogs'|'sga',
 *   initialStats: {technical: {base:number, range:number}, communication: {base:number, range:number}, leadership: {base:number, range:number}}
 * }>}
 */
const JOB_TYPES = {
  engineer: {
    label:       '技術職',
    description: '開発・インフラ・QA・データサイエンス',
    coefficient: 200,
    costType:    'cogs',   // 原価
    initialStats: {
      technical:     { base: 55, range: 20 },  // テクニカル高め
      communication: { base: 35, range: 15 },  // コミュ低め
      leadership:    { base: 35, range: 15 },
    },
  },
  sales: {
    label:       '営業職',
    description: '顧客開拓・提案・クロージング・CS',
    coefficient: 180,
    costType:    'sga',    // 販管
    initialStats: {
      technical:     { base: 30, range: 15 },  // テクニカル低め
      communication: { base: 55, range: 20 },  // コミュ高め
      leadership:    { base: 40, range: 15 },
    },
  },
  strategy: {
    label:       '戦略職',
    description: '経営企画・事業開発・マーケティング',
    coefficient: 160,
    costType:    'sga',
    initialStats: {
      technical:     { base: 45, range: 15 },  // バランス型やや高め
      communication: { base: 48, range: 15 },
      leadership:    { base: 48, range: 15 },
    },
  },
  specialist: {
    label:       '専門職',
    description: '法務・財務・経理・人事・広報など専門業務',
    coefficient: 80,
    costType:    'sga',
    initialStats: {
      technical:     { base: 48, range: 15 },  // テクニカル中高
      communication: { base: 40, range: 15 },  // コミュ中
      leadership:    { base: 35, range: 15 },
    },
  },
  admin: {
    label:       '事務職',
    description: '総務・庶務・一般事務・バックオフィス',
    coefficient: 40,
    costType:    'sga',
    initialStats: {
      technical:     { base: 30, range: 12 },  // 全体中低め
      communication: { base: 35, range: 12 },
      leadership:    { base: 28, range: 12 },
    },
  },
};

/**
 * ポテンシャル定義（C/B/A/S）
 * growthMultiplier: スキル成長速度の乗数
 * promotionRelax: true の場合、昇格条件を緩和する
 *
 * @type {Object.<string, {label: string, growthMultiplier: number, promotionRelax: boolean, description: string}>}
 */
const POTENTIAL_TYPES = {
  C: { label: 'C（標準以下）', growthMultiplier: 0.7, promotionRelax: false, description: '成長速度が低い。基礎業務向き。' },
  B: { label: 'B（標準）',     growthMultiplier: 1.0, promotionRelax: false, description: '平均的な成長速度。' },
  A: { label: 'A（高）',       growthMultiplier: 1.4, promotionRelax: true,  description: '昇格条件が緩和される。' },
  S: { label: 'S（最高）',     growthMultiplier: 1.8, promotionRelax: true,  description: '昇格条件が大幅に緩和される。' },
};

/**
 * 役員属性定義（7種）
 * defaultCompensation: デフォルト役員報酬（万円/年）
 * requiresExecutiveRole: true の場合、役員役職（Cスイート）が必須
 *
 * @type {Object.<string, {label: string, defaultCompensation: number, requiresExecutiveRole: boolean, description: string}>}
 */
const EXECUTIVE_ATTRIBUTES = {
  representative_director: {
    label:                 '代表取締役',
    defaultCompensation:   5000,
    requiresExecutiveRole: true,
    description:           '会社を代表する取締役。役員役職（CEO等）必須。',
  },
  senior_managing_director: {
    label:                 '専務取締役',
    defaultCompensation:   3500,
    requiresExecutiveRole: true,
    description:           '代表取締役を補佐する上級取締役。役員役職必須。',
  },
  managing_director: {
    label:                 '常務取締役',
    defaultCompensation:   2800,
    requiresExecutiveRole: true,
    description:           '業務執行を担う常務取締役。役員役職必須。',
  },
  director: {
    label:                 '取締役',
    defaultCompensation:   2000,
    requiresExecutiveRole: false,
    description:           '取締役会構成員。',
  },
  outside_director: {
    label:                 '社外取締役',
    defaultCompensation:   500,
    requiresExecutiveRole: false,
    description:           '社外から招聘した独立取締役。',
  },
  standing_auditor: {
    label:                 '常務監査役',
    defaultCompensation:   1500,
    requiresExecutiveRole: false,
    description:           '常勤の監査役。',
  },
  outside_auditor: {
    label:                 '社外監査役',
    defaultCompensation:   300,
    requiresExecutiveRole: false,
    description:           '社外の監査役。',
  },
};

/**
 * 役員役職（Cスイート）定義（9種）
 * buff: 役員バフ効果（SimulationModule が参照）
 *   type: 'revenue_pct' | 'cost_pct' | 'cost_cogs_pct' | 'cost_sga_pct' | 'cost_labor_pct'
 *   value: 倍率加算分（例: 0.05 → +5%、-0.03 → −3%）
 * required: true の場合、必ず1名設置が必要
 *
 * @type {Object.<string, {label: string, buff: {type: string, value: number}|null, required: boolean, description: string}>}
 */
const EXECUTIVE_ROLES = {
  CEO: {
    label:       'CEO（最高経営責任者）',
    required:    true,
    buff:        null,
    description: '経営の最高責任者。必ず設置すること。',
  },
  COO: {
    label:       'COO（最高執行責任者）',
    required:    false,
    buff:        { type: 'revenue_pct', value: 0.05 },
    description: '売上+5%のバフ。',
  },
  CFO: {
    label:       'CFO（最高財務責任者）',
    required:    false,
    buff:        { type: 'cost_pct', value: -0.03 },
    description: '全費用−3%のバフ。',
  },
  CTO: {
    label:       'CTO（最高技術責任者）',
    required:    false,
    buff:        { type: 'cost_cogs_labor_pct', value: -0.05 },
    description: '原価人件費−5%のバフ。',
  },
  CMO: {
    label:       'CMO（最高マーケティング責任者）',
    required:    false,
    buff:        { type: 'cost_sga_labor_pct', value: -0.05 },
    description: '販管人件費−5%のバフ。',
  },
  CIO: {
    label:       'CIO（最高情報責任者）',
    required:    false,
    buff:        { type: 'cost_labor_pct', value: -0.04 },
    description: '人件費全体−4%のバフ。',
  },
  CLO: {
    label:       'CLO（最高法務責任者）',
    required:    false,
    buff:        { type: 'cost_cogs_labor_pct', value: -0.03 },
    description: '原価人件費−3%のバフ。',
  },
  CSO: {
    label:       'CSO（最高戦略責任者）',
    required:    false,
    buff:        { type: 'revenue_pct', value: 0.04 },
    description: '売上+4%のバフ。',
  },
  CHRO: {
    label:       'CHRO（最高人事責任者）',
    required:    true,
    buff:        null,
    description: 'プレイヤー自身。必ず設置すること。',
  },
};

// ============================================================
// 内部ユーティリティ
// ============================================================

/** 整数乱数 [min, max] */
function _randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 値を [lo, hi] にクランプ */
function _clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

/** グレード別採用時年齢レンジ */
const HIRE_AGE_RANGES = {
  G1:  { min: 22, max: 29 },
  G2:  { min: 25, max: 34 },
  G3:  { min: 27, max: 39 },
  G4:  { min: 27, max: 44 },
  G5:  { min: 30, max: 49 },
  G6:  { min: 40, max: 59 },
  G7:  { min: 40, max: 59 },
  G8:  { min: 45, max: 59 },
  G9:  { min: 50, max: 59 },
  G10: { min: 50, max: 59 },
};

/** ユニークID生成（簡易） */
function _generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

// 日本人姓リスト
const _LAST_NAMES = [
  '佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤',
  '吉田','山田','佐々木','山口','松本','井上','木村','林','斎藤','清水',
  '山崎','阿部','池田','橋本','石川','前田','小川','岡田','長谷川','近藤',
  '藤田','後藤','小野','岡本','村上','中島','松田','上野','石井','中川',
  '西村','中野','原田','市川','金子','藤原','坂本','野口','久保','小島',
  '菊地','菅原','服部','平野','宮崎','増田','宮本','古川','丸山','森田',
  '島田','永井','野村','川口','津田','安藤','大野','三浦','中山','森',
  '川崎','沢田','工藤','藤井','樋口','三宅','千葉','矢野','吉川','須藤',
  '横山','杉山','村田','堀','秋山','武田','酒井','平田','高田','熊谷',
  '奥村','金田','坂田','大久保','石橋','福田','荒井','西山','菊池','宮田',
  '木下','辻','水野','桑原','荒木','村山','奥田','浜田','土屋','河野',
  '星野','藤本','北村','渡部','柴田','小山','田村','松井','松尾','中田',
  '中西','西田','内田','谷口','谷本','本田','大塚','大西','大川','片山',
  '片岡','若林','石原','石田','広瀬','久保田','今井','今村','豊田','長野',
  '東','福島','福原','佐伯','佐野','寺田','吉村','吉岡','岸本','倉田',
  '山下','山内','木田','松村','亀山','井田','上田','高木','足立','宮沢',
  '長田','田口','堀田','戸田','村岡','白石','岡村','大谷','西川','竹内',
  '細川','中原','浅野','川端','大島','田畑','下村','関','杉本','牧野',
  '新井','大橋','川上','鈴原','竹下','岡崎','原口','広田','吉永','里見',
  '松岡','本間','栗原','中尾','岩田','遠藤','榎本','古田','植田','吉沢',
];

// 男性名リスト（漢字のみ・昭和〜平成）
const _MALE_FIRST_NAMES = [
  '隆','修','誠','浩','博','明','勇','豊','茂','敏',
  '健一','正雄','義雄','英夫','俊夫','和夫','孝夫','雄二','進','哲也',
  '一郎','幸男','正樹','康弘','秀雄','光雄','和彦','貴之','達也','洋介',
  '大介','健太郎','智之','賢一','祐介','裕樹','武史','拓也','慎一','雅之',
  '浩二','徹','勝','靖','章','哲','恭平','宏','力','剛',
  '聡','慶一','啓介','龍一','俊介','雄一','慎吾','哲郎','晃','崇',
  '純一','正人','光一','康雄','将','秀樹','良一','武','進一','敬一',
  '智一','直樹','幸雄','信一','弘','敦','豪','宗一','良二','俊也',
  '晴彦','慎也','武雄','克己','啓太','尚之','篤','健','宏之','義之',
  '智哉','政雄','清','彰','茂雄','義一','忠','孝一','悟','昭',
];

// 女性名リスト（漢字のみ・昭和〜平成）
const _FEMALE_FIRST_NAMES = [
  '明子','幸子','恵子','久美子','順子','智子','洋子','陽子','敦子','裕子',
  '美智子','和子','千恵子','由美子','清子','美代子','節子','澄子','弥生','真由美',
  '典子','則子','直子','良子','征子','淑子','朋子','尚子','真紀','麻衣',
  '香織','亜紀','聡子','友美','純子','理恵','奈美','悦子','摩耶','百合子',
  '玲子','恵美','広美','知恵','芳子','由紀','多恵','礼子','和美','江里子',
  '真奈美','利恵','千佳','愛子','佳奈','実希','里佳','奈緒','彩香','智美',
  '萌','絵里','咲子','瑞希','温子','菜緒','裕美','麻友','那奈','祥子',
  '理沙','久美','有希','夏子','梢','麗子','伸子','泰子','昌子','和香',
  '妙子','芽衣','春菜','舞','桃子','晴美','希美','沙織','真弓','緑',
  '麻里','桜子','礼奈','恵里','優子','彩乃','美穂','紫','幸','真澄',
];

// ============================================================
// 関数定義（骨格＋シグネチャ）
// ============================================================

/**
 * 社員オブジェクトを生成して返す
 *
 * @param {Object} params - 生成パラメータ
 * @param {number}  params.id        - ユニークID
 * @param {string}  [params.name]    - 氏名（省略時ランダム生成）
 * @param {number}  [params.age]     - 年齢（省略時グレード連動）
 * @param {string}  [params.jobType] - 職種コード（JOB_TYPES のキー）
 * @param {string}  [params.grade]   - グレード G1〜G10（省略時 G2）
 * @param {string}  [params.potential] - ポテンシャル C/B/A/S（省略時ランダム加重抽選）
 * @param {number}  [params.technical]     - テクニカルスキル 1〜100
 * @param {number}  [params.communication] - コミュニケーション 1〜100
 * @param {number}  [params.leadership]    - リーダーシップ 1〜100
 * @param {number}  [params.motivation]    - モチベーション 1〜100
 * @param {string|null} [params.unitId]    - 所属部門ID
 * @param {string[]} [params.positionIds]  - 役職IDリスト（最大3件）
 * @param {number}  [params.hireYear]      - 入社年
 * @returns {Employee} 社員オブジェクト
 *
 * Employee 型定義:
 * {
 *   id:             number,
 *   name:           string,
 *   age:            number,
 *   jobType:        string,        // JOB_TYPES のキー
 *   grade:          string,        // G1〜G10
 *   potential:      string,        // C/B/A/S（固定）
 *   technical:      number,        // 1〜100（成長）
 *   communication:  number,        // 1〜100（成長）
 *   leadership:     number,        // 1〜100（成長）
 *   experience:     number,        // 経験値（在籍年数で加算）
 *   motivation:     number,        // 1〜100（変動）
 *   unitId:         string|null,
 *   positionIds:    string[],      // 役職IDリスト（最大3）
 *   hireYear:       number,
 *   retiredYear:    number|null,
 *   retiredReason:  string|null,
 * }
 */
function createEmployee(params) {
  // グレード（省略時G1）
  const grade = params.grade || 'G1';

  // 性別：M/F が指定されていればその値、省略時は50%でランダム
  const gender = (params.gender === 'M' || params.gender === 'F')
    ? params.gender
    : (Math.random() < 0.5 ? 'M' : 'F');

  // 氏名：省略時はランダム生成（gender に応じて名リストを切り替え）
  const firstNameList = gender === 'M' ? _MALE_FIRST_NAMES : _FEMALE_FIRST_NAMES;
  const name = params.name || (
    _LAST_NAMES[_randInt(0, _LAST_NAMES.length - 1)] + ' ' +
    firstNameList[_randInt(0, firstNameList.length - 1)]
  );

  // 職種：省略時はランダム
  const jobTypeKeys = Object.keys(JOB_TYPES);
  const jobType = (params.jobType && JOB_TYPES[params.jobType])
    ? params.jobType
    : jobTypeKeys[_randInt(0, jobTypeKeys.length - 1)];

  // ポテンシャル：省略時は加重抽選（C:40%, B:35%, A:20%, S:5%）
  let potential = params.potential;
  if (!potential || !POTENTIAL_TYPES[potential]) {
    const roll = Math.random();
    potential = roll < 0.40 ? 'C'
      : roll < 0.75 ? 'B'
      : roll < 0.95 ? 'A'
      : 'S';
  }

  // 年齢：省略時は HIRE_AGE_RANGES[grade] の範囲でランダム（グレード不明時は22〜35）
  let age;
  if (params.age !== undefined) {
    age = params.age;
  } else {
    const ageRange = HIRE_AGE_RANGES[grade];
    age = ageRange ? _randInt(ageRange.min, ageRange.max) : _randInt(22, 35);
  }

  // スキル初期値：JOB_TYPES の statTendency（initialStats）とポテンシャルに基づく
  const stats       = JOB_TYPES[jobType].initialStats;
  const growthMult  = POTENTIAL_TYPES[potential].growthMultiplier;
  // ポテンシャルによるボーナス（growthMultiplier を基にスキル底上げ）
  const potBonus    = Math.round((growthMult - 1.0) * 10);

  function initSkill(stat, override) {
    if (override !== undefined) return _clamp(override, 1, 100);
    const raw = stat.base + _randInt(-stat.range, stat.range) + potBonus;
    return _clamp(raw, 1, 100);
  }

  const technical     = initSkill(stats.technical,     params.technical);
  const communication = initSkill(stats.communication, params.communication);
  const leadership    = initSkill(stats.leadership,    params.leadership);

  // モチベーション：省略時は60〜80のランダム
  const motivation = (params.motivation !== undefined)
    ? _clamp(params.motivation, 1, 100)
    : _randInt(60, 80);

  // 経験値：中途採用は年齢に応じた初期値（(年齢-22) × 1.0）、0未満にはしない
  const experience = Math.max(0, (age - 22) * 1.0);

  return {
    id:            (params.id !== undefined && params.id !== null) ? params.id : null,
    name,
    age,
    gender,
    jobType,
    grade,
    potential,
    technical,
    communication,
    leadership,
    experience,
    motivation,
    positionIds:   (params.positionIds || []).slice(0, 3),
    unitId:        (params.unitId !== undefined) ? params.unitId : null,
    isExecutive:   false,
    hireYear:      params.hireYear || 2025,
    retiredYear:   null,
    retiredReason: null,
  };
}

/**
 * G1〜G5 の自動昇格判定を行う
 *
 * @param {Employee} employee - 対象社員
 * @returns {boolean} true = 昇格すべき
 *
 * 判定ロジック（足軽・壱が実装）:
 *   - 現在グレードが G5 以下のみ対象（G6以上は false）
 *   - 昇格スコア = (technical + communication + leadership) / 3 + experience * 0.5
 *   - 閾値: G1→G2: 30, G2→G3: 42, G3→G4: 55, G4→G5: 68
 *   - ポテンシャルS/A: 閾値を −10/−5 緩和
 */
function calcAutoPromotion(employee) {
  // G5以上（インデックス4以上）はfalseを返す（G6以上は手動昇格のため）
  const currentIndex = GRADE_ORDER.indexOf(employee.grade);
  if (currentIndex < 0 || currentIndex >= AUTO_PROMOTION_MAX_INDEX) return false;

  // 総合スコア = テクニカル×0.4 + コミュ×0.3 + リーダー×0.1 + 経験値×0.2
  const score = employee.technical     * 0.4
              + employee.communication * 0.3
              + employee.leadership    * 0.1
              + employee.experience    * 0.2;

  // ポテンシャル緩和（S/A それぞれ個別対応）
  const ageMod   = employee.potential === 'S' ? -3 : employee.potential === 'A' ? -2 : 0;
  const scoreMod = employee.potential === 'S' ? -10 : employee.potential === 'A' ? -6 : 0;

  // 昇格条件テーブル（現グレード → 次グレード）
  const conditions = {
    G1: { minAge: 25, minExp:  3, minScore: 40 },
    G2: { minAge: 27, minExp:  7, minScore: 48 },
    G3: { minAge: 30, minExp: 10, minScore: 56 },
    G4: { minAge: 35, minExp: 13, minScore: 63 },
  };

  const cond = conditions[employee.grade];
  if (!cond) return false;

  return employee.age        >= (cond.minAge   + ageMod)
      && employee.experience >= cond.minExp
      && score               >= (cond.minScore + scoreMod);
}

/**
 * G5以上の昇格候補リストを返す
 *
 * @param {Employee[]} employees - 在籍社員リスト
 * @param {string} targetGrade   - 昇格先グレード（G6〜G10）
 * @returns {Employee[]} 昇格候補社員リスト（スコア降順）
 *
 * 候補条件（足軽・壱が実装）:
 *   - 現在グレードが targetGrade の1つ下であること
 *   - 昇格スコア（avgSkill + experience * 0.5）が一定値以上
 *   - スコア降順でソートして返す
 */
function getPromotionCandidates(employees, targetGrade) {
  // targetGrade の1つ下のグレードを特定
  const targetIndex = GRADE_ORDER.indexOf(targetGrade);
  if (targetIndex <= 0) return [];

  const currentGrade = GRADE_ORDER[targetIndex - 1];

  // 総合スコア = テクニカル×0.4 + コミュ×0.3 + リーダー×0.1 + 経験値×0.2
  const candidates = employees
    .filter(e => e.grade === currentGrade)
    .map(e => {
      const totalScore = e.technical     * 0.4
                       + e.communication * 0.3
                       + e.leadership    * 0.1
                       + e.experience    * 0.2;
      return Object.assign({}, e, { totalScore });
    })
    .sort((a, b) => b.totalScore - a.totalScore);

  return candidates;
}

/**
 * 年次ステータス変動を適用する（1ターン分）
 *
 * @param {Employee} employee - 対象社員（直接変更）
 * @param {Object}   events   - 今ターンのイベントフラグ
 * @param {boolean}  [events.promoted]            - 昇格した（motivation +10）
 * @param {number}   [events.overcapacityPenalty] - 拠点超過ペナルティ（0〜-20）
 * @param {number}   [events.spanOfControlDelta]  - SoCによるモチベ変動（正=ボーナス、負=ペナルティ）
 * @returns {void}
 *
 * 処理内容（足軽・壱が実装）:
 *   1. age += 1
 *   2. experience += 1
 *   3. motivation: 自然減衰 -2 + ランダム ±5 + イベント分
 *   4. スキル成長: POTENTIAL_TYPES[potential].growthMultiplier を使用
 *      - motivation >= 70: avgSkill * 0.02 * growthMultiplier を各スキルに加算（小数で蓄積可）
 *      - motivation <= 30: -1 を各スキルに加算
 *   5. 全値を適正範囲にクランプ（age上限なし、skills 1〜100、motivation 1〜100）
 */
function applyYearlyStatusChange(employee, events = {}) {
  // 1. 年齢・経験値を加算
  employee.age        += 1;
  employee.experience += 1;

  // 2. モチベーション変動
  //    自然減衰: -2、ランダム: -5〜+5
  let motDelta = -2 + _randInt(-5, 5);

  if (events.overcapacityPenalty)  motDelta -= events.overcapacityPenalty;

  // 兼任ボーナス: モチベ>=70なら+3、モチベ<=40なら-3
  if (events.concurrentRoleBonus) {
    if (employee.motivation >= 70)      motDelta += 3;
    else if (employee.motivation <= 40) motDelta -= 3;
  }

  // スパン・オブ・コントロール変動（正=ボーナス、負=ペナルティ）
  if (events.spanOfControlDelta) motDelta += events.spanOfControlDelta;

  employee.motivation = _clamp(employee.motivation + motDelta, 1, 100);

  // 3. スキル成長（growthMultiplier を参照）
  const growthMultiplier = POTENTIAL_TYPES[employee.potential]?.growthMultiplier || 1.0;

  if (employee.motivation >= 70) {
    // +Math.round(1 × growthMultiplier) を各スキルに加算
    const growth = Math.round(1 * growthMultiplier);
    employee.technical     = _clamp(employee.technical     + growth, 1, 100);
    employee.communication = _clamp(employee.communication + growth, 1, 100);
    employee.leadership    = _clamp(employee.leadership    + growth, 1, 100);
  } else if (employee.motivation <= 30) {
    employee.technical     = _clamp(employee.technical     - 1, 1, 100);
    employee.communication = _clamp(employee.communication - 1, 1, 100);
    employee.leadership    = _clamp(employee.leadership    - 1, 1, 100);
  }

  return employee;
}

/**
 * グレードに対応する標準年俸（万円）を返す
 *
 * @param {string} grade - G1〜G10
 * @returns {number} 年俸（万円）。不明グレードの場合は 0
 */
function getGradeSalary(grade) {
  return GRADE_DEFINITIONS[grade]?.baseAnnualSalary ?? 0;
}

// ============================================================
// モジュール公開
// ============================================================

window.DataModule = {
  // 定数
  GRADE_DEFINITIONS,
  GRADE_ORDER,
  AUTO_PROMOTION_MAX_GRADE,
  AUTO_PROMOTION_MAX_INDEX,
  JOB_TYPES,
  POTENTIAL_TYPES,
  EXECUTIVE_ATTRIBUTES,
  EXECUTIVE_ROLES,
  HIRE_AGE_RANGES,

  // 関数
  createEmployee,
  calcAutoPromotion,
  getPromotionCandidates,
  applyYearlyStatusChange,
  getGradeSalary,
};
