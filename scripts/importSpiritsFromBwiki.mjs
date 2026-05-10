import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const spiritsOutputPath = join(generatedDir, "spirits.generated.ts");
const skillsOutputPath = join(generatedDir, "skills.generated.ts");
const buildsOutputPath = join(generatedDir, "builds.generated.ts");
const reportPath = join(root, "data-import-report.md");

const apiUrl = "https://wiki.biligame.com/rocom/api.php";
const wikiBaseUrl = "https://wiki.biligame.com";
const spiritIndexPage = "精灵图鉴";
const requestDelayMs = 70;

const statMap = {
  生命: "hp",
  物攻: "atk",
  魔攻: "spa",
  物防: "def",
  魔防: "spd",
  速度: "spe",
};

const emptyStats = {
  hp: 0,
  atk: 0,
  spa: 0,
  def: 0,
  spd: 0,
  spe: 0,
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

function normalizeSkillName(name) {
  return normalizeText(name).replace(/[（(].*?[）)]/g, "").trim();
}

function createFallbackId(name) {
  return `spirit_${encodeURIComponent(name)
    .toLowerCase()
    .replace(/%/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

async function parseWikiPage(params) {
  const body = new URLSearchParams({
    action: "parse",
    format: "json",
    prop: "text|links",
    ...params,
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent":
        "roco-damage-calculator-spirit-import/0.1 (+local static data generator)",
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

function splitElements(text) {
  return normalizeText(text)
    .split(/[\/、\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function extractImageUrl(html) {
  const image = html.match(/<img\b[^>]*src="([^"]+)"/i)?.[1];
  if (!image) {
    return undefined;
  }

  return new URL(decodeHtml(image), wikiBaseUrl).toString();
}

function extractDexNo(text) {
  return normalizeText(text).match(/NO\.?\s*([0-9]+)/i)?.[1];
}

function extractSpiritSummaries(indexHtml) {
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
    const pageTitle = decodeURIComponent(href.replace(/^\/rocom\//, ""));

    if (!name || seen.has(pageTitle)) {
      continue;
    }

    seen.add(pageTitle);

    const formParts = [attrs["data-param4"], attrs["data-param5"]]
      .map(normalizeText)
      .filter((item) => item && item !== "原始形态");
    if (normalizeText(attrs["data-param6"]) === "是") {
      formParts.push("异色");
    }

    summaries.push({
      name,
      pageTitle,
      sourceUrl: new URL(href, wikiBaseUrl).toString(),
      dexNo: extractDexNo(cardHtml),
      stage: normalizeText(attrs["data-param1"]) || undefined,
      form: formParts.length > 0 ? [...new Set(formParts)].join(" / ") : undefined,
      elements: splitElements(attrs["data-param2"]),
      imageUrl: extractImageUrl(cardHtml),
    });
  }

  return summaries;
}

function parseDetailName(html, fallbackName) {
  const nameBlock = html.match(
    /<[^>]*class="[^"]*rocom_sprite_grament_name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i
  )?.[1];
  const text = normalizeText(stripTags(nameBlock ?? ""));
  const match = text.match(/^(\d+)\s+(.+)$/);

  return {
    dexNo: match?.[1],
    name: match?.[2] ?? fallbackName,
  };
}

function parseDetailElements(html, fallbackElements) {
  const elements = [
    ...html.matchAll(
      /<[^>]*class="[^"]*rocom_sprite_grament_attributes_text[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi
    ),
  ]
    .map((match) => normalizeText(stripTags(match[1])))
    .filter(Boolean);

  return elements.length > 0 ? [...new Set(elements)].slice(0, 2) : fallbackElements;
}

function parseStats(html) {
  const stats = { ...emptyStats };
  const matches = html.matchAll(
    /<p\b[^>]*class="[^"]*rocom_sprite_info_qualification_name[^"]*"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<p\b[^>]*class="[^"]*rocom_sprite_info_qualification_value[^"]*"[^>]*>\s*(\d+)\s*<\/p>/gi
  );

  for (const match of matches) {
    const label = normalizeText(stripTags(match[1]));
    const key = statMap[label];
    if (key) {
      stats[key] = Number(match[2]);
    }
  }

  return stats;
}

function parseTraits(html) {
  const traits = [];
  const matches = html.matchAll(
    /<p\b[^>]*class="[^"]*rocom_sprite_info_characteristic_title[^"]*"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<p\b[^>]*class="[^"]*rocom_sprite_info_characteristic_text[^"]*"[^>]*>([\s\S]*?)<\/p>/gi
  );

  for (const match of matches) {
    const name = normalizeText(stripTags(match[1]));
    const description = normalizeText(stripTags(match[2]));

    if (name) {
      traits.push({
        name,
        description: description || undefined,
      });
    }
  }

  return [...new Map(traits.map((trait) => [trait.name, trait])).values()];
}

function parseSkillNames(html) {
  const names = [
    ...html.matchAll(
      /<div\b[^>]*class="[^"]*rocom_sprite_skillName[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    ),
  ]
    .map((match) => normalizeSkillName(stripTags(match[1])))
    .filter(Boolean);

  return [...new Set(names)];
}

function parseDetailImage(html, fallbackImageUrl) {
  const receptorImage = html.match(
    /<li\b[^>]*id="receptor_grament_list_1"[\s\S]*?<img\b[^>]*src="([^"]+)"/i
  )?.[1];

  if (receptorImage) {
    return new URL(decodeHtml(receptorImage), wikiBaseUrl).toString();
  }

  return fallbackImageUrl;
}

function statIsComplete(stats) {
  return Object.values(stats).every((value) => Number.isFinite(value) && value > 0);
}

function readGeneratedJson(source, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = ([\\s\\S]*?) satisfies [^;]+;`
  );
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`无法读取 ${exportName} 生成数据。`);
  }

  return JSON.parse(match[1]);
}

