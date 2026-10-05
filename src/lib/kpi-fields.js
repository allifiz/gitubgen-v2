export function ticketType(title = '') {
  const withoutPrefix = String(title).replace(/^\s*\[[^\]]+\]\s*/i, '');
  return withoutPrefix.match(/^(FEAT|FIX|BUGS?|ENHANCE|REFACTOR|CHORE)\s*:/i)?.[1]?.toUpperCase() || '';
}

export function systemType(title = '') {
  const value = String(title).match(/^\s*\[([^\]]+)\]/)?.[1]?.toUpperCase() || '';
  if (value.startsWith('SUPERAPPS')) return 'SUPERAPPS';
  if (value.startsWith('GOEXPERT')) return 'GOEXPERT';
  if (value.startsWith('RESET_GOA')) return 'RESET_GOA';
  return value.split('-')[0] || '';
}

export function weekOfMonth(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return '';
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const mondayOffset = (firstDay + 6) % 7;
  return `Minggu ${Math.floor((day + mondayOffset - 1) / 7) + 1}`;
}
