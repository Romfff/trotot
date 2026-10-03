// Store Vietnamese numbers in the existing national format; preserve other countries.
export function normalizePhone(phone: string): string {
  const compact = phone.trim().replace(/[\s().-]/g, '');
  return compact.replace(/^(?:\+84|0084|84)([1-9]\d{8})$/, '0$1');
}
