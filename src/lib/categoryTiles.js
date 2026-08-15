// Maps this project's existing product.category values (Grains, Pulses,
// Vegetables, Oil, Grocery, Spices — set in schema.sql's seed data) onto the
// 4 category tiles described in the Hotel↔APMC redesign doc (Dry Items,
// Spices, Oil & Ghee, Vegetables), so the Hotel ordering screen can group by
// them without a schema change.
export const CATEGORY_TILES = ['Dry Items', 'Spices', 'Oil & Ghee', 'Vegetables']

const CATEGORY_MAP = {
  Grains: 'Dry Items',
  Pulses: 'Dry Items',
  Grocery: 'Dry Items',
  Spices: 'Spices',
  Oil: 'Oil & Ghee',
  Vegetables: 'Vegetables'
}

export function categoryTileFor(productCategory) {
  return CATEGORY_MAP[productCategory] || 'Dry Items'
}
