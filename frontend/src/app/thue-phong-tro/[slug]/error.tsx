"use client";

import Link from "next/link";

export default function ListingDetailError() {
  return (
    <div role="alert" className="max-w-xl mx-auto px-4 py-12 text-center">
      <h1 className="text-xl font-bold">Không thể tải thông tin phòng</h1>
      <p className="text-gray-600 mt-3">Vui lòng thử lại sau ít phút.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => window.location.reload()} className="button">Thử lại</button>
        <Link href="/thue-phong-tro" className="button button-secondary">Về danh sách</Link>
      </div>
    </div>
  );
}
