import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const spiritsPath = join(generatedDir, "spirits.generated.ts");
const skillsPath = join(generatedDir, "skills.generated.ts");
const outputPath = join(generatedDir, "pvpLineups.generated.ts");
const reportPath = join(root, "pvp-lineups-import-report.md");

const apiUrl = "https://wiki.biligame.com/rocom/api.php";
const wikiBaseUrl = "https://wiki.biligame.com";
const requestDelayMs = 70;
const requestRetryCount = 3;
const requestRetryDelayMs = 900;
const lineupQuery =
  "[[分类:精灵阵容]][[阵容类型::pvp]]" +
  "|?阵容精灵1|?阵容精灵2|?阵容精灵3|?阵容精灵4|?阵容精灵5|?阵容精灵6" +
  "|?阵容血脉魔法|?阵容标题|?阵容编号|?阵容上传日期" +
  "|sort=阵容上传日期|order=desc|limit=1000";

const statNameToKey = {
  生命: "hp",
  物攻: "atk",
  魔攻: "spa",
  物防: "def",
  魔防: "spd",
  速度: "spe",
};

const natureNameToId = {
  孤僻: "atk_up_def_down",
  固执: "atk_up_spa_down",
  调皮: "atk_up_spd_down",
  勇敢: "atk_up_spe_down",
  大胆: "def_up_atk_down",
  淘气: "def_up_spa_down",
  无虑: "def_up_spd_down",
  悠闲: "def_up_spe_down",
  保守: "spa_up_atk_down",
  稳重: "spa_up_def_down",
  马虎: "spa_up_spd_down",
  冷静: "spa_up_spe_down",
  沉着: "spd_up_atk_down",
  温顺: "spd_up_def_down",
  慎重: "spd_up_spa_down",
  狂妄: "spd_up_spe_down",
  胆小: "spe_up_atk_down",
  急躁: "spe_up_def_down",
  开朗: "spe_up_spa_down",
  爽朗: "spe_up_spa_down",
  天真: "spe_up_spd_down",
  坦率: "neutral",
  害羞: "neutral",
  认真: "neutral",
  勤奋: "neutral",
  浮躁: "neutral",
};

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

function normalizeText(text) {
  return decodeHtml(text).replace(/\s+/g, " ").trim();
}

function stripParenthetical(text) {
  return normalizeText(text).replace(/[（(].*?[）)]/g, "").trim();
}

function normalizeLookupText(text) {
  return normalizeText(text)
    .replace(/\s+/g, "")
    .replace(/[()]/g, (value) => (value === "(" ? "（" : "）"));
}

