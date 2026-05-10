import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDir = join(root, "src", "data", "generated");
const skillsOutputPath = join(generatedDir, "skills.generated.ts");
const reportPath = join(root, "data-import-report.md");

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
    prop: "text|links",
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

function parseDetailSkill(html, summary) {
  const name =
    normalizeText(stripTags(extractByClass(html, "rocom_skill_template_skillName"))) ||
    summary.name;
  const attributeText = normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillAttribute"))
  );
  const categoryText = normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillSort"))
  ).replace(/技能分类/g, "");
  const effect = normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillEffect"))
  );
  const describe = normalizeText(
    stripTags(extractByClass(html, "rocom_skill_template_skillDescribe"))
  );
  const category = categoryMap[categoryText.trim()] ?? summary.category;
  const element = attributeText.replace(/系/g, "").trim() || summary.element;
  const power = parsePower(html);
  const isDamageCategory = category === "physical" || category === "magical";
  const description = [effect, describe].filter(Boolean).join(" ");

  return {
    id: createSkillId(name),
    name,
    element,
    category,
    power,
    stableDamage: isDamageCategory && power > 0,
    defaultHitCount: 1,
    defaultPowerBonus: 0,
    defaultPowerBuffMultiplier: 1,
    description: description || undefined,
    notes:
      isDamageCategory && power > 0
        ? "由 BWIKI 导入；条件加成仍需人工确认。"
        : "非确定伤害技能，暂不进入可计算技能候选。",
    sourceUrl: summary.sourceUrl,
    learnableSpiritNames: [],
    learnableSpiritIds: [],
  };
}

function serialize(value) {
  return JSON.stringify(value, null, 2);
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
      const detailHtml = detailPage.text?.["*"] ?? "";
      skills.push(parseDetailSkill(detailHtml, summary));
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

  const uniqueSkills = [...new Map(skills.map((skill) => [skill.id, skill])).values()];
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
      `- 警告数量：${warnings.length}`,
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
