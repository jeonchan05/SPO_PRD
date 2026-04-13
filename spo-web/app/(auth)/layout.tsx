import { SiteFooter } from "@/components/layout/SiteFooter";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
