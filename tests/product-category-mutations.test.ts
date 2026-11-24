import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import {
  createProductCategory,
  deleteProductCategory,
  updateProductCategory,
} from '../src/lib/product-category-mutations';
import { createProduct, updateProduct } from '../src/lib/product-mutations';

let tenantId = '';
let suffix: string;

before(async () => {
  suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({
    data: { slug: `test-category-${suffix}`, name: `Category ${suffix}`, status: 'active' },
  });
  tenantId = tenant.id;
  await prisma.location.create({
    data: { tenantId, name: 'Main', isDefault: true },
  });
});

after(async () => {
  const cleanupTenantId = tenantId;
  if (!cleanupTenantId) return;
  await prisma.inventory.deleteMany({ where: { tenantId: cleanupTenantId } });
  await prisma.productVariant.deleteMany({ where: { tenantId: cleanupTenantId } });
  await prisma.product.deleteMany({ where: { tenantId: cleanupTenantId } });
  await prisma.productCategory.deleteMany({ where: { tenantId: cleanupTenantId } });
  await prisma.location.deleteMany({ where: { tenantId: cleanupTenantId } });
  await prisma.tenant.deleteMany({ where: { id: cleanupTenantId } });
});

test('categories are tenant-scoped, assignable, removable, and unassign products on deletion', async () => {
  const createdCategory = await createProductCategory(tenantId, '  Furniture  ');
  assert.ok(createdCategory.success, createdCategory.success ? '' : createdCategory.error);
  if (!createdCategory.success) return;

  const duplicate = await createProductCategory(tenantId, 'Furniture');
  assert.ok(!duplicate.success);
  if (duplicate.success) return;

  const createdProduct = await createProduct(tenantId, {
    name: `Chair ${suffix}`,
    price: '1000',
    weightGrams: '100',
    status: 'active',
    categoryId: createdCategory.data.categoryId,
  });
  assert.ok(createdProduct.success, createdProduct.success ? '' : createdProduct.error);
  if (!createdProduct.success) return;

  const assignedProduct = await prisma.product.findUnique({
    where: { id: createdProduct.data.productId },
    include: { category: true },
  });
  assert.equal(assignedProduct?.category?.name, 'Furniture');

  const renamedCategory = await updateProductCategory(
    tenantId,
    createdCategory.data.categoryId,
    'Homeware',
  );
  assert.ok(renamedCategory.success, renamedCategory.success ? '' : renamedCategory.error);
  const renamedProduct = await prisma.product.findUnique({
    where: { id: createdProduct.data.productId },
    include: { category: true },
  });
  assert.equal(renamedProduct?.category?.name, 'Homeware');

  const updated = await updateProduct(tenantId, createdProduct.data.productId, {
    name: `Chair ${suffix}`,
    price: '1000',
    weightGrams: '100',
    status: 'active',
    categoryId: 'missing-category',
  });
  assert.ok(!updated.success);

  const deletedCategory = await deleteProductCategory(tenantId, createdCategory.data.categoryId);
  assert.ok(deletedCategory.success, deletedCategory.success ? '' : deletedCategory.error);

  const uncategorizedProduct = await prisma.product.findUnique({
    where: { id: createdProduct.data.productId },
    select: { categoryId: true },
  });
  assert.equal(uncategorizedProduct?.categoryId, null);
});
