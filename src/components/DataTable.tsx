import type { ReactNode } from "react";

type DataTableProps = {
  children: ReactNode;
  className?: string;
  scrollClassName?: string;
};

/** Shared shell for full-size data tables. */
export function DataTable({
  children,
  className = "",
  scrollClassName = "",
}: DataTableProps) {
  return (
    <section className={`data-table ${className}`.trim()}>
      <div className={`data-table-scroll ${scrollClassName}`.trim()}>{children}</div>
    </section>
  );
}
