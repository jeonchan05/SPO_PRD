'use client';

import './page.css';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
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
  page?: number;
  pageSize?: number;
  totalCount?: number;
  totalPages?: number;
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const PAGE_SIZE = 10;

const formatNoticeDate = (value?: string) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ko-KR');
};

export default function AcademyNoticesPage() {
  const [focusedNoticeId, setFocusedNoticeId] = useState<number | null>(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [loading, setLoading] = useState(false);
  const [notices, setNotices] = useState<AcademyNotice[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [keywordInput, setKeywordInput] = useState('');
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateError, setDateError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const rawNoticeId = Number(params.get('noticeId'));
    if (Number.isInteger(rawNoticeId) && rawNoticeId > 0) {
      setFocusedNoticeId(rawNoticeId);
      return;
    }
    setFocusedNoticeId(null);
  }, []);

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

    let cancelled = false;
    const loadNotices = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        query.set('page', String(page));
        query.set('pageSize', String(PAGE_SIZE));
        if (keyword) query.set('q', keyword);
        if (startDate) query.set('startDate', startDate);
        if (endDate) query.set('endDate', endDate);
        if (focusedNoticeId) query.set('noticeId', String(focusedNoticeId));

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
            setNotices([]);
            setTotalCount(0);
            setTotalPages(1);
          }
          await fireSpoNotice({
            icon: 'error',
            title: '공지 목록을 불러오지 못했어요',
            text: data.message || '잠시 후 다시 시도해주세요.',
          });
          return;
        }

        if (!cancelled) {
          setNotices(Array.isArray(data.notices) ? data.notices : []);
          setTotalCount(Number(data.totalCount || 0));
          setTotalPages(Math.max(1, Number(data.totalPages || 1)));
          if (typeof data.page === 'number' && Number.isInteger(data.page) && data.page > 0 && data.page !== page) {
            setPage(data.page);
          }
        }
      } catch {
        if (!cancelled) {
          setNotices([]);
          setTotalCount(0);
          setTotalPages(1);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadNotices();
    return () => {
      cancelled = true;
    };
  }, [sessionChecking, page, keyword, startDate, endDate, focusedNoticeId]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (startDateInput && endDateInput && startDateInput > endDateInput) {
      setDateError('시작일은 종료일보다 늦을 수 없습니다.');
      return;
    }
    setDateError('');
    setPage(1);
    setKeyword(keywordInput.trim());
    setStartDate(startDateInput);
    setEndDate(endDateInput);
  };

  const handleResetFilters = () => {
    setDateError('');
    setKeywordInput('');
    setStartDateInput('');
    setEndDateInput('');
    setPage(1);
    setKeyword('');
    setStartDate('');
    setEndDate('');
  };

  if (sessionChecking) {
    return (
      <div className="academy-notices-loading">
        <p>로그인 상태를 확인하는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="academy-notices-page">
      <AppSidebar activeItem="academy-notices" />

      <main className="academy-notices-main">
        <header className="academy-notices-topbar">
          <div className="academy-notices-topbar-right">
            <NotificationBell />
            <div className="academy-notices-profile">
              <img
                className="academy-notices-profile-image"
                src={profileImageUrl}
                alt="User profile"
                onError={(event) => {
                  event.currentTarget.src = '/default-profile-avatar.svg';
                }}
              />
            </div>
          </div>
        </header>

        <section className="academy-notices-content">
          <div className="academy-notices-head">
            <div>
              <p className="academy-notices-eyebrow">ACADEMY NOTICE</p>
              <h1 className="academy-notices-title">학원 공지 전체보기</h1>
              <p className="academy-notices-subtitle">등록한 학원의 전체 공지와 참여 스터디 공지를 모두 확인할 수 있어요.</p>
            </div>
            <p className="academy-notices-count">총 {totalCount}건</p>
          </div>

          <form className="academy-notices-filter" onSubmit={handleSearchSubmit}>
            <input
              className="academy-notices-filter-input"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="공지 제목, 내용, 스터디명 검색"
            />
            <input
              type="date"
              className="academy-notices-filter-date"
              value={startDateInput}
              onChange={(event) => setStartDateInput(event.target.value)}
            />
            <span className="academy-notices-filter-sep">~</span>
            <input
              type="date"
              className="academy-notices-filter-date"
              value={endDateInput}
              onChange={(event) => setEndDateInput(event.target.value)}
            />
            <button type="submit" className="academy-notices-filter-btn academy-notices-filter-btn-primary">
              검색
            </button>
            <button type="button" className="academy-notices-filter-btn" onClick={handleResetFilters}>
              초기화
            </button>
          </form>
          {dateError ? <p className="academy-notices-filter-error">{dateError}</p> : null}

          <div className="academy-notices-list">
            {loading ? (
              <div className="academy-notices-empty">공지 목록을 불러오는 중입니다...</div>
            ) : notices.length === 0 ? (
              <div className="academy-notices-empty">조건에 맞는 공지사항이 없습니다.</div>
            ) : (
              notices.map((notice) => {
                const isStudyNotice = notice.studyGroupId != null && Number(notice.studyGroupId) > 0;
                return (
                  <Link
                    key={notice.id}
                    href={`/academy-notices/${notice.id}`}
                    className={`academy-notice-item academy-notice-item-link ${focusedNoticeId === notice.id ? 'academy-notice-item-highlight' : ''}`}
                  >
                    <div className="academy-notice-item-main">
                      <div className="academy-notice-item-head">
                        <h3 className="academy-notice-item-title">{notice.title}</h3>
                        <div className="academy-notice-item-badges">
                          <span className="academy-notice-item-badge">{isStudyNotice ? '스터디 공지' : '전체 공지'}</span>
                          {notice.studyGroupName ? (
                            <span className="academy-notice-item-badge academy-notice-item-badge-sub">{notice.studyGroupName}</span>
                          ) : null}
                        </div>
                      </div>
                      <p className="academy-notice-item-content">{notice.content}</p>
                      <p className="academy-notice-item-date">{formatNoticeDate(notice.updatedAt || notice.createdAt)}</p>
                    </div>
                    {notice.imageUrl ? (
                      <div className="academy-notice-item-preview">
                        <img
                          src={notice.imageUrl}
                          alt="공지 첨부 이미지"
                          className="academy-notice-item-preview-image"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    ) : null}
                  </Link>
                );
              })
            )}
          </div>

          <div className="academy-notices-pagination">
            <button
              type="button"
              className="academy-notices-pagination-btn"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              이전
            </button>
            <span className="academy-notices-pagination-label">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="academy-notices-pagination-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              다음
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
