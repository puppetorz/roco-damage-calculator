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
  全攻击: ["atk", "spa"],
  全防御: ["def", "spd"],
  攻防速: ["atk", "spa", "def", "spd", "spe"],
  攻防: ["atk", "spa", "def", "spd"],
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
    .replace(/[^\w\u4e00-\u9fa5:+.%/-]+/g, "_");
}

function addUniqueRule(rules: EffectRule[], rule: EffectRule): void {
  if (!rules.some((item) => item.id === rule.id)) {
    rules.push(rule);
  }
}

function getCondition(text: string): EffectCondition {
  if (text.includes("应对攻击") || text.includes("应对成功")) {
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

  if (/先于敌方|先手/.test(text)) {
    return "beforeEnemy";
  }

  if (/后手|后于敌方/.test(text)) {
    return "afterEnemy";
  }

  if (/敌方本回合更换精灵|更换精灵/.test(text)) {
    return "enemySwitch";
  }

  if (/生命低于50%|生命值低于50%/.test(text)) {
    return "lowHp";
  }

  if (/在场时/.test(text)) {
    return "fieldActive";
  }

  return "manual";
}

function conditionLabel(condition: EffectCondition): string {
  const labels: Record<EffectCondition, string> = {
    always: "默认生效",
    manual: "手动确认",
    responseAttack: "应对攻击/应对成功",
    responseStatus: "应对状态",
    responseDefense: "应对防御",
    typeAdvantage: "造成克制伤害后",
    beforeEnemy: "先于敌方攻击",
    afterEnemy: "后手攻击",
    enemySwitch: "敌方本回合更换精灵",
    lowHp: "生命低于 50%",
    fieldActive: "在场时",
  };

  return labels[condition];
}

function splitSentences(text: string): string[] {
  return String(text ?? "")
    .replace(/^✦\s*/, "")
    .split(/[。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findSentence(description: string, fragment: string): string {
  return (
    splitSentences(description).find((sentence) => sentence.includes(fragment)) ??
    fragment
  );
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
  return /降低|下降|减少|-/.test(text) ? -rate : rate;
}

function parseTarget(
  text: string,
  sourceType: EffectSourceType
): EffectTarget | undefined {
  if (
    /自己|自身|我方/.test(text) ||
    (sourceType === "trait" && /获得|提升|入场/.test(text))
  ) {
    return "attacker";
  }

  if (/敌方|对方|目标/.test(text)) {
    return "defender";
  }

  if (/获得|提升|入场/.test(text) || sourceType === "trait") {
    return "attacker";
  }

  return undefined;
}

const elementNamePattern =
  "(普通|机械|恶魔|幽灵|地面|草|火|水|光|土|地|冰|龙|电|毒|虫|武|翼|萌|幽|恶|幻|机)";

function normalizeParsedElementName(element: string): string {
  const aliases: Record<string, string> = {
    地: "土",
    地面: "土",
    机: "机械",
    恶魔: "恶",
    幽灵: "幽",
  };

  return aliases[element] ?? element;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function parseAppliesToSkillElements(text: string): string[] | undefined {
  if (/全技能|所有技能/.test(text)) {
    return undefined;
  }

  const beforePower = text.split("技能威力")[0] ?? text;
  const matches = [...beforePower.matchAll(new RegExp(`${elementNamePattern}系`, "g"))]
    .map((match) => normalizeParsedElementName(match[1]))
    .filter(Boolean);

  const elements = uniqueValues(matches);
  return elements.length > 0 ? elements : undefined;
}

function formatSkillElementScope(elements: string[] | undefined): string {
  return elements && elements.length > 0 ? `${elements.join("/")}技能` : "全技能";
}

function isStackedTriggerText(text: string): boolean {
  return /每有|每携带|每层|每1|每使用|每应对|每失去|每次|使用.*后|受到|被攻击|队伍中的/.test(
    text
  );
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

function addNote(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  reason: string
): void {
  addUniqueRule(rules, {
    id: createRuleId(sourceType, sourceName, "note", reason),
    sourceType,
    sourceName,
    kind: "note",
    label: `${sourceName}：未计入效果`,
    description: reason,
  });
}

function parseStackLabel(text: string): string {
  const useElementSkill = text.match(new RegExp(`每使用1次(?:其他)?${elementNamePattern}系技能`));
  if (useElementSkill) {
    return `${normalizeParsedElementName(useElementSkill[1])}系技能使用次数`;
  }

  if (/每使用1次状态技能/.test(text)) {
    return "状态技能使用次数";
  }

  if (/每使用1次防御技能/.test(text)) {
    return "防御技能使用次数";
  }

  if (/每应对1次|每应对成功1次/.test(text)) {
    return "应对次数";
  }

  const lostHp = text.match(/每失去(\d+)%生命/);
  if (lostHp) {
    return `每失去 ${lostHp[1]}% 生命次数`;
  }

  const carryElementSkill = text.match(new RegExp(`每携带1个${elementNamePattern}系技能`));
  if (carryElementSkill) {
    return `${normalizeParsedElementName(carryElementSkill[1])}系技能携带数量`;
  }

  const teamElementSpirit = text.match(new RegExp(`队伍中每有1只其他的?${elementNamePattern}系精灵`));
  if (teamElementSpirit) {
    return `${normalizeParsedElementName(teamElementSpirit[1])}系队友数量`;
  }

  if (/每使用1次【聚能】技能|每使用1次聚能技能/.test(text)) {
    return "聚能使用或换人次数";
  }

  if (/造成克制伤害后|克制/.test(text)) {
    return "触发层数";
  }

  if (/萌化/.test(text)) {
    return "萌化层数";
  }

  if (/中毒/.test(text)) {
    return "中毒层数";
  }

  if (/冻结/.test(text)) {
    return "冻结层数";
  }

  if (/星陨/.test(text)) {
    return "星陨印记层数";
  }

  if (/敌方.*总能耗|总能耗/.test(text)) {
    return "敌方技能总能耗";
  }

  if (/敌方.*增益/.test(text)) {
    return "敌方增益层数";
  }

  if (/受到.*攻击|被攻击/.test(text)) {
    return "受到攻击次数";
  }

  if (/使用.*后|使用.*次数/.test(text)) {
    return "触发次数";
  }

  return "层数/次数";
}

function addHitCountBonusRule(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  sentence: string,
  amount: number
): void {
  const condition = getCondition(sentence);
  const shouldStack = isStackedTriggerText(sentence);

  if (shouldStack) {
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountBonusStack", sentence),
      sourceType,
      sourceName,
      kind: "hitCountBonusStack",
      label: `${sourceName}：连击数 +${amount} / ${parseStackLabel(sentence)}`,
      description: sentence,
      condition,
      amountPerStack: amount,
      stackLabel: parseStackLabel(sentence),
    });
    return;
  }

  addUniqueRule(rules, {
    id: createRuleId(sourceType, sourceName, "hitCountBonusToggle", sentence),
    sourceType,
    sourceName,
    kind: "hitCountBonusToggle",
    label: `${sourceName}：${conditionLabel(condition)}连击 +${amount}`,
    description: sentence,
    condition,
    amount,
  });
}

function parseHitCountRules(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  description: string
): void {
  for (const match of description.matchAll(/(\d+)连击/g)) {
    const before = description.slice(Math.max(0, (match.index ?? 0) - 6), match.index);
    if (/(变为|改为|固定为)$/.test(before)) {
      continue;
    }

    const hitCount = Number(match[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountBase", String(hitCount)),
      sourceType,
      sourceName,
      kind: "hitCountBase",
      label: `${sourceName}：基础 ${hitCount} 连击`,
      description: `技能描述写明 ${hitCount} 连击。`,
      hitCount,
    });
  }

  for (const match of description.matchAll(/连击数永久\+(\d+)/g)) {
    const amount = Number(match[1]);
    const sentence = findSentence(description, match[0]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountPerUse", sentence),
      sourceType,
      sourceName,
      kind: "hitCountPerUse",
      label: `${sourceName}：每次使用连击 +${amount}`,
      description: sentence,
      amount,
    });
  }

  for (const match of description.matchAll(
    /([^。；;，,]*?(?:变为|改为)(\d+)连击)/g
  )) {
    const sentence = match[1];
    const hitCount = Number(match[2]);
    const condition = getCondition(sentence);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountOverride", sentence),
      sourceType,
      sourceName,
      kind: "hitCountOverride",
      label: `${sourceName}：${conditionLabel(condition)}变为 ${hitCount} 连击`,
      description: sentence,
      condition,
      hitCount,
    });
  }

  const fixedHitCount = description.match(/连击数固定为(\d+)/);
  if (fixedHitCount) {
    const hitCount = Number(fixedHitCount[1]);
    const sentence = findSentence(description, fixedHitCount[0]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountOverride", sentence),
      sourceType,
      sourceName,
      kind: "hitCountOverride",
      label: `${sourceName}：连击数固定为 ${hitCount}`,
      description: sentence,
      condition: getCondition(sentence),
      hitCount,
    });
  }

  for (const match of description.matchAll(/([^。；;，,]*?连击数翻倍)/g)) {
    const sentence = match[1];
    const condition = getCondition(sentence);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountMultiplier", sentence),
      sourceType,
      sourceName,
      kind: "hitCountMultiplier",
      label: `${sourceName}：${conditionLabel(condition)}连击翻倍`,
      description: sentence,
      condition,
      multiplier: 2,
    });
  }

  for (const match of description.matchAll(/([^。；;，,]*?连击数\+(\d+))/g)) {
    const sentence = findSentence(description, match[0]);
    if (/永久/.test(sentence)) {
      continue;
    }

    addHitCountBonusRule(rules, sourceType, sourceName, sentence, Number(match[2]));
  }
}

