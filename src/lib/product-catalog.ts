type SearchableProduct = {
  name: string;
  descriptionExcerpt: string | null;
  category: string | null;
};

export const STOREFRONT_PAGE_SIZE = 20;

export function filterCatalogProducts<T extends SearchableProduct>(
  products: readonly T[],
  query: string,
  category: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return products.filter((product) => {
    if (category && product.category !== category) return false;
    if (!normalizedQuery) return true;

    return [product.name, product.descriptionExcerpt ?? '', product.category ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}

export function paginateCatalogProducts<T>(
  products: readonly T[],
  page: number,
  pageSize: number,
): {
  items: T[];
  page: number;
  totalPages: number;
  totalCount: number;
  start: number;
  end: number;
} {
  const totalCount = products.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.max(1, Math.min(Math.floor(page) || 1, totalPages));

  return {
    items: products.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    page: currentPage,
    totalPages,
    totalCount,
    start: totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1,
    end: Math.min(currentPage * pageSize, totalCount),
  };
}
