import { describe, it, expect } from "vitest";
import { formatVND } from "@/components/RoomCard";
import type { PublicListingItem } from "@/types/listing";

describe("RoomCard helpers & DTO compatibility", () => {
  it("formatVND định dạng đúng tiền tệ Việt Nam", () => {
    expect(formatVND(3500000)).toMatch(/3\.500\.000\s*đ/);
    expect(formatVND(0)).toMatch(/0\s*đ/);
  });

  it("PublicListingItem có đầy đủ các trường yêu cầu từ backend DTO", () => {
    const mockItem: PublicListingItem = {
      id: "b18b456e-8ff4-4f24-9b21-4f16bfa09e71",
      slug: "cho-thue-phong-tro-gac-lung-bk",
      title: "Cho thuê phòng trọ gác lửng",
      description: "Mô tả phòng",
      videoUrl: null,
      propertyType: "PHONG_TRO",
      addressDetail: "268 Lý Thường Kiệt",
      provinceCode: "79",
      districtCode: "760",
      wardCode: "26740",
      latitude: 10.7725,
      longitude: 106.6578,
      isVerified: true,
      isAvailable: true,
      createdAt: "2026-10-03T10:00:00.000Z",
      ward: {
        name: "Phường 14",
        province: { name: "Thành phố Hồ Chí Minh" },
      },
      host: {
        fullName: "Nguyễn Văn A",
        avatarUrl: null,
      },
      images: [
        { url: "https://example.com/room1.webp", position: 0, sortOrder: 0 },
      ],
      amenities: [
        { id: "air_cond", name: "Máy lạnh" },
        { id: "wifi", name: "Wi-Fi" },
      ],
      distanceMeters: 1250,
      monthlyPrice: 3500000,
      depositAmount: 3500000,
      areaSqm: 25.5,
      leaseTermMonths: 12,
      electricityCost: 3500,
      waterCost: 20000,
      waterUnit: "M3",
      internetCost: 100000,
      garbageCost: 30000,
      parkingFee: 120000,
      allowPets: false,
    };

    expect(mockItem.slug).toBe("cho-thue-phong-tro-gac-lung-bk");
    expect(mockItem.monthlyPrice).toBe(3500000);
    expect(mockItem.garbageCost).toBe(30000);
    expect(mockItem.waterUnit).toBe("M3");
    expect(mockItem.amenities).toHaveLength(2);
  });
});
