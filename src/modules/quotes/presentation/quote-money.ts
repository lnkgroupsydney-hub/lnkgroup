/** Customer Quote amount display: A$2,200 for whole dollars, A$2,200.50 when cents exist. */
export function formatQuoteAmount(cents: number) {
  const fractionDigits = cents % 100 ? 2 : 0;
  return `A$${new Intl.NumberFormat('en-AU', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(cents / 100)}`;
}
