import type { ReactNode } from "react";

type DataTableProps = {
  /** Backwards-compatible desktop table content. Prefer `desktop` for new pages. */
  children?: ReactNode;
  className?: string;
  scrollClassName?: string;
  /** Content above the scrollable desktop table, such as a result count or bulk actions. */
  header?: ReactNode;
  /** Explicit desktop table slot. It takes precedence over `children`. */
  desktop?: ReactNode;
  /** Optional card/list representation shown by the page's responsive CSS. */
  mobile?: ReactNode;
  /** Standard empty state for views that do not need to keep table headers visible. */
  empty?: ReactNode;
  isEmpty?: boolean;
  /** Content below the table, typically pagination. */
  footer?: ReactNode;
  /** Accessible label for the table region when the surrounding page has no heading. */
  ariaLabel?: string;
};

type TableBulkActionsProps = {
  summary?: ReactNode;
  children: ReactNode;
};

/** Shared shell for full-size data tables. */
export function DataTable({
  children,
  className = "",
  scrollClassName = "",
  header,
  desktop,
  mobile,
  empty,
  isEmpty = false,
  footer,
  ariaLabel,
}: DataTableProps) {
  return (
    <section className={`data-table ${className}`.trim()} aria-label={ariaLabel}>
      {header && <div className="data-table-header">{header}</div>}
      <div className={`data-table-scroll ${scrollClassName}`.trim()}>{isEmpty ? empty : desktop ?? children}</div>
      {!isEmpty && mobile}
      {footer && <div className="data-table-footer">{footer}</div>}
    </section>
  );
}

export function TableBulkActions({
  summary,
  children,
}: TableBulkActionsProps) {
  return (
    <div className="table-bulk-actions">
      {summary != null && <span>{summary}</span>}
      {children}
    </div>
  );
}
