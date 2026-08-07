import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./ui/Button";
import { SelectField } from "./ui/Primitives";
import "./TablePagination.css";

export type TablePaginationProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function TablePagination({ page, pageCount, pageSize, total, onPageChange, onPageSizeChange }: TablePaginationProps) {
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return <footer className="ui-table-pagination">
    <div className="ui-table-pagination-summary">显示 {from} 至 {to} 共 {total} 条结果 <label>每页:<SelectField aria-label="每页" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></SelectField></label></div>
    <nav aria-label="分页"><IconButton variant="ghost" label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)} icon={<ChevronLeft size={16} />} /><span aria-current="page">{page}</span><IconButton variant="ghost" label="下一页" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} icon={<ChevronRight size={16} />} /></nav>
  </footer>;
}
