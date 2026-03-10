/**
 * Format number in Indian notation (lakhs/crores)
 */
export function formatIndianCurrency(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  }
  return `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * Format percentage with 1 decimal
 */
export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Format date as DD-MMM-YYYY
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate().toString().padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}
