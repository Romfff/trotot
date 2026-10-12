"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listingsApi } from "@/lib/api/listings";
import { decimalPriceLabel } from "@/lib/decimal-price-label";
import { Calculator } from "lucide-react";
import "./stitch-detail.css";
import type { CostEstimateDto, CostEstimateLineDto } from "@/lib/api/appointment-types.generated";

const money = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)} đ`;
const units: Record<CostEstimateLineDto["unit"], string> = {
  "VND/ROOM/MONTH": "phòng/tháng", "VND/KWH": "kWh", "VND/M3": "m³",
  "VND/PERSON/MONTH": "người/tháng", "VND/VEHICLE/MONTH": "xe/tháng",
};

export function EstimateRows({ estimate }: { estimate: CostEstimateDto }) {
  return <>
    <dl className="space-y-4 text-sm">
      {estimate.lines.map(line => <div key={line.code} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
        <dt className="min-w-0 text-gray-600">
          {line.label}
          {line.unitPrice !== null && <span className="mt-1 block text-xs break-words">
            {decimalPriceLabel(line.unitPrice)} đ/{units[line.unit]}
            {line.quantity !== null && line.status !== "FIXED" && line.code !== "INTERNET" && line.code !== "GARBAGE"
              ? ` × ${new Intl.NumberFormat("vi-VN").format(line.quantity)}` : ""}
          </span>}
        </dt>
        <dd className="font-medium tabular-nums break-words">
          {line.status === "NOT_DECLARED" ? "Chưa kê khai" : line.status === "NEEDS_INPUT" ? "Chưa nhập" : line.amount === null ? "Chưa tính được" : line.status === "FREE"
            ? <><span className="block">Miễn phí / đã gồm trong giá thuê</span><span className="block">{money(line.amount)}</span></> : money(line.amount)}
        </dd>
      </div>)}
    </dl>
    <div className="mt-5 bg-brand-tint border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Tổng tháng ước tính</p>
        <p data-testid="cost-estimate-total" className="text-xl font-bold text-brand tabular-nums">{money(estimate.totalMonthly)}</p>
      </div>
      {!estimate.isComplete && <p className="mt-2 text-sm text-gray-600 text-pretty">
        {estimate.missingInputs.length > 0 && <>Chưa gồm các khoản chưa nhập mức dùng. </>}
        {estimate.missingInputs.includes("electricityKwh") && <>Chưa gồm điện vì chưa nhập mức dùng. </>}
        {estimate.missingInputs.some(field => field === "waterM3" || field === "occupants") && <>Chưa gồm nước vì chưa nhập mức dùng. </>}
        {estimate.missingCosts.length > 0 && <>Các khoản chủ trọ chưa kê khai không nằm trong tổng.</>}
      </p>}
      <p className="mt-3 text-sm text-gray-600">Tiền cọc (riêng): <span className="font-medium text-ink tabular-nums">{estimate.deposit === null ? "Chưa kê khai" : money(estimate.deposit)}</span></p>
      <p className="mt-3 text-xs text-gray-600 text-pretty">{estimate.disclaimer}</p>
    </div>
  </>;
}

export function CostEstimate({ slug, waterUnit }: { slug: string; waterUnit: "M3" | "PERSON" }) {
  const [usage, setUsage] = useState({ electricityKwh: "", waterM3: "", occupants: "", vehicles: "" });
  const [result, setResult] = useState<{ estimate: CostEstimateDto; requestKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify({ slug, usage });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const estimate = await listingsApi.costEstimate(slug, usage, controller.signal);
        if (active) setResult({ estimate, requestKey });
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Không tải được bảng ước tính. Vui lòng thử lại.");
      } finally {
        if (active) setLoading(false);
      }
    }, 400);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [slug, usage, requestKey, retry]);

  const pending = loading || Boolean(result && result.requestKey !== requestKey && !error);
  function change(field: keyof typeof usage, value: string) {
    setUsage(previous => ({ ...previous, [field]: value }));
    setLoading(true);
    setError(null);
  }

  return <section aria-labelledby="cost-estimate-heading" className="relative bg-white border border-gray-200 rounded-xl p-5 overflow-hidden shadow-sm">
    {pending && result && <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-brand motion-safe:animate-pulse" />}
    <h2 id="cost-estimate-heading" className="text-[20px] leading-7 font-bold text-ink mb-2 flex items-start gap-2"><Calculator size={22} className="text-brand shrink-0 mt-0.5" aria-hidden="true" />Ước tính chi phí mỗi tháng</h2>
    <p className="mb-4 text-sm text-gray-600 text-pretty">Nhập mức dùng dự kiến của bạn. Có thể để trống; khoản chưa nhập sẽ không được cộng vào tổng.</p>
    <div className="grid gap-4 sm:grid-cols-2 mb-6 p-4 bg-bg border border-gray-200 rounded-lg">
      <Input id="estimate-electricity" label="Điện (kWh/tháng)" type="number" inputMode="decimal" min="0" step="0.1"
        value={usage.electricityKwh} onChange={event => change("electricityKwh", event.target.value)} className="text-base md:text-sm" />
      {waterUnit === "M3" ? <Input id="estimate-water" label="Nước (m³/tháng)" type="number" inputMode="decimal" min="0" step="0.1"
        value={usage.waterM3} onChange={event => change("waterM3", event.target.value)} className="text-base md:text-sm" />
        : <Input id="estimate-occupants" label="Số người" type="number" inputMode="numeric" min="0" step="1"
          value={usage.occupants} onChange={event => change("occupants", event.target.value)} className="text-base md:text-sm" />}
      <Input id="estimate-vehicles" label="Số xe gửi" type="number" inputMode="numeric" min="0" step="1"
        value={usage.vehicles} onChange={event => change("vehicles", event.target.value)} className="text-base md:text-sm" />
    </div>
    <div aria-busy={pending}>
      {result ? <EstimateRows estimate={result.estimate} /> : !error && <div className="min-h-64 space-y-5" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="flex justify-between gap-4">
          <div className="h-3 w-1/3 rounded bg-gray-100 animate-pulse motion-reduce:animate-none" /><div className="h-3 w-1/4 rounded bg-gray-100 animate-pulse motion-reduce:animate-none" />
        </div>)}
      </div>}
    </div>
    {pending && <p role="status" className="mt-3 text-xs text-gray-600">Đang cập nhật ước tính{result ? "; kết quả bên trên thuộc mức dùng trước đó" : ""}.</p>}
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
      <p className="text-red-700">{error}</p>
      {result && <p className="mt-2 text-ink">Kết quả đang hiển thị là lần tính trước, chưa áp dụng mức dùng mới.</p>}
      <Button variant="secondary" type="button" className="mt-3" onClick={() => { setLoading(true); setError(null); setRetry(value => value + 1); }}>Thử lại</Button>
    </div>}
  </section>;
}
