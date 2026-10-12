// Display only; never calculate an estimate in the browser. BigInt grouping keeps
// exact Decimal unit-price strings, including rates above floating-point precision.
export function decimalPriceLabel(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Invalid Decimal price string");
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return new Intl.NumberFormat("vi-VN").format(BigInt(whole)) + (trimmed ? `,${trimmed}` : "");
}
