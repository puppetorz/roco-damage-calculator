import { useMemo, useState } from "react";
import "./App.css";

import { natures } from "./data/natures";
import { spirits } from "./data/spirits";
import type {
  BattleStats,
  IndividualValues,
  Nature,
  SkillCategory,
  Spirit,
  StatKey,
} from "./types/battle";
import { calculateDamage } from "./utils/damageCalculator";
import {
  DEFAULT_INDIVIDUAL_VALUES,
  PVP_LEVEL,
  STAT_KEYS,
  calculatePvpStats,
  clampIndividualValue,
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

function copyDefaultIvs(): IndividualValues {
  return { ...DEFAULT_INDIVIDUAL_VALUES };
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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

type SpiritPanelProps = {
  title: string;
  spirit: Spirit;
  spiritId: string;
  natureId: string;
  ivs: IndividualValues;
  actualStats: BattleStats;
  onSpiritChange: (spiritId: string) => void;
  onNatureChange: (natureId: string) => void;
  onIvChange: (key: StatKey, value: number) => void;
};

function SpiritPanel({
  title,
  spirit,
  spiritId,
  natureId,
  ivs,
  actualStats,
  onSpiritChange,
  onNatureChange,
  onIvChange,
}: SpiritPanelProps) {
  return (
    <section className="panel spirit-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{spirit.elements.join(" / ")}</span>
      </div>

      <div className="field-row">
        <label>
          精灵
          <select
            value={spiritId}
            onChange={(event) => onSpiritChange(event.target.value)}
          >
            {spirits.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
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

      <div className="stat-table">
        <div className="stat-table-head">属性</div>
        <div className="stat-table-head">种族值</div>
        <div className="stat-table-head">个体值</div>
        <div className="stat-table-head">实际</div>

        {STAT_KEYS.map((key) => (
          <div className="stat-row" key={key}>
            <span>{statLabels[key]}</span>
            <strong>{spirit.baseStats[key]}</strong>
            <input
              aria-label={`${title}${statLabels[key]}个体值`}
              min={0}
              max={60}
              type="number"
              value={ivs[key]}
              onChange={(event) =>
                onIvChange(key, safeNumber(event.target.value))
              }
            />
            <strong className="actual-stat">{actualStats[key]}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [attackerId, setAttackerId] = useState(spirits[0].id);
  const [defenderId, setDefenderId] = useState(spirits[2].id);
  const [attackerNatureId, setAttackerNatureId] = useState(natures[0].id);
  const [defenderNatureId, setDefenderNatureId] = useState(natures[0].id);
  const [attackerIvs, setAttackerIvs] =
    useState<IndividualValues>(copyDefaultIvs);
  const [defenderIvs, setDefenderIvs] =
    useState<IndividualValues>(copyDefaultIvs);

  const [category, setCategory] = useState<SkillCategory>("physical");
  const [skillPower, setSkillPower] = useState(312);
  const [responseMultiplier, setResponseMultiplier] = useState(1);
  const [powerBonus, setPowerBonus] = useState(0);
  const [powerBuffMultiplier, setPowerBuffMultiplier] = useState(1);
  const [stabMultiplier, setStabMultiplier] = useState(1);
  const [typeMultiplier, setTypeMultiplier] = useState(1);
  const [weatherMultiplier, setWeatherMultiplier] = useState(1);
  const [hitCount, setHitCount] = useState(1);
  const [damageReduction, setDamageReduction] = useState(0);
  const [attackerAttackUp, setAttackerAttackUp] = useState(0);
  const [attackerAttackDown, setAttackerAttackDown] = useState(0);
  const [defenderDefenseUp, setDefenderDefenseUp] = useState(0);
  const [defenderDefenseDown, setDefenderDefenseDown] = useState(0);

  const attacker = spirits.find((item) => item.id === attackerId) ?? spirits[0];
  const defender = spirits.find((item) => item.id === defenderId) ?? spirits[0];
  const attackerNature: Nature =
    natures.find((item) => item.id === attackerNatureId) ?? natures[0];
  const defenderNature: Nature =
    natures.find((item) => item.id === defenderNatureId) ?? natures[0];

  const attackerStats = useMemo(
    () => calculatePvpStats(attacker.baseStats, attackerIvs, attackerNature),
    [attacker.baseStats, attackerIvs, attackerNature]
  );

  const defenderStats = useMemo(
    () => calculatePvpStats(defender.baseStats, defenderIvs, defenderNature),
    [defender.baseStats, defenderIvs, defenderNature]
  );

  const damageResult = useMemo(
    () =>
      calculateDamage({
        category,
        attackerStats,
        defenderStats,
        skillPower,
        responseMultiplier,
        powerBonus,
        powerBuffMultiplier,
        stabMultiplier,
        typeMultiplier,
        weatherMultiplier,
        hitCount,
        damageReductions: [damageReduction],
        attackerAttackUp,
        attackerAttackDown,
        defenderDefenseUp,
        defenderDefenseDown,
      }),
    [
      attackerAttackDown,
      attackerAttackUp,
      attackerStats,
      category,
      damageReduction,
      defenderDefenseDown,
      defenderDefenseUp,
      defenderStats,
      hitCount,
      powerBonus,
      powerBuffMultiplier,
      responseMultiplier,
      skillPower,
      stabMultiplier,
      typeMultiplier,
      weatherMultiplier,
    ]
  );

  function updateIv(
    side: "attacker" | "defender",
    key: StatKey,
    value: number
  ) {
    const safeValue = clampIndividualValue(value);
    const setter = side === "attacker" ? setAttackerIvs : setDefenderIvs;

    setter((previous) => ({
      ...previous,
      [key]: safeValue,
    }));
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">PVP 等级固定 {PVP_LEVEL}</p>
          <h1>洛克王国：世界 PVP 伤害计算器</h1>
        </div>
        <div className="hero-summary">
          <span>{damageResult.damage}</span>
          <strong>最终伤害</strong>
        </div>
      </header>

      <div className="battle-grid">
        <SpiritPanel
          title="进攻方"
          spirit={attacker}
          spiritId={attackerId}
          natureId={attackerNatureId}
          ivs={attackerIvs}
          actualStats={attackerStats}
          onSpiritChange={setAttackerId}
          onNatureChange={setAttackerNatureId}
          onIvChange={(key, value) => updateIv("attacker", key, value)}
        />

        <SpiritPanel
          title="防守方"
          spirit={defender}
          spiritId={defenderId}
          natureId={defenderNatureId}
          ivs={defenderIvs}
          actualStats={defenderStats}
          onSpiritChange={setDefenderId}
          onNatureChange={setDefenderNatureId}
          onIvChange={(key, value) => updateIv("defender", key, value)}
        />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>技能与战斗参数</h2>
          <span>单技能计算</span>
        </div>

        <div className="form-grid">
          <label>
            技能类型
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as SkillCategory)
              }
            >
              <option value="physical">物理：物攻 / 物防</option>
              <option value="magical">魔法：魔攻 / 魔防</option>
            </select>
          </label>

          <label>
            技能威力
            <input
              min={0}
              type="number"
              value={skillPower}
              onChange={(event) =>
                setSkillPower(clampNonNegative(safeNumber(event.target.value)))
              }
            />
          </label>

          <label>
            应对倍率
            <input
              min={0}
              step="0.01"
              type="number"
              value={responseMultiplier}
              onChange={(event) =>
                setResponseMultiplier(
                  clampNonNegative(safeNumber(event.target.value))
                )
              }
            />
          </label>

          <label>
            威力加成
            <input
              min={0}
              type="number"
              value={powerBonus}
              onChange={(event) =>
                setPowerBonus(clampNonNegative(safeNumber(event.target.value)))
              }
            />
          </label>

          <label>
            威力提升 buff
            <input
              min={0}
              step="0.01"
              type="number"
              value={powerBuffMultiplier}
              onChange={(event) =>
                setPowerBuffMultiplier(
                  clampNonNegative(safeNumber(event.target.value))
                )
              }
            />
          </label>

          <label>
            本系加成
            <select
              value={stabMultiplier}
              onChange={(event) =>
                setStabMultiplier(safeNumber(event.target.value, 1))
              }
            >
              <option value={1}>1</option>
              <option value={1.25}>1.25</option>
            </select>
          </label>

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
            连击数
            <input
              min={1}
              type="number"
              value={hitCount}
              onChange={(event) =>
                setHitCount(Math.max(1, safeNumber(event.target.value, 1)))
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

        <div className="ability-block">
          <h3>能力等级</h3>
          <div className="form-grid compact">
            <label>
              进攻方攻击提升
              <input
                min={0}
                step="0.01"
                type="number"
                value={attackerAttackUp}
                onChange={(event) =>
                  setAttackerAttackUp(
                    clampNonNegative(safeNumber(event.target.value))
                  )
                }
              />
            </label>

            <label>
              进攻方攻击降低
              <input
                min={0}
                step="0.01"
                type="number"
                value={attackerAttackDown}
                onChange={(event) =>
                  setAttackerAttackDown(
                    clampNonNegative(safeNumber(event.target.value))
                  )
                }
              />
            </label>

            <label>
              防守方防御提升
              <input
                min={0}
                step="0.01"
                type="number"
                value={defenderDefenseUp}
                onChange={(event) =>
                  setDefenderDefenseUp(
                    clampNonNegative(safeNumber(event.target.value))
                  )
                }
              />
            </label>

            <label>
              防守方防御降低
              <input
                min={0}
                step="0.01"
                type="number"
                value={defenderDefenseDown}
                onChange={(event) =>
                  setDefenderDefenseDown(
                    clampNonNegative(safeNumber(event.target.value))
                  )
                }
              />
            </label>
          </div>
        </div>
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
            能力等级倍率
            <strong>{formatNumber(damageResult.abilityMultiplier, 3)}</strong>
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
