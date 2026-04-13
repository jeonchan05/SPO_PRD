import type { Metadata } from "next";
import "./css/globals.css";

export const metadata: Metadata = {
  title: "SPO | Study and Point",
  description: "학원 스터디 운영을 위한 공고·신청·매칭·공지·출석·리워드 통합 플랫폼",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="light">
      <body className="text-on-background font-body antialiased">{children}</body>
    </html>
  );
}