function parsePowerRules(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  description: string
): void {
  const enemyCostPower = description.match(/威力等于敌方精灵技能总能耗的(\d+)倍/);
  if (enemyCostPower) {
    const multiplier = Number(enemyCostPower[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "powerFromEnemyCost", String(multiplier)),
      sourceType,
      sourceName,
      kind: "powerFromEnemyCost",
      label: `${sourceName}：按敌方技能总能耗计算威力`,
      description: enemyCostPower[0],
      multiplier,
    });
  }

  const permanentPower = description.match(/威力永久\+(\d+)/);
  if (permanentPower) {
    const amount = Number(permanentPower[1]);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "powerBonusPerUse", permanentPower[0]),
      sourceType,
      sourceName,
      kind: "powerBonusPerUse",
      label: `${sourceName}：每次使用威力 +${amount}`,
      description: findSentence(description, permanentPower[0]),
      amount,
    });
  }

  for (const match of description.matchAll(/([^。；;，,]*?威力\+(\d+)%)/g)) {
    const sentence = findSentence(description, match[0]);
    const rate = Number(match[2]) / 100;
    const condition = getCondition(sentence);
    const shouldStack = isStackedTriggerText(sentence) || /总能耗/.test(sentence);
    const appliesToSkillElements = parseAppliesToSkillElements(sentence);
    const scopeLabel = formatSkillElementScope(appliesToSkillElements);

    if (shouldStack) {
      addUniqueRule(rules, {
        id: createRuleId(sourceType, sourceName, "powerMultiplierStack", sentence),
        sourceType,
        sourceName,
        kind: "powerMultiplierStack",
        label: `${sourceName}：${scopeLabel}威力 +${Math.round(rate * 100)}% / ${parseStackLabel(sentence)}`,
        description: sentence,
        condition,
        ratePerStack: rate,
        stackLabel: parseStackLabel(sentence),
        appliesToSkillElements,
      });
    } else {
      addUniqueRule(rules, {
        id: createRuleId(sourceType, sourceName, "powerMultiplierToggle", sentence),
        sourceType,
        sourceName,
        kind: "powerMultiplierToggle",
        label: `${sourceName}：${conditionLabel(condition)}${scopeLabel}威力 +${Math.round(rate * 100)}%`,
        description: sentence,
        condition,
        multiplier: 1 + rate,
        appliesToSkillElements,
      });
    }
  }

  for (const match of description.matchAll(/([^。；;，,]*?威力\+(\d+)(?![\d%]))/g)) {
    const sentence = findSentence(description, match[0]);
    if (/永久/.test(sentence)) {
      continue;
    }

    const amount = Number(match[2]);
    const condition = getCondition(sentence);
    const shouldStack = isStackedTriggerText(sentence) || /总能耗/.test(sentence);
    const appliesToSkillElements = parseAppliesToSkillElements(sentence);
    const scopeLabel = formatSkillElementScope(appliesToSkillElements);

    if (shouldStack) {
      addUniqueRule(rules, {
        id: createRuleId(sourceType, sourceName, "powerBonusStack", sentence),
        sourceType,
        sourceName,
        kind: "powerBonusStack",
        label: `${sourceName}：${scopeLabel}威力 +${amount} / ${parseStackLabel(sentence)}`,
        description: sentence,
        condition,
        amountPerStack: amount,
        stackLabel: parseStackLabel(sentence),
        appliesToSkillElements,
      });
    } else {
      addUniqueRule(rules, {
        id: createRuleId(sourceType, sourceName, "powerBonusToggle", sentence),
        sourceType,
        sourceName,
        kind: "powerBonusToggle",
        label: `${sourceName}：${conditionLabel(condition)}${scopeLabel}威力 +${amount}`,
        description: sentence,
        condition,
        amount,
        appliesToSkillElements,
      });
    }
  }

  for (const match of description.matchAll(/([^。；;，,]*?(?:威力翻倍|技能威力翻倍))/g)) {
    const sentence = findSentence(description, match[0]);
    const condition = getCondition(sentence);
    const appliesToSkillElements = parseAppliesToSkillElements(sentence);
    const scopeLabel = formatSkillElementScope(appliesToSkillElements);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "powerMultiplierToggle", sentence),
      sourceType,
      sourceName,
      kind: "powerMultiplierToggle",
      label: `${sourceName}：${conditionLabel(condition)}${scopeLabel}威力 x2`,
      description: sentence,
      condition,
      multiplier: 2,
      appliesToSkillElements,
    });
  }

  for (const match of description.matchAll(/([^。；;，,]*?威力变为(\d+)倍)/g)) {
    const sentence = findSentence(description, match[0]);
    const multiplier = Number(match[2]);
    const condition = getCondition(sentence);
    const appliesToSkillElements = parseAppliesToSkillElements(sentence);
    const scopeLabel = formatSkillElementScope(appliesToSkillElements);
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "powerMultiplierToggle", sentence),
      sourceType,
      sourceName,
      kind: "powerMultiplierToggle",
      label: `${sourceName}：${conditionLabel(condition)}${scopeLabel}威力 x${multiplier}`,
      description: sentence,
      condition,
      multiplier,
      appliesToSkillElements,
    });
  }
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
      isStackedTriggerText(sentence);
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
      stackLabel: stackable ? parseStackLabel(sentence) : undefined,
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
    "冻结",
    "灼烧",
    "奉献",
    "脱离",
    "打断",
    "眩晕",
    "吸血",
  ];
  const matched = noteKeywords.filter((keyword) => description.includes(keyword));

  if (matched.length === 0) {
    return;
  }

  addNote(
    rules,
    sourceType,
    sourceName,
    `包含 ${matched.join("、")} 等效果，当前只展示，不进入伤害公式。`
  );
}

