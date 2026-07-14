/**
 * Formats a number as Indian Rupee (INR) currency with correct lakh/crore grouping.
 * @param {number} amount - The amount to format.
 * @returns {string} The formatted currency string (e.g., ₹1,25,000.00).
 */
export function formatINR(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
}
