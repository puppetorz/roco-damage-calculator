import type {
  EffectCondition,
  EffectRule,
  EffectSourceType,
  EffectTarget,
  Skill,
  StatKey,
  Trait,
} from "../types/battle";

const statNameMap: Record<string, StatKey[]> = {
  生命: ["hp"],
  物攻: ["atk"],
  魔攻: ["spa"],
  物防: ["def"],
  魔防: ["spd"],
  速度: ["spe"],
  双攻: ["atk", "spa"],
  双防: ["def", "spd"],
  攻防: ["atk", "spa", "def", "spd"],
  攻防速: ["atk", "spa", "def", "spd", "spe"],
};

const statPhrases = Object.keys(statNameMap).sort(
  (left, right) => right.length - left.length
);

function createRuleId(
  sourceType: EffectSourceType,
  sourceName: string,
  kind: string,
  suffix: string
): string {
  return [sourceType, sourceName, kind, suffix]
    .join(":")
    .replace(/\s+/g, "")
    .replace(/[^\w\u4e00-\u9fa5:+.-]+/g, "_");
}

function getCondition(text: string): EffectCondition {
  if (text.includes("应对攻击")) {
    return "responseAttack";
  }

  if (text.includes("应对状态")) {
    return "responseStatus";
  }

  if (text.includes("应对防御")) {
    return "responseDefense";
  }

  if (text.includes("造成克制伤害后")) {
    return "typeAdvantage";
  }

  return "manual";
}

function conditionLabel(condition: EffectCondition): string {
  const labels: Record<EffectCondition, string> = {
    always: "默认生效",
    manual: "手动确认",
    responseAttack: "应对攻击",
    responseStatus: "应对状态",
    responseDefense: "应对防御",
    typeAdvantage: "造成克制伤害后",
  };

  return labels[condition];
}

function addUniqueRule(rules: EffectRule[], rule: EffectRule): void {
  if (!rules.some((item) => item.id === rule.id)) {
    rules.push(rule);
  }
}

