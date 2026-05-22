import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const skillsOutputPath = join(generatedDir, "skills.generated.ts");
const spiritsOutputPath = join(generatedDir, "spirits.generated.ts");
const buildsOutputPath = join(generatedDir, "builds.generated.ts");
const pvpLineupsOutputPath = join(generatedDir, "pvpLineups.generated.ts");
const reportPath = join(root, "lcx-data-import-report.md");

const lcxBaseUrl = "https://wiki.lcx.cab/lk";
const skillListUrl = `${lcxBaseUrl}/skill_list.php`;
const spiritDexUrl = `${lcxBaseUrl}/tujian.php`;
const skillDataUrl = `${lcxBaseUrl}/get_skill_data.php`;
const spiritDataUrl = `${lcxBaseUrl}/get_pokemon_data.php`;
const pageDelayMs = 80;
const execFileAsync = promisify(execFile);

const categoryMap = {
  物攻: "physical",
  魔攻: "magical",
  状态: "status",
  防御: "defense",
};

const statNameMap = new Map([
  ["生命", ["hp"]],
  ["物攻", ["atk"]],
  ["魔攻", ["spa"]],
  ["物防", ["def"]],
  ["魔防", ["spd"]],
  ["速度", ["spe"]],
  ["双攻", ["atk", "spa"]],
  ["双防", ["def", "spd"]],
  ["攻防速", ["atk", "spa", "def", "spd", "spe"]],
  ["全属性", ["atk", "spa", "def", "spd", "spe"]],
]);

const statusMap = new Map([
  ["灼伤", "burn"],
  ["冻结", "freeze"],
  ["冰冻", "freeze"],
  ["中毒", "poison"],
  ["麻痹", "stun"],
  ["眩晕", "stun"],
]);

