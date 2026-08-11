import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { paginationHref } from "../lib/pagination";

export default function Pagination({ basePath, page, pageSize, total, params = {} }) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, total);

  return (
    <div className="pagination" role="navigation" aria-label="Paginação">
      <span>{firstItem}–{lastItem} de {total}</span>
      <div>
        {currentPage > 1 ? <Link href={paginationHref(basePath, params, currentPage - 1)} aria-label="Página anterior"><ChevronLeft size={15} /></Link> : <i><ChevronLeft size={15} /></i>}
        <strong>Página {currentPage} de {totalPages}</strong>
        {currentPage < totalPages ? <Link href={paginationHref(basePath, params, currentPage + 1)} aria-label="Próxima página"><ChevronRight size={15} /></Link> : <i><ChevronRight size={15} /></i>}
      </div>
    </div>
  );
}
