import type { ReactNode } from "react";

type ManagementTableProps = {
  children: ReactNode;
  toolbar?: ReactNode;
  className?: string;
};

type TableBulkActionsProps = {
  summary: ReactNode;
  children: ReactNode;
};

export function ManagementTable({
  children,
  toolbar,
  className = "",
}: ManagementTableProps) {
  return (
    <section className={`management-table ${className}`.trim()}>
      {toolbar && <div className="management-table-toolbar">{toolbar}</div>}
      <div className="management-table-scroll">{children}</div>
    </section>
  );
}

export function TableBulkActions({
  summary,
  children,
}: TableBulkActionsProps) {
  return (
    <div className="table-bulk-actions">
      <span>{summary}</span>
      {children}
    </div>
  );
}