function readGeneratedJson(source, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = ([\\s\\S]*?) satisfies [^;]+;`,
    "m"
  );
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`无法从生成文件中读取 ${exportName}`);
  }

  return JSON.parse(match[1]);
}

async function readGeneratedData() {
  const [spiritsSource, skillsSource] = await Promise.all([
    readFile(spiritsPath, "utf8"),
    readFile(skillsPath, "utf8"),
  ]);

  return {
    spirits: readGeneratedJson(spiritsSource, "generatedSpirits"),
    skills: readGeneratedJson(skillsSource, "generatedSkills"),
  };
}

async function postApi(params) {
  let lastError;

  for (let attempt = 1; attempt <= requestRetryCount; attempt += 1) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent":
            "roco-damage-calculator-pvp-lineup-import/0.1 (+local static data generator)",
        },
        body: new URLSearchParams(params),
      });

      if (!response.ok) {
        throw new Error(`BWIKI API 返回 HTTP ${response.status}`);
      }

      const payload = await response.json();

      if (payload.error) {
        throw new Error(payload.error.info ?? JSON.stringify(payload.error));
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= requestRetryCount) {
        break;
      }
      await sleep(requestRetryDelayMs * attempt);
    }
  }

  throw lastError;
}

async function askPvpLineups() {
  const results = [];
  let offset = 0;

  while (true) {
    const query = offset > 0 ? `${lineupQuery}|offset=${offset}` : lineupQuery;
    const payload = await postApi({
      action: "ask",
      format: "json",
      query,
    });
    const batch = Object.values(payload.query?.results ?? {});
    results.push(...batch);

    const nextOffset = payload["query-continue-offset"];
    if (!nextOffset || batch.length === 0) {
      break;
    }

    offset = Number(nextOffset);
  }

  return results;
}

async function parseWikiPage(page) {
  const payload = await postApi({
    action: "parse",
    format: "json",
    prop: "wikitext",
    page,
  });

  return payload.parse;
}

function parseTemplateFields(wikitext) {
  const body = wikitext.match(/\{\{精灵阵容([\s\S]*?)\}\}/)?.[1] ?? wikitext;
  const fields = {};

  for (const rawLine of body.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = normalizeText(line.slice(1, separatorIndex));
    const value = normalizeText(line.slice(separatorIndex + 1));
    fields[key] = value;
  }

  return fields;
}

function createSkillMatcher(skills) {
  const exact = new Map();
  const stripped = new Map();

  for (const skill of skills) {
    exact.set(normalizeLookupText(skill.name), skill);

    const strippedKey = normalizeLookupText(stripParenthetical(skill.name));
    const current = stripped.get(strippedKey) ?? [];
    current.push(skill);
    stripped.set(strippedKey, current);
  }

  return (name) => {
    const key = normalizeLookupText(name);
    const exactMatch = exact.get(key);
    if (exactMatch) {
      return exactMatch;
    }

    const strippedMatches = stripped.get(normalizeLookupText(stripParenthetical(name)));
    return strippedMatches?.length === 1 ? strippedMatches[0] : undefined;
  };
}

function getSpiritAliases(spirit) {
  const aliases = new Set([spirit.name]);

  if (spirit.sourceUrl) {
    try {
      const pageTitle = decodeURIComponent(
        new URL(spirit.sourceUrl).pathname.replace(/^\/rocom\//, "")
      );
      aliases.add(pageTitle);
    } catch {
      // sourceUrl 只用于增强形态匹配；解析失败时保留其他匹配方式。
    }
  }

  for (const value of [spirit.form, spirit.stage].filter(Boolean)) {
    aliases.add(`${spirit.name}（${value}）`);
    for (const part of String(value).split(/\s*\/\s*/g)) {
      aliases.add(`${spirit.name}（${part}）`);
    }
  }

  return [...aliases].map(normalizeLookupText);
}

function createSpiritMatcher(spirits) {
  const exact = new Map();
  const byBaseName = new Map();

  for (const spirit of spirits) {
    for (const alias of getSpiritAliases(spirit)) {
      if (!exact.has(alias)) {
        exact.set(alias, spirit);
      }
    }

    const baseKey = normalizeLookupText(stripParenthetical(spirit.name));
    const list = byBaseName.get(baseKey) ?? [];
    list.push(spirit);
    byBaseName.set(baseKey, list);
  }

  return (name) => {
    const exactMatch = exact.get(normalizeLookupText(name));
    if (exactMatch) {
      return exactMatch;
    }

    const baseMatches = byBaseName.get(normalizeLookupText(stripParenthetical(name)));
    return baseMatches?.length === 1 ? baseMatches[0] : undefined;
  };
}

function parseIndividualKeys(text) {
  return normalizeText(text)
    .split(/[、,，/ ]+/g)
    .map((item) => statNameToKey[item])
    .filter(Boolean);
}

function parseLineupMember(slot, fields, matchSpirit, matchSkill) {
  const prefix = `阵容精灵${slot}`;
  const spiritName = fields[prefix] ?? "";
  const matchedSpirit = spiritName ? matchSpirit(spiritName) : undefined;
  const skillNames = [1, 2, 3, 4]
    .map((index) => fields[`${prefix}技能${index}`])
    .filter(Boolean);
  const skillIds = [];
  const unresolvedSkillNames = [];

  for (const skillName of skillNames) {
    const skill = matchSkill(skillName);
    if (skill) {
      skillIds.push(skill.id);
    } else {
      unresolvedSkillNames.push(skillName);
    }
  }

  return {
    slot,
    spiritName,
    spiritId: matchedSpirit?.id,
    bloodline: fields[`${prefix}血脉`] || undefined,
    natureName: fields[`${prefix}性格`] || undefined,
    natureId: natureNameToId[fields[`${prefix}性格`]] ?? undefined,
    individualKeys: parseIndividualKeys(fields[`${prefix}个体值`]),
    skillNames,
    skillIds: [...new Set(skillIds)],
    unresolvedSkillNames,
  };
}

function buildLineupsSource(lineups) {
  return [
    'import type { PvpLineup } from "../../types/battle";',
    "",
    `export const generatedPvpLineups = ${JSON.stringify(
      lineups,
      null,
      2
    )} satisfies PvpLineup[];`,
    "",
  ].join("\n");
}

function getFirstPrintout(result, key) {
  return result.printouts?.[key]?.[0];
}

async function main() {
  const warnings = [];
  const { spirits, skills } = await readGeneratedData();
  const matchSpirit = createSpiritMatcher(spirits);
  const matchSkill = createSkillMatcher(skills);
  const lineupSummaries = await askPvpLineups();
  const lineups = [];

  for (const [index, summary] of lineupSummaries.entries()) {
    await sleep(requestDelayMs);
    const pageTitle = summary.fulltext;
    const page = await parseWikiPage(pageTitle);
    const fields = parseTemplateFields(page.wikitext?.["*"] ?? "");
    const members = [1, 2, 3, 4, 5, 6].map((slot) =>
      parseLineupMember(slot, fields, matchSpirit, matchSkill)
    );
    const unresolvedSpiritNames = members
      .filter((member) => member.spiritName && !member.spiritId)
      .map((member) => member.spiritName);

    if (unresolvedSpiritNames.length > 0) {
      warnings.push(
        `${fields.阵容标题 ?? getFirstPrintout(summary, "阵容标题") ?? pageTitle}: 未匹配精灵 ${unresolvedSpiritNames.join("、")}`
      );
    }

    for (const member of members) {
      if (member.unresolvedSkillNames.length > 0) {
        warnings.push(
          `${fields.阵容标题 ?? pageTitle}/${member.spiritName}: 未匹配技能 ${member.unresolvedSkillNames.join("、")}`
        );
      }
    }

    lineups.push({
      id:
        fields.阵容编号 ??
        getFirstPrintout(summary, "阵容编号") ??
        pageTitle.split("/").at(-1),
      title:
        fields.阵容标题 ??
        getFirstPrintout(summary, "阵容标题") ??
        summary.displaytitle?.replace(/^精灵阵容:/, "") ??
        pageTitle,
      type: "pvp",
      author: fields.阵容作者 || undefined,
      bloodlineMagic:
        fields.阵容血脉魔法 ??
        getFirstPrintout(summary, "阵容血脉魔法") ??
        undefined,
      description: fields.阵容介绍 || undefined,
      uploadedAt:
        fields.阵容上传日期 ??
        getFirstPrintout(summary, "阵容上传日期") ??
        undefined,
      sourcePage: pageTitle,
      sourceUrl: summary.fullurl ?? new URL(`/rocom/${pageTitle}`, wikiBaseUrl).toString(),
      members,
      unresolvedSpiritNames,
    });

    if ((index + 1) % 25 === 0) {
      console.log(`已解析 ${index + 1} / ${lineupSummaries.length} 个 PVP 阵容`);
    }
  }

  await mkdir(generatedDir, { recursive: true });
  await writeFile(outputPath, buildLineupsSource(lineups), "utf8");

  const memberCount = lineups.reduce((sum, lineup) => sum + lineup.members.length, 0);
  const matchedMemberCount = lineups.reduce(
    (sum, lineup) =>
      sum + lineup.members.filter((member) => Boolean(member.spiritId)).length,
    0
  );
  const skillCount = lineups.reduce(
    (sum, lineup) =>
      sum + lineup.members.reduce((inner, member) => inner + member.skillNames.length, 0),
    0
  );
  const matchedSkillCount = lineups.reduce(
    (sum, lineup) =>
      sum + lineup.members.reduce((inner, member) => inner + member.skillIds.length, 0),
    0
  );

  await writeFile(
    reportPath,
    [
      "# BWIKI PVP 阵容导入报告",
      "",
      `- PVP 阵容数量：${lineups.length}`,
      `- 阵容成员匹配：${matchedMemberCount} / ${memberCount}`,
      `- 技能匹配：${matchedSkillCount} / ${skillCount}`,
      `- 警告数量：${warnings.length}`,
      "",
      "## 警告",
      warnings.length > 0 ? warnings.map((item) => `- ${item}`).join("\n") : "- 无",
      "",
    ].join("\n"),
    "utf8"
  );

  console.log(`已从 BWIKI 导入 ${lineups.length} 个 PVP 阵容`);
  console.log(`阵容成员匹配：${matchedMemberCount} / ${memberCount}`);
  console.log(`技能匹配：${matchedSkillCount} / ${skillCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