const lcxElements = [
  "草",
  "火",
  "水",
  "光",
  "地",
  "冰",
  "龙",
  "电",
  "毒",
  "虫",
  "武",
  "翼",
  "萌",
  "幻",
  "幽",
  "恶",
  "普通",
  "机械",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return normalizeText(value)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function createSkillId(name) {
  return `skill_${encodeURIComponent(name)
    .toLowerCase()
    .replace(/%/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

function createLcxSpiritId(row) {
  return `lcx_spirit_${normalizeText(row.id)}`;
}

function toNumber(value, fallback = 0) {
  const text = normalizeText(value);
  if (!text || text === "--") {
    return fallback;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[,\n\r，、]+/g)
    .map(normalizeText)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function serialize(value) {
  return JSON.stringify(value, null, 2);
}

function extractConstExpression(source, exportName, fallback = []) {
  const pattern = new RegExp(
    `export const ${exportName} = ([\\s\\S]*?) satisfies [^;]+;`,
    "m"
  );
  const match = source.match(pattern);

  if (!match) {
    return fallback;
  }

  return JSON.parse(match[1]);
}

async function readGenerated(path, exportName, fallback = []) {
  try {
    const source = await readFile(path, "utf8");
    return extractConstExpression(source, exportName, fallback);
  } catch {
    return fallback;
  }
}

async function readGeneratedFromGit(relativePath, exportName, fallback = []) {
  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${relativePath}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return extractConstExpression(stdout, exportName, fallback);
  } catch {
    return fallback;
  }
}

async function readGeneratedWithBaseline(path, relativePath, exportName, fallback = []) {
  const current = await readGenerated(path, exportName, fallback);
  const baseline = await readGeneratedFromGit(relativePath, exportName, fallback);

  return Array.isArray(current) && current.length > 0 ? current : baseline;
}

async function fetchJson(url, referer) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer,
      "user-agent":
        "roco-damage-calculator-lcx-import/1.0 (+local static data generator)",
      "x-requested-with": "XMLHttpRequest",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchPagedRows({ baseUrl, referer, buildParams, maxPages = 500 }) {
  const rows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ page: String(page), ...buildParams(page) });
    const data = await fetchJson(`${baseUrl}?${params.toString()}`, referer);

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    rows.push(...data);
    await sleep(pageDelayMs);
  }

  return rows;
}

function completenessScore(row) {
  return Object.values(row).reduce((sum, value) => {
    if (value === null || value === undefined || value === "") {
      return sum;
    }

    return sum + String(value).length;
  }, 0);
}

function isFormRow(row) {
  return Boolean(row.is_form || row.form_id || row.form_name || row.form_display_name);
}

function shouldReplaceSpiritDuplicate(current, next) {
  const currentIsForm = isFormRow(current);
  const nextIsForm = isFormRow(next);

  if (currentIsForm !== nextIsForm) {
    return !nextIsForm;
  }

  return completenessScore(next) > completenessScore(current);
}

function dedupeSpiritRows(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = `${row.id}|${row.t_id}|${row.name}`;
    const current = byKey.get(key);
    if (!current || shouldReplaceSpiritDuplicate(current, row)) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}

function createEffect(kind, target, rawText, trigger, extra = {}, simulated = true) {
  return {
    kind,
    target,
    rawText,
    simulated,
    ...(trigger ? { trigger } : {}),
    ...extra,
  };
}

function splitEffectEntries(description) {
  const lines = String(description ?? "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return String(description ?? "")
    .split(/[。；;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTriggeredEntry(entry) {
  const match = entry.match(/^([^\s:：]{1,3})(?:系)?[:：](.+)$/);
  if (!match || !lcxElements.includes(match[1])) {
    return { text: entry };
  }

  return {
    text: match[2].trim(),
    trigger: {
      kind: "carriedSkillElement",
      element: match[1],
    },
  };
}

function getEffectTarget(text) {
  return /对手|敌方|目标/.test(text) || /^上\d+层/.test(text) ? "opponent" : "self";
}

function parseStatKeys(text) {
  const keys = [];

  for (const [label, statKeys] of statNameMap) {
    if (text.includes(label)) {
      keys.push(...statKeys);
    }
  }

  return unique(keys);
}

function parseStatusName(text) {
  for (const [label, status] of statusMap) {
    if (text.includes(label)) {
      return status;
    }
  }

  return "other";
}

function addStatEffects(effects, text, entry, trigger) {
  const patterns = [
    /(?:获得|增加|提升)?(生命|物攻|魔攻|物防|魔防|速度|双攻|双防|攻防速|全属性)([+-]\d+)%/g,
    /(?:使)?(?:对手|敌方|目标)(?:获得)?(生命|物攻|魔攻|物防|魔防|速度|双攻|双防|攻防速|全属性)([+-]\d+)%/g,
    /[-－](?:对手|敌方|目标)(\d+)%(生命|物攻|魔攻|物防|魔防|速度|双攻|双防|攻防速|全属性)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const statLabel = match[1] && statNameMap.has(match[1]) ? match[1] : match[2];
      const signed = match[2]?.startsWith?.("+") || match[2]?.startsWith?.("-") ? match[2] : `-${match[1]}`;
      const target = /对手|敌方|目标/.test(match[0]) ? "opponent" : "self";
      const rate = Number(signed) / 100;

      if (!Number.isFinite(rate)) {
        continue;
      }

      effects.push(
        createEffect("statModifier", target, entry, trigger, {
          statKeys: parseStatKeys(statLabel),
          rate,
        })
      );
    }
  }
}

function parseBattleEffects(entries) {
  const effects = [];
  const notes = [];

  for (const entry of entries) {
    const { text, trigger } = parseTriggeredEntry(entry);
    const target = getEffectTarget(text);

    for (const match of text.matchAll(/减伤(\d+)%/g)) {
      effects.push(
        createEffect("damageReduction", "self", entry, trigger, {
          rate: Number(match[1]) / 100,
        })
      );
    }

    for (const match of text.matchAll(/应对(攻击|状态|防御)/g)) {
      const responseKind =
        match[1] === "攻击" ? "attack" : match[1] === "状态" ? "status" : "defense";
      effects.push(
        createEffect("responseWindow", "self", entry, trigger, {
          responseKind,
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

    for (const match of text.matchAll(/(?:连击数?|连击)([+-]\d+)|(\d+)连击/g)) {
      const amount = match[1] ? Number(match[1]) : Number(match[2]) - 1;
      effects.push(
        createEffect("hitCountModifier", "self", entry, trigger, {
          amount,
        })
      );
    }

    for (const match of text.matchAll(/速度([+-]\d+)|(?:减少|降低)(?:对手|敌方|目标)?(\d+)速度|(?:对手|敌方|目标)速度-(\d+)/g)) {
      const amount = Number(match[1] ?? `-${match[2] ?? match[3]}`);
      effects.push(
        createEffect("speedModifier", /对手|敌方|目标|减少|降低/.test(match[0]) ? "opponent" : "self", entry, trigger, {
          amount,
        })
      );
    }

    addStatEffects(effects, text, entry, trigger);

    for (const match of text.matchAll(/(?:获得|上|给?对手\+?|对手\+?)(\d+)层([^,，。；;\s()（）]+)(?:印记)?/g)) {
      const label = match[2];
      if ([...statusMap.keys()].some((status) => label.includes(status))) {
        effects.push(
          createEffect("status", /自己|自身/.test(match[0]) ? "self" : "opponent", entry, trigger, {
            status: parseStatusName(label),
            stacks: Number(match[1]),
          })
        );
      } else if (["光合", "湿润", "棘刺", "萌化"].some((term) => label.includes(term))) {
        effects.push(
          createEffect("termMark", /自己|自身/.test(match[0]) ? "self" : "opponent", entry, trigger, {
            term: label.replace(/印记/g, ""),
            stacks: Number(match[1]),
            ...(label.includes("萌化")
              ? {
                  partial: true,
                  approximationNote: "萌化种族值退化暂未完整模拟。",
                }
              : {}),
          })
        );
      } else {
        effects.push(
          createEffect("mark", /自己|自身/.test(match[0]) ? "self" : "opponent", entry, trigger, {
            mark: label.replace(/印记/g, ""),
            stacks: Number(match[1]),
          })
        );
      }
    }

    for (const match of text.matchAll(/(?:回复|回)(\d+)%?(?:生命|血)/g)) {
      const value = Number(match[1]);
      effects.push(
        createEffect("percentHeal", "self", entry, trigger, {
          percent: value > 1 ? value / 100 : value,
        })
      );
    }

    for (const match of text.matchAll(/(?:回复|恢复)(\d+)点?能量/g)) {
      effects.push(
        createEffect("energyDelta", "self", entry, trigger, {
          amount: Number(match[1]),
        })
      );
    }

    for (const match of text.matchAll(/(?:对手|敌方|目标)?(?:失去|减少)(\d+)能量|[-－](?:对手|敌方|目标)(\d+)能量/g)) {
      effects.push(
        createEffect("energyDelta", "opponent", entry, trigger, {
          amount: -Number(match[1] ?? match[2]),
        })
      );
    }

    for (const match of text.matchAll(/偷取(?:对手|敌方|目标)?(\d+)能量/g)) {
      const amount = Number(match[1]);
      effects.push(createEffect("energyDelta", "opponent", entry, trigger, { amount: -amount }));
      effects.push(createEffect("energyDelta", "self", entry, trigger, { amount }));
    }

    for (const match of text.matchAll(/(?:全技能)?能耗([+-]\d+)|([+-]\d+)能耗/g)) {
      effects.push(
        createEffect("energyCostModifier", "self", entry, trigger, {
          amount: Number(match[1] ?? match[2]),
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

    const powerBonus = text.match(/威力\+(\d+)(?![%\d])/);
    if (powerBonus) {
      effects.push(
        createEffect("powerBonus", "self", entry, trigger, {
          amount: Number(powerBonus[1]),
        })
      );
    }

    if (/敌方本回合更换精灵/.test(text) && /威力翻倍/.test(text)) {
      effects.push(
        createEffect("powerMultiplierIfOpponentSwitched", "self", entry, trigger, {
          multiplier: 2,
        })
      );
    } else if (/威力翻倍|技能威力翻倍/.test(text)) {
      effects.push(
        createEffect("powerMultiplier", "self", entry, trigger, {
          multiplier: 2,
        })
      );
    }

    if (/打断/.test(text)) {
      effects.push(createEffect("interrupt", "opponent", entry, trigger));
    }

    if (/驱散|清除|解除/.test(text)) {
      effects.push(createEffect("dispel", target, entry, trigger));
    }

    if (/脱离|换人|下场/.test(text)) {
      effects.push(createEffect("switch", target, entry, trigger));
    }

    if (/吸血/.test(text)) {
      const drain = text.match(/([+-]?\d+)%吸血|吸血\+(\d+)%/);
      effects.push(
        createEffect("drain", "self", entry, trigger, {
          percent: Number(drain?.[1] ?? drain?.[2] ?? 30) / 100,
        })
      );
    }

    const hasStructuredEffect = effects.some((effect) => effect.rawText === entry);
    const isPlainDamage = /^对敌方精灵造成(?:物理|魔法)伤害|^造成(?:物伤|魔伤)/.test(text);
    if (!hasStructuredEffect && !isPlainDamage && text) {
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
  }

  for (const effect of effects) {
    if (!effect.simulated && effect.kind === "note") {
      notes.push(`${effect.rawText}：已记录，暂未完整进入自博弈结算。`);
    }
  }

  return {
    parsedEffects: effects,
    unparsedEffectNotes: unique(notes),
  };
}

function normalizeSkillRow(row, existingSkill) {
  const name = normalizeText(row.name);
  const category = categoryMap[normalizeText(row.category)] ?? "status";
  const power = toNumber(row.power, 0);
  const description = normalizeText(row.description);
  const effectEntries = splitEffectEntries(row.description);
  const { parsedEffects, unparsedEffectNotes } = parseBattleEffects(effectEntries);

  return {
    id: existingSkill?.id ?? createSkillId(name),
    name,
    element: normalizeText(row.attribute) || existingSkill?.element || "普通",
    category,
    power,
    energyCost: toNumber(row.energy_consumption, undefined),
    stableDamage: (category === "physical" || category === "magical") && power > 0,
    defaultHitCount: existingSkill?.defaultHitCount ?? 1,
    defaultPowerBonus: existingSkill?.defaultPowerBonus ?? 0,
    defaultPowerBuffMultiplier: existingSkill?.defaultPowerBuffMultiplier ?? 1,
    description: description || undefined,
    rawEffectText: description || undefined,
    rawDescriptionText: existingSkill?.rawDescriptionText,
    effectEntries,
    parsedEffects,
    unparsedEffectNotes,
    notes:
      (category === "physical" || category === "magical") && power > 0
        ? "由 LCX 导入；特殊效果已结构化记录，部分复杂效果按报告说明近似或暂不结算。"
        : "非确定伤害技能，暂不进入可计算技能候选。",
    sourceUrl: `${skillListUrl}?search=${encodeURIComponent(name)}`,
    learnableSpiritNames: [],
    learnableSpiritIds: [],
  };
}

function hasCompleteStats(row) {
  return ["hp", "attack", "special_attack", "defense", "special_defense", "speed"].every(
    (key) => toNumber(row[key], 0) > 0
  );
}

function parseTraits(value) {
  const text = normalizeText(value);
  if (!text || text === "暂无特性信息") {
    return [];
  }

  return text
    .split(/\n|；|;/g)
    .map(normalizeText)
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([^:：]{1,20})[:：](.+)$/);
      return match
        ? {
            name: normalizeText(match[1]),
            description: normalizeText(match[2]) || undefined,
          }
        : {
            name: "特性",
            description: item,
          };
    });
}

function getRecommendedIndividualKeys(stats) {
  return ["hp", stats.spa > stats.atk ? "spa" : "atk", "spe"];
}

function normalizeSpiritRow(row, skillByName) {
  const name = normalizeText(row.name);
  const skillNames = unique([
    ...splitList(row.moves),
    ...splitList(row.jinengshi),
    ...splitList(row.xuemai),
    ...splitList(row.tujian),
    ...splitList(row.pve4),
    ...splitList(row.pvp4),
  ]);
  const learnableSkillIds = [];
  const unresolvedSkillNames = [];

  for (const skillName of skillNames) {
    const skill = skillByName.get(normalizeName(skillName));
    if (skill) {
      learnableSkillIds.push(skill.id);
    } else {
      unresolvedSkillNames.push(skillName);
    }
  }

  const baseStats = {
    hp: toNumber(row.hp),
    atk: toNumber(row.attack),
    spa: toNumber(row.special_attack),
    def: toNumber(row.defense),
    spd: toNumber(row.special_defense),
    spe: toNumber(row.speed),
  };

  return {
    id: createLcxSpiritId(row),
    pageId: toNumber(row.id, undefined),
    name,
    dexNo: normalizeText(row.t_id) || undefined,
    stage: normalizeText(row.evolution_stage) || undefined,
    elements: unique(splitList(row.attributes)).slice(0, 2),
    baseStats,
    imageUrl: `${lcxBaseUrl}/imgs/${encodeURIComponent(name)}.webp`,
    sourceUrl: `${spiritDexUrl}?search=${encodeURIComponent(name)}`,
    traits: parseTraits(row.abilities_text),
    commonSkillIds: [],
    learnableSkillIds: unique(learnableSkillIds),
    learnableSkillNames: skillNames,
    unresolvedSkillNames,
  };
}

function skillComparable(skill) {
  return {
    element: skill.element,
    category: skill.category,
    power: skill.power,
    energyCost: skill.energyCost,
    description: skill.description,
  };
}

function spiritComparable(spirit) {
  return {
    elements: spirit.elements,
    baseStats: spirit.baseStats,
    traits: (spirit.traits ?? []).map((trait) => `${trait.name}:${trait.description ?? ""}`),
    learnableSkillNames: unique(spirit.learnableSkillNames ?? []).sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN")
    ),
  };
}

function diffObject(before, after) {
  const changes = [];
  const keys = unique([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const left = JSON.stringify(before[key]);
    const right = JSON.stringify(after[key]);
    if (left !== right) {
      changes.push(`${key}: ${left ?? "undefined"} -> ${right ?? "undefined"}`);
    }
  }

  return changes;
}

function buildSkillsSource(skills) {
  return [
    'import type { Skill } from "../../types/battle";',
    "",
    `export const generatedSkills = ${serialize(skills)} satisfies Skill[];`,
    "",
  ].join("\n");
}

function buildSpiritsSource(spirits) {
  return [
    'import type { Spirit } from "../../types/battle";',
    "",
    `export const generatedSpirits = ${serialize(spirits)} satisfies Spirit[];`,
    "",
  ].join("\n");
}

function buildBuildsSource(spirits, existingBuilds) {
  const recommended = Object.fromEntries(
    spirits.map((spirit) => [spirit.id, getRecommendedIndividualKeys(spirit.baseStats)])
  );

  return [
    'import type { CommonBuild, StatKey } from "../../types/battle";',
    "",
    `export const generatedBuilds = ${serialize(existingBuilds)} satisfies CommonBuild[];`,
    "",
    `export const generatedRecommendedIndividualKeys = ${serialize(
      recommended
    )} satisfies Record<string, StatKey[]>;`,
    "",
  ].join("\n");
}

function buildPvpLineupsSource(lineups) {
  return [
    'import type { PvpLineup } from "../../types/battle";',
    "",
    `export const generatedPvpLineups = ${serialize(lineups)} satisfies PvpLineup[];`,
    "",
  ].join("\n");
}

function sortSpirits(left, right) {
  const leftNo = Number(left.dexNo);
  const rightNo = Number(right.dexNo);
  if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) {
    return leftNo - rightNo;
  }

  return left.name.localeCompare(right.name, "zh-Hans-CN");
}

function attachSpiritLinks(skills, spirits) {
  const bySkillId = new Map();

  for (const spirit of spirits) {
    for (const skillId of spirit.learnableSkillIds ?? []) {
      const list = bySkillId.get(skillId) ?? [];
      list.push({ id: spirit.id, name: spirit.name });
      bySkillId.set(skillId, list);
    }
  }

  return skills.map((skill) => {
    const learnedBy = bySkillId.get(skill.id) ?? [];
    return {
      ...skill,
      learnableSpiritNames: unique(learnedBy.map((item) => item.name)),
      learnableSpiritIds: unique(learnedBy.map((item) => item.id)),
    };
  });
}

function makeReportSection(title, rows, emptyText = "无") {
  return [
    `## ${title}`,
    rows.length > 0 ? rows.map((item) => `- ${item}`).join("\n") : `- ${emptyText}`,
    "",
  ].join("\n");
}