function applyManualFallbacks(
  rules: EffectRule[],
  sourceType: EffectSourceType,
  sourceName: string,
  description: string
): void {
  if (
    sourceType === "trait" &&
    sourceName === "最好的伙伴" &&
    description.includes("造成克制伤害后") &&
    !rules.some(
      (rule) => rule.kind === "statModifier" && rule.condition === "typeAdvantage"
    )
  ) {
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "statModifier", "typeAdvantage20"),
      sourceType,
      sourceName,
      kind: "statModifier",
      label: "最好的伙伴：克制后攻防速 +20%",
      description: "造成克制伤害后，获得攻防速 +20%。",
      condition: "typeAdvantage",
      target: "attacker",
      statKeys: ["atk", "spa", "def", "spd", "spe"],
      rate: 0.2,
      stackable: true,
      stackLabel: "触发层数",
    });
  }

  if (/在场时，?所有精灵连击数固定为2/.test(description)) {
    addUniqueRule(rules, {
      id: createRuleId(sourceType, sourceName, "hitCountOverride", "fieldFixed2"),
      sourceType,
      sourceName,
      kind: "hitCountOverride",
      label: `${sourceName}：所有精灵连击数固定为 2`,
      description: "在场时，所有精灵连击数固定为 2。",
      condition: "fieldActive",
      hitCount: 2,
    });
  }
}

