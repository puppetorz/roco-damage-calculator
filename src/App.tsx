import { useEffect, useState } from "react";
import "./App.css";

import { natures } from "./data/natures";
import { skills } from "./data/skills";
import { spirits } from "./data/spirits";
import type {
  BattleModifierState,
  BattleStats,
  DamageResult,
  DamageSkillCategory,
  EffectRule,
  IndividualValues,
  Nature,
  Skill,
  SkillCategory,
  Spirit,
  StatKey,
} from "./types/battle";
import { ELEMENTS } from "./data/typeChart";
import { calculateDamage } from "./utils/damageCalculator";
import {
  getAllSkillsForSpirit,
  getDamageSkillsForSpirit,
  getDefaultSkillForSpirit,
  getRecommendedIvs,
  getStabMultiplier,
  getTraitRules,
} from "./utils/combatantBuilder";
import {
  createDefaultBattleModifierState,
  resolveDamageInput,
} from "./utils/damageResolver";
import {
  getConditionLabel,
  parseSkillRules,
  parseTraitRules,
  ruleUsesStack,
} from "./utils/effectRuleParser";
import {
  PERFECT_IV_LINE_COUNT,
  PERFECT_IV_VALUE,
  PVP_LEVEL,
  STAT_KEYS,
  calculatePvpStats,
} from "./utils/statCalculator";
import { calculateTypeMultiplier, createDefenseTypeKey } from "./utils/typeCalculator";

const statLabels: Record<StatKey, string> = {
  hp: "生命",
  atk: "物攻",
  spa: "魔攻",
  def: "物防",
  spd: "魔防",
  spe: "速度",
};

const categoryLabels: Record<DamageSkillCategory, string> = {
  physical: "物理",
  magical: "魔法",
};

const skillCategoryLabels: Record<SkillCategory, string> = {
  physical: "物理",
  magical: "魔法",
  status: "状态",
  defense: "防御",
};

const riskClassName: Record<DamageResult["risk"], string> = {
  必定击杀: "risk-ko",
  高危: "risk-high",
  中危: "risk-medium",
  低危: "risk-low",
};

const manualStatKeys: StatKey[] = ["atk", "spa", "def", "spd", "spe"];
const skillMap = new Map(skills.map((skill) => [skill.id, skill]));
const natureMap = new Map(natures.map((nature) => [nature.id, nature]));
const spiritMap = new Map(spirits.map((spirit) => [spirit.id, spirit]));
const SPIRIT_HISTORY_STORAGE_KEY = "roco-spirit-search-history";
const SPIRIT_HISTORY_STORAGE_VERSION = 1;
const MAX_SPIRIT_HISTORY = 8;
const SPIRIT_PRESET_STORAGE_KEY = "roco-spirit-presets";
const SPIRIT_PRESET_STORAGE_VERSION = 1;

type PageKey = "calculator" | "spirits" | "skills" | "types" | "rules" | "updates";

const routes: Array<{
  key: PageKey;
  label: string;
  description: string;
}> = [
  { key: "calculator", label: "伤害计算", description: "单技能与动态参数" },
  { key: "spirits", label: "精灵图鉴", description: "种族值、特性、技能" },
  { key: "skills", label: "技能图鉴", description: "威力、能耗、规则" },
  { key: "types", label: "克制表", description: "属性倍率查询" },
  { key: "rules", label: "规则调试", description: "解析结果核对" },
  { key: "updates", label: "版本公告", description: "更新记录与计划" },
];

type UpdateAnnouncement = {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  notes?: string[];
};

const updateAnnouncements: UpdateAnnouncement[] = [
  {
    version: "v0.6.0",
    date: "2026-05-16",
    title: "PVP 工作台第一阶段",
    highlights: [
      "新增精灵图鉴、技能图鉴、克制表、规则调试页面。",
      "默认仍保留伤害计算器，新增 hash 导航用于快速切换功能。",
      "图鉴页面可以把精灵或技能回填到当前计算器。",
    ],
    notes: [
      "本阶段不改变核心伤害公式。",
      "规则调试页用于排查特性、连击和威力解析问题。",
    ],
  },
  {
    version: "v0.5.0",
    date: "2026-05-15",
    title: "本地离线启动包",
    highlights: [
      "新增 Windows 离线包，可双击启动计算器。",
      "离线包内置静态数据，不依赖 Node、npm、Vite 或外网。",
      "修复批处理启动脚本编码导致的双击失败问题。",
    ],
  },
  {
    version: "v0.4.0",
    date: "2026-05-14",
    title: "精灵预设与搜索历史",
    highlights: [
      "新增精灵预设保存、套用、删除功能。",
      "进攻方和防守方共用最近选择历史。",
      "历史和预设使用浏览器 localStorage 长期保存。",
    ],
  },
  {
    version: "v0.3.0",
    date: "2026-05-13",
    title: "PVP 伤害公式修正",
    highlights: [
      "伤害公式修正为 37/41 推导公式。",
      "连击改为单击伤害取整后再乘连击数。",
      "保留 gameRound 和 gameFloor，方便后续继续校准取整规则。",
    ],
    notes: ["0.5 取整细节仍以集中封装为准，后续可继续根据实战样本修正。"],
  },
  {
    version: "v0.2.0",
    date: "2026-05-12",
    title: "动态特性与技能机制",
    highlights: [
      "新增特性层数、技能连击、威力变化、应对触发等动态控件。",
      "新增手动修正模块，用于录入已经发生的强化或削弱。",
      "未能稳定解析的效果会进入未计入提示，避免静默误算。",
    ],
  },
];

type PresetSide = "attacker" | "defender";

type SpiritPreset = {
  id: string;
  name: string;
  spiritId: string;
  natureId: string;
  ivs: IndividualValues;
  skillId?: string;
  createdAt: number;
  updatedAt: number;
};

