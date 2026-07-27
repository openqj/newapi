export function formatCompact(value?: number | null) {
  if (value == null) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatCurrency(value?: number | null) {
  return value == null ? "--" : `$${value.toFixed(4)}`;
}
