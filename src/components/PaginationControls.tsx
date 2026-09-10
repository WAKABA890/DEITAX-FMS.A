import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const INVENTORY_PAGE_SIZE = 10;

export const getTotalPages = (itemCount: number, pageSize = INVENTORY_PAGE_SIZE) =>
  Math.max(1, Math.ceil(itemCount / pageSize));

export const getPageSlice = <T,>(items: T[], currentPage: number, pageSize = INVENTORY_PAGE_SIZE) => {
  const startIndex = (currentPage - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
};

export function usePagination<T>(items: T[], resetKey: string, pageSize = INVENTORY_PAGE_SIZE) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = getTotalPages(items.length, pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    pageItems: getPageSlice(items, currentPage, pageSize),
  };
}

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  itemCount: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  itemCount,
  pageSize = INVENTORY_PAGE_SIZE,
  onPageChange,
}) => {
  if (itemCount <= pageSize) return null;

  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, itemCount);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
      <span className="font-mono text-slate-400">
        Showing {firstItem}-{lastItem} of {itemCount}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </button>
        <span className="min-w-20 text-center font-mono text-slate-300">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
