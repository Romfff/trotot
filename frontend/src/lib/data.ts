// User-provided visual fixtures. These records are not connected to listing/booking APIs.
export interface RoomItem {
  id: string;
  title: string;
  fullTitle?: string;
  address: string;
  ward?: string;
  district?: string;
  city?: string;
  km: number;
  area: number;
  price: number;
  deposit: number;
  electricity: number;
  water: number;
  internet: number;
  parking: number;
  amenities: string[];
  isVerified: boolean;
  images: string[];
  host: {
    name: string;
    avatar: string;
    role: string;
    phone: string;
    zalo: string;
  };
  description: string[];
  nearby: { name: string; distance: string }[];
  status: string;
  capacity: string;
}

export interface HomestayItem {
  id: string;
  title: string;
  city: string;
  location: string;
  stars: number;
  score: number;
  reviewCount: number;
  reviewText: string;
  price: number;
  capacity: number;
  cleaningFee: number;
  mode: "instant" | "request";
  images: string[];
  host: {
    name: string;
    avatar: string;
  };
}

export const ROOMS: RoomItem[] = [
  {
    id: "1",
    title: "Gác lửng mới xây gần ĐH Bách Khoa",
    fullTitle: "Gác lửng mới xây 28 m², ban công thoáng, gần ĐH Bách Khoa",
    address: "268 Lý Thường Kiệt, Phường 14, Quận 10, TP. Hồ Chí Minh",
    ward: "Phường 14",
    district: "Quận 10",
    city: "TP. Hồ Chí Minh",
    km: 0.6,
    area: 28,
    price: 3500000,
    deposit: 3500000,
    electricity: 3500,
    water: 20000,
    internet: 100000,
    parking: 120000,
    amenities: ["ac", "loft", "kitchen", "washing", "fingerprint", "pets", "security"],
    isVerified: true,
    images: [
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Cô Lan Phương",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      role: "Chủ nhà",
      phone: "0912345678",
      zalo: "https://zalo.me",
    },
    description: [
      "Phòng vừa hoàn thiện, lầu 2 mát mẻ, ban công đón gió tự nhiên.",
      "Vị trí thuận tiện: hẻm 268 Lý Thường Kiệt xe hơi vào tận cửa, cách ĐH Bách Khoa TP.HCM 600m, gần BV Trưng Vương và chợ Nguyễn Tri Phương.",
      "Tòa nhà có thang máy, hầm giữ xe có bảo vệ, camera từng tầng.",
      "Phù hợp sinh viên hoặc người đi làm ở sạch sẽ, trật tự.",
    ],
    nearby: [
      { name: "ĐH Bách Khoa (Cổng Lý Thường Kiệt)", distance: "600 m" },
      { name: "Bệnh viện Trưng Vương", distance: "800 m" },
      { name: "Siêu thị Co.opmart Lữ Gia", distance: "1,1 km" },
      { name: "Trạm xe buýt gần nhất", distance: "150 m" },
    ],
    status: "Còn phòng",
    capacity: "2 - 3 người",
  },
  {
    id: "2",
    title: "Studio ban công, giờ giấc tự do",
    fullTitle: "Studio ban công rộng rãi, đủ nội thất, giờ giấc tự do",
    address: "Hẻm 45 Tô Hiến Thành, Phường 13, Quận 10, TP. Hồ Chí Minh",
    ward: "Phường 13",
    district: "Quận 10",
    city: "TP. Hồ Chí Minh",
    km: 1.4,
    area: 28,
    price: 4000000,
    deposit: 4000000,
    electricity: 3800,
    water: 22000,
    internet: 100000,
    parking: 100000,
    amenities: ["ac", "pets", "kitchen", "fingerprint"],
    isVerified: true,
    images: [
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Anh Tuấn Anh",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
      role: "Chính chủ",
      phone: "0909888999",
      zalo: "https://zalo.me",
    },
    description: [
      "Studio có ban công thoáng mát, sẵn tủ lạnh, máy lạnh, giường nệm.",
      "Gần trường ĐH Kinh Tế, ĐH Bách Khoa, tiện di chuyển Quận 1, Quận 3, Quận 10.",
      "Cổng khóa vân tay, camera an ninh.",
    ],
    nearby: [
      { name: "Đại học Bách Khoa", distance: "1,4 km" },
      { name: "Vạn Hạnh Mall", distance: "900 m" },
      { name: "Big C Miền Đông", distance: "700 m" },
    ],
    status: "Còn phòng",
    capacity: "2 người",
  },
  {
    id: "3",
    title: "Phòng dãy trọ sinh viên, có kệ bếp",
    fullTitle: "Phòng trọ sinh viên có gác lửng, giờ giấc tự do",
    address: "Đường 3/2, Phường 11, Quận 10, TP. Hồ Chí Minh",
    ward: "Phường 11",
    district: "Quận 10",
    city: "TP. Hồ Chí Minh",
    km: 2.1,
    area: 18,
    price: 2200000,
    deposit: 500000,
    electricity: 3500,
    water: 15000,
    internet: 0,
    parking: 80000,
    amenities: ["loft", "kitchen"],
    isVerified: false,
    images: [
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Bác Năm",
      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&auto=format&fit=crop&q=80",
      role: "Chủ trọ",
      phone: "0987654321",
      zalo: "https://zalo.me",
    },
    description: [
      "Dãy trọ sinh viên yên tĩnh, an ninh, có gác lửng riêng.",
      "Khu vực trung tâm đi lại thuận tiện nhiều trường đại học lân cận.",
    ],
    nearby: [
      { name: "ĐH Kinh Tế TP.HCM", distance: "1,2 km" },
      { name: "ĐH Bách Khoa", distance: "2,1 km" },
    ],
    status: "Còn 1 phòng",
    capacity: "1 - 2 người",
  },
  {
    id: "4",
    title: "Chung cư mini đầy đủ nội thất",
    fullTitle: "Chung cư mini có thang máy, bảo vệ",
    address: "Đường Cao Thắng, Phường 12, Quận 10, TP. Hồ Chí Minh",
    ward: "Phường 12",
    district: "Quận 10",
    city: "TP. Hồ Chí Minh",
    km: 2.8,
    area: 32,
    price: 5800000,
    deposit: 11600000,
    electricity: 3800,
    water: 25000,
    internet: 0,
    parking: 150000,
    amenities: ["ac", "pets", "kitchen", "washing", "fingerprint", "security"],
    isVerified: true,
    images: [
      "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Chị Hạnh",
      avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&auto=format&fit=crop&q=80",
      role: "Quản lý tòa nhà",
      phone: "0933112233",
      zalo: "https://zalo.me",
    },
    description: [
      "Căn hộ mini có sofa, giường nệm, bếp điện từ.",
      "Tòa nhà thang máy, hầm giữ xe thẻ từ, giờ giấc tự do.",
    ],
    nearby: [
      { name: "Hà Đô Centrosa", distance: "500 m" },
      { name: "Ga Sài Gòn", distance: "1 km" },
    ],
    status: "Còn phòng",
    capacity: "2 - 3 người",
  },
  {
    id: "5",
    title: "Phòng nữ sinh có gác, an ninh",
    fullTitle: "Phòng trọ nữ sinh viên có gác lửng, camera",
    address: "Đường Lê Hồng Phong, Phường 10, Quận 10, TP. Hồ Chí Minh",
    ward: "Phường 10",
    district: "Quận 10",
    city: "TP. Hồ Chí Minh",
    km: 1.8,
    area: 22,
    price: 2800000,
    deposit: 2800000,
    electricity: 3500,
    water: 20000,
    internet: 100000,
    parking: 100000,
    amenities: ["loft", "security", "fingerprint"],
    isVerified: true,
    images: [
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Chị Thảo",
      avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80",
      role: "Chủ nhà",
      phone: "0977889900",
      zalo: "https://zalo.me",
    },
    description: [
      "Nhà trọ sạch sẽ, trật tự.",
      "Gần chợ, siêu thị mini, trạm xe buýt thuận tiện di chuyển.",
    ],
    nearby: [
      { name: "ĐH Khoa Học Tự Nhiên", distance: "1,5 km" },
      { name: "ĐH Sư Phạm TP.HCM", distance: "1,7 km" },
    ],
    status: "Còn phòng",
    capacity: "2 người",
  },
  {
    id: "6",
    title: "Căn hộ 1 phòng ngủ gần bệnh viện",
    fullTitle: "Căn hộ 1 phòng ngủ khép kín, gần BV Hùng Vương",
    address: "Đường Hồng Bàng, Phường 12, Quận 5, TP. Hồ Chí Minh",
    ward: "Phường 12",
    district: "Quận 5",
    city: "TP. Hồ Chí Minh",
    km: 3.2,
    area: 35,
    price: 4800000,
    deposit: 9600000,
    electricity: 3800,
    water: 24000,
    internet: 0,
    parking: 150000,
    amenities: ["ac", "kitchen", "washing", "security"],
    isVerified: false,
    images: [
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Anh Hoàng",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
      role: "Chủ nhà",
      phone: "0901234567",
      zalo: "https://zalo.me",
    },
    description: [
      "Căn hộ 1 phòng ngủ riêng, phòng khách và bếp thoáng.",
      "Gần BV Hùng Vương, Chợ Rẫy, ĐH Y Dược TP.HCM.",
    ],
    nearby: [
      { name: "ĐH Y Dược TP.HCM", distance: "800 m" },
      { name: "Bệnh viện Chợ Rẫy", distance: "900 m" },
    ],
    status: "Còn phòng",
    capacity: "2 - 4 người",
  },
];

