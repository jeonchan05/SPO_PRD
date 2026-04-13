'use client';

import './page.css';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoNotice } from '@/lib/ui/swal';

type SessionUserResponse = {
  user?: {
    profileImageUrl?: string | null;
  };
};

type AcademyNotice = {
  id: number;
  academyId: number;
  studyGroupId: number | null;
  studyGroupName?: string | null;
  title: string;
  content: string;
  imageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type AcademyNoticeListResponse = {
  notices?: AcademyNotice[];
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ko-KR');
};

export default function AcademyNoticeDetailPage() {
  const params = useParams<{ noticeId?: string | string[] }>();
  const noticeId = useMemo(() => {
    const value = Array.isArray(params?.noticeId) ? params.noticeId[0] : params?.noticeId;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  }, [params]);

  const [sessionChecking, setSessionChecking] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<AcademyNotice | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/app/users/me`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as SessionUserResponse;

        if (response.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!cancelled && typeof data.user?.profileImageUrl === 'string' && data.user.profileImageUrl.trim()) {
          setProfileImageUrl(data.user.profileImageUrl.trim());
        }
      } catch {
        window.location.replace('/sign-in');
        return;
      } finally {
        if (!cancelled) {
          setSessionChecking(false);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessionChecking) return;

    if (!noticeId) {
      setNotFound(true);
      setNotice(null);
      return;
    }

    let cancelled = false;

    const loadNotice = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const query = new URLSearchParams();
        query.set('noticeId', String(noticeId));
        query.set('page', '1');
        query.set('pageSize', '1');
        const response = await fetch(`${API_BASE_URL}/app/academy-notices?${query.toString()}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as AcademyNoticeListResponse;

        if (response.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!response.ok) {
          if (!cancelled) {
            setNotice(null);
            setNotFound(true);
          }
          await fireSpoNotice({
            icon: 'error',
            title: '공지사항을 불러오지 못했어요',
            text: data.message || '잠시 후 다시 시도해주세요.',
          });
          return;
        }

        const selected = Array.isArray(data.notices) ? data.notices[0] : null;
        if (!cancelled) {
          setNotice(selected || null);
          setNotFound(!selected);
        }
      } catch {
        if (!cancelled) {
          setNotice(null);
          setNotFound(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadNotice();

    return () => {
      cancelled = true;
    };
  }, [sessionChecking, noticeId]);

  if (sessionChecking) {
    return (
      <div className="academy-notice-detail-loading">
        <p>로그인 상태를 확인하는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="academy-notice-detail-page">
      <AppSidebar activeItem="academy-notices" />

      <main className="academy-notice-detail-main">
        <header className="academy-notice-detail-topbar">
          <div className="academy-notice-detail-topbar-right">
            <NotificationBell />
            <div className="academy-notice-detail-profile">
              <img
                className="academy-notice-detail-profile-image"
                src={profileImageUrl}
                alt="User profile"
                onError={(event) => {
                  event.currentTarget.src = '/default-profile-avatar.svg';
                }}
              />
            </div>
          </div>
        </header>

        <section className="academy-notice-detail-content">
          <div className="academy-notice-detail-head">
            <Link href="/academy-notices" className="academy-notice-detail-back">
              목록으로
            </Link>
          </div>

          {loading ? (
            <div className="academy-notice-detail-empty">공지사항을 불러오는 중입니다...</div>
          ) : notFound || !notice ? (
            <div className="academy-notice-detail-empty">해당 공지사항을 찾을 수 없습니다.</div>
          ) : (
            <article className="academy-notice-detail-card">
              <div className="academy-notice-detail-meta">
                <span className="academy-notice-detail-chip">{notice.studyGroupId ? '스터디 공지' : '전체 공지'}</span>
                {notice.studyGroupName ? (
                  <span className="academy-notice-detail-chip academy-notice-detail-chip-sub">{notice.studyGroupName}</span>
                ) : null}
                <span className="academy-notice-detail-date">{formatDateTime(notice.updatedAt || notice.createdAt)}</span>
              </div>
              <h1 className="academy-notice-detail-title">{notice.title}</h1>
              <p className="academy-notice-detail-body">{notice.content}</p>
              {notice.imageUrl ? (
                <div className="academy-notice-detail-image-wrap">
                  <img
                    src={notice.imageUrl}
                    alt="공지 첨부 이미지"
                    className="academy-notice-detail-image"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              ) : null}
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
