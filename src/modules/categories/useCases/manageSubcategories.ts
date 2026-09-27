import type { Subcategory } from '../types';
import type { SubcategoryRepository } from '../repositories';

export type SubcategoryInput = {
  categoryId: string;
  color?: string;
  name: string;
};

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function buildId(input: SubcategoryInput): string {
  const slug = `${input.categoryId}-${normalizeName(input.name)}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `subcategory-${slug || Date.now()}-${Date.now().toString(36)}`;
}

async function assertInput(
  repository: SubcategoryRepository,
  input: SubcategoryInput,
  currentId?: string,
): Promise<void> {
  if (!input.categoryId.trim() || !normalizeName(input.name)) {
    throw new Error('La categoria padre y el nombre de la subcategoria son obligatorios.');
  }
  const duplicate = (await repository.getSubcategories(true)).some(candidate =>
    candidate.id !== currentId &&
    candidate.categoryId === input.categoryId &&
    candidate.name.toLocaleLowerCase() === normalizeName(input.name).toLocaleLowerCase(),
  );
  if (duplicate) {
    throw new Error('Ya existe una subcategoria con ese nombre en la categoria seleccionada.');
  }
}

export async function createSubcategory(
  repository: SubcategoryRepository,
  input: SubcategoryInput,
): Promise<Subcategory> {
  await assertInput(repository, input);
  const now = new Date().toISOString();
  const subcategory: Subcategory = {
    id: buildId(input),
    categoryId: input.categoryId,
    color: input.color?.trim() || undefined,
    name: normalizeName(input.name),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await repository.saveSubcategories([subcategory]);
  return subcategory;
}

export async function updateSubcategory(
  repository: SubcategoryRepository,
  id: string,
  input: SubcategoryInput,
): Promise<Subcategory> {
  await assertInput(repository, input, id);
  const current = (await repository.getSubcategories(true)).find(candidate => candidate.id === id);
  if (!current) {
    throw new Error('No se encontro la subcategoria para modificar.');
  }
  const updated: Subcategory = {
    ...current,
    categoryId: input.categoryId,
    color: input.color?.trim() || undefined,
    name: normalizeName(input.name),
    isActive: true,
    updatedAt: new Date().toISOString(),
  };
  await repository.saveSubcategories([updated]);
  return updated;
}

export async function deactivateSubcategory(
  repository: SubcategoryRepository,
  id: string,
): Promise<void> {
  const current = (await repository.getSubcategories(true)).find(candidate => candidate.id === id);
  if (!current) {
    throw new Error('No se encontro la subcategoria para desactivar.');
  }
  await repository.saveSubcategories([{
    ...current,
    isActive: false,
    updatedAt: new Date().toISOString(),
  }]);
}