export const HOMESTAYS: HomestayItem[] = [
  {
    id: "h1",
    city: "TP. Hồ Chí Minh",
    title: "Homestay Sài Gòn Xưa",
    location: "Bến Thành, cách trung tâm 0,4 km",
    stars: 4,
    score: 9.2,
    reviewCount: 1240,
    reviewText: "Tuyệt vời",
    price: 600000,
    capacity: 4,
    cleaningFee: 150000,
    mode: "instant",
    images: [
      "https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Trần Mai Anh",
      avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&auto=format&fit=crop&q=80",
    },
  },
  {
    id: "h2",
    city: "TP. Hồ Chí Minh",
    title: "Căn hộ dịch vụ Lumi",
    location: "Nguyễn Huệ, cách trung tâm 0,9 km",
    stars: 4,
    score: 8.8,
    reviewCount: 860,
    reviewText: "Rất tốt",
    price: 820000,
    capacity: 4,
    cleaningFee: 200000,
    mode: "request",
    images: [
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Quốc Huy",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
    },
  },
  {
    id: "h3",
    city: "TP. Hồ Chí Minh",
    title: "Studio Cây Me",
    location: "Phạm Ngũ Lão, cách trung tâm 1,2 km",
    stars: 3,
    score: 7.9,
    reviewCount: 312,
    reviewText: "Tốt",
    price: 380000,
    capacity: 2,
    cleaningFee: 100000,
    mode: "instant",
    images: [
      "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Ngọc Lan",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
    },
  },
  {
    id: "h4",
    city: "TP. Hồ Chí Minh",
    title: "The Loft Bùi Viện",
    location: "Bùi Viện, cách trung tâm 1,0 km",
    stars: 5,
    score: 9.5,
    reviewCount: 2104,
    reviewText: "Xuất sắc",
    price: 1150000,
    capacity: 5,
    cleaningFee: 250000,
    mode: "request",
    images: [
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80",
    ],
    host: {
      name: "Alex Minh",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
    },
  },
];

export function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount);
}
