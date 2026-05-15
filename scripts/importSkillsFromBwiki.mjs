import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const skillsOutputPath = join(generatedDir, "skills.generated.ts");
const spiritsSourcePath = join(generatedDir, "spirits.generated.ts");
const reportPath = join(root, "skill-import-report.md");

const apiUrl = "https://wiki.biligame.com/rocom/api.php";
const wikiBaseUrl = "https://wiki.biligame.com";
const skillIndexPageId = "1013";
const requestDelayMs = 70;

const categoryMap = {
  物攻: "physical",
  魔攻: "magical",
  防御: "defense",
  状态: "status",
};

const statKeyMap = new Map([
  ["生命", ["hp"]],
  ["物攻", ["atk"]],
  ["魔攻", ["spa"]],
  ["物防", ["def"]],
  ["魔防", ["spd"]],
  ["速度", ["spe"]],
  ["双攻", ["atk", "spa"]],
  ["双防", ["def", "spd"]],
  ["全属性", ["atk", "spa", "def", "spd", "spe"]],
  ["攻防速", ["atk", "spa", "def", "spd", "spe"]],
  ["攻防", ["atk", "spa", "def", "spd"]],
]);

const elementAliases = new Map([
  ["地", "土"],
  ["地面", "土"],
  ["普", "普通"],
  ["机", "机械"],
  ["恶魔", "恶"],
  ["幽灵", "幽"],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(text) {
  return String(text ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripTags(html) {
  return decodeHtml(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h1|h2|h3|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

function normalizeText(text) {
  return decodeHtml(text).replace(/\s+/g, " ").trim();
}

function createSkillId(name) {
  return `skill_${encodeURIComponent(name)
    .toLowerCase()
    .replace(/%/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

async function parseWikiPage(params) {
  const body = new URLSearchParams({
    action: "parse",
    format: "json",
    prop: "text|links|wikitext",
    ...params,
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent":
        "roco-damage-calculator-skill-import/0.4 (+local static data generator)",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`BWIKI API 返回 HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload.error) {
    throw new Error(payload.error.info ?? JSON.stringify(payload.error));
  }

  return payload.parse;
}

function normalizeElement(value) {
  const cleaned = normalizeText(value).replace(/系$/, "");
  return elementAliases.get(cleaned) ?? cleaned;
}

function stripWikiMarkup(text) {
  return stripTags(
    String(text ?? "")
      .replace(/'''/g, "")
      .replace(/''/g, "")
      .replace(/{{系别图标\|([^}|]+)(?:\|[^}]*)?}}/g, "$1系")
      .replace(/{{(?:color|颜色)\|[^|}]+\|([^}]*)}}/gi, "$1")
      .replace(/{{([^}|]+)\|([^}]*)}}/g, "$2")
      .replace(/{{([^}]+)}}/g, "$1")
      .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, "$2")
      .replace(/\[\[([^\]]+)]]/g, "$1")
  );
}

function normalizeWikiText(text) {
  return normalizeText(stripWikiMarkup(text)).replace(/([一-龥]{1,3}系)\1/g, "$1");
}

function parseSkillInfoFields(wikitext) {
  const start = String(wikitext ?? "").indexOf("{{技能信息");

  if (start < 0) {
    return {};
  }

  const block = String(wikitext).slice(start);
  const fields = {};
  let currentKey = "";
  let currentValue = [];

  function saveField() {
    if (!currentKey) {
      return;
    }

    fields[currentKey] = currentValue.join("\n").trim();
  }

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line === "}}" || line.startsWith("}}")) {
      saveField();
      break;
    }

    const fieldMatch = line.match(/^\|([^=]+)=(.*)$/);

    if (fieldMatch) {
      saveField();
      currentKey = fieldMatch[1].trim();
      currentValue = [fieldMatch[2]];
      continue;
    }

    if (currentKey) {
      currentValue.push(line);
    }
  }

  return fields;
}

function parseAttributes(text) {
  return Object.fromEntries(
    [...String(text ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [
      match[1],
      decodeHtml(match[2]),
    ])
  );
}

function splitDivsortCards(html) {
  const starts = [...html.matchAll(/<div class="divsort"[^>]*>/g)];

  return starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? html.length;
    return html.slice(start, end);
  });
}

function extractSkillSummaries(indexHtml) {
  const summaries = [];
  const seen = new Set();

  for (const cardHtml of splitDivsortCards(indexHtml)) {
    const openTag = cardHtml.match(/^<div class="divsort"[^>]*>/)?.[0] ?? "";
    const attrs = parseAttributes(openTag);
    const anchor = cardHtml.match(
      /<a\b[^>]*href="(\/rocom\/[^"]+)"[^>]*title="([^"]+)"[^>]*>/i
    );

    if (!anchor) {
      continue;
    }

    const href = decodeHtml(anchor[1]);
    const name = normalizeText(anchor[2]);

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    summaries.push({
      name,
      pageTitle: decodeURIComponent(href.replace(/^\/rocom\//, "")),
      sourceUrl: new URL(href, wikiBaseUrl).toString(),
      category: categoryMap[normalizeText(attrs["data-param1"])] ?? "status",
      element: normalizeText(attrs["data-param2"]) || "普通",
    });
  }

  return summaries;
}

function extractByClass(html, className) {
  const pattern = new RegExp(
    `<[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i"
  );
  return pattern.exec(html)?.[1] ?? "";
}

function parsePower(html) {
  const block = html.match(
    /<div class="rocom_skill_template_skillPower"[\s\S]*?<b[^>]*>\s*(\d+)\s*<\/b>/i
  );
  return block ? Number(block[1]) : 0;
}

function parsePowerFromFields(fields, html) {
  const value = Number(normalizeWikiText(fields.威力));
  return Number.isFinite(value) ? value : parsePower(html);
}

function parseEffectEntries(rawDescriptionText) {
  const tableCells = [
    ...String(rawDescriptionText ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
  ].map((match) => normalizeWikiText(match[1]));

  if (tableCells.length > 0) {
    return tableCells.filter(Boolean);
  }

  return normalizeWikiText(rawDescriptionText)
    .split(/[。；;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isMechanicEntry(entry) {
  return /[+-]\d|\d+%|\d+层|\d+连击|威力|能耗|能量|减伤|驱散|印记|灼烧|中毒|冻结|吸血|应对|打断|回复|获得|增加|减少|降低|提升|先手|后手|脱离|替换|消耗|状态|天气|场地/.test(
    entry
  );
}

function getTriggeredEntry(entry) {
  const match = entry.match(/^([一-龥]+)系[:：]?(.+)$/);

  if (!match) {
    return { text: entry };
  }

  return {
    text: match[2].trim(),
    trigger: {
      kind: "carriedSkillElement",
      element: normalizeElement(match[1]),
    },
  };
}

function createEffect(kind, target, rawText, trigger, extra, simulated = true) {
  return {
    kind,
    target,
    rawText,
    simulated,
    ...(trigger ? { trigger } : {}),
    ...extra,
  };
}

function parseStatKeys(text) {
  const keys = [];

  for (const [phrase, statKeys] of statKeyMap) {
    if (text.includes(phrase)) {
      keys.push(...statKeys);
    }
  }

  return [...new Set(keys)];
}

function parseStatusName(text) {
  if (text.includes("灼烧")) {
    return "burn";
  }

  if (text.includes("冻结")) {
    return "freeze";
  }

  if (text.includes("中毒")) {
    return "poison";
  }

  if (text.includes("麻痹") || text.includes("眩晕")) {
    return "stun";
  }

  return "other";
}

function parseBattleEffects(entry) {
  const effects = [];
  const notes = [];
  const { text, trigger } = getTriggeredEntry(entry);
  const target = /对手|敌方|目标/.test(text) ? "opponent" : "self";
  const isPlainDamageText =
    /^(?:对敌方精灵)?造成(?:大量)?(?:物伤|魔伤|物理伤害|魔法伤害)$/.test(text) ||
    /^(?:对敌方精灵)?造成(?:物理|魔法)伤害$/.test(text) ||
    /^造成(?:物伤|魔伤)，?携带其他系别技能/.test(text);

  if (text.includes("使用时消耗所有能量") && text.includes("消耗越高，伤害越高")) {
    effects.push(
      createEffect("dynamicPowerOverride", "self", entry, trigger, {
        powerByEnergy: [46, 71, 91, 111, 136, 156, 166, 181, 191, 201, 211],
        approximationNote: "魔能爆威力表来自用户提供图片，超过10能量按10档封顶。",
      })
    );
  }

  if (text.includes("每失去5%生命") && text.includes("本次技能威力-10")) {
    effects.push(
      createEffect("powerLossByMissingHp", "self", entry, trigger, {
        stepPercent: 5,
        amountPerStep: 10,
        minimumPower: 0,
      })
    );
  }

  if (text.includes("使用后消耗全部生命")) {
    effects.push(createEffect("selfFaintAfterUse", "self", entry, trigger, {}));
  }

  if (text.includes("自己和敌方获得萌化")) {
    for (const effectTarget of ["self", "opponent"]) {
      effects.push(
        createEffect("termMark", effectTarget, entry, trigger, {
          term: "萌化",
          stacks: 1,
          partial: true,
          approximationNote: "萌化种族值退化暂未完整模拟。",
        })
      );
      effects.push(
        createEffect("percentHeal", effectTarget, entry, trigger, {
          percent: 0.4,
        })
      );
      effects.push(
        createEffect("energyDelta", effectTarget, entry, trigger, {
          amount: 4,
        })
      );
    }
    notes.push(`${entry}：萌化种族值退化暂未完整模拟，当前仅记录萌化并结算回复与能量。`);
  }

  if (text.includes("迸发") && text.includes("本技能能耗-1")) {
    effects.push(
      createEffect("temporaryEnergyCostOnFirstAction", "self", entry, trigger, {
        amount: -1,
      })
    );
  }

  if (text.includes("若敌方本回合更换精灵") && text.includes("威力翻倍")) {
    effects.push(
      createEffect("powerMultiplierIfOpponentSwitched", "self", entry, trigger, {
        multiplier: 2,
      })
    );
  }

  if (text.includes("物防比敌方越高") && text.includes("本次技能威力越高")) {
    effects.push(
      createEffect("defenseGapPowerOverride", "self", entry, trigger, {
        table: [
          { min: -999999, max: -1, power: 60 },
          { min: 0, max: 14, power: 100 },
          { min: 15, max: 29, power: 130 },
          { min: 30, max: 44, power: 140 },
          { min: 45, max: 59, power: 150 },
          { min: 60, max: 74, power: 160 },
          { min: 75, max: 89, power: 170 },
          { min: 90, max: 104, power: 180 },
          { min: 105, max: 119, power: 190 },
          { min: 120, max: 134, power: 194 },
          { min: 135, power: 200 },
        ],
      })
    );
  }

  const termMark = text.match(/(?:自己|敌方|对手|目标)?获得(\d+)层(光合|湿润|萌化|棘刺)(?:印记)?/);
  if (termMark && !text.includes("自己和敌方获得萌化")) {
    const term = termMark[2];
    const isPartial = term === "萌化";
    effects.push(
      createEffect("termMark", target, entry, trigger, {
        term,
        stacks: Number(termMark[1]),
        ...(isPartial
          ? {
              partial: true,
              approximationNote: "萌化种族值退化暂未完整模拟。",
            }
          : {}),
      })
    );

    if (term === "光合") {
      effects.push(
        createEffect("endTurnEnergyFromMark", target, entry, trigger, {
          term,
          energyPerStack: 1,
        })
      );
    }

    if (isPartial) {
      notes.push(`${entry}：萌化种族值退化暂未完整模拟。`);
    }
  }

  if (text.includes("获得萌化") && !termMark && !text.includes("自己和敌方获得萌化")) {
    effects.push(
      createEffect("termMark", target, entry, trigger, {
        term: "萌化",
        stacks: 1,
        partial: true,
        approximationNote: "萌化种族值退化暂未完整模拟。",
      })
    );
    notes.push(`${entry}：萌化种族值退化暂未完整模拟。`);
  }

  const percentHeal = text.match(/(?:自己|敌方|对手|目标)?回复(\d+)%生命/);
  if (percentHeal && !text.includes("自己和敌方获得萌化")) {
    effects.push(
      createEffect("percentHeal", target, entry, trigger, {
        percent: Number(percentHeal[1]) / 100,
      })
    );
  }

  const explicitStatus = text.match(/(?:敌方|对手|目标)?获得(\d+)层(灼烧|冻结|中毒|麻痹|眩晕)/);
  if (explicitStatus) {
    effects.push(
      createEffect("status", target === "self" ? "self" : "opponent", entry, trigger, {
        status: parseStatusName(explicitStatus[2]),
        stacks: Number(explicitStatus[1]),
      })
    );
  }

  const skillPower = text.match(/(?:增加|提升)?(\d+)技能威力|威力\+(\d+)(?!%)/);
  if (skillPower) {
    effects.push(
      createEffect("powerBonus", "self", entry, trigger, {
        amount: Number(skillPower[1] ?? skillPower[2]),
      })
    );
  }

  const powerPercent = text.match(/威力\+(\d+)%|增加(\d+)%威力/);
  if (powerPercent) {
    effects.push(
      createEffect("powerMultiplier", "self", entry, trigger, {
        multiplier: 1 + Number(powerPercent[1] ?? powerPercent[2]) / 100,
      })
    );
  }

  const hitCount = text.match(/连击\s*([+-]\d+)/);
  if (hitCount) {
    effects.push(
      createEffect("hitCountModifier", "self", entry, trigger, {
        amount: Number(hitCount[1]),
      })
    );
  }

  const fixedHitCount = text.match(/(\d+)连击|变为(\d+)连击/);
  if (fixedHitCount && !hitCount) {
    effects.push(
      createEffect("hitCountModifier", "self", entry, trigger, {
        amount: Math.max(0, Number(fixedHitCount[1] ?? fixedHitCount[2]) - 1),
      })
    );
  }

  const priority = text.match(/先手\+(\d+)|迅捷/);
  if (priority) {
    effects.push(
      createEffect("priorityModifier", "self", entry, trigger, {
        amount: priority[1] ? Number(priority[1]) : 2,
      })
    );
  }

  const damageReduction = text.match(/减伤(\d+)%/);
  if (damageReduction) {
    effects.push(
      createEffect("damageReduction", "self", entry, trigger, {
        rate: Number(damageReduction[1]) / 100,
      })
    );
  }

  for (const response of text.matchAll(/应对(攻击|状态|防御)/g)) {
    const responseKind = response[1] === "攻击" ? "attack" : response[1] === "状态" ? "status" : "defense";
    effects.push(
      createEffect("responseWindow", "self", entry, trigger, {
        responseKind,
      })
    );
  }

  if (/打断/.test(text)) {
    effects.push(createEffect("interrupt", "opponent", entry, trigger, {}));
  }

  const speedDown = text.match(/减少(?:对手|敌方|目标)?(\d+)速度|速度-(\d+)/);
  if (speedDown) {
    effects.push(
      createEffect("speedModifier", target === "opponent" ? "opponent" : "self", entry, trigger, {
        amount: target === "opponent" ? -Number(speedDown[1] ?? speedDown[2]) : Number(speedDown[1] ?? speedDown[2]),
      })
    );
  }

  const speedUp = text.match(/(?:增加|\+)(\d+)速度值|(?:增加|\+)(\d+)速度|速度\+(\d+)/);
  if (speedUp && !speedDown) {
    effects.push(
      createEffect("speedModifier", "self", entry, trigger, {
        amount: Number(speedUp[1] ?? speedUp[2] ?? speedUp[3]),
      })
    );
  }

  const statPercent = text.match(/(?:增加|提升|减少|降低|获得)(?:对手|敌方|目标)?(\d+)%(双攻|双防|物攻|魔攻|物防|魔防|速度|攻防速|攻防|全属性)/);
  if (statPercent) {
    const isDecrease = /减少|降低/.test(text);
    effects.push(
      createEffect(
        "statModifier",
        target,
        entry,
        trigger,
        {
          statKeys: parseStatKeys(statPercent[2]),
          rate: (isDecrease ? -1 : 1) * (Number(statPercent[1]) / 100),
        },
        true
      )
    );
  }

  const signedStatPercent = text.match(/(双攻|双防|物攻|魔攻|物防|魔防|速度|攻防速|攻防|全属性)([+-])(\d+)%/);
  if (signedStatPercent) {
    const sign = signedStatPercent[2] === "-" ? -1 : 1;
    effects.push(
      createEffect("statModifier", target, entry, trigger, {
        statKeys: parseStatKeys(signedStatPercent[1]),
        rate: sign * (Number(signedStatPercent[3]) / 100),
      })
    );
  }

  const status = text.match(/给予(?:对手|敌方|目标)?(\d+)层(灼烧|冻结|中毒|麻痹|眩晕)/);
  if (status) {
    effects.push(
      createEffect("status", "opponent", entry, trigger, {
        status: parseStatusName(status[2]),
        stacks: Number(status[1]),
      })
    );
  }

  const mark = text.match(/给予(?:对手|敌方|目标)?(\d+)层([^，,。；;]*印记)/);
  if (mark) {
    effects.push(
      createEffect("mark", "opponent", entry, trigger, {
        mark: mark[2],
        stacks: Number(mark[1]),
      })
    );
  }

  const energyDelta = text.match(/减少(?:对手|敌方|目标)?(\d+)点能量|使(?:敌方|对手|目标)失去(\d+)能量|偷取(?:敌方|对手|目标)?(\d+)能量|回复(\d+)点?能量/);
  if (energyDelta) {
    const amount = Number(energyDelta[1] ?? energyDelta[2] ?? energyDelta[3] ?? energyDelta[4]);
    effects.push(
      createEffect("energyDelta", energyDelta[4] ? "self" : "opponent", entry, trigger, {
        amount: energyDelta[4] ? amount : -amount,
      })
    );

    if (energyDelta[3]) {
      effects.push(
        createEffect("energyDelta", "self", entry, trigger, {
          amount,
        })
      );
    }
  }

  const energyCost = text.match(/全技能减少(\d+)点能耗|能耗减少(\d+)/);
  if (energyCost) {
    effects.push(
      createEffect("energyCostModifier", "self", entry, trigger, {
        amount: -Number(energyCost[1] ?? energyCost[2]),
      })
    );
  }

  const permanentEnergyCost = text.match(/能耗永久([+-])(\d+)/);
  if (permanentEnergyCost) {
    const sign = permanentEnergyCost[1] === "-" ? -1 : 1;
    effects.push(
      createEffect("permanentEnergyCostModifier", "self", entry, trigger, {
        amount: sign * Number(permanentEnergyCost[2]),
      })
    );
  }

  const permanentPower = text.match(/威力永久\+(\d+)/);
  if (permanentPower) {
    effects.push(
      createEffect("permanentPowerModifier", "self", entry, trigger, {
        amount: Number(permanentPower[1]),
      })
    );
  }

  if (/每次入场/.test(text)) {
    effects.push(createEffect("entryCounter", "self", entry, trigger, {}));
  }

  const drain = text.match(/增加(\d+)%吸血|吸血\+(\d+)%/);
  if (drain) {
    effects.push(
      createEffect("drain", "self", entry, trigger, {
        percent: Number(drain[1] ?? drain[2]) / 100,
      })
    );
  }

  if (/回复少量生命/.test(text)) {
    effects.push(
      createEffect("heal", "self", entry, trigger, {
        percent: 0.18,
      })
    );
    notes.push(`${entry}：少量生命在自博弈中按最大生命 18% 近似。`);
  }

  if (/天气/.test(text)) {
    effects.push(
      createEffect("weather", "field", entry, trigger, {
        weather: text,
      }, false)
    );
  }

  if (/场地|环境/.test(text)) {
    effects.push(
      createEffect("field", "field", entry, trigger, {
        field: text,
      }, false)
    );
  }

  if (/驱散|清除|删除.*强化|解除/.test(text)) {
    effects.push(createEffect("dispel", target, entry, trigger, {}, true));
  }

  if (/脱离|换人|替换|下场/.test(text)) {
    effects.push(createEffect("switch", target, entry, trigger, {}, true));
  }

  if (effects.length === 0 && text && !isPlainDamageText) {
    effects.push(
      createEffect(
        "note",
        target,
        entry,
        trigger,
        {
          note: text,
        },
        false
      )
    );
  }

  return { effects, notes };
}

function parseSkillEffects(effectEntries) {
  const effects = [];
  const notes = [];

  for (const entry of effectEntries) {
    const parsed = parseBattleEffects(entry);
    effects.push(...parsed.effects);
    notes.push(...parsed.notes);
  }

  return {
    parsedEffects: effects,
    unparsedEffectNotes: [
      ...notes,
      ...effects
        .filter((effect) => !effect.simulated)
        .map((effect) => `${effect.rawText}：已记录，暂未完整进入自博弈结算。`),
    ],
  };
}

function parseDetailSkill(detailPage, summary) {
  const html = detailPage.text?.["*"] ?? "";
  const wikitext = detailPage.wikitext?.["*"] ?? "";
  const fields = parseSkillInfoFields(wikitext);
  const name =
    normalizeWikiText(fields.技能名称) ||
    normalizeText(stripTags(extractByClass(html, "rocom_skill_template_skillName"))) ||
    summary.name;
  const attributeText = normalizeWikiText(fields.属性) || normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillAttribute"))
  );
  const categoryText = (normalizeWikiText(fields.技能类别) || normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillSort"))
  )).replace(/技能分类/g, "");
  const rawEffectText = fields.效果 ?? "";
  const rawDescriptionText = fields.描述 ?? "";
  const effect = normalizeWikiText(rawEffectText) || normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillEffect"))
  );
  const describe = normalizeWikiText(rawDescriptionText) || normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillDescribe"))
  );
  const category = categoryMap[categoryText.trim()] ?? summary.category;
  const element = attributeText.replace(/系/g, "").trim() || summary.element;
  const power = parsePowerFromFields(fields, html);
  const energyCost = Number(normalizeWikiText(fields.耗能));
  const isDamageCategory = category === "physical" || category === "magical";
  const description = [effect, describe].filter(Boolean).join(" ");
  const effectEntries = [
    ...parseEffectEntries(rawEffectText),
    ...parseEffectEntries(rawDescriptionText).filter(isMechanicEntry),
  ].filter(Boolean);
  const { parsedEffects, unparsedEffectNotes } = parseSkillEffects(effectEntries);

  return {
    id: createSkillId(name),
    name,
    element,
    category,
    power,
    energyCost: Number.isFinite(energyCost) ? energyCost : undefined,
    stableDamage: isDamageCategory && power > 0,
    defaultHitCount: 1,
    defaultPowerBonus: 0,
    defaultPowerBuffMultiplier: 1,
    description: description || undefined,
    rawEffectText: normalizeWikiText(rawEffectText) || undefined,
    rawDescriptionText: normalizeWikiText(rawDescriptionText) || undefined,
    effectEntries,
    parsedEffects,
    unparsedEffectNotes,
    notes:
      isDamageCategory && power > 0
        ? "由 BWIKI 导入；特殊效果已结构化记录，部分复杂效果按报告说明近似或暂不结算。"
        : "非确定伤害技能，暂不进入可计算技能候选。",
    sourceUrl: summary.sourceUrl,
    learnableSpiritNames: [],
    learnableSpiritIds: [],
  };
}

function serialize(value) {
  return JSON.stringify(value, null, 2);
}

function extractConstExpression(source, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = ([\\s\\S]*?) satisfies [^;]+;`,
    "m"
  );
  const match = source.match(pattern);

  if (!match) {
    return [];
  }

  return JSON.parse(match[1]);
}

async function readSpiritSkillLinks() {
  try {
    const source = await readFile(spiritsSourcePath, "utf8");
    const spirits = extractConstExpression(source, "generatedSpirits");
    const links = new Map();

    for (const spirit of spirits) {
      const skillIds = [
        ...new Set([
          ...(spirit.commonSkillIds ?? []),
          ...(spirit.learnableSkillIds ?? []),
        ]),
      ];

      for (const skillId of skillIds) {
        const current = links.get(skillId) ?? {
          names: [],
          ids: [],
        };
        current.names.push(spirit.name);
        current.ids.push(spirit.id);
        links.set(skillId, current);
      }
    }

    return links;
  } catch {
    return new Map();
  }
}

function attachSpiritLinks(skills, spiritSkillLinks) {
  return skills.map((skill) => {
    const links = spiritSkillLinks.get(skill.id);

    return {
      ...skill,
      learnableSpiritNames: links ? [...new Set(links.names)] : [],
      learnableSpiritIds: links ? [...new Set(links.ids)] : [],
    };
  });
}

function buildSkillsSource(skills) {
  return [
    'import type { Skill } from "../../types/battle";',
    "",
    `export const generatedSkills = ${serialize(skills)} satisfies Skill[];`,
    "",
  ].join("\n");
}

async function main() {
  const warnings = [];
  const spiritSkillLinks = await readSpiritSkillLinks();
  const indexPage = await parseWikiPage({ pageid: skillIndexPageId });
  const indexHtml = indexPage.text?.["*"] ?? "";
  const summaries = extractSkillSummaries(indexHtml);

  if (summaries.length === 0) {
    throw new Error("未能从技能图鉴页提取技能卡片。");
  }

  const skills = [];

  for (const [index, summary] of summaries.entries()) {
    try {
      await sleep(requestDelayMs);
      const detailPage = await parseWikiPage({ page: summary.pageTitle });
      skills.push(parseDetailSkill(detailPage, summary));
    } catch (error) {
      warnings.push(
        `${summary.name}: 详情页导入失败，已使用总表基础字段。${
          error instanceof Error ? error.message : String(error)
        }`
      );
      skills.push({
        id: createSkillId(summary.name),
        name: summary.name,
        element: summary.element,
        category: summary.category,
        power: 0,
        energyCost: undefined,
        stableDamage: false,
        defaultHitCount: 1,
        defaultPowerBonus: 0,
        defaultPowerBuffMultiplier: 1,
        notes: "详情页导入失败，暂不进入可计算技能候选。",
        sourceUrl: summary.sourceUrl,
        learnableSpiritNames: [],
        learnableSpiritIds: [],
      });
    }

    if ((index + 1) % 50 === 0) {
      console.log(`已解析 ${index + 1} / ${summaries.length} 个技能`);
    }
  }

  const uniqueSkills = attachSpiritLinks(
    [...new Map(skills.map((skill) => [skill.id, skill])).values()],
    spiritSkillLinks
  );
  await mkdir(generatedDir, { recursive: true });
  await writeFile(skillsOutputPath, buildSkillsSource(uniqueSkills), "utf8");
  await writeFile(
    reportPath,
    [
      "# 技能数据导入报告",
      "",
      `- 技能数量：${uniqueSkills.length}`,
      `- 可计算伤害技能：${
        uniqueSkills.filter((skill) => skill.stableDamage).length
      }`,
      `- 已结构化技能效果：${uniqueSkills.reduce(
        (sum, skill) => sum + (skill.parsedEffects?.length ?? 0),
        0
      )}`,
      `- 未完整模拟效果说明：${uniqueSkills.reduce(
        (sum, skill) => sum + (skill.unparsedEffectNotes?.length ?? 0),
        0
      )}`,
      `- 警告数量：${warnings.length}`,
      "",
      "## 折射效果",
      uniqueSkills.find((skill) => skill.name === "折射")?.effectEntries?.length
        ? uniqueSkills
            .find((skill) => skill.name === "折射")
            .effectEntries.map((item) => `- ${item}`)
            .join("\n")
        : "- 未导入折射详情",
      "",
      "## 警告",
      warnings.length > 0 ? warnings.map((item) => `- ${item}`).join("\n") : "- 无",
      "",
    ].join("\n"),
    "utf8"
  );

  console.log(`已从 BWIKI 导入 ${uniqueSkills.length} 个技能`);
}

main().catch(async (error) => {
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    reportPath,
    [
      "# 技能数据导入失败",
      "",
      String(error instanceof Error ? error.stack ?? error.message : error),
      "",
    ].join("\n"),
    "utf8"
  );
  console.error(error);
  process.exitCode = 1;
});
