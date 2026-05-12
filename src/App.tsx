import { useState } from "react";
import "./App.css";

import { recommendedIndividualKeys } from "./data/builds";
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
  Spirit,
  StatKey,
} from "./types/battle";
import { calculateDamage } from "./utils/damageCalculator";
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
  createIndividualValuesFromKeys,
} from "./utils/statCalculator";
import { calculateTypeMultiplier } from "./utils/typeCalculator";

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

function getRecommendedIvs(spiritId: string): IndividualValues {
  return createIndividualValuesFromKeys(
    recommendedIndividualKeys[spiritId] ?? ["hp", "atk", "spe"]
  );
}

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

function isDamageSkill(skill: Skill): skill is Skill & {
  category: DamageSkillCategory;
} {
  const hasDynamicPower = (skill.description ?? "").includes(
    "威力等于敌方精灵技能总能耗"
  );

  return (
    (skill.category === "physical" || skill.category === "magical") &&
    (skill.power > 0 || hasDynamicPower)
  );
}

function getAllSkillsForSpirit(spirit: Spirit): Skill[] {
  const commonSkillIds = spirit.commonSkillIds ?? [];
  const learnableSkillIds = spirit.learnableSkillIds ?? [];
  const skillIds = commonSkillIds.length > 0 ? commonSkillIds : learnableSkillIds;

  return skillIds
    .map((skillId) => skillMap.get(skillId))
    .filter((skill): skill is Skill => Boolean(skill));
}

function getDamageSkillsForSpirit(
  spirit: Spirit
): Array<Skill & { category: DamageSkillCategory }> {
  return getAllSkillsForSpirit(spirit).filter(isDamageSkill);
}

function getDefaultSkillForSpirit(spirit: Spirit): Skill | undefined {
  return getDamageSkillsForSpirit(spirit)[0];
}

function getStabMultiplier(attacker: Spirit, skill?: Skill): number {
  if (!skill) {
    return 1;
  }

  return attacker.elements.includes(skill.element) ? 1.25 : 1;
}

function getTraitRules(spirit: Spirit): EffectRule[] {
  return (spirit.traits ?? []).flatMap(parseTraitRules);
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
          <h1>洛克王国：世界 PVP 伤害计算器</h1>
        </div>
        <span>特性层数 · 技能机制 · 手动修正</span>
      </header>

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
                <span>技能威力</span>
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
                <span>连击数</span>
                <strong>{formatNumber(resolvedDamageInput.hitCount)}</strong>
              </div>
              <div>
                <span>能力等级倍率</span>
                <strong>{formatNumber(damageResult.abilityMultiplier)}</strong>
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
    </main>
  );
}
