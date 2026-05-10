import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const sourcePath = join(root, "documentory", "精灵种族值.xlsx");
const spiritsOutputPath = join(
  root,
  "src",
  "data",
  "generated",
  "spirits.generated.ts"
);
const buildsOutputPath = join(
  root,
  "src",
  "data",
  "generated",
  "builds.generated.ts"
);
const sourceUrl = "documentory/精灵种族值.xlsx";

const statKeys = ["hp", "atk", "spa", "def", "spd", "spe"];

function runPowerShellExtractor(filePath) {
  const script = String.raw`
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = $env:ROCO_SPIRIT_STATS_XLSX
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
function ReadEntry($name) {
  $entry = $zip.GetEntry($name)
  if ($null -eq $entry) { throw "Missing XLSX entry: $name" }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}
try {
  [xml]$shared = ReadEntry 'xl/sharedStrings.xml'
  $sharedNs = [System.Xml.XmlNamespaceManager]::new($shared.NameTable)
  $sharedNs.AddNamespace('m','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $strings = @()
  foreach ($si in $shared.SelectNodes('//m:si', $sharedNs)) {
    $parts = @()
    foreach ($text in $si.SelectNodes('.//m:t', $sharedNs)) {
      $parts += $text.'#text'
    }
    $strings += ($parts -join '')
  }

  [xml]$sheet = ReadEntry 'xl/worksheets/sheet1.xml'
  $sheetNs = [System.Xml.XmlNamespaceManager]::new($sheet.NameTable)
  $sheetNs.AddNamespace('m','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $rows = @()
  foreach ($row in $sheet.SelectNodes('//m:sheetData/m:row', $sheetNs)) {
    if ([int]$row.r -lt 3) { continue }
    $cells = [ordered]@{ row = [int]$row.r }
    foreach ($cell in $row.SelectNodes('./m:c', $sheetNs)) {
      $column = $cell.r -replace '\d',''
      $valueNode = $cell.SelectSingleNode('./m:v', $sheetNs)
      if ($null -eq $valueNode) {
        $value = ''
      } elseif ($cell.t -eq 's') {
        $value = $strings[[int]$valueNode.InnerText]
      } else {
        $value = $valueNode.InnerText
      }
      $cells[$column] = $value
    }
    if ($cells['A']) {
      $rows += [pscustomobject]$cells
    }
  }
  $rows | ConvertTo-Json -Depth 5 -Compress
} finally {
  $zip.Dispose()
}
`;

  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ROCO_SPIRIT_STATS_XLSX: filePath,
      },
      maxBuffer: 1024 * 1024 * 20,
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "PowerShell XLSX 读取失败");
  }

  return JSON.parse(result.stdout);
}

function toNumber(value, row, label) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`第 ${row} 行 ${label} 不是有效数字：${value}`);
  }

  return number;
}

function normalizeDexNo(value) {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);

  if (Number.isFinite(numeric)) {
    return String(numeric);
  }

  return raw;
}

function createSpiritId(dexNo, row) {
  const normalizedDexNo = dexNo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `spirit_${normalizedDexNo || "unknown"}_${row}`;
}

function splitElements(firstElement, secondElement) {
  return [firstElement, secondElement]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function recommendIndividualKeys(baseStats) {
  const attackKey = baseStats.atk >= baseStats.spa ? "atk" : "spa";
  return ["hp", attackKey, "spe"];
}

function serialize(value) {
  return JSON.stringify(value, null, 2);
}

function buildSpirits(rows) {
  return rows.map((row) => {
    const dexNo = normalizeDexNo(row.B);
    const elements = splitElements(row.C, row.D);

    if (elements.length === 0 || elements.length > 2) {
      throw new Error(`第 ${row.row} 行属性数量异常：${serialize(elements)}`);
    }

    return {
      id: createSpiritId(dexNo, row.row),
      name: String(row.A).trim(),
      elements,
      dexNo,
      sourceUrl,
      commonSkillIds: [],
      baseStats: {
        hp: toNumber(row.E, row.row, "生命"),
        atk: toNumber(row.G, row.row, "物攻"),
        spa: toNumber(row.H, row.row, "魔攻"),
        def: toNumber(row.I, row.row, "物防"),
        spd: toNumber(row.J, row.row, "魔防"),
        spe: toNumber(row.F, row.row, "速度"),
      },
    };
  });
}

function buildRecommendedIndividualKeys(spirits) {
  return Object.fromEntries(
    spirits.map((spirit) => [
      spirit.id,
      recommendIndividualKeys(spirit.baseStats),
    ])
  );
}

function buildSpiritsSource(spirits) {
  return [
    'import type { Spirit } from "../../types/battle";',
    "",
    `export const generatedSpirits = ${serialize(spirits)} satisfies Spirit[];`,
    "",
  ].join("\n");
}

function buildBuildsSource(recommendedIndividualKeys) {
  return [
    'import type { CommonBuild, StatKey } from "../../types/battle";',
    "",
    `export const generatedRecommendedIndividualKeys = ${serialize(
      recommendedIndividualKeys
    )} satisfies Record<string, StatKey[]>;`,
    "",
    "export const generatedBuilds = [] satisfies CommonBuild[];",
    "",
  ].join("\n");
}

async function main() {
  const rows = runPowerShellExtractor(sourcePath);
  const normalizedRows = Array.isArray(rows) ? rows : [rows];
  const spirits = buildSpirits(normalizedRows);
  const recommendedIndividualKeys = buildRecommendedIndividualKeys(spirits);

  await writeFile(spiritsOutputPath, buildSpiritsSource(spirits), "utf8");
  await writeFile(
    buildsOutputPath,
    buildBuildsSource(recommendedIndividualKeys),
    "utf8"
  );

  console.log(`已从 Excel 导入 ${spirits.length} 条精灵种族值`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
