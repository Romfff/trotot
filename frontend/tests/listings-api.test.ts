import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { AxiosError, AxiosResponse } from "axios";
import { listingsApi, ListingApiError } from "@/lib/api/listings";

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
      isAxiosError: actual.isAxiosError,
    },
    AxiosError: actual.AxiosError,
  };
});

describe("listingsApi", () => {
  it("cost estimate forwards exact explicit usage, leaves blank fields omitted, and returns only server totals", async () => {
    vi.stubGlobal("window", {});
    const data = { lines: [{ unitPrice: "3500.5", amount: 3501 }], totalMonthly: 3501, deposit: 0 };
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { success: true, data } });
    const controller = new AbortController();
    expect(await listingsApi.costEstimate("a b", { electricityKwh: "1.0", waterM3: "", vehicles: "0" }, controller.signal)).toEqual(data);
    expect(axios.get).toHaveBeenCalledWith("/api/listings/properties/a%20b/cost-estimate", expect.objectContaining({ params: { electricityKwh: "1.0", vehicles: "0" }, signal: controller.signal }));
  });
  it("cost estimate propagates server errors instead of a local formula or fixture fallback", async () => {
    const error = new AxiosError("invalid", "ERR_BAD_REQUEST", undefined, undefined, { status: 400, data: { success: false, errorCode: "INVALID_ESTIMATE_USAGE", message: "Mức dùng không hợp lệ.", errors: [{ field: "vehicles", message: "vehicles invalid" }] } } as AxiosResponse);
    vi.mocked(axios.get).mockRejectedValueOnce(error);
    await expect(listingsApi.costEstimate("sample", { vehicles: "1.5" })).rejects.toMatchObject({ status: 400, errorCode: "INVALID_ESTIMATE_USAGE", details: [{ field: "vehicles", message: "vehicles invalid" }] });
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses same-origin public reads in the browser, not a localhost/public-env fallback", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:5000/api/v1");
    vi.mocked(axios.get).mockResolvedValue({ data: { success: true, data: [] } });
    await listingsApi.search();
    await listingsApi.getAmenities();
    await listingsApi.getBySlug("a b");
    expect(vi.mocked(axios.get).mock.calls.map(([url]) => url)).toEqual([
      "/api/listings/properties/long-term/search", "/api/listings/amenities", "/api/listings/properties/a%20b",
    ]);
  });

  it("uses the configured server URL and fails clearly if production config is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_API_URL", "https://backend.test/api/v1/");
    vi.mocked(axios.get).mockResolvedValue({ data: { success: true, data: [] } });
    await listingsApi.getAmenities();
    expect(axios.get).toHaveBeenCalledWith("https://backend.test/api/v1/amenities", expect.any(Object));
    vi.mocked(axios.get).mockClear();
    vi.stubEnv("BACKEND_API_URL", "");
    await expect(listingsApi.search()).rejects.toMatchObject({ status: 503, errorCode: "API_NOT_CONFIGURED" });
    expect(axios.get).not.toHaveBeenCalled();
  });

  describe("search", () => {
    it("gửi đúng query params được làm sạch và parse đúng DTO", async () => {
      const mockResponse = {
        data: {
          success: true,
          message: "Yêu cầu thành công.",
          data: [],
          meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      const result = await listingsApi.search({
        minPrice: 2000000,
        maxPrice: 5000000,
        minArea: 20,
        amenities: "air_cond,wifi,mezzanine",
        lat: 10.7725,
        lng: 106.6578,
        radius: 3000,
        sortBy: "distance_asc",
        page: 2,
        limit: 20,
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/properties/long-term/search"),
        expect.objectContaining({
          params: {
            minPrice: 2000000,
            maxPrice: 5000000,
            minArea: 20,
            amenities: "air_cond,wifi,mezzanine",
            lat: 10.7725,
            lng: 106.6578,
            radius: 3000,
            sortBy: "distance_asc",
            page: 2,
            limit: 20,
          },
        })
      );

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it("tự động chuyển sortBy về newest nếu chọn distance_asc nhưng thiếu tọa độ", async () => {
      const mockResponse = {
        data: {
          success: true,
          message: "Yêu cầu thành công.",
          data: [],
          meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      };

      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      await listingsApi.search({
        sortBy: "distance_asc",
      });

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/properties/long-term/search"),
        expect.objectContaining({
          params: {
            sortBy: "newest",
          },
        })
      );
    });

    it("chuyển lỗi 429 thành RATE_LIMITED với thông báo tiếng Việt lịch sự", async () => {
      const axiosError = new AxiosError(
        "Request failed with status code 429",
        "ERR_BAD_REQUEST",
        undefined,
        undefined,
        {
          status: 429,
          data: {
            success: false,
            errorCode: "RATE_LIMITED",
            message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
          },
        } as AxiosResponse
      );

      vi.mocked(axios.get).mockRejectedValueOnce(axiosError);

      await expect(listingsApi.search()).rejects.toThrow(ListingApiError);
      
      vi.mocked(axios.get).mockRejectedValueOnce(axiosError);
      try {
        await listingsApi.search();
      } catch (err) {
        const error = err as ListingApiError;
        expect(error.status).toBe(429);
        expect(error.errorCode).toBe("RATE_LIMITED");
      }
    });

    it("chuyển lỗi 503 thành SERVICE_UNAVAILABLE", async () => {
      const axiosError = new AxiosError(
        "Request failed with status code 503",
        "ERR_BAD_RESPONSE",
        undefined,
        undefined,
        {
          status: 503,
          data: {
            success: false,
            errorCode: "SERVICE_UNAVAILABLE",
            message: "Máy chủ đang bận. Vui lòng thử lại sau.",
          },
        } as AxiosResponse
      );

      vi.mocked(axios.get).mockRejectedValueOnce(axiosError);

      try {
        await listingsApi.search();
      } catch (err) {
        const error = err as ListingApiError;
        expect(error.status).toBe(503);
        expect(error.errorCode).toBe("SERVICE_UNAVAILABLE");
      }
    });
  });

  describe("getAmenities", () => {
    it("trả về danh mục tiện ích chính xác từ server", async () => {
      const mockAmenities = [
        { id: "air_cond", name: "Máy lạnh" },
        { id: "wifi", name: "Wi-Fi" },
      ];

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          success: true,
          message: "Yêu cầu thành công.",
          data: mockAmenities,
        },
      });

      const result = await listingsApi.getAmenities();
      expect(result).toEqual(mockAmenities);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/amenities"),
        expect.any(Object)
      );
    });
  });
});
