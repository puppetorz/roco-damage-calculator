import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const LCX_INDEX_URL = "https://wiki.lcx.cab/lk/index.php";
const BWIKI_HOME_URL =
  "https://wiki.biligame.com/rocom/%E9%A6%96%E9%A1%B5";
const reportPath = join(process.cwd(), "data-import-report.md");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} 退出码 ${code}`));
      }
    });
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "roco-damage-calculator-data-import/0.1 (+local static data generator)",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} 返回 HTTP ${response.status}`);
  }

  return response.text();
}

function discoverCandidateLinks(html, baseUrl) {
  const links = new Set();
  const linkPattern = /(?:href|src)=["']([^"']+)["']/gi;
  let match = linkPattern.exec(html);

  while (match) {
    const value = match[1];
    const lower = value.toLowerCase();

    if (
      lower.includes("pet") ||
      lower.includes("spirit") ||
      lower.includes("skill") ||
      lower.includes("move") ||
      value.includes("精灵") ||
      value.includes("技能")
    ) {
      links.add(new URL(value, baseUrl).toString());
    }

    match = linkPattern.exec(html);
  }

  return [...links];
}

async function main() {
  const now = new Date().toISOString();
  const reportLines = [
    "# 数据导入/校验报告",
    "",
    `- 时间：${now}`,
    `- 主来源：${LCX_INDEX_URL}`,
    `- 兜底来源：${BWIKI_HOME_URL}`,
    "",
  ];

  try {
    const html = await fetchText(LCX_INDEX_URL);
    const candidates = discoverCandidateLinks(html, LCX_INDEX_URL);

    reportLines.push("## lcx 页面探测");
    reportLines.push(`- 首页 HTML 长度：${html.length}`);
    reportLines.push(`- 候选资源数量：${candidates.length}`);

    if (candidates.length > 0) {
      reportLines.push(
        ...candidates.slice(0, 20).map((candidate) => `- ${candidate}`)
      );
    }

    reportLines.push("");
    reportLines.push("## 导入状态");
    reportLines.push(
      "- 已完成资料源探测，但当前脚本还没有确认稳定的精灵/技能结构化接口。"
    );
    reportLines.push(
      "- 为避免写入错误图鉴数据，本次没有覆盖 src/data/generated 下的静态数据。"
    );
    reportLines.push(
      "- 下一步：根据候选资源补充 parser 后，再生成 spirits.generated.ts 与 skills.generated.ts。"
    );

    await writeFile(reportPath, reportLines.join("\n"), "utf8");
    await run("node", ["scripts/validateData.mjs"]);
    console.log(`资料源探测完成，详见 ${reportPath}`);
  } catch (error) {
    reportLines.push("## 导入状态");
    reportLines.push("- 网络访问或资料源解析失败。");
    reportLines.push(
      `- 错误：${error instanceof Error ? error.message : String(error)}`
    );
    reportLines.push(
      "- 已保留现有生成数据，未覆盖 src/data/generated 下的任何文件。"
    );

    await writeFile(reportPath, reportLines.join("\n"), "utf8");
    console.error(`导入失败，详见 ${reportPath}`);
    process.exit(1);
  }
}

main();