export function getConditionLabel(condition: EffectCondition): string {
  return conditionLabel(condition);
}

export function ruleUsesStack(rule: EffectRule): rule is Extract<
  EffectRule,
  | { kind: "hitCountBonusStack" }
  | { kind: "powerBonusStack" }
  | { kind: "powerMultiplierStack" }
  | { kind: "statModifier" }
> {
  return (
    rule.kind === "hitCountBonusStack" ||
    rule.kind === "powerBonusStack" ||
    rule.kind === "powerMultiplierStack" ||
    (rule.kind === "statModifier" && rule.stackable)
  );
}

export function parseSkillRules(skill: Skill): EffectRule[] {
  const description = skill.description ?? "";
  const rules: EffectRule[] = [];
  const sourceType: EffectSourceType = "skill";

  parseHitCountRules(rules, sourceType, skill.name, description);
  parsePowerRules(rules, sourceType, skill.name, description);
  parseStatModifierRules(rules, sourceType, skill.name, description);
  parseUncountedNotes(rules, sourceType, skill.name, description);
  applyManualFallbacks(rules, sourceType, skill.name, description);

  return rules;
}

export function parseTraitRules(trait: Trait): EffectRule[] {
  const description = trait.description ?? "";
  const rules: EffectRule[] = [];
  const sourceType: EffectSourceType = "trait";

  parseHitCountRules(rules, sourceType, trait.name, description);
  parsePowerRules(rules, sourceType, trait.name, description);
  parseStatModifierRules(rules, sourceType, trait.name, description);
  parseUncountedNotes(rules, sourceType, trait.name, description);
  applyManualFallbacks(rules, sourceType, trait.name, description);

  return rules;
}
