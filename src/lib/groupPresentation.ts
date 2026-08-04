export type GroupPresentationSource = {
  name: string;
  description?: string | null;
};

export type GroupPresentation = {
  name: string;
  description?: string;
};

const trailingParenthetical = /^(.*?)[\s\u3000]*[\(\uFF08]([^()\uFF08\uFF09]+)[\)\uFF09]\s*$/u;
const bracketPrefix = /^(\s*(?:\u3010[^\u3011]+\u3011|\[[^\]]+\]))\s*(.+)$/u;

/**
 * Uses a server description when available and keeps a useful fallback for
 * relays that encode the subtitle in the group name itself.
 */
export function presentGroup(source: GroupPresentationSource): GroupPresentation {
  const description = source.description?.trim();
  if (description) return { name: source.name, description };

  const name = source.name.trim();
  const parenthetical = name.match(trailingParenthetical);
  if (parenthetical?.[1].trim() && parenthetical[2].trim()) {
    return { name: parenthetical[1].trim(), description: parenthetical[2].trim() };
  }

  const prefixed = name.match(bracketPrefix);
  if (prefixed?.[2].trim()) {
    return { name: prefixed[1].trim(), description: prefixed[2].trim() };
  }

  return { name: source.name, description: undefined };
}
