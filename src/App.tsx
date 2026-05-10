import { useState } from "react";
import "./App.css";

import { recommendedIndividualKeys } from "./data/builds";
import { natures } from "./data/natures";
import { skills } from "./data/skills";
import { spirits } from "./data/spirits";
import type {
  BattleStats,
  GrowthValues,
  IndividualValues,
  Nature,
  Skill,
  Spirit,
  StatKey,
} from "./types/battle";
import { calculateDamage } from "./utils/damageCalculator";
import {
  DEFAULT_PVP_GROWTH_VALUES,
  PERFECT_IV_LINE_COUNT,
  PERFECT_IV_VALUE,
  PVP_LEVEL,
  STAT_KEYS,
  calculatePvpBaseStats,
  calculatePvpStats,
  createIndividualValuesFromKeys,
} from "./utils/statCalculator";

const statLabels: Record<StatKey, string> = {
  hp: "生命",
  atk: "物攻",
  spa: "魔攻",
  def: "物防",
  spd: "魔防",
  spe: "速度",
};

const riskClassName = {
  必定击杀: "risk-ko",
  高危: "risk-high",
  中危: "risk-medium",
  低危: "risk-low",
} as const;

function getRecommendedIvs(spiritId: string): IndividualValues {
  return createIndividualValuesFromKeys(
    recommendedIndividualKeys[spiritId] ?? ["hp", "atk", "spe"]
  );
}

function safeNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNonNegative(value: number): number {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function clampReduction(value: number): number {
  return Math.min(0.99, Math.max(0, Number.isFinite(value) ? value : 0));
}

function countPerfectIvLines(ivs: IndividualValues): number {
  return STAT_KEYS.filter((key) => ivs[key] === PERFECT_IV_VALUE).length;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function filterSpirits(query: string, selectedSpirit: Spirit): Spirit[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return spirits;
  }

  const filtered = spirits.filter((spirit) => {
    return [spirit.name, spirit.dexNo, spirit.form, spirit.stage]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedQuery));
  });

  return filtered.some((spirit) => spirit.id === selectedSpirit.id)
    ? filtered
    : [selectedSpirit, ...filtered];
}

function getSkillsForSpirit(spirit: Spirit): Skill[] {
  const commonSkillIds = spirit.commonSkillIds ?? [];
  const commonSkills = commonSkillIds
    .map((skillId) => skills.find((skill) => skill.id === skillId))
    .filter((skill): skill is Skill => Boolean(skill));

  return commonSkills.length > 0 ? commonSkills : skills;
}

function getDefaultSkillForSpirit(spirit: Spirit): Skill {
  return getSkillsForSpirit(spirit)[0] ?? skills[0];
}

type SpiritPanelProps = {
  title: string;
  search: string;
  spirit: Spirit;
  spiritId: string;
  natureId: string;
  ivs: IndividualValues;
  growthValues: GrowthValues;
  baseFormulaStats: BattleStats;
  actualStats: BattleStats;
  onSearchChange: (query: string) => void;
  onSpiritChange: (spiritId: string) => void;
  onNatureChange: (natureId: string) => void;
  onIvToggle: (key: StatKey) => void;
};

