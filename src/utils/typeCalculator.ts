import {
  ELEMENTS,
  elementAliases,
  type ElementName,
  typeChart,
} from "../data/typeChart";

const knownElements = new Set<string>(ELEMENTS);

export type TypeMultiplierResult = {
  attackElement: string;
  defenseKey: string;
  multiplier: number;
  found: boolean;
};

export function normalizeElementName(value: string): ElementName | undefined {
  const cleaned = value.trim().replace(/系$/, "");
  const aliased = elementAliases[cleaned] ?? cleaned;

  return knownElements.has(aliased) ? (aliased as ElementName) : undefined;
}

export function createDefenseTypeKey(elements: readonly string[]): string {
  return elements
    .map((element) => normalizeElementName(element) ?? element.trim())
    .filter(Boolean)
    .join("/");
}

export function calculateTypeMultiplier(
  skillElement: string | undefined,
  defenderElements: readonly string[]
): TypeMultiplierResult {
  const attackElement = normalizeElementName(skillElement ?? "");
  const normalizedDefenders = defenderElements
    .map((element) => normalizeElementName(element))
    .filter((element): element is ElementName => Boolean(element));
  const defenseKey = createDefenseTypeKey(defenderElements);

  if (!attackElement || normalizedDefenders.length === 0) {
    return {
      attackElement: skillElement ?? "",
      defenseKey,
      multiplier: 1,
      found: false,
    };
  }

  const normalizedDefenseKey = normalizedDefenders.join("/");
  const multiplier = typeChart[attackElement]?.[normalizedDefenseKey];

  return {
    attackElement,
    defenseKey: normalizedDefenseKey,
    multiplier: multiplier ?? 1,
    found: multiplier !== undefined,
  };
}
