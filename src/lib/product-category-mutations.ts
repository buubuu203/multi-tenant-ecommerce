import { getScopedDb } from './db/tenant-db';
import type { ActionResult } from './action-result';

export async function createProductCategory(
  tenantId: string,
  name: string,
): Promise<ActionResult<{ categoryId: string }>> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: 'Category name is required.' };
  }

  try {
    const category = await getScopedDb(tenantId).productCategory.create({
      data: { tenantId, name: trimmed },
    });
    return { success: true, data: { categoryId: category.id } };
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002') {
      return { success: false, error: 'A category with this name already exists.' };
    }
    console.error('createProductCategory failed:', e);
    return { success: false, error: 'Something went wrong creating the category.' };
  }
}

export async function deleteProductCategory(
  tenantId: string,
  categoryId: string,
): Promise<ActionResult> {
  if (!categoryId.trim()) {
    return { success: false, error: 'Category not found.' };
  }

  try {
    const result = await getScopedDb(tenantId).productCategory.deleteMany({
      where: { id: categoryId, tenantId },
    });
    if (result.count === 0) {
      return { success: false, error: 'Category not found.' };
    }
    return { success: true, data: undefined };
  } catch (e) {
    console.error('deleteProductCategory failed:', e);
    return { success: false, error: 'Something went wrong deleting the category.' };
  }
}

export async function updateProductCategory(
  tenantId: string,
  categoryId: string,
  name: string,
): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: 'Category name is required.' };
  }
  if (!categoryId.trim()) {
    return { success: false, error: 'Category not found.' };
  }

  try {
    const result = await getScopedDb(tenantId).productCategory.updateMany({
      where: { id: categoryId, tenantId },
      data: { name: trimmed },
    });
    if (result.count === 0) {
      return { success: false, error: 'Category not found.' };
    }
    return { success: true, data: undefined };
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002') {
      return { success: false, error: 'A category with this name already exists.' };
    }
    console.error('updateProductCategory failed:', e);
    return { success: false, error: 'Something went wrong updating the category.' };
  }
}
