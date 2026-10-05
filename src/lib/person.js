const CANONICAL = new Map([
  ['allif', 'allief'],
  ['allief', 'allief'],
  ['hizkia', 'hizkia'],
  ['maulana', 'maulana'],
  ['dwiki', 'dwiki'],
  ['dwiky', 'dwiki']
]);

export function normalizePerson(value = '') {
  const cleaned = String(value)
    .toLowerCase()
    .replace(/gobimbel/g, '')
    .replace(/[^a-z]/g, '');
  return CANONICAL.get(cleaned) || cleaned;
}