function splitSentences(text: string): string[] {
  return text
    .replace(/^✓\s*/, "")
    .split(/[。；;，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseStatKeys(text: string): StatKey[] {
  const keys = new Set<StatKey>();

  for (const phrase of statPhrases) {
    if (text.includes(phrase)) {
      for (const key of statNameMap[phrase]) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

function parseSignedPercent(text: string): number | undefined {
  const signed = text.match(/([+-]\d+(?:\.\d+)?)%/);
  if (signed) {
    return Number(signed[1]) / 100;
  }

  const plain = text.match(/(\d+(?:\.\d+)?)%/);
  if (!plain) {
    return undefined;
  }

  const rate = Number(plain[1]) / 100;
  return /降低|下降|减少/.test(text) ? -rate : rate;
}

function parseTarget(
  text: string,
  sourceType: EffectSourceType
): EffectTarget | undefined {
  if (/敌方|对方|目标/.test(text)) {
    return "defender";
  }

  if (/自己|自身|我方|获得|入场/.test(text) || sourceType === "trait") {
    return "attacker";
  }

  return undefined;
}

function statKeyToLabel(key: StatKey): string {
  const labels: Record<StatKey, string> = {
    hp: "生命",
    atk: "物攻",
    spa: "魔攻",
    def: "物防",
    spd: "魔防",
    spe: "速度",
  };

  return labels[key];
}

function parseStatModifierRules(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  description: string
): void {
  for (const sentence of splitSentences(description)) {
    const statKeys = parseStatKeys(sentence);
    const rate = parseSignedPercent(sentence);
    const target = parseTarget(sentence, sourceType);

    if (statKeys.length === 0 || rate === undefined || !target) {
      continue;
    }

    const condition = getCondition(sentence);
    const stackable =
      sourceType === "trait" ||
      condition === "typeAdvantage" ||
      /每有|每次|每1/.test(sentence);
    const suffix = `${sentence}:${target}:${statKeys.join("_")}:${rate}`;

    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "statModifier", suffix),
      sourceType,
      sourceName,
      kind: "statModifier",
      label: `${sourceName}：${target === "attacker" ? "自己" : "敌方"}${statKeys
        .map(statKeyToLabel)
        .join(" / ")} ${rate >= 0 ? "+" : ""}${Math.round(rate * 100)}%`,
      description: sentence,
      condition,
      target,
      statKeys,
      rate,
      stackable,
    });
  }
}

function parseUncountedNotes(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  description: string
): void {
  const noteKeywords = [
    "回复",
    "能量",
    "印记",
    "天气",
    "驱散",
    "萌化",
    "中毒",
    "灼烧",
  ];
  const matched = noteKeywords.filter((keyword) => description.includes(keyword));

  if (matched.length === 0) {
    return;
  }

  addUniqueRule(rules, {
    id: createRuleId(sourceType, sourceName, "note", matched.join("_")),
    sourceType,
    sourceName,
    kind: "note",
    label: `${sourceName}：未计入效果`,
    description: `包含 ${matched.join("、")} 等效果，当前只展示，不进入伤害公式。`,
  });
}

export function getConditionLabel(condition: EffectCondition): string {
  return conditionLabel(condition);
}

export function parseSkillRules(skill: Skill): EffectRule[] {
  const description = skill.description ?? "";
  const rules: EffectRule[] = [];
  const sourceType: EffectSourceType = "skill";

  for (const match of description.matchAll(/(\d+)连击/g)) {
    const hitCount = Number(match[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "hitCountBase", String(hitCount)),
      sourceType,
      sourceName: skill.name,
      kind: "hitCountBase",
      label: `${skill.name}：${hitCount} 连击`,
      description: `技能描述写明 ${hitCount} 连击。`,
      hitCount,
    });
  }

  const hitIncrement = description.match(/连击数永久\+(\d+)/);
  if (hitIncrement) {
    const amount = Number(hitIncrement[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "hitCountPerUse", String(amount)),
      sourceType,
      sourceName: skill.name,
      kind: "hitCountPerUse",
      label: `${skill.name}：每次使用连击 +${amount}`,
      description: `每次使用后，本技能连击数永久 +${amount}。`,
      amount,
    });
  }

  const responseHitOverride = description.match(
    /应对状态[^。；;，,]*变为(\d+)连击/
  );
  if (responseHitOverride) {
    const hitCount = Number(responseHitOverride[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "hitCountOverride", String(hitCount)),
      sourceType,
      sourceName: skill.name,
      kind: "hitCountOverride",
      label: `${skill.name}：应对状态变为 ${hitCount} 连击`,
      description: responseHitOverride[0],
      condition: "responseStatus",
      hitCount,
    });
  }

  if (/应对状态[^。；;，,]*连击数翻倍/.test(description)) {
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "hitCountMultiplier", "responseStatusDouble"),
      sourceType,
      sourceName: skill.name,
      kind: "hitCountMultiplier",
      label: `${skill.name}：应对状态连击翻倍`,
      description: "应对状态时，本次技能连击数翻倍。",
      condition: "responseStatus",
      multiplier: 2,
    });
  }

  const enemyCostPower = description.match(
    /威力等于敌方精灵技能总能耗的(\d+)倍/
  );
  if (enemyCostPower) {
    const multiplier = Number(enemyCostPower[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "powerFromEnemyCost", String(multiplier)),
      sourceType,
      sourceName: skill.name,
      kind: "powerFromEnemyCost",
      label: `${skill.name}：按敌方技能总能耗计算威力`,
      description: enemyCostPower[0],
      multiplier,
    });
  }

  const permanentPower = description.match(/威力永久\+(\d+)/);
  if (permanentPower) {
    const amount = Number(permanentPower[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "powerBonusPerUse", String(amount)),
      sourceType,
      sourceName: skill.name,
      kind: "powerBonusPerUse",
      label: `${skill.name}：每次使用威力 +${amount}`,
      description: permanentPower[0],
      amount,
    });
  }

  for (const match of description.matchAll(/(?:本次技能)?威力\+(\d+)(?!%)/g)) {
    const amount = Number(match[1]);
    if (permanentPower?.[1] === match[1]) {
      continue;
    }

    const sentence = splitSentences(description).find((item) =>
      item.includes(match[0])
    );
    const condition = getCondition(sentence ?? match[0]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "powerBonusToggle", `${amount}:${condition}`),
      sourceType,
      sourceName: skill.name,
      kind: "powerBonusToggle",
      label: `${skill.name}：${conditionLabel(condition)}威力 +${amount}`,
      description: sentence ?? match[0],
      condition,
      amount,
    });
  }

  for (const match of description.matchAll(/威力\+(\d+)%/g)) {
    const multiplier = 1 + Number(match[1]) / 100;
    const sentence = splitSentences(description).find((item) =>
      item.includes(match[0])
    );
    const condition = getCondition(sentence ?? match[0]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "powerMultiplierToggle", `${multiplier}:${condition}`),
      sourceType,
      sourceName: skill.name,
      kind: "powerMultiplierToggle",
      label: `${skill.name}：${conditionLabel(condition)}威力 x${multiplier}`,
      description: sentence ?? match[0],
      condition,
      multiplier,
    });
  }

  const powerBecomes = description.match(/威力变为(\d+)倍/);
  if (powerBecomes) {
    const multiplier = Number(powerBecomes[1]);
    const condition = getCondition(description);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, skill.name, "powerMultiplierToggle", `becomes:${multiplier}:${condition}`),
      sourceType,
      sourceName: skill.name,
      kind: "powerMultiplierToggle",
      label: `${skill.name}：${conditionLabel(condition)}威力变为 ${multiplier} 倍`,
      description: powerBecomes[0],
      condition,
      multiplier,
    });
  }

  parseStatModifierRules(rules, sourceType, skill.name, description);
  parseUncountedNotes(rules, sourceType, skill.name, description);

  return rules;
}

export function parseTraitRules(trait: Trait): EffectRule[] {
  const description = trait.description ?? "";
  const rules: EffectRule[] = [];
  const sourceType: EffectSourceType = "trait";

  parseStatModifierRules(rules, sourceType, trait.name, description);
  parseUncountedNotes(rules, sourceType, trait.name, description);

  return rules;
}
