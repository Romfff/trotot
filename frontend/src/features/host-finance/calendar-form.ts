import type { HostCalendar } from "@/lib/api/host-calendar";

export function calendarCells(month: string, days: HostCalendar["days"]) {
  const offset = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => days[index - offset] ?? null);
}
export function calendarRange(days: HostCalendar["days"], start: string, end: string) {
  const [first, last] = [start, end].sort();
  return days.filter(day => day.date >= first && day.date <= last).map(day => day.date);
}
export function calendarPriceError(value: string) {
  return /^\d{1,13}(\.\d{1,2})?$/.test(value) && Number(value) <= 9999999999999.99
    ? "" : "Nhập giá không âm, tối đa 13 chữ số và 2 chữ số thập phân. Máy chủ kiểm tra giá tối thiểu.";
}
export function shiftCalendarMonth(month: string, delta: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
