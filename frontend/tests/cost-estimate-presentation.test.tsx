import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CostEstimate, EstimateRows } from "../src/components/listing/CostEstimate";
import type { CostEstimateDto } from "../src/lib/api/appointment-types.generated";

const estimate: CostEstimateDto = {
  lines: [
    { code: "RENT", label: "Tiền thuê", unitPrice: "1000.50", unit: "VND/ROOM/MONTH", quantity: 1, amount: 1001, status: "FIXED" },
    { code: "ELECTRICITY", label: "Điện", unitPrice: "3500.50", unit: "VND/KWH", quantity: 1.1, amount: 3851, status: "COMPUTED" },
    { code: "WATER", label: "Nước", unitPrice: null, unit: "VND/M3", quantity: null, amount: null, status: "NOT_DECLARED" },
    { code: "PARKING", label: "Gửi xe", unitPrice: "0", unit: "VND/VEHICLE/MONTH", quantity: null, amount: null, status: "NEEDS_INPUT" },
  ], totalMonthly: 4852, deposit: 999, missingInputs: ["vehicles"], missingCosts: ["WATER"], isComplete: false, disclaimer: "Hóa đơn thực tế do chủ trọ tính.",
};

describe("cost estimate display only", () => {
  it("renders exact rates, server amounts and server total; does not include deposit in total", () => {
    const html = renderToStaticMarkup(<EstimateRows estimate={estimate} />);
    expect(html).toContain("3.500,5 đ/kWh"); expect(html).not.toContain("3.500,50");
    expect(html).toContain("1,1"); expect(html).toContain("3.851 đ"); expect(html).toContain("4.852 đ"); expect(html).toContain("999 đ");
    expect(html).toContain("Chưa nhập"); expect(html).toContain("Chưa kê khai"); expect(html).toContain(estimate.disclaimer);
  });
  it("uses the server total rather than recomputing a fallback in the browser", () => {
    expect(renderToStaticMarkup(<EstimateRows estimate={{ ...estimate, totalMonthly: 123 }} />)).toContain('data-testid="cost-estimate-total" class="text-xl font-bold text-brand tabular-nums">123 đ');
  });
  it.each(["M3", "PERSON"] as const)("leaves usage empty and shows only the applicable water control for %s", waterUnit => {
    const html = renderToStaticMarkup(<CostEstimate slug="fixture" waterUnit={waterUnit} />);
    expect(html.match(/value=""/g)).toHaveLength(3); expect(html).toContain('step="0.1"');
    expect(html).toContain(waterUnit === "M3" ? "Nước (m³/tháng)" : "Số người");
    expect(html).not.toContain(waterUnit === "M3" ? "Số người" : "Nước (m³/tháng)");
    expect(html).not.toContain("Chưa kê khai"); expect(html).toContain("Đang cập nhật");
  });
  it("zero/free stays a known amount, distinct from missing input", () => {
    const html = renderToStaticMarkup(<EstimateRows estimate={{ ...estimate, lines: [{ ...estimate.lines[3], status: "FREE", quantity: 0, amount: 0 }], isComplete: true, missingInputs: [], missingCosts: [] }} />);
    expect(html).toContain("0 đ"); expect(html).not.toContain("Chưa nhập"); expect(html).not.toContain("Chưa gồm");
    expect(html).toContain("Miễn phí / đã gồm trong giá thuê");
  });
  it("identifies exactly which utility has no usage instead of implying both are absent", () => {
    const html = renderToStaticMarkup(<EstimateRows estimate={{ ...estimate, missingInputs: ["electricityKwh"] }} />);
    expect(html).toContain("Chưa gồm điện vì chưa nhập mức dùng.");
    expect(html).not.toContain("Chưa gồm nước vì chưa nhập mức dùng.");
  });
});
