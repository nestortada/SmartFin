import type { ISODateString } from '../../../shared/types';

export type Subcategory = {
  id: string;
  categoryId: string;
  name: string;
  color?: string;
  isActive: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
