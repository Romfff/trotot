import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

export type EstimatePrices = Record<'monthlyPrice' | 'depositAmount' | 'electricityCost' | 'waterCost' | 'internetCost' | 'garbageCost' | 'parkingFee', Prisma.Decimal | string | number | null> & { waterUnit: 'M3' | 'PERSON' };
export type EstimateUsage = { electricityKwh?: unknown; waterM3?: unknown; occupants?: unknown; vehicles?: unknown };
export type EstimateLimits = Record<keyof EstimateUsage, number>;
export type EstimateCode = 'RENT' | 'ELECTRICITY' | 'WATER' | 'INTERNET' | 'GARBAGE' | 'PARKING';
export type EstimateStatus = 'FIXED' | 'COMPUTED' | 'NEEDS_INPUT' | 'NOT_DECLARED' | 'FREE';
export type EstimateLine = { code: EstimateCode; label: string; unitPrice: string | null; unit: string; quantity: number | null; amount: number | null; status: EstimateStatus };
export const estimateUsageLimits: EstimateLimits = { electricityKwh: 10000, waterM3: 1000, occupants: 20, vehicles: 10 };
const limitEnv = { electricityKwh: 'ESTIMATE_MAX_ELECTRICITY_KWH', waterM3: 'ESTIMATE_MAX_WATER_M3', occupants: 'ESTIMATE_MAX_OCCUPANTS', vehicles: 'ESTIMATE_MAX_VEHICLES' } as const;
export const estimateDisclaimer = 'Ước tính theo mức dùng bạn nhập; hóa đơn thực tế do chủ trọ tính. Tiền cọc không nằm trong tiền tháng.';

export function configuredEstimateLimits(env: NodeJS.ProcessEnv = process.env): EstimateLimits {
  const limits = { ...estimateUsageLimits };
  for (const key of Object.keys(limits) as (keyof EstimateUsage)[]) {
    const value = env[limitEnv[key]];
    if (value === undefined) continue;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error(`Invalid ${limitEnv[key]}`);
    limits[key] = Number(value);
  }
  return limits;
}

// D12: the frontend renders these lines; it must not implement another calculator.
// Parking unit stays explicit; D12 now approves VEHICLE for the public endpoint.
export function calculateLongTermEstimate(prices: EstimatePrices, input: EstimateUsage, parkingUnit: 'VEHICLE' | 'ROOM', limits: EstimateLimits = estimateUsageLimits) {
  const usage: Partial<Record<keyof EstimateUsage, Prisma.Decimal>> = {};
  const errors: string[] = [];
  for (const key of Object.keys(limits) as (keyof EstimateUsage)[]) {
    if ((key === 'waterM3' && prices.waterUnit !== 'M3') || (key === 'occupants' && prices.waterUnit !== 'PERSON')) continue;
    const value = input[key];
    if (value === undefined) continue;
    const integer = key === 'occupants' || key === 'vehicles';
    if (typeof value !== 'string' || value.length > 32 || !(integer ? /^\d+$/ : /^\d+(\.\d)?$/).test(value)) {
      errors.push(`${key} phải là số không âm${integer ? ' nguyên' : ', tối đa một chữ số thập phân'}.`);
      continue;
    }
    const amount = new Prisma.Decimal(value);
    if (amount.gt(limits[key])) errors.push(`${key} không được vượt ${limits[key]}.`);
    else usage[key] = amount;
  }
  // The existing exception filter turns these field-prefixed messages into errors[].
  if (errors.length) throw new BadRequestException({ errorCode: 'INVALID_ESTIMATE_USAGE', message: errors });

  const specs: { code: EstimateCode; label: string; price: keyof Omit<EstimatePrices, 'waterUnit'>; unit: string; usage?: keyof EstimateUsage }[] = [
    { code: 'RENT', label: 'Giá thuê', price: 'monthlyPrice', unit: 'VND/ROOM/MONTH' },
    { code: 'ELECTRICITY', label: 'Điện', price: 'electricityCost', unit: 'VND/KWH', usage: 'electricityKwh' },
    { code: 'WATER', label: 'Nước', price: 'waterCost', unit: prices.waterUnit === 'M3' ? 'VND/M3' : 'VND/PERSON/MONTH', usage: prices.waterUnit === 'M3' ? 'waterM3' : 'occupants' },
    { code: 'INTERNET', label: 'Internet', price: 'internetCost', unit: 'VND/ROOM/MONTH' },
    { code: 'GARBAGE', label: 'Rác', price: 'garbageCost', unit: 'VND/ROOM/MONTH' },
    { code: 'PARKING', label: 'Gửi xe', price: 'parkingFee', unit: parkingUnit === 'VEHICLE' ? 'VND/VEHICLE/MONTH' : 'VND/ROOM/MONTH', ...(parkingUnit === 'VEHICLE' ? { usage: 'vehicles' as const } : {}) },
  ];
  const lines: EstimateLine[] = specs.map(spec => {
    const price = prices[spec.price];
    const quantity = spec.usage ? usage[spec.usage] : new Prisma.Decimal(1);
    const rate = price === null ? null : new Prisma.Decimal(price);
    if (rate && (!rate.isFinite() || rate.isNegative())) throw new Error('Invalid stored estimate price');
    const amount = rate === null || quantity === undefined ? null : rate.mul(quantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    if (amount !== null && !Number.isSafeInteger(amount)) throw new BadRequestException({ errorCode: 'ESTIMATE_AMOUNT_OUT_OF_RANGE', message: ['request mức dùng tạo thành tiền vượt giới hạn số nguyên an toàn.'] });
    const status: EstimateStatus = rate === null ? 'NOT_DECLARED' : quantity === undefined ? 'NEEDS_INPUT' : rate.isZero() ? 'FREE' : spec.usage ? 'COMPUTED' : 'FIXED';
    return { code: spec.code, label: spec.label, unitPrice: rate?.toFixed() ?? null, unit: spec.unit, quantity: quantity?.toNumber() ?? null, amount, status };
  });
  const missingInputs = specs.filter(spec => lines.find(line => line.code === spec.code)?.status === 'NEEDS_INPUT').map(spec => spec.usage!);
  const missingCosts = lines.filter(line => line.status === 'NOT_DECLARED').map(line => line.code);
  const totalMonthly = lines.reduce((sum, line) => sum.plus(line.amount ?? 0), new Prisma.Decimal(0)).toNumber();
  const deposit = prices.depositAmount === null ? null : new Prisma.Decimal(prices.depositAmount).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(totalMonthly) || deposit !== null && (!Number.isSafeInteger(deposit) || deposit < 0)) throw new Error('Estimate totals exceed safe VND response range');
  return {
    lines,
    totalMonthly, deposit,
    missingInputs, missingCosts, isComplete: !missingInputs.length && !missingCosts.length, disclaimer: estimateDisclaimer,
  };
}
