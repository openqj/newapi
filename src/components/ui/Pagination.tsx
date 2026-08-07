import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./Button";
import "./Pagination.css";

export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  ariaLabel?: string;
  className?: string;
};

export function Pagination({
  page,
  pageCount,
  onPageChange,
  ariaLabel = "分页",
  className = "",
}: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <nav className={`ui-pagination ${className}`.trim()} aria-label={ariaLabel}>
      <IconButton
        variant="secondary"
        label="上一页"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        icon={<ChevronLeft size={16} aria-hidden="true" />}
      />
      <span aria-current="page">第 {page} / {pageCount} 页</span>
      <IconButton
        variant="secondary"
        label="下一页"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        icon={<ChevronRight size={16} aria-hidden="true" />}
      />
    </nav>
  );
}
