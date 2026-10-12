import Link from "next/link";

export function ListingTypeNavigation({ active }: { active: "long-term" | "homestay" }) {
  return <nav aria-label="Chọn loại tin đăng" className="grid grid-cols-2 gap-3">
    <Link href="/host/properties/create" aria-current={active === "long-term" ? "page" : undefined}
      className={`button text-center ${active === "long-term" ? "" : "button-secondary"}`}>Trọ dài hạn</Link>
    <Link href="/host/homestays/create" aria-current={active === "homestay" ? "page" : undefined}
      className={`button text-center ${active === "homestay" ? "" : "button-secondary"}`}>Homestay / Villa</Link>
  </nav>;
}
