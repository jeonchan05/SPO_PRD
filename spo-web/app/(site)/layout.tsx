'use client';

import '@/components/layout/AppSidebar.css';
import { usePathname } from 'next/navigation';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideHeader =
    pathname === '/main' ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/study-room') ||
    pathname.startsWith('/attendance-management') ||
    pathname.startsWith('/schedule-management') ||
    pathname.startsWith('/friends') ||
    pathname.startsWith('/academy-notices') ||
    pathname.startsWith('/rewards') ||
    pathname.startsWith('/academy-management');
  const hideFooter =
    pathname.startsWith('/profile') ||
    pathname.startsWith('/study-room') ||
    pathname.startsWith('/attendance-management') ||
    pathname.startsWith('/schedule-management') ||
    pathname.startsWith('/friends') ||
    pathname.startsWith('/academy-notices') ||
    pathname.startsWith('/rewards') ||
    pathname.startsWith('/academy-management');

  return (
    <>
      {!hideHeader ? <SiteHeader /> : null}
      {children}
      {!hideFooter ? <SiteFooter /> : null}
    </>
  );
}