function countPerfectIvLines(ivs: IndividualValues): number {
  return STAT_KEYS.filter((key) => ivs[key] === PERFECT_IV_VALUE).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function formatRate(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function getPageFromHash(hash = window.location.hash): PageKey {
  const value = hash.replace(/^#\/?/, "") as PageKey;
  return routes.some((route) => route.key === value) ? value : "calculator";
}

function navigateToPage(page: PageKey): void {
  window.location.hash = `/${page}`;
}

function formatSpiritOption(spirit: Spirit): string {
  return [
    spirit.dexNo ? `${spirit.dexNo}` : "",
    spirit.name,
    spirit.stage,
    spirit.form,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatSpiritHistoryItem(spirit: Spirit): string {
  return [formatSpiritOption(spirit), spirit.elements.join(" / ")]
    .filter(Boolean)
    .join(" · ");
}

function formatSkillOption(skill: Skill): string {
  return [
    skill.name,
    skill.element,
    skillCategoryLabels[skill.category],
    skill.power > 0 ? skill.power : "动态威力",
  ]
    .filter(Boolean)
    .join(" · ");
}

function getSkillDescription(skill: Skill): string {
  return (
    skill.description ??
    skill.rawDescriptionText ??
    skill.rawEffectText ??
    skill.effectEntries?.join("；") ??
    "暂无技能说明。"
  );
}

function getSpiritSearchText(spirit: Spirit): string {
  return [
    spirit.name,
    spirit.dexNo,
    spirit.form,
    spirit.stage,
    spirit.elements.join("/"),
    ...(spirit.traits?.flatMap((trait) => [trait.name, trait.description]) ?? []),
    ...(spirit.learnableSkillNames ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getSkillSearchText(skill: Skill): string {
  return [
    skill.name,
    skill.element,
    skillCategoryLabels[skill.category],
    skill.power,
    skill.energyCost,
    getSkillDescription(skill),
    ...(skill.learnableSpiritNames ?? []),
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();
}

function getRuleSummary(rule: EffectRule): string {
  switch (rule.kind) {
    case "hitCountBase":
      return `基础 ${rule.hitCount} 连击`;
    case "hitCountPerUse":
      return `每次使用连击 +${rule.amount}`;
    case "hitCountBonusToggle":
      return `${getConditionLabel(rule.condition)}时连击 +${rule.amount}`;
    case "hitCountBonusStack":
      return `${rule.stackLabel}每层/次连击 +${rule.amountPerStack}`;
    case "hitCountMultiplier":
      return `${getConditionLabel(rule.condition)}时连击 x${rule.multiplier}`;
    case "hitCountOverride":
      return `${getConditionLabel(rule.condition)}时连击变为 ${rule.hitCount}`;
    case "powerBonusPerUse":
      return `每次使用威力 +${rule.amount}`;
    case "powerBonusToggle":
      return `${getConditionLabel(rule.condition)}时威力 +${rule.amount}`;
    case "powerBonusStack":
      return `${rule.stackLabel}每层/次威力 +${rule.amountPerStack}`;
    case "powerMultiplierToggle":
      return `${getConditionLabel(rule.condition)}时威力 x${rule.multiplier}`;
    case "powerMultiplierStack":
      return `${rule.stackLabel}每层/次威力 +${Math.round(rule.ratePerStack * 100)}%`;
    case "powerFromEnemyCost":
      return `威力 = 敌方技能总能耗 x${rule.multiplier}`;
    case "statModifier":
      return `${rule.target === "attacker" ? "进攻方" : "防守方"} ${rule.statKeys
        .map((key) => statLabels[key])
        .join("/")} ${formatRate(rule.rate)}${rule.stackable ? " / 层" : ""}`;
    case "note":
      return "未计入公式，仅作提示";
  }
}

function getRuleFormulaStatus(rule: EffectRule): string {
  return rule.kind === "note" ? "未计入提示" : "可计入公式";
}

function formatIvSummary(ivs: IndividualValues): string {
  const selectedLabels = STAT_KEYS.filter((key) => ivs[key] === PERFECT_IV_VALUE).map(
    (key) => statLabels[key]
  );

  return selectedLabels.length > 0
    ? `${selectedLabels.join("/")} +60`
    : "未选择 +60 个体";
}

function formatPresetDefaultName(
  spirit: Spirit,
  nature: Nature,
  ivs: IndividualValues,
  skill?: Skill
): string {
  return [spirit.name, nature.name, formatIvSummary(ivs), skill?.name]
    .filter(Boolean)
    .join(" · ");
}

function normalizeSpiritHistoryIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }

  const uniqueIds = new Set<string>();
  const validIds: string[] = [];

  for (const id of ids) {
    if (typeof id !== "string" || uniqueIds.has(id) || !spiritMap.has(id)) {
      continue;
    }

    uniqueIds.add(id);
    validIds.push(id);

    if (validIds.length >= MAX_SPIRIT_HISTORY) {
      break;
    }
  }

  return validIds;
}

function readSpiritHistoryIds(): string[] {
  try {
    const raw = window.localStorage.getItem(SPIRIT_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return normalizeSpiritHistoryIds(parsed);
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      "spiritIds" in parsed &&
      parsed.version === SPIRIT_HISTORY_STORAGE_VERSION
    ) {
      return normalizeSpiritHistoryIds(parsed.spiritIds);
    }
  } catch {
    return [];
  }

  return [];
}

function writeSpiritHistoryIds(spiritIds: string[]): void {
  try {
    window.localStorage.setItem(
      SPIRIT_HISTORY_STORAGE_KEY,
      JSON.stringify({
        version: SPIRIT_HISTORY_STORAGE_VERSION,
        spiritIds,
      })
    );
  } catch {
    // localStorage 可能被浏览器禁用；历史功能失败时不影响计算器主体功能。
  }
}

function normalizePresetIvs(value: unknown): IndividualValues | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const ivs = {} as IndividualValues;

  for (const key of STAT_KEYS) {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return undefined;
    }

    const rounded = Math.round(raw);
    if (rounded !== 0 && rounded !== PERFECT_IV_VALUE) {
      return undefined;
    }

    ivs[key] = rounded;
  }

  return countPerfectIvLines(ivs) <= PERFECT_IV_LINE_COUNT ? ivs : undefined;
}

function normalizeSpiritPreset(value: unknown): SpiritPreset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const spiritId = typeof value.spiritId === "string" ? value.spiritId : "";
  const natureId = typeof value.natureId === "string" ? value.natureId : "";
  const createdAt = typeof value.createdAt === "number" ? value.createdAt : 0;
  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : 0;
  const ivs = normalizePresetIvs(value.ivs);

  if (
    !id ||
    !name ||
    !spiritMap.has(spiritId) ||
    !natureMap.has(natureId) ||
    !ivs ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt)
  ) {
    return undefined;
  }

  const skillId = typeof value.skillId === "string" ? value.skillId : undefined;
  const validSkillId =
    skillId &&
    skillMap.has(skillId) &&
    getAllSkillsForSpirit(spiritMap.get(spiritId)!).some((skill) => skill.id === skillId)
      ? skillId
      : undefined;

  return {
    id,
    name,
    spiritId,
    natureId,
    ivs,
    skillId: validSkillId,
    createdAt,
    updatedAt,
  };
}

function readSpiritPresets(): SpiritPreset[] {
  try {
    const raw = window.localStorage.getItem(SPIRIT_PRESET_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    const rawPresets =
      isRecord(parsed) &&
      parsed.version === SPIRIT_PRESET_STORAGE_VERSION &&
      Array.isArray(parsed.presets)
        ? parsed.presets
        : Array.isArray(parsed)
          ? parsed
          : [];

    return rawPresets
      .map(normalizeSpiritPreset)
      .filter((preset): preset is SpiritPreset => Boolean(preset))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

function writeSpiritPresets(presets: SpiritPreset[]): void {
  try {
    window.localStorage.setItem(
      SPIRIT_PRESET_STORAGE_KEY,
      JSON.stringify({
        version: SPIRIT_PRESET_STORAGE_VERSION,
        presets,
      })
    );
  } catch {
    // localStorage 不可用时只影响预设持久化，不影响当前计算。
  }
}

function createSpiritPreset(options: {
  name: string;
  spirit: Spirit;
  nature: Nature;
  ivs: IndividualValues;
  skill?: Skill;
}): SpiritPreset {
  const now = Date.now();

  return {
    id: `preset_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: options.name,
    spiritId: options.spirit.id,
    natureId: options.nature.id,
    ivs: { ...options.ivs },
    skillId: options.skill?.id,
    createdAt: now,
    updatedAt: now,
  };
}

function filterSpirits(query: string, selectedSpirit: Spirit): Spirit[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return spirits;
  }

  const filtered = spirits.filter((spirit) => {
    return [
      spirit.name,
      spirit.dexNo,
      spirit.form,
      spirit.stage,
      spirit.elements.join("/"),
      ...(spirit.traits?.map((trait) => trait.name) ?? []),
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedQuery));
  });

  return filtered.some((spirit) => spirit.id === selectedSpirit.id)
    ? filtered
    : [selectedSpirit, ...filtered];
}

function hasConfigurableSkillRule(rule: EffectRule): boolean {
  return (
    rule.kind === "hitCountPerUse" ||
    rule.kind === "powerBonusPerUse" ||
    rule.kind === "powerFromEnemyCost" ||
    ruleUsesStack(rule) ||
    ("condition" in rule && rule.condition !== "always")
  );
}

function needsRuleToggle(rule: EffectRule): boolean {
  return "condition" in rule && rule.condition !== "always" && !ruleUsesStack(rule);
}

type SpiritPanelProps = {
  title: string;
  side: PresetSide;
  search: string;
  spirit: Spirit;
  spiritId: string;
  natureId: string;
  ivs: IndividualValues;
  historySpirits: Spirit[];
  presets: SpiritPreset[];
  presetDraftName: string;
  savingPreset: boolean;
  actualStats: BattleStats;
  onSearchChange: (query: string) => void;
  onSpiritChange: (spiritId: string) => void;
  onClearHistory: () => void;
  onHistorySelect: (spiritId: string) => void;
  onBeginPresetSave: (side: PresetSide) => void;
  onPresetDraftNameChange: (name: string) => void;
  onConfirmPresetSave: (side: PresetSide) => void;
  onCancelPresetSave: () => void;
  onApplyPreset: (side: PresetSide, presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onNatureChange: (natureId: string) => void;
  onIvToggle: (key: StatKey) => void;
};

function SpiritPanel({
  title,
  side,
  search,
  spirit,
  spiritId,
  natureId,
  ivs,
  historySpirits,
  presets,
  presetDraftName,
  savingPreset,
  actualStats,
  onSearchChange,
  onSpiritChange,
  onClearHistory,
  onHistorySelect,
  onBeginPresetSave,
  onPresetDraftNameChange,
  onConfirmPresetSave,
  onCancelPresetSave,
  onApplyPreset,
  onDeletePreset,
  onNatureChange,
  onIvToggle,
}: SpiritPanelProps) {
  const selectedIvLineCount = countPerfectIvLines(ivs);
  const spiritOptions = filterSpirits(search, spirit);
  const showHistory = search.trim().length === 0 && historySpirits.length > 0;

  return (
    <section className="panel spirit-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{spirit.elements.join(" / ")}</span>
      </div>

      <div className="field-row">
        <label>
          搜索精灵
          <input
            placeholder="输入名称、编号、形态、属性或特性"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        {showHistory ? (
          <div className="search-history" aria-label={`${title}最近选择`}>
            <div className="search-history-heading">
              <strong>最近选择</strong>
              <button type="button" onClick={onClearHistory}>
                清空
              </button>
            </div>
            <div className="search-history-list">
              {historySpirits.map((item) => (
                <button
                  key={item.id}
                  className={item.id === spiritId ? "is-active" : ""}
                  type="button"
                  onClick={() => onHistorySelect(item.id)}
                >
                  {formatSpiritHistoryItem(item)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <label>
          精灵
          <select
            value={spiritId}
            onChange={(event) => onSpiritChange(event.target.value)}
          >
            {spiritOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {formatSpiritOption(item)}
              </option>
            ))}
          </select>
        </label>

        <label>
          性格
          <select
            value={natureId}
            onChange={(event) => onNatureChange(event.target.value)}
          >
            {natures.map((nature) => (
              <option key={nature.id} value={nature.id}>
                {nature.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="iv-summary">
        已选择 {selectedIvLineCount} / {PERFECT_IV_LINE_COUNT} 条 +60 个体
      </div>

      <div className="preset-box">
        <div className="preset-heading">
          <div>
            <strong>精灵预设</strong>
            <span>保存精灵、性格、个体{side === "attacker" ? "和技能" : ""}</span>
          </div>
          <button type="button" onClick={() => onBeginPresetSave(side)}>
            保存当前
          </button>
        </div>

        {savingPreset ? (
          <div className="preset-save-row">
            <input
              aria-label={`${title}预设名称`}
              value={presetDraftName}
              onChange={(event) => onPresetDraftNameChange(event.target.value)}
            />
            <button
              disabled={presetDraftName.trim().length === 0}
              type="button"
              onClick={() => onConfirmPresetSave(side)}
            >
              保存
            </button>
            <button type="button" onClick={onCancelPresetSave}>
              取消
            </button>
          </div>
        ) : null}

        {presets.length > 0 ? (
          <div className="preset-list">
            {presets.map((preset) => {
              const presetSpirit = spiritMap.get(preset.spiritId);
              const presetNature = natures.find(
                (nature) => nature.id === preset.natureId
              );
              const presetSkill = preset.skillId
                ? skillMap.get(preset.skillId)
                : undefined;

              if (!presetSpirit || !presetNature) {
                return null;
              }

              return (
                <article className="preset-item" key={preset.id}>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>
                      {formatSpiritOption(presetSpirit)} · {presetNature.name}
                    </span>
                    <em>
                      {formatIvSummary(preset.ivs)}
                      {presetSkill ? ` · ${presetSkill.name}` : ""}
                    </em>
                  </div>
                  <div className="preset-actions">
                    <button
                      type="button"
                      onClick={() => onApplyPreset(side, preset.id)}
                    >
                      套用到{title}
                    </button>
                    <button type="button" onClick={() => onDeletePreset(preset.id)}>
                      删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="preset-empty">暂无预设，保存当前配置后会显示在这里。</p>
        )}
      </div>

      <div className="trait-list">
        <strong>特性</strong>
        <span>可识别效果会在下方动态生成控件</span>
        {(spirit.traits?.length ?? 0) > 0 ? (
          spirit.traits?.map((trait) => (
            <div className="trait-card" key={trait.name}>
              <b>{trait.name}</b>
              {trait.description ? <p>{trait.description}</p> : null}
            </div>
          ))
        ) : (
          <p>暂无特性数据</p>
        )}
      </div>

      <div className="stat-table">
        <div className="stat-table-head">属性</div>
        <div className="stat-table-head">种族</div>
        <div className="stat-table-head">个体</div>
        <div className="stat-table-head">PVP 实际</div>

        {STAT_KEYS.map((key) => {
          const checked = ivs[key] === PERFECT_IV_VALUE;
          const disableUnchecked =
            !checked && selectedIvLineCount >= PERFECT_IV_LINE_COUNT;

          return (
            <div className="stat-row" key={key}>
              <span>{statLabels[key]}</span>
              <strong>{spirit.baseStats[key]}</strong>
              <label className="iv-checkbox">
                <input
                  aria-label={`${title}${statLabels[key]}个体 +60`}
                  checked={checked}
                  disabled={disableUnchecked}
                  type="checkbox"
                  onChange={() => onIvToggle(key)}
                />
                <span>{checked ? "+60" : "0"}</span>
              </label>
              <strong className="actual-stat">{actualStats[key]}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type RuleControlProps = {
  rule: EffectRule;
  state: BattleModifierState;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onRuleStacksChange: (ruleId: string, stacks: number) => void;
};

function getStackLabel(rule: EffectRule): string {
  if (rule.kind === "statModifier") {
    return rule.stackLabel ?? "触发层数/次数";
  }

  if (
    rule.kind === "hitCountBonusStack" ||
    rule.kind === "powerBonusStack" ||
    rule.kind === "powerMultiplierStack"
  ) {
    return rule.stackLabel;
  }

  return "触发层数/次数";
}

function RuleControl({
  rule,
  state,
  onToggleRule,
  onRuleStacksChange,
}: RuleControlProps) {
  if (rule.kind === "note") {
    return (
      <div className="rule-note">
        <strong>{rule.label}</strong>
        <p>{rule.description}</p>
      </div>
    );
  }

  if (rule.kind === "hitCountBase") {
    return (
      <div className="rule-readonly">
        <strong>{rule.label}</strong>
        <span>{rule.description}</span>
      </div>
    );
  }

  if (ruleUsesStack(rule)) {
    return (
      <label className="rule-control stack-control">
        {rule.label}
        <span>
          {getStackLabel(rule)} · {"condition" in rule ? getConditionLabel(rule.condition) : "手动确认"}
        </span>
        <input
          min="0"
          step="1"
          type="number"
          value={state.ruleStacks[rule.id] ?? 0}
          onChange={(event) =>
            onRuleStacksChange(
              rule.id,
              Math.max(0, Math.round(Number(event.target.value) || 0))
            )
          }
        />
      </label>
    );
  }

  if (needsRuleToggle(rule)) {
    return (
      <label className="rule-toggle">
        <input
          checked={Boolean(state.ruleEnabled[rule.id])}
          type="checkbox"
          onChange={(event) => onToggleRule(rule.id, event.target.checked)}
        />
        <span>
          <strong>{rule.label}</strong>
          {"condition" in rule ? <em>{getConditionLabel(rule.condition)}</em> : null}
        </span>
      </label>
    );
  }

  return (
    <div className="rule-readonly">
      <strong>{rule.label}</strong>
      <span>{rule.description}</span>
    </div>
  );
}

type ManualModifierGroupProps = {
  title: string;
  values: BattleModifierState["manualAttacker"];
  side: "attacker" | "defender";
  onChange: (side: "attacker" | "defender", key: StatKey, value: number) => void;
};

function ManualModifierGroup({
  title,
  values,
  side,
  onChange,
}: ManualModifierGroupProps) {
  return (
    <div className="manual-group">
      <div className="manual-group-header">
        <h4>{title}</h4>
        <span>百分比</span>
      </div>
      <div className="manual-input-grid">
        {manualStatKeys.map((key) => (
          <label className="percent-input" key={`${side}-${key}`}>
            {statLabels[key]}
            <span>
              <input
                step="10"
                type="number"
                value={Math.round(values[key] * 100)}
                onChange={(event) =>
                  onChange(side, key, Number(event.target.value) || 0)
                }
              />
              <em>%</em>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

type SpiritDexViewProps = {
  attackerId: string;
  defenderId: string;
  onUseAsAttacker: (spiritId: string) => void;
  onUseAsDefender: (spiritId: string) => void;
};

function SpiritDexView({
  attackerId,
  defenderId,
  onUseAsAttacker,
  onUseAsDefender,
}: SpiritDexViewProps) {
  const [query, setQuery] = useState("");
  const [elementFilter, setElementFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(spirits[0]?.id ?? "");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSpirits = spirits.filter((spirit) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      getSpiritSearchText(spirit).includes(normalizedQuery);
    const matchesElement =
      elementFilter === "all" || spirit.elements.includes(elementFilter);
    return matchesQuery && matchesElement;
  });
  const selectedSpirit =
    filteredSpirits.find((spirit) => spirit.id === selectedId) ??
    filteredSpirits[0] ??
    spiritMap.get(selectedId) ??
    spirits[0];
  const selectedSkills = selectedSpirit ? getAllSkillsForSpirit(selectedSpirit) : [];

  return (
    <section className="workspace-grid">
      <div className="panel dex-list-panel">
        <div className="panel-heading">
          <h2>精灵图鉴</h2>
          <span>{filteredSpirits.length} / {spirits.length}</span>
        </div>
        <div className="dex-filters">
          <label>
            搜索
            <input
              placeholder="名称、编号、形态、属性、特性或技能"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            属性
            <select
              value={elementFilter}
              onChange={(event) => setElementFilter(event.target.value)}
            >
              <option value="all">全部属性</option>
              {ELEMENTS.map((element) => (
                <option key={element} value={element}>
                  {element}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dex-list">
          {filteredSpirits.map((spirit) => (
            <button
              key={spirit.id}
              className={spirit.id === selectedSpirit?.id ? "dex-row is-active" : "dex-row"}
              type="button"
              onClick={() => setSelectedId(spirit.id)}
            >
              <span>{formatSpiritOption(spirit)}</span>
              <em>{spirit.elements.join(" / ")}</em>
            </button>
          ))}
        </div>
      </div>

      {selectedSpirit ? (
        <article className="panel dex-detail-panel">
          <div className="detail-heading">
            <div>
              <p>{selectedSpirit.elements.join(" / ")}</p>
              <h2>{formatSpiritOption(selectedSpirit)}</h2>
            </div>
            {selectedSpirit.imageUrl ? (
              <img alt={selectedSpirit.name} src={selectedSpirit.imageUrl} />
            ) : null}
          </div>

          <div className="detail-actions">
            <button
              className={selectedSpirit.id === attackerId ? "is-current" : ""}
              type="button"
              onClick={() => onUseAsAttacker(selectedSpirit.id)}
            >
              设为进攻方
            </button>
            <button
              className={selectedSpirit.id === defenderId ? "is-current" : ""}
              type="button"
              onClick={() => onUseAsDefender(selectedSpirit.id)}
            >
              设为防守方
            </button>
          </div>

          <div className="mini-stat-grid">
            {STAT_KEYS.map((key) => (
              <div key={key}>
                <span>{statLabels[key]}</span>
                <strong>{selectedSpirit.baseStats[key]}</strong>
              </div>
            ))}
          </div>

          <div className="detail-section">
            <h3>特性</h3>
            {(selectedSpirit.traits?.length ?? 0) > 0 ? (
              selectedSpirit.traits?.map((trait) => (
                <div className="trait-card" key={trait.name}>
                  <b>{trait.name}</b>
                  <p>{trait.description ?? "暂无说明。"}</p>
                </div>
              ))
            ) : (
              <p className="muted-text">暂无特性数据。</p>
            )}
          </div>

          <div className="detail-section">
            <h3>可学习技能</h3>
            {selectedSkills.length > 0 ? (
              <div className="compact-chip-list">
                {selectedSkills.map((skill) => (
                  <span key={skill.id}>{formatSkillOption(skill)}</span>
                ))}
              </div>
            ) : (
              <p className="muted-text">暂无已匹配技能。</p>
            )}
            {(selectedSpirit.unresolvedSkillNames?.length ?? 0) > 0 ? (
              <p className="warning-text">
                未匹配技能：{selectedSpirit.unresolvedSkillNames?.join("、")}
              </p>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}

type SkillDexViewProps = {
  attacker: Spirit;
  selectedSkill?: Skill;
  onUseSkill: (skillId: string) => void;
};

function SkillDexView({ attacker, selectedSkill, onUseSkill }: SkillDexViewProps) {
  const [query, setQuery] = useState("");
  const [elementFilter, setElementFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<SkillCategory | "all">("all");
  const [calculableFilter, setCalculableFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(selectedSkill?.id ?? skills[0]?.id ?? "");
  const attackerSkillIds = new Set(getAllSkillsForSpirit(attacker).map((skill) => skill.id));
  const attackerDamageSkillIds = new Set(
    getDamageSkillsForSpirit(attacker).map((skill) => skill.id)
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    const isDamage = skill.category === "physical" || skill.category === "magical";
    return (
      (normalizedQuery.length === 0 ||
        getSkillSearchText(skill).includes(normalizedQuery)) &&
      (elementFilter === "all" || skill.element === elementFilter) &&
      (categoryFilter === "all" || skill.category === categoryFilter) &&
      (calculableFilter === "all" ||
        (calculableFilter === "calculable" ? isDamage : !isDamage))
    );
  });
  const focusSkill =
    filteredSkills.find((skill) => skill.id === selectedId) ??
    filteredSkills[0] ??
    skillMap.get(selectedId) ??
    skills[0];
  const focusRules = focusSkill ? parseSkillRules(focusSkill) : [];
  const canUseForAttacker = focusSkill ? attackerDamageSkillIds.has(focusSkill.id) : false;

  return (
    <section className="workspace-grid">
      <div className="panel dex-list-panel">
        <div className="panel-heading">
          <h2>技能图鉴</h2>
          <span>{filteredSkills.length} / {skills.length}</span>
        </div>
        <div className="dex-filters three-columns">
          <label>
            搜索
            <input
              placeholder="技能名、属性、描述或可学习精灵"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            属性
            <select
              value={elementFilter}
              onChange={(event) => setElementFilter(event.target.value)}
            >
              <option value="all">全部属性</option>
              {ELEMENTS.map((element) => (
                <option key={element} value={element}>
                  {element}
                </option>
              ))}
            </select>
          </label>
          <label>
            类型
            <select
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value as SkillCategory | "all")
              }
            >
              <option value="all">全部类型</option>
              <option value="physical">物理</option>
              <option value="magical">魔法</option>
              <option value="status">状态</option>
              <option value="defense">防御</option>
            </select>
          </label>
          <label>
            可计算
            <select
              value={calculableFilter}
              onChange={(event) => setCalculableFilter(event.target.value)}
            >
              <option value="all">全部技能</option>
              <option value="calculable">可算伤害</option>
              <option value="non-calculable">非伤害/暂不可算</option>
            </select>
          </label>
        </div>
        <div className="dex-list">
          {filteredSkills.map((skill) => (
            <button
              key={skill.id}
              className={skill.id === focusSkill?.id ? "dex-row is-active" : "dex-row"}
              type="button"
              onClick={() => setSelectedId(skill.id)}
            >
              <span>{formatSkillOption(skill)}</span>
              <em>{attackerSkillIds.has(skill.id) ? "当前进攻方可学" : "资料技能"}</em>
            </button>
          ))}
        </div>
      </div>

      {focusSkill ? (
        <article className="panel dex-detail-panel">
          <div className="detail-heading">
            <div>
              <p>
                {focusSkill.element} · {skillCategoryLabels[focusSkill.category]}
              </p>
              <h2>{focusSkill.name}</h2>
            </div>
            <div className="skill-power-badge">
              <span>威力</span>
              <strong>{focusSkill.power > 0 ? focusSkill.power : "动态"}</strong>
            </div>
          </div>
          <div className="detail-actions">
            <button
              disabled={!canUseForAttacker}
              type="button"
              onClick={() => onUseSkill(focusSkill.id)}
            >
              用于当前进攻方
            </button>
          </div>
          <div className="info-grid">
            <div>
              <span>能耗</span>
              <strong>{focusSkill.energyCost ?? "-"}</strong>
            </div>
            <div>
              <span>稳定计入</span>
              <strong>{focusSkill.stableDamage ? "是" : "否"}</strong>
            </div>
            <div>
              <span>可学习精灵</span>
              <strong>{focusSkill.learnableSpiritNames?.length ?? 0}</strong>
            </div>
          </div>
          <div className="detail-section">
            <h3>技能说明</h3>
            <p>{getSkillDescription(focusSkill)}</p>
            {focusSkill.notes ? <p className="warning-text">{focusSkill.notes}</p> : null}
          </div>
          <RuleSummaryList rules={focusRules} />
          <div className="detail-section">
            <h3>可学习精灵</h3>
            {(focusSkill.learnableSpiritNames?.length ?? 0) > 0 ? (
              <div className="compact-chip-list">
                {focusSkill.learnableSpiritNames?.slice(0, 80).map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
            ) : (
              <p className="muted-text">暂无可学习精灵数据。</p>
            )}
          </div>
        </article>
      ) : null}
    </section>
  );
}

type TypeChartViewProps = {
  defender: Spirit;
  selectedSkill?: Skill;
};

function TypeChartView({ defender, selectedSkill }: TypeChartViewProps) {
  const [attackElement, setAttackElement] = useState<string>(
    selectedSkill?.element ?? "普通"
  );
  const [firstDefense, setFirstDefense] = useState<string>(
    defender.elements[0] ?? "普通"
  );
  const [secondDefense, setSecondDefense] = useState<string>(
    defender.elements[1] ?? ""
  );
  const defenseElements = [firstDefense, secondDefense].filter(Boolean);
  const selectedResult = calculateTypeMultiplier(attackElement, defenseElements);
  const currentResult = calculateTypeMultiplier(
    selectedSkill?.element ?? "普通",
    defender.elements
  );

  return (
    <section className="panel type-panel">
      <div className="panel-heading">
        <h2>克制表</h2>
        <span>双属性按当前表计算</span>
      </div>
      <div className="type-query">
        <label>
          进攻属性
          <select
            value={attackElement}
            onChange={(event) => setAttackElement(event.target.value)}
          >
            {ELEMENTS.map((element) => (
              <option key={element} value={element}>
                {element}
              </option>
            ))}
          </select>
        </label>
        <label>
          防守属性一
          <select
            value={firstDefense}
            onChange={(event) => setFirstDefense(event.target.value)}
          >
            {ELEMENTS.map((element) => (
              <option key={element} value={element}>
                {element}
              </option>
            ))}
          </select>
        </label>
        <label>
          防守属性二
          <select
            value={secondDefense}
            onChange={(event) => setSecondDefense(event.target.value)}
          >
            <option value="">无</option>
            {ELEMENTS.map((element) => (
              <option key={element} value={element}>
                {element}
              </option>
            ))}
          </select>
        </label>
        <div className="type-result-card">
          <span>
            {attackElement} → {createDefenseTypeKey(defenseElements)}
          </span>
          <strong>{selectedResult.multiplier}</strong>
          {!selectedResult.found ? <em>未录入，按 1 计算</em> : null}
        </div>
      </div>

      <div className="current-type-note">
        当前计算器：{selectedSkill?.element ?? "普通"} →{" "}
        {defender.elements.join(" / ")} = {currentResult.multiplier}
        {!currentResult.found ? "（未录入，按 1）" : ""}
      </div>

      <div className="type-table-wrap">
        <table className="type-table">
          <thead>
            <tr>
              <th>攻 \ 防</th>
              {ELEMENTS.map((defense) => (
                <th key={defense}>{defense}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ELEMENTS.map((attack) => (
              <tr key={attack}>
                <th>{attack}</th>
                {ELEMENTS.map((defense) => {
                  const result = calculateTypeMultiplier(attack, [defense]);
                  const active =
                    attack === attackElement &&
                    defenseElements.length === 1 &&
                    defense === firstDefense;
                  return (
                    <td
                      key={`${attack}-${defense}`}
                      className={`${active ? "is-active" : ""} type-rate-${String(
                        result.multiplier
                      ).replace(".", "-")}`}
                    >
                      {result.multiplier}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RuleSummaryList({ rules }: { rules: EffectRule[] }) {
  return (
    <div className="detail-section">
      <h3>规则摘要</h3>
      {rules.length > 0 ? (
        <div className="rule-debug-list">
          {rules.map((rule) => (
            <article className="rule-debug-card" key={rule.id}>
              <div>
                <strong>{rule.label}</strong>
                <span>{rule.kind} · {getRuleFormulaStatus(rule)}</span>
              </div>
              <p>{getRuleSummary(rule)}</p>
              <em>{rule.description}</em>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-text">没有解析到可展示规则。</p>
      )}
    </div>
  );
}

function RulesDebugView() {
  const [mode, setMode] = useState<"skill" | "trait">("skill");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(skills[0]?.id ?? "");
  const traitEntries = spirits.flatMap((spirit) =>
    (spirit.traits ?? []).map((trait) => ({
      id: `${spirit.id}:${trait.name}`,
      spirit,
      trait,
    }))
  );
  const normalizedQuery = query.trim().toLowerCase();
  const skillOptions = skills.filter(
    (skill) =>
      normalizedQuery.length === 0 || getSkillSearchText(skill).includes(normalizedQuery)
  );
  const traitOptions = traitEntries.filter((entry) =>
    normalizedQuery.length === 0
      ? true
      : [formatSpiritOption(entry.spirit), entry.trait.name, entry.trait.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
  );
  const selectedSkill =
    skillOptions.find((skill) => skill.id === selectedId) ??
    skillOptions[0] ??
    skillMap.get(selectedId);
  const selectedTrait =
    traitOptions.find((entry) => entry.id === selectedId) ??
    traitOptions[0] ??
    traitEntries.find((entry) => entry.id === selectedId);
  const rules =
    mode === "skill" && selectedSkill
      ? parseSkillRules(selectedSkill)
      : mode === "trait" && selectedTrait
        ? parseTraitRules(selectedTrait.trait)
        : [];
  const rawText =
    mode === "skill"
      ? selectedSkill
        ? getSkillDescription(selectedSkill)
        : ""
      : selectedTrait?.trait.description ?? "";

  return (
    <section className="workspace-grid">
      <div className="panel dex-list-panel">
        <div className="panel-heading">
          <h2>规则调试</h2>
          <span>{mode === "skill" ? skillOptions.length : traitOptions.length} 项</span>
        </div>
        <div className="dex-filters">
          <label>
            类型
            <select
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as "skill" | "trait";
                setMode(nextMode);
                setSelectedId(
                  nextMode === "skill" ? skills[0]?.id ?? "" : traitEntries[0]?.id ?? ""
                );
              }}
            >
              <option value="skill">技能</option>
              <option value="trait">特性</option>
            </select>
          </label>
          <label>
            搜索
            <input
              placeholder="搜索技能、精灵、特性或描述"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="dex-list">
          {mode === "skill"
            ? skillOptions.map((skill) => (
                <button
                  key={skill.id}
                  className={skill.id === selectedSkill?.id ? "dex-row is-active" : "dex-row"}
                  type="button"
                  onClick={() => setSelectedId(skill.id)}
                >
                  <span>{formatSkillOption(skill)}</span>
                  <em>{parseSkillRules(skill).length} 条规则</em>
                </button>
              ))
            : traitOptions.map((entry) => (
                <button
                  key={entry.id}
                  className={entry.id === selectedTrait?.id ? "dex-row is-active" : "dex-row"}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span>{entry.trait.name}</span>
                  <em>{formatSpiritOption(entry.spirit)}</em>
                </button>
              ))}
        </div>
      </div>

      <article className="panel dex-detail-panel">
        <div className="detail-heading">
          <div>
            <p>{mode === "skill" ? "技能描述解析" : "特性描述解析"}</p>
            <h2>
              {mode === "skill"
                ? selectedSkill?.name ?? "未选择"
                : selectedTrait
                  ? `${selectedTrait.spirit.name} · ${selectedTrait.trait.name}`
                  : "未选择"}
            </h2>
          </div>
        </div>
        <div className="detail-section">
          <h3>原始描述</h3>
          <p>{rawText || "暂无描述。"}</p>
        </div>
        <RuleSummaryList rules={rules} />
      </article>
    </section>
  );
}

function UpdateAnnouncementsView() {
  const latest = updateAnnouncements[0];

  return (
    <section className="updates-page">
      <div className="panel updates-hero">
        <div>
          <p>当前版本</p>
          <h2>{latest.version} · {latest.title}</h2>
          <span>{latest.date}</span>
        </div>
        <div className="updates-hero-note">
          这里记录计算器的重要更新、已上线能力和仍需校准的规则，方便玩家确认当前版本是否包含自己需要的功能。
        </div>
      </div>

      <div className="updates-timeline">
        {updateAnnouncements.map((announcement) => (
          <article className="panel update-card" key={announcement.version}>
            <div className="update-meta">
              <strong>{announcement.version}</strong>
              <span>{announcement.date}</span>
            </div>
            <div className="update-body">
              <h3>{announcement.title}</h3>
              <ul>
                {announcement.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {announcement.notes && announcement.notes.length > 0 ? (
                <div className="update-notes">
                  {announcement.notes.map((note) => (
                    <span key={note}>{note}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const initialAttacker = spirits[0];
  const initialDefender = spirits[2] ?? spirits[0];
  const initialSkill = getDefaultSkillForSpirit(initialAttacker);

  const [attackerId, setAttackerId] = useState(initialAttacker.id);
  const [defenderId, setDefenderId] = useState(initialDefender.id);
  const [attackerSearch, setAttackerSearch] = useState("");
  const [defenderSearch, setDefenderSearch] = useState("");
  const [attackerNatureId, setAttackerNatureId] = useState(natures[0].id);
  const [defenderNatureId, setDefenderNatureId] = useState(natures[0].id);
  const [attackerIvs, setAttackerIvs] = useState<IndividualValues>(() =>
    getRecommendedIvs(initialAttacker.id)
  );
  const [defenderIvs, setDefenderIvs] = useState<IndividualValues>(() =>
    getRecommendedIvs(initialDefender.id)
  );
  const [selectedSkillId, setSelectedSkillId] = useState(initialSkill?.id ?? "");
  const [modifierState, setModifierState] = useState<BattleModifierState>(() =>
    createDefaultBattleModifierState()
  );
  const [spiritHistoryIds, setSpiritHistoryIds] = useState<string[]>(() =>
    readSpiritHistoryIds()
  );
  const [spiritPresets, setSpiritPresets] = useState<SpiritPreset[]>(() =>
    readSpiritPresets()
  );
  const [savingPresetSide, setSavingPresetSide] = useState<PresetSide | null>(null);
  const [presetDraftName, setPresetDraftName] = useState("");
  const [activePage, setActivePage] = useState<PageKey>(() => getPageFromHash());

  useEffect(() => {
    const syncPageFromHash = () => setActivePage(getPageFromHash());
    window.addEventListener("hashchange", syncPageFromHash);

    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/calculator");
    }

    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  const attacker = spirits.find((item) => item.id === attackerId) ?? spirits[0];
  const defender = spirits.find((item) => item.id === defenderId) ?? spirits[0];
  const historySpirits = spiritHistoryIds
    .map((spiritId) => spiritMap.get(spiritId))
    .filter((item): item is Spirit => Boolean(item));
  const attackerNature: Nature =
    natures.find((item) => item.id === attackerNatureId) ?? natures[0];
  const defenderNature: Nature =
    natures.find((item) => item.id === defenderNatureId) ?? natures[0];

  const attackerActualStats = calculatePvpStats(
    attacker.baseStats,
    attackerIvs,
    attackerNature
  );
  const defenderActualStats = calculatePvpStats(
    defender.baseStats,
    defenderIvs,
    defenderNature
  );

  const availableSkills = getDamageSkillsForSpirit(attacker);
  const selectedSkill =
    availableSkills.find((skill) => skill.id === selectedSkillId) ??
    availableSkills[0];
  const selectedSkillRules = selectedSkill ? parseSkillRules(selectedSkill) : [];
  const traitRules = getTraitRules(attacker);
  const allAppliedRules = [...selectedSkillRules, ...traitRules];
  const configurableSkillRules = selectedSkillRules.filter(hasConfigurableSkillRule);
  const typeResult = calculateTypeMultiplier(
    selectedSkill?.element ?? "普通",
    defender.elements
  );
  const stabMultiplier = getStabMultiplier(attacker, selectedSkill);
  const resolvedDamageInput = selectedSkill
    ? resolveDamageInput({
        skill: selectedSkill,
        attackerStats: attackerActualStats,
        defenderStats: defenderActualStats,
        stabMultiplier,
        typeMultiplier: typeResult.multiplier,
        state: modifierState,
        rules: allAppliedRules,
      })
    : undefined;
  const damageResult = resolvedDamageInput
    ? calculateDamage(resolvedDamageInput.input)
    : undefined;

  const handleIvToggle =
    (side: "attacker" | "defender") =>
    (key: StatKey): void => {
      const setter = side === "attacker" ? setAttackerIvs : setDefenderIvs;
      setter((current) => {
        const checked = current[key] === PERFECT_IV_VALUE;
        const selectedCount = countPerfectIvLines(current);

        if (!checked && selectedCount >= PERFECT_IV_LINE_COUNT) {
          return current;
        }

        return {
          ...current,
          [key]: checked ? 0 : PERFECT_IV_VALUE,
        };
      });
    };

  function resetDynamicState(preserveManual = false): void {
    setModifierState((current) => {
      const next = createDefaultBattleModifierState();

      if (!preserveManual) {
        return next;
      }

      return {
        ...next,
        manualAttacker: current.manualAttacker,
        manualDefender: current.manualDefender,
      };
    });
  }

  function rememberSpiritHistory(spiritId: string): void {
    if (!spiritMap.has(spiritId)) {
      return;
    }

    setSpiritHistoryIds((current) => {
      const next = [
        spiritId,
        ...current.filter((currentId) => currentId !== spiritId && spiritMap.has(currentId)),
      ].slice(0, MAX_SPIRIT_HISTORY);

      writeSpiritHistoryIds(next);
      return next;
    });
  }

  function clearSpiritHistory(): void {
    setSpiritHistoryIds([]);
    writeSpiritHistoryIds([]);
  }

  function getPresetDraftContext(side: PresetSide): {
    spirit: Spirit;
    nature: Nature;
    ivs: IndividualValues;
    skill?: Skill;
  } {
    if (side === "attacker") {
      return {
        spirit: attacker,
        nature: attackerNature,
        ivs: attackerIvs,
        skill: selectedSkill,
      };
    }

    return {
      spirit: defender,
      nature: defenderNature,
      ivs: defenderIvs,
    };
  }

  function beginPresetSave(side: PresetSide): void {
    const context = getPresetDraftContext(side);
    setPresetDraftName(
      formatPresetDefaultName(
        context.spirit,
        context.nature,
        context.ivs,
        side === "attacker" ? context.skill : undefined
      )
    );
    setSavingPresetSide(side);
  }

  function confirmPresetSave(side: PresetSide): void {
    const name = presetDraftName.trim();
    if (!name) {
      return;
    }

    const context = getPresetDraftContext(side);
    const preset = createSpiritPreset({
      name,
      spirit: context.spirit,
      nature: context.nature,
      ivs: context.ivs,
      skill: side === "attacker" ? context.skill : undefined,
    });

    setSpiritPresets((current) => {
      const next = [preset, ...current].sort((left, right) => right.updatedAt - left.updatedAt);
      writeSpiritPresets(next);
      return next;
    });
    setSavingPresetSide(null);
    setPresetDraftName("");
  }

  function cancelPresetSave(): void {
    setSavingPresetSide(null);
    setPresetDraftName("");
  }

  function applyPreset(side: PresetSide, presetId: string): void {
    const preset = spiritPresets.find((item) => item.id === presetId);
    const presetSpirit = preset ? spiritMap.get(preset.spiritId) : undefined;
    const presetNature = preset ? natureMap.get(preset.natureId) : undefined;

    if (!preset || !presetSpirit || !presetNature) {
      return;
    }

    rememberSpiritHistory(preset.spiritId);

    if (side === "attacker") {
      const availablePresetSkills = getDamageSkillsForSpirit(presetSpirit);
      const presetSkillIsAvailable = Boolean(
        preset.skillId &&
          availablePresetSkills.some((skill) => skill.id === preset.skillId)
      );

      setAttackerId(preset.spiritId);
      setAttackerNatureId(preset.natureId);
      setAttackerIvs({ ...preset.ivs });
      setAttackerSearch("");
      setSelectedSkillId(
        presetSkillIsAvailable
          ? preset.skillId!
          : getDefaultSkillForSpirit(presetSpirit)?.id ?? ""
      );
      resetDynamicState();
      return;
    }

    setDefenderId(preset.spiritId);
    setDefenderNatureId(preset.natureId);
    setDefenderIvs({ ...preset.ivs });
    setDefenderSearch("");
  }

  function deletePreset(presetId: string): void {
    setSpiritPresets((current) => {
      const next = current.filter((preset) => preset.id !== presetId);
      writeSpiritPresets(next);
      return next;
    });
  }

  function handleAttackerChange(nextId: string): void {
    rememberSpiritHistory(nextId);
    setAttackerId(nextId);
    setAttackerIvs(getRecommendedIvs(nextId));
    const nextSpirit = spirits.find((item) => item.id === nextId) ?? attacker;
    setSelectedSkillId(getDefaultSkillForSpirit(nextSpirit)?.id ?? "");
    resetDynamicState();
  }

  function handleDefenderChange(nextId: string): void {
    rememberSpiritHistory(nextId);
    setDefenderId(nextId);
    setDefenderIvs(getRecommendedIvs(nextId));
  }

  function handleSkillChange(nextSkillId: string): void {
    setSelectedSkillId(nextSkillId);
    resetDynamicState(true);
  }

  function applySpiritFromDex(side: PresetSide, spiritId: string): void {
    if (side === "attacker") {
      handleAttackerChange(spiritId);
      setAttackerSearch("");
    } else {
      handleDefenderChange(spiritId);
      setDefenderSearch("");
    }

    navigateToPage("calculator");
  }

  function useSkillFromDex(skillId: string): void {
    if (!availableSkills.some((skill) => skill.id === skillId)) {
      return;
    }

    handleSkillChange(skillId);
    navigateToPage("calculator");
  }

  function updateRuleEnabled(ruleId: string, enabled: boolean): void {
    setModifierState((current) => ({
      ...current,
      ruleEnabled: {
        ...current.ruleEnabled,
        [ruleId]: enabled,
      },
    }));
  }

  function updateRuleStacks(ruleId: string, stacks: number): void {
    setModifierState((current) => ({
      ...current,
      ruleStacks: {
        ...current.ruleStacks,
        [ruleId]: stacks,
      },
    }));
  }

  function updateSkillUseCount(value: number): void {
    setModifierState((current) => ({
      ...current,
      skillUseCount: Math.max(0, Math.round(value)),
    }));
  }

  function updateEnemyTotalSkillCost(value: number): void {
    setModifierState((current) => ({
      ...current,
      enemyTotalSkillCost: Math.max(0, value),
    }));
  }

  function updateManualModifier(
    side: "attacker" | "defender",
    key: StatKey,
    percentValue: number
  ): void {
    const stateKey = side === "attacker" ? "manualAttacker" : "manualDefender";
    setModifierState((current) => ({
      ...current,
      [stateKey]: {
        ...current[stateKey],
        [key]: (Number.isFinite(percentValue) ? percentValue : 0) / 100,
      },
    }));
  }

  const hasPerUseRule = selectedSkillRules.some(
    (rule) => rule.kind === "hitCountPerUse" || rule.kind === "powerBonusPerUse"
  );
  const hasEnemyCostPower = selectedSkillRules.some(
    (rule) => rule.kind === "powerFromEnemyCost"
  );

  return (
    <main className="page">
      <header className="app-header">
        <div>
          <p>PVP 等级固定 {PVP_LEVEL}</p>
          <h1>洛克王国：世界 PVP 工作台</h1>
        </div>
        <span>伤害计算 · 图鉴资料 · 规则调试</span>
      </header>

      <nav className="workspace-nav" aria-label="PVP 工作台导航">
        {routes.map((route) => (
          <a
            key={route.key}
            className={activePage === route.key ? "is-active" : ""}
            href={`#/${route.key}`}
          >
            <strong>{route.label}</strong>
            <span>{route.description}</span>
          </a>
        ))}
      </nav>

      {activePage === "calculator" ? (
      <>
      <div className="battle-grid">
        <SpiritPanel
          actualStats={attackerActualStats}
          historySpirits={historySpirits}
          ivs={attackerIvs}
          natureId={attackerNatureId}
          presetDraftName={presetDraftName}
          presets={spiritPresets}
          search={attackerSearch}
          savingPreset={savingPresetSide === "attacker"}
          side="attacker"
          spirit={attacker}
          spiritId={attackerId}
          title="进攻方"
          onApplyPreset={applyPreset}
          onBeginPresetSave={beginPresetSave}
          onCancelPresetSave={cancelPresetSave}
          onClearHistory={clearSpiritHistory}
          onConfirmPresetSave={confirmPresetSave}
          onDeletePreset={deletePreset}
          onHistorySelect={handleAttackerChange}
          onIvToggle={handleIvToggle("attacker")}
          onNatureChange={setAttackerNatureId}
          onPresetDraftNameChange={setPresetDraftName}
          onSearchChange={setAttackerSearch}
          onSpiritChange={handleAttackerChange}
        />

        <SpiritPanel
          actualStats={defenderActualStats}
          historySpirits={historySpirits}
          ivs={defenderIvs}
          natureId={defenderNatureId}
          presetDraftName={presetDraftName}
          presets={spiritPresets}
          search={defenderSearch}
          savingPreset={savingPresetSide === "defender"}
          side="defender"
          spirit={defender}
          spiritId={defenderId}
          title="防守方"
          onApplyPreset={applyPreset}
          onBeginPresetSave={beginPresetSave}
          onCancelPresetSave={cancelPresetSave}
          onClearHistory={clearSpiritHistory}
          onConfirmPresetSave={confirmPresetSave}
          onDeletePreset={deletePreset}
          onHistorySelect={handleDefenderChange}
          onIvToggle={handleIvToggle("defender")}
          onNatureChange={setDefenderNatureId}
          onPresetDraftNameChange={setPresetDraftName}
          onSearchChange={setDefenderSearch}
          onSpiritChange={handleDefenderChange}
        />
      </div>

      <section className="panel skill-panel">
        <div className="panel-heading">
          <h2>技能与自动参数</h2>
          <span>{availableSkills.length} 个可计算技能</span>
        </div>

        <div className="field-row">
          <label>
            进攻方可学习技能
            <select
              disabled={availableSkills.length === 0}
              value={selectedSkill?.id ?? ""}
              onChange={(event) => handleSkillChange(event.target.value)}
            >
              {availableSkills.length > 0 ? (
                availableSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name} · {skill.element} · {categoryLabels[skill.category]} ·{" "}
                    {skill.power > 0 ? skill.power : "动态威力"}
                  </option>
                ))
              ) : (
                <option value="">该精灵暂无可计算技能</option>
              )}
            </select>
          </label>
        </div>

        {selectedSkill ? (
          <div className="skill-summary">
            <h3>
              {selectedSkill.name}{" "}
              {selectedSkill.power > 0 ? selectedSkill.power : "动态威力"}
            </h3>
            <div className="chip-row">
              <span>{selectedSkill.element}</span>
              <span>{categoryLabels[selectedSkill.category]}</span>
              <span>本系 {stabMultiplier}</span>
              <span>
                克制 {selectedSkill.element} → {defender.elements.join(" / ")} ={" "}
                {typeResult.multiplier}
              </span>
            </div>
            <p>{selectedSkill.description ?? "暂无技能说明。"}</p>
            {!typeResult.found ? (
              <em>克制表未录入该组合，当前按 1 计算。</em>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">
            当前精灵还没有匹配到可计算伤害技能。可以先换一只精灵，或后续补齐技能对应关系。
          </div>
        )}

        <div className="dynamic-grid">
          <section className="dynamic-card">
            <div className="dynamic-card-heading">
              <h3>当前技能机制</h3>
              <span>{configurableSkillRules.length} 项可调</span>
            </div>
            {hasPerUseRule ? (
              <label className="rule-control">
                当前技能已使用次数
                <span>用于永久威力/连击成长</span>
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={modifierState.skillUseCount}
                  onChange={(event) =>
                    updateSkillUseCount(Number(event.target.value) || 0)
                  }
                />
              </label>
            ) : null}
            {hasEnemyCostPower ? (
              <label className="rule-control">
                敌方技能总能耗
                <span>用于动态威力</span>
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={modifierState.enemyTotalSkillCost}
                  onChange={(event) =>
                    updateEnemyTotalSkillCost(Number(event.target.value) || 0)
                  }
                />
              </label>
            ) : null}
            {selectedSkillRules.length > 0 ? (
              selectedSkillRules.map((rule) => (
                <RuleControl
                  key={rule.id}
                  rule={rule}
                  state={modifierState}
                  onRuleStacksChange={updateRuleStacks}
                  onToggleRule={updateRuleEnabled}
                />
              ))
            ) : (
              <p className="muted-text">该技能没有识别到额外伤害机制。</p>
            )}
          </section>

          <section className="dynamic-card">
            <div className="dynamic-card-heading">
              <h3>当前精灵特性</h3>
              <span>{traitRules.filter((rule) => rule.kind !== "note").length} 项可调</span>
            </div>
            {traitRules.length > 0 ? (
              traitRules.map((rule) => (
                <RuleControl
                  key={rule.id}
                  rule={rule}
                  state={modifierState}
                  onRuleStacksChange={updateRuleStacks}
                  onToggleRule={updateRuleEnabled}
                />
              ))
            ) : (
              <p className="muted-text">该精灵没有可解析特性。</p>
            )}
          </section>

          <section className="dynamic-card manual-card">
            <div className="dynamic-card-heading">
              <h3>手动修正</h3>
              <span>最终状态</span>
            </div>
            <p className="muted-text">
              用于手动填入已经发生的强化或削弱。攻击、防御会进入伤害公式；速度只进入摘要，暂不改变伤害。
            </p>
            <div className="manual-groups">
              <ManualModifierGroup
                side="attacker"
                title="进攻方修正"
                values={modifierState.manualAttacker}
                onChange={updateManualModifier}
              />
              <ManualModifierGroup
                side="defender"
                title="防守方修正"
                values={modifierState.manualDefender}
                onChange={updateManualModifier}
              />
            </div>
          </section>
        </div>
      </section>

      <section className="result-panel">
        <div className="damage-hero">
          <span>最终伤害</span>
          <strong>{damageResult?.damage ?? "-"}</strong>
          {damageResult ? (
            <em className={riskClassName[damageResult.risk]}>{damageResult.risk}</em>
          ) : (
            <em className="risk-low">无可计算技能</em>
          )}
        </div>

        {damageResult && resolvedDamageInput ? (
          <div className="result-wrap">
            <div className="result-grid">
              <div>
                <span>使用攻击属性</span>
                <strong>{damageResult.attackStatName}</strong>
              </div>
              <div>
                <span>使用防御属性</span>
                <strong>{damageResult.defenseStatName}</strong>
              </div>
              <div>
                <span>进攻值</span>
                <strong>{damageResult.attack}</strong>
              </div>
              <div>
                <span>防御值</span>
                <strong>{damageResult.defense}</strong>
              </div>
              <div>
                <span>基础威力</span>
                <strong>{formatNumber(resolvedDamageInput.skillPower)}</strong>
              </div>
              <div>
                <span>威力加成</span>
                <strong>{formatNumber(resolvedDamageInput.powerBonus)}</strong>
              </div>
              <div>
                <span>威力提升</span>
                <strong>{formatNumber(resolvedDamageInput.powerBuffMultiplier)}</strong>
              </div>
              <div>
                <span>局内威力</span>
                <strong>{formatNumber(damageResult.inBattlePower)}</strong>
              </div>
              <div>
                <span>连击数</span>
                <strong>{formatNumber(damageResult.hitCount)}</strong>
              </div>
              <div>
                <span>能力等级倍率</span>
                <strong>{formatNumber(damageResult.abilityMultiplier)}</strong>
              </div>
              <div>
                <span>修正攻击</span>
                <strong>{formatNumber(damageResult.adjustedAttack)}</strong>
              </div>
              <div>
                <span>37/41 中间值</span>
                <strong>{formatNumber(damageResult.singleHitIntermediate)}</strong>
              </div>
              <div>
                <span>单击伤害</span>
                <strong>{formatNumber(damageResult.singleHitDamage)}</strong>
              </div>
              <div>
                <span>本系加成</span>
                <strong>{stabMultiplier}</strong>
              </div>
              <div>
                <span>克制倍率</span>
                <strong>{typeResult.multiplier}</strong>
              </div>
              <div>
                <span>占防守生命</span>
                <strong>{formatPercent(damageResult.hpPercent)}</strong>
              </div>
            </div>

            <div className="applied-effects">
              <h3>已计入效果</h3>
              {resolvedDamageInput.summaries.length > 0 ? (
                <ul>
                  {resolvedDamageInput.summaries.map((summary) => (
                    <li key={summary}>{summary}</li>
                  ))}
                </ul>
              ) : (
                <p>当前没有额外计入的技能、特性或手动修正效果。</p>
              )}
              <h3>未计入提示</h3>
              {resolvedDamageInput.notes.length > 0 ? (
                <ul>
                  {[...new Set(resolvedDamageInput.notes)].map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p>没有额外提示。</p>
              )}
              <div className="modifier-summary">
                <span>
                  进攻方：物攻 {formatRate(resolvedDamageInput.attackerModifiers.atk)}，
                  魔攻 {formatRate(resolvedDamageInput.attackerModifiers.spa)}，速度{" "}
                  {formatRate(resolvedDamageInput.attackerModifiers.spe)}
                </span>
                <span>
                  防守方：物防 {formatRate(resolvedDamageInput.defenderModifiers.def)}，
                  魔防 {formatRate(resolvedDamageInput.defenderModifiers.spd)}，速度{" "}
                  {formatRate(resolvedDamageInput.defenderModifiers.spe)}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      </>
      ) : null}

      {activePage === "spirits" ? (
        <SpiritDexView
          attackerId={attacker.id}
          defenderId={defender.id}
          onUseAsAttacker={(spiritId) => applySpiritFromDex("attacker", spiritId)}
          onUseAsDefender={(spiritId) => applySpiritFromDex("defender", spiritId)}
        />
      ) : null}

      {activePage === "skills" ? (
        <SkillDexView
          attacker={attacker}
          selectedSkill={selectedSkill}
          onUseSkill={useSkillFromDex}
        />
      ) : null}

      {activePage === "types" ? (
        <TypeChartView defender={defender} selectedSkill={selectedSkill} />
      ) : null}

      {activePage === "rules" ? <RulesDebugView /> : null}

      {activePage === "updates" ? <UpdateAnnouncementsView /> : null}

    </main>
  );
}
