import { expect, it } from "vitest";
import { decimalPriceLabel } from "@/lib/decimal-price-label";

it.each([["3500.5", "3.500,5"], ["3500.50", "3.500,5"], ["3500.00", "3.500"], ["0.49", "0,49"], ["0.5", "0,5"], ["0.51", "0,51"], ["9999999999999.99", "9.999.999.999.999,99"], ["0", "0"]])("renders exact Decimal %s without trailing zeros or Number coercion", (value, label) => {
  expect(decimalPriceLabel(value)).toBe(label);
});
it.each(["", "NaN", "-1", "1e3", "1,5", "<script>"])("rejects invalid non-Decimal label %s", value => {
  expect(() => decimalPriceLabel(value)).toThrow();
});