function SpiritPanel({
  title,
  search,
  spirit,
  spiritId,
  natureId,
  ivs,
  growthValues,
  baseFormulaStats,
  actualStats,
  onSearchChange,
  onSpiritChange,
  onNatureChange,
  onIvToggle,
}: SpiritPanelProps) {
  const selectedIvLineCount = countPerfectIvLines(ivs);
  const spiritOptions = filterSpirits(search, spirit);

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
            placeholder="输入名称、编号、形态"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        <label>
          精灵
          <select
            value={spiritId}
            onChange={(event) => onSpiritChange(event.target.value)}
          >
            {spiritOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.dexNo ? `${item.dexNo} · ` : ""}
                {item.name}
                {item.form ? `（${item.form}）` : ""}
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

      <div className="stat-table">
        <div className="stat-table-head">属性</div>
        <div className="stat-table-head">种族</div>
        <div className="stat-table-head">个体</div>
        <div className="stat-table-head">公式基础</div>
        <div className="stat-table-head">五星成长</div>
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
              <strong>{baseFormulaStats[key]}</strong>
              <strong>+{growthValues[key]}</strong>
              <strong className="actual-stat">{actualStats[key]}</strong>
            </div>
          );
        })}
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

  const [selectedSkillId, setSelectedSkillId] = useState(initialSkill.id);
  const [typeMultiplier, setTypeMultiplier] = useState(1);
  const [weatherMultiplier, setWeatherMultiplier] = useState(1);
  const [damageReduction, setDamageReduction] = useState(0);

  const attacker = spirits.find((item) => item.id === attackerId) ?? spirits[0];
  const defender = spirits.find((item) => item.id === defenderId) ?? spirits[0];
  const attackerNature: Nature =
    natures.find((item) => item.id === attackerNatureId) ?? natures[0];
  const defenderNature: Nature =
    natures.find((item) => item.id === defenderNatureId) ?? natures[0];
  const availableSkills = getSkillsForSpirit(attacker);
  const selectedSkill =
    skills.find((skill) => skill.id === selectedSkillId) ??
    availableSkills[0] ??
    skills[0];

  const stabMultiplier = attacker.elements.includes(selectedSkill.element)
    ? 1.25
    : 1;
  const hitCount = selectedSkill.defaultHitCount ?? 1;
  const powerBonus = selectedSkill.defaultPowerBonus ?? 0;
  const powerBuffMultiplier = selectedSkill.defaultPowerBuffMultiplier ?? 1;

  const attackerBaseFormulaStats = calculatePvpBaseStats(
    attacker.baseStats,
    attackerIvs,
    attackerNature
  );

  const defenderBaseFormulaStats = calculatePvpBaseStats(
    defender.baseStats,
    defenderIvs,
    defenderNature
  );

  const attackerStats = calculatePvpStats(
    attacker.baseStats,
    attackerIvs,
    attackerNature,
    DEFAULT_PVP_GROWTH_VALUES
  );

  const defenderStats = calculatePvpStats(
    defender.baseStats,
    defenderIvs,
    defenderNature,
    DEFAULT_PVP_GROWTH_VALUES
  );

  const damageResult = calculateDamage({
    category: selectedSkill.category,
    attackerStats,
    defenderStats,
    skillPower: selectedSkill.power,
    responseMultiplier: 1,
    powerBonus,
    powerBuffMultiplier,
    stabMultiplier,
    typeMultiplier,
    weatherMultiplier,
    hitCount,
    damageReductions: [damageReduction],
    attackerAttackUp: 0,
    attackerAttackDown: 0,
    defenderDefenseUp: 0,
    defenderDefenseDown: 0,
  });

  function applySkill(skill: Skill) {
    setSelectedSkillId(skill.id);
  }

  function changeSpirit(side: "attacker" | "defender", spiritId: string) {
    const nextSpirit = spirits.find((spirit) => spirit.id === spiritId);

    if (!nextSpirit) {
      return;
    }

    if (side === "attacker") {
      setAttackerId(spiritId);
      setAttackerIvs(getRecommendedIvs(spiritId));
      applySkill(getDefaultSkillForSpirit(nextSpirit));
      return;
    }

    setDefenderId(spiritId);
    setDefenderIvs(getRecommendedIvs(spiritId));
  }

  function toggleIv(side: "attacker" | "defender", key: StatKey) {
    const setter = side === "attacker" ? setAttackerIvs : setDefenderIvs;

    setter((previous) => {
      const checked = previous[key] === PERFECT_IV_VALUE;
      const selectedCount = countPerfectIvLines(previous);

      if (!checked && selectedCount >= PERFECT_IV_LINE_COUNT) {
        return previous;
      }

      return {
        ...previous,
        [key]: checked ? 0 : PERFECT_IV_VALUE,
      };
    });
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">
            PVP 等级 {PVP_LEVEL} · 默认五星满成长 · 最多三条 +60 个体
          </p>
          <h1>洛克王国：世界 PVP 伤害计算器</h1>
        </div>
        <div className="hero-summary">
          <span>{damageResult.damage}</span>
          <strong>最终伤害</strong>
        </div>
      </header>

      <section className="rule-note">
        <strong>当前逻辑：</strong>
        选择技能后会自动使用技能类型、威力、连击数和本系加成。克制、天气和减伤暂时保留手动修正，后续接入技能库和克制表后再自动计算。
      </section>

      <div className="battle-grid">
        <SpiritPanel
          title="进攻方"
          search={attackerSearch}
          spirit={attacker}
          spiritId={attackerId}
          natureId={attackerNatureId}
          ivs={attackerIvs}
          growthValues={DEFAULT_PVP_GROWTH_VALUES}
          baseFormulaStats={attackerBaseFormulaStats}
          actualStats={attackerStats}
          onSearchChange={setAttackerSearch}
          onSpiritChange={(spiritId) => changeSpirit("attacker", spiritId)}
          onNatureChange={setAttackerNatureId}
          onIvToggle={(key) => toggleIv("attacker", key)}
        />

        <SpiritPanel
          title="防守方"
          search={defenderSearch}
          spirit={defender}
          spiritId={defenderId}
          natureId={defenderNatureId}
          ivs={defenderIvs}
          growthValues={DEFAULT_PVP_GROWTH_VALUES}
          baseFormulaStats={defenderBaseFormulaStats}
          actualStats={defenderStats}
          onSearchChange={setDefenderSearch}
          onSpiritChange={(spiritId) => changeSpirit("defender", spiritId)}
          onNatureChange={setDefenderNatureId}
          onIvToggle={(key) => toggleIv("defender", key)}
        />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>技能与战斗参数</h2>
          <span>自动带入技能参数</span>
        </div>

        <div className="skill-card compact-skill-card">
          <label>
            进攻方常见技能
            <select
              value={selectedSkill.id}
              onChange={(event) => {
                const nextSkill =
                  skills.find((skill) => skill.id === event.target.value) ??
                  selectedSkill;
                applySkill(nextSkill);
              }}
            >
              {availableSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} · {skill.element} · {skill.power}
                </option>
              ))}
            </select>
          </label>

          <div className="skill-meta">
            <strong>{selectedSkill.name}</strong>
            <span>
              {selectedSkill.element} /{" "}
              {selectedSkill.category === "physical" ? "物理" : "魔法"}
            </span>
            <p>{selectedSkill.description ?? "暂无技能说明。"}</p>
            {selectedSkill.notes ? <em>{selectedSkill.notes}</em> : null}
          </div>
        </div>

        <div className="auto-param-grid">
          <p>
            技能类型
            <strong>{selectedSkill.category === "physical" ? "物理" : "魔法"}</strong>
          </p>
          <p>
            技能威力
            <strong>{selectedSkill.power}</strong>
          </p>
          <p>
            本系加成
            <strong>{stabMultiplier}</strong>
          </p>
          <p>
            连击数
            <strong>{hitCount}</strong>
          </p>
          <p>
            威力加成
            <strong>{powerBonus}</strong>
          </p>
          <p>
            威力提升
            <strong>{powerBuffMultiplier}</strong>
          </p>
        </div>

        <div className="manual-adjustments">
          <label>
            克制关系
            <input
              list="type-multipliers"
              min={0}
              step="0.01"
              type="number"
              value={typeMultiplier}
              onChange={(event) =>
                setTypeMultiplier(
                  clampNonNegative(safeNumber(event.target.value))
                )
              }
            />
          </label>

          <label>
            天气影响
            <input
              min={0}
              step="0.01"
              type="number"
              value={weatherMultiplier}
              onChange={(event) =>
                setWeatherMultiplier(
                  clampNonNegative(safeNumber(event.target.value))
                )
              }
            />
          </label>

          <label>
            总减伤比例
            <input
              max={0.99}
              min={0}
              step="0.01"
              type="number"
              value={damageReduction}
              onChange={(event) =>
                setDamageReduction(clampReduction(safeNumber(event.target.value)))
              }
            />
          </label>
        </div>

        <datalist id="type-multipliers">
          <option value="0.5" />
          <option value="1" />
          <option value="2" />
          <option value="3" />
        </datalist>
      </section>

      <section className="result-panel">
        <div className="result-main">
          <span>最终伤害</span>
          <strong>{damageResult.damage}</strong>
          <em className={riskClassName[damageResult.risk]}>
            {damageResult.risk}
          </em>
        </div>

        <div className="result-grid">
          <p>
            使用攻击属性
            <strong>{damageResult.attackStatName}</strong>
          </p>
          <p>
            使用防御属性
            <strong>{damageResult.defenseStatName}</strong>
          </p>
          <p>
            进攻值
            <strong>{damageResult.attack}</strong>
          </p>
          <p>
            防御值
            <strong>{damageResult.defense}</strong>
          </p>
          <p>
            有效威力
            <strong>{formatNumber(damageResult.effectivePower)}</strong>
          </p>
          <p>
            本系 / 克制 / 天气
            <strong>
              {stabMultiplier} / {typeMultiplier} / {weatherMultiplier}
            </strong>
          </p>
          <p>
            总减伤
            <strong>{formatPercent(damageResult.totalDamageReduction * 100)}</strong>
          </p>
          <p>
            原始伤害
            <strong>{formatNumber(damageResult.rawDamage)}</strong>
          </p>
          <p>
            占防守方生命
            <strong>{formatPercent(damageResult.hpPercent)}</strong>
          </p>
        </div>
      </section>
    </main>
  );
}
