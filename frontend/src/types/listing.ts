export interface PublicListingItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  videoUrl: string | null;
  propertyType: 'PHONG_TRO' | 'CHUNG_CU_MINI' | 'NHA_NGUYEN_CAN' | 'O_GHEP';
  addressDetail: string;
  provinceCode: string;
  districtCode: string | null;
  wardCode: string;
  latitude: number;
  longitude: number;
  isVerified: boolean;
  isAvailable: boolean;
  createdAt: string;
  ward: {
    name: string;
    province: {
      name: string;
    };
  } | null;
  host: {
    fullName: string;
    avatarUrl: string | null;
  } | null;
  images: {
    url: string;
    position: number;
    sortOrder: number;
  }[];
  amenities: {
    id: string;
    name: string;
  }[];
  distanceMeters: number | null;
  monthlyPrice: number;
  depositAmount: number;
  areaSqm: number;
  leaseTermMonths: number;
  electricityCost: number;
  waterCost: number;
  waterUnit: 'M3' | 'PERSON';
  internetCost: number;
  garbageCost: number;
  parkingFee: number;
  allowPets: boolean;
}

export interface SearchListingsParams {
  province?: string;
  district?: string;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  amenities?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'distance_asc';
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SearchListingsResponse {
  success: boolean;
  message: string;
  data: PublicListingItem[];
  meta: PaginationMeta;
}

export interface AmenityItem {
  id: string;
  name: string;
}

export interface AmenitiesResponse {
  success: boolean;
  message: string;
  data: AmenityItem[];
}

export interface ListingDetailResponse {
  success: boolean;
  message: string;
  data: PublicListingItem;
}