async function readGeneratedSkills() {
  const source = await readFile(skillsOutputPath, "utf8");
  return readGeneratedJson(source, "generatedSkills");
}

function buildSkillsSource(skills) {
  return [
    'import type { Skill } from "../../types/battle";',
    "",
    `export const generatedSkills = ${JSON.stringify(skills, null, 2)} satisfies Skill[];`,
    "",
  ].join("\n");
}

function buildSpiritsSource(spirits) {
  return [
    'import type { Spirit } from "../../types/battle";',
    "",
    `export const generatedSpirits = ${JSON.stringify(
      spirits,
      null,
      2
    )} satisfies Spirit[];`,
    "",
  ].join("\n");
}

function getRecommendedIndividualKeys(stats) {
  const attackKey = stats.spa > stats.atk ? "spa" : "atk";
  return [...new Set(["hp", attackKey, "spe"])];
}

function buildBuildsSource(spirits) {
  const recommended = Object.fromEntries(
    spirits.map((spirit) => [spirit.id, getRecommendedIndividualKeys(spirit.baseStats)])
  );

  return [
    'import type { CommonBuild, StatKey } from "../../types/battle";',
    "",
    "export const generatedBuilds = [] satisfies CommonBuild[];",
    "",
    `export const generatedRecommendedIndividualKeys = ${JSON.stringify(
      recommended,
      null,
      2
    )} satisfies Record<string, StatKey[]>;`,
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

async function main() {
  const warnings = [];
  const unresolvedSkillReports = [];
  const skills = await readGeneratedSkills();
  const skillByName = new Map(skills.map((skill) => [normalizeSkillName(skill.name), skill]));

  const indexPage = await parseWikiPage({ page: spiritIndexPage });
  const indexHtml = indexPage.text?.["*"] ?? "";
  const summaries = extractSpiritSummaries(indexHtml);

  if (summaries.length === 0) {
    throw new Error("未能从精灵图鉴页提取精灵卡片。");
  }

  const spirits = [];

  for (const [index, summary] of summaries.entries()) {
    try {
      await sleep(requestDelayMs);
      const detailPage = await parseWikiPage({ page: summary.pageTitle });
      const detailHtml = detailPage.text?.["*"] ?? "";
      const detailName = parseDetailName(detailHtml, summary.name);
      const baseStats = parseStats(detailHtml);
      const learnableSkillNames = parseSkillNames(detailHtml);
      const learnableSkillIds = [];
      const unresolvedSkillNames = [];

      for (const skillName of learnableSkillNames) {
        const skill = skillByName.get(normalizeSkillName(skillName));
        if (skill) {
          learnableSkillIds.push(skill.id);
        } else {
          unresolvedSkillNames.push(skillName);
        }
      }

      if (!statIsComplete(baseStats)) {
        warnings.push(`${summary.name}: 六维种族值不完整，已跳过。`);
        continue;
      }

      if (unresolvedSkillNames.length > 0) {
        unresolvedSkillReports.push(
          `${detailName.name}: ${unresolvedSkillNames.join("、")}`
        );
      }

      const pageId = Number(detailPage.pageid);
      const spirit = {
        id: Number.isFinite(pageId) ? `spirit_${pageId}` : createFallbackId(detailName.name),
        pageId: Number.isFinite(pageId) ? pageId : undefined,
        name: detailName.name,
        dexNo: detailName.dexNo ?? summary.dexNo,
        stage: summary.stage,
        form: summary.form,
        elements: parseDetailElements(detailHtml, summary.elements).slice(0, 2),
        baseStats,
        imageUrl: parseDetailImage(detailHtml, summary.imageUrl),
        sourceUrl: summary.sourceUrl,
        traits: parseTraits(detailHtml),
        commonSkillIds: [],
        learnableSkillIds: [...new Set(learnableSkillIds)],
        learnableSkillNames,
        unresolvedSkillNames,
      };

      if (spirit.elements.length === 0) {
        warnings.push(`${spirit.name}: 属性缺失，已按普通处理。`);
        spirit.elements = ["普通"];
      }

      spirits.push(spirit);
    } catch (error) {
      warnings.push(
        `${summary.name}: 详情页导入失败，已跳过。${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if ((index + 1) % 50 === 0) {
      console.log(`已解析 ${index + 1} / ${summaries.length} 个精灵`);
    }
  }

  const uniqueSpirits = [...new Map(spirits.map((spirit) => [spirit.id, spirit])).values()]
    .sort(sortSpirits);

  const spiritBySkillId = new Map();
  for (const spirit of uniqueSpirits) {
    for (const skillId of spirit.learnableSkillIds ?? []) {
      const list = spiritBySkillId.get(skillId) ?? [];
      list.push({ id: spirit.id, name: spirit.name });
      spiritBySkillId.set(skillId, list);
    }
  }

  const updatedSkills = skills.map((skill) => {
    const learnedBy = spiritBySkillId.get(skill.id) ?? [];
    return {
      ...skill,
      learnableSpiritIds: learnedBy.map((item) => item.id),
      learnableSpiritNames: learnedBy.map((item) => item.name),
    };
  });

  await mkdir(generatedDir, { recursive: true });
  await writeFile(spiritsOutputPath, buildSpiritsSource(uniqueSpirits), "utf8");
  await writeFile(skillsOutputPath, buildSkillsSource(updatedSkills), "utf8");
  await writeFile(buildsOutputPath, buildBuildsSource(uniqueSpirits), "utf8");

  const spiritsWithoutTraits = uniqueSpirits.filter(
    (spirit) => (spirit.traits?.length ?? 0) === 0
  );
  await writeFile(
    reportPath,
    [
      "# BWIKI 精灵数据导入报告",
      "",
      `- 精灵数量：${uniqueSpirits.length}`,
      `- 技能数量：${updatedSkills.length}`,
      `- 建立技能引用的精灵：${
        uniqueSpirits.filter((spirit) => (spirit.learnableSkillIds?.length ?? 0) > 0)
          .length
      }`,
      `- 无特性数据精灵：${spiritsWithoutTraits.length}`,
      `- 未匹配技能记录：${unresolvedSkillReports.length}`,
      `- 其他警告：${warnings.length}`,
      "",
      "## 未匹配技能",
      unresolvedSkillReports.length > 0
        ? unresolvedSkillReports.map((item) => `- ${item}`).join("\n")
        : "- 无",
      "",
      "## 无特性数据精灵",
      spiritsWithoutTraits.length > 0
        ? spiritsWithoutTraits.map((spirit) => `- ${spirit.name}`).join("\n")
        : "- 无",
      "",
      "## 其他警告",
      warnings.length > 0 ? warnings.map((item) => `- ${item}`).join("\n") : "- 无",
      "",
    ].join("\n"),
    "utf8"
  );

  console.log(`已从 BWIKI 导入 ${uniqueSpirits.length} 个精灵`);
}

main().catch(async (error) => {
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    reportPath,
    [
      "# BWIKI 精灵数据导入失败",
      "",
      String(error instanceof Error ? error.stack ?? error.message : error),
      "",
    ].join("\n"),
    "utf8"
  );
  console.error(error);
  process.exitCode = 1;
});
