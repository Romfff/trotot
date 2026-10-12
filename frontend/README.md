# trotot — Frontend Sprint 1

Đọc [hướng dẫn setup](../docs/FRONTEND_SPRINT1_SETUP.md) để tạo `.env.local`, chạy backend và cài dependency bằng `npm ci` trước khi chạy các lệnh dưới đây. Node khuyến nghị: 24.15.0. Không đưa `.env.local` vào Git.

Auth và danh sách trọ/homestay đọc API backend. OTP mock và dữ liệu seed demo chỉ dành cho local/dev; upload server riêng đang hoãn. Chạy `npm test`, `npm run lint`, `npm run typecheck` và `npm run build` để kiểm code. Browser/DB integration cần chạy riêng, không được suy ra từ test mặc định. Phần bên dưới là tài liệu tham khảo từ Next.js scaffold, chưa phải hướng dẫn deploy dự án này.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
