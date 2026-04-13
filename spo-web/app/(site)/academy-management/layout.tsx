'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

type SessionMeResponse = {
  user?: {
    role?: string;
  };
};

const ACADEMY_ALLOWED_ROLES = new Set(['academy', 'mentor', 'admin', 'operator']);

const normalizeRole = (value?: string | null) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export default function AcademyManagementLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const verifyAccess = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as SessionMeResponse;
        if (cancelled) return;

        if (response.status === 401 || !response.ok || !data.user) {
          window.location.replace('/sign-in');
          return;
        }

        const role = normalizeRole(data.user.role);
        if (!ACADEMY_ALLOWED_ROLES.has(role)) {
          router.replace('/main');
          return;
        }

        setIsAuthorized(true);
      } catch {
        if (cancelled) return;
        window.location.replace('/sign-in');
      }
    };

    void verifyAccess();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!isAuthorized) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6b7280',
          fontWeight: 700,
          fontSize: '16px',
        }}
      >
        권한 확인 중입니다...
      </div>
    );
  }

  return <>{children}</>;
}