async function main() {
  const existingSkills = await readGeneratedWithBaseline(
    skillsOutputPath,
    "src/data/generated/skills.generated.ts",
    "generatedSkills"
  );
  const existingSpirits = await readGeneratedWithBaseline(
    spiritsOutputPath,
    "src/data/generated/spirits.generated.ts",
    "generatedSpirits"
  );
  const existingBuilds = await readGenerated(buildsOutputPath, "generatedBuilds");
  const existingPvpLineups = await readGenerated(
    pvpLineupsOutputPath,
    "generatedPvpLineups"
  );

  const existingSkillByName = new Map(
    existingSkills.map((skill) => [normalizeName(skill.name), skill])
  );
  const existingSpiritByName = new Map(
    existingSpirits.map((spirit) => [normalizeName(spirit.name), spirit])
  );

  const rawSkillRows = await fetchPagedRows({
    baseUrl: skillDataUrl,
    referer: skillListUrl,
    buildParams: () => ({
      category: "all",
      attribute: "all",
      search: "",
      sort: "",
      direction: "desc",
      energy_value: "all",
    }),
  });
  const rawSpiritRows = await fetchPagedRows({
    baseUrl: spiritDataUrl,
    referer: spiritDexUrl,
    buildParams: () => ({
      exclude_details: "0",
    }),
  });
  const lcxSpiritRows = dedupeSpiritRows(rawSpiritRows);

  const skillChanges = [];
  const newSkillReports = [];
  const lcxSkillNames = new Set();
  const lcxSkills = rawSkillRows.map((row) => {
    const existing = existingSkillByName.get(normalizeName(row.name));
    const next = normalizeSkillRow(row, existing);
    lcxSkillNames.add(normalizeName(next.name));

    if (!existing) {
      newSkillReports.push(`${next.name}（${next.element}/${next.category}，威力 ${next.power}，能耗 ${next.energyCost ?? "-" }）`);
    } else {
      const changes = diffObject(skillComparable(existing), skillComparable(next));
      if (changes.length > 0) {
        skillChanges.push(`${next.name}: ${changes.join("; ")}`);
      }
    }

    return next;
  });
  const lcxSkillByName = new Map(lcxSkills.map((skill) => [normalizeName(skill.name), skill]));

  const mergedSkillById = new Map();
  for (const skill of existingSkills) {
    const replacement = lcxSkillByName.get(normalizeName(skill.name));
    mergedSkillById.set(skill.id, replacement ?? { ...skill, learnableSpiritNames: [], learnableSpiritIds: [] });
  }
  for (const skill of lcxSkills) {
    if (!mergedSkillById.has(skill.id)) {
      mergedSkillById.set(skill.id, skill);
    }
  }

  const mergedSkillsBeforeLinks = [...mergedSkillById.values()];
  const skillByName = new Map(
    mergedSkillsBeforeLinks.map((skill) => [normalizeName(skill.name), skill])
  );

  const skippedSpiritReports = [];
  const newSpiritReports = [];
  const spiritChanges = [];
  const oldIdToNewId = new Map();
  const lcxSpiritNames = new Set();
  const lcxValidSpirits = [];
  const skippedKeys = new Set();

  for (const row of lcxSpiritRows) {
    const rowName = normalizeName(row.name);
    const rowDex = normalizeText(row.t_id);
    const existing = existingSpiritByName.get(rowName);
    lcxSpiritNames.add(rowName);

    if (!hasCompleteStats(row)) {
      const reason = `${normalizeText(row.name)}（编号 ${rowDex || "-"}）：缺少有效种族值`;
      skippedSpiritReports.push(existing ? `${reason}，保留旧数据 ${existing.id}` : reason);
      skippedKeys.add(existing?.id ?? `${row.id}|${row.t_id}|${row.name}`);
      continue;
    }

    const next = normalizeSpiritRow(row, skillByName);
    if (existing && existing.id !== next.id) {
      oldIdToNewId.set(existing.id, next.id);
    }

    if (!existing) {
      newSpiritReports.push(`${next.name}（编号 ${next.dexNo ?? "-"}，${next.elements.join("/")}）`);
    } else {
      const changes = diffObject(spiritComparable(existing), spiritComparable(next));
      if (changes.length > 0) {
        spiritChanges.push(`${next.name}: ${changes.join("; ")}`);
      }
    }

    lcxValidSpirits.push(next);
  }

  const lcxSpiritByName = new Map(
    lcxValidSpirits.map((spirit) => [normalizeName(spirit.name), spirit])
  );
  const mergedSpiritById = new Map();
  for (const spirit of existingSpirits) {
    const replacement = lcxSpiritByName.get(normalizeName(spirit.name));
    if (replacement) {
      mergedSpiritById.set(replacement.id, replacement);
    } else {
      mergedSpiritById.set(spirit.id, spirit);
    }
  }
  for (const spirit of lcxValidSpirits) {
    mergedSpiritById.set(spirit.id, spirit);
  }

  const mergedSpirits = [...mergedSpiritById.values()].sort(sortSpirits);
  const mergedSkills = attachSpiritLinks(mergedSkillsBeforeLinks, mergedSpirits);
  const spiritByName = new Map(mergedSpirits.map((spirit) => [normalizeName(spirit.name), spirit]));

  const remappedLineups = existingPvpLineups.map((lineup) => ({
    ...lineup,
    members: (lineup.members ?? []).map((member) => {
      const mappedId =
        (member.spiritId ? oldIdToNewId.get(member.spiritId) : undefined) ??
        spiritByName.get(normalizeName(member.spiritName))?.id ??
        member.spiritId;

      return {
        ...member,
        spiritId: mappedId,
      };
    }),
  }));
  const remappedLineupCount = existingPvpLineups.reduce((sum, lineup, lineupIndex) => {
    const next = remappedLineups[lineupIndex];
    return (
      sum +
      (lineup.members ?? []).filter(
        (member, memberIndex) => member.spiritId !== next.members[memberIndex]?.spiritId
      ).length
    );
  }, 0);

  const lcxMissingSkillReports = existingSkills
    .filter((skill) => !lcxSkillNames.has(normalizeName(skill.name)))
    .map((skill) => `${skill.name}（${skill.id}）`);
  const lcxMissingSpiritReports = existingSpirits
    .filter((spirit) => {
      if (skippedKeys.has(spirit.id)) {
        return false;
      }
      return !lcxSpiritNames.has(normalizeName(spirit.name));
    })
    .map((spirit) => `${spirit.name}（${spirit.id}${spirit.dexNo ? `，编号 ${spirit.dexNo}` : ""}）`);

  const unresolvedSkillReports = mergedSpirits
    .filter((spirit) => (spirit.unresolvedSkillNames?.length ?? 0) > 0)
    .map(
      (spirit) =>
        `${spirit.name}: ${unique(spirit.unresolvedSkillNames ?? []).slice(0, 30).join("、")}`
    );

  await mkdir(generatedDir, { recursive: true });
  await writeFile(skillsOutputPath, buildSkillsSource(mergedSkills), "utf8");
  await writeFile(spiritsOutputPath, buildSpiritsSource(mergedSpirits), "utf8");
  await writeFile(buildsOutputPath, buildBuildsSource(mergedSpirits, existingBuilds), "utf8");
  if (remappedLineupCount > 0) {
    await writeFile(pvpLineupsOutputPath, buildPvpLineupsSource(remappedLineups), "utf8");
  }

  const report = [
    "# LCX 数据导入改动清单",
    "",
    `- 导入时间：${new Date().toISOString()}`,
    `- 技能来源：${skillListUrl}`,
    `- 精灵来源：${spiritDexUrl}`,
    `- LCX 技能记录：${rawSkillRows.length}`,
    `- LCX 精灵原始记录：${rawSpiritRows.length}`,
    `- LCX 精灵去重后：${lcxSpiritRows.length}`,
    `- 生成技能数量：${mergedSkills.length}`,
    `- 生成精灵数量：${mergedSpirits.length}`,
    `- 新增技能：${newSkillReports.length}`,
    `- 新增精灵：${newSpiritReports.length}`,
    `- 技能字段变化：${skillChanges.length}`,
    `- 精灵字段变化：${spiritChanges.length}`,
    `- 跳过 LCX 不完整精灵：${skippedSpiritReports.length}`,
    `- 未匹配技能引用的精灵：${unresolvedSkillReports.length}`,
    `- LCX 未返回但保留的旧技能：${lcxMissingSkillReports.length}`,
    `- LCX 未返回但保留的旧精灵：${lcxMissingSpiritReports.length}`,
    `- 已同步 PVP 阵容精灵引用：${remappedLineupCount}`,
    "",
    makeReportSection("新增技能", newSkillReports),
    makeReportSection("新增精灵", newSpiritReports),
    makeReportSection("技能字段变化", skillChanges),
    makeReportSection("精灵字段变化", spiritChanges),
    makeReportSection("跳过的 LCX 不完整精灵", skippedSpiritReports),
    makeReportSection("未匹配技能引用", unresolvedSkillReports),
    makeReportSection("LCX 未返回但保留的旧技能", lcxMissingSkillReports),
    makeReportSection("LCX 未返回但保留的旧精灵", lcxMissingSpiritReports),
  ].join("\n");

  await writeFile(reportPath, report, "utf8");

  console.log(
    `LCX 导入完成：${mergedSpirits.length} 个精灵，${mergedSkills.length} 个技能。报告：${reportPath}`
  );
}

main().catch(async (error) => {
  await writeFile(
    reportPath,
    [
      "# LCX 数据导入失败",
      "",
      String(error instanceof Error ? error.stack ?? error.message : error),
      "",
    ].join("\n"),
    "utf8"
  );
  console.error(error);
  process.exitCode = 1;
});
