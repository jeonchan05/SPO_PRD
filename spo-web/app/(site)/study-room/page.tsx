'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoNotice, fireSpoSwal } from '@/lib/ui/swal';

type Academy = {
  id: number;
  name: string;
  address?: string | null;
};

type StudyRoomContextResponse = {
  academies?: Academy[];
  studies?: StudyGroup[];
  message?: string;
};

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
  description?: string | null;
  academyId?: number | null;
  academyName?: string | null;
  memberCount?: number;
  isActive?: boolean;
};

type AcademySearchResponse = {
  academies?: Academy[];
  message?: string;
};

type StudyRecruitmentListItem = {
  id: number;
  academyId?: number | null;
  academyName?: string | null;
  academyAddress?: string | null;
  title: string;
  targetClass?: string | null;
  recruitmentEndAt?: string;
  teamSize?: number;
  status?: 'open' | 'matching' | 'completed' | 'closed';
};

type StudyRecruitmentListResponse = {
  recruitments?: StudyRecruitmentListItem[];
  message?: string;
};

type SessionUserResponse = {
  user?: {
    profileImageUrl?: string | null;
    role?: string;
  };
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const REGISTERED_ACADEMIES_PER_PAGE = 4;
const SEARCH_ACADEMIES_PER_PAGE = 5;
const RECRUITMENTS_PER_PAGE = 4;

const formatRecruitmentDate = (value?: string) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const recruitmentStatusLabel: Record<NonNullable<StudyRecruitmentListItem['status']>, string> = {
  open: '모집중',
  matching: '매칭중',
  completed: '매칭완료',
  closed: '종료',
};

export default function StudyRoomPage() {
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [registeringAcademyId, setRegisteringAcademyId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showAcademyAddPanel, setShowAcademyAddPanel] = useState(false);
  const [registeredAcademies, setRegisteredAcademies] = useState<Academy[]>([]);
  const [studies, setStudies] = useState<StudyGroup[]>([]);
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [recruitments, setRecruitments] = useState<StudyRecruitmentListItem[]>([]);
  const [recruitmentsLoading, setRecruitmentsLoading] = useState(true);
  const [recruitmentSearchKeyword, setRecruitmentSearchKeyword] = useState('');
  const [recruitmentSearchAppliedKeyword, setRecruitmentSearchAppliedKeyword] = useState('');
  const [recruitmentPage, setRecruitmentPage] = useState(1);
  const [registeredPage, setRegisteredPage] = useState(1);
  const [academySearchPage, setAcademySearchPage] = useState(1);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [userRole, setUserRole] = useState('student');

  const hasAcademyRegistered = registeredAcademies.length > 0;
  const isAcademyManager = userRole === 'academy' || userRole === 'mentor';
  const registeredAcademyIdSet = useMemo(
    () => new Set(registeredAcademies.map((academy) => Number(academy.id))),
    [registeredAcademies],
  );
  const registeredTotalPages = Math.max(
    1,
    Math.ceil(registeredAcademies.length / REGISTERED_ACADEMIES_PER_PAGE),
  );
  const paginatedRegisteredAcademies = useMemo(() => {
    const start = (registeredPage - 1) * REGISTERED_ACADEMIES_PER_PAGE;
    return registeredAcademies.slice(start, start + REGISTERED_ACADEMIES_PER_PAGE);
  }, [registeredAcademies, registeredPage]);
  const academySearchTotalPages = Math.max(1, Math.ceil(academies.length / SEARCH_ACADEMIES_PER_PAGE));
  const paginatedAcademies = useMemo(() => {
    const start = (academySearchPage - 1) * SEARCH_ACADEMIES_PER_PAGE;
    return academies.slice(start, start + SEARCH_ACADEMIES_PER_PAGE);
  }, [academies, academySearchPage]);
  const recruitmentTotalPages = Math.max(1, Math.ceil(recruitments.length / RECRUITMENTS_PER_PAGE));
  const paginatedRecruitments = useMemo(() => {
    const start = (recruitmentPage - 1) * RECRUITMENTS_PER_PAGE;
    return recruitments.slice(start, start + RECRUITMENTS_PER_PAGE);
  }, [recruitments, recruitmentPage]);

  const loadStudyRoomContext = async () => {
    const response = await fetch(`${API_BASE_URL}/app/study-room/context`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => ({}))) as StudyRoomContextResponse;

    if (response.status === 401) {
      window.location.replace('/sign-in');
      return null;
    }

    if (!response.ok) {
      await fireSpoNotice({
        icon: 'error',
        title: '불러오기 실패',
        text: data.message || '스터디룸 정보를 불러오지 못했습니다.',
      });
      return null;
    }

    const loadedAcademies = Array.isArray(data.academies) ? data.academies : [];
    const loadedStudies = Array.isArray(data.studies) ? data.studies : [];
    setRegisteredAcademies(loadedAcademies);
    setStudies(loadedStudies);
    return loadedAcademies;
  };

  const loadAcademies = async (query = '') => {
    setSearching(true);
    try {
      const url = new URL(`${API_BASE_URL}/app/academies`, window.location.origin);
      if (query.trim()) {
        url.searchParams.set('q', query.trim());
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      const data = (await response.json().catch(() => ({}))) as AcademySearchResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '검색 실패',
          text: data.message || '학원 검색에 실패했습니다.',
        });
        return;
      }

      setAcademies(Array.isArray(data.academies) ? data.academies : []);
      setAcademySearchPage(1);
    } finally {
      setSearching(false);
    }
  };

  const loadStudyRecruitments = async (query = '') => {
    setRecruitmentsLoading(true);
    try {
      const url = new URL(`${API_BASE_URL}/app/study-recruitments`, window.location.origin);
      const trimmedQuery = query.trim();
      if (trimmedQuery) {
        url.searchParams.set('q', trimmedQuery);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      const data = (await response.json().catch(() => ({}))) as StudyRecruitmentListResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '모집 목록 불러오기 실패',
          text: data.message || '스터디 모집 목록을 불러오지 못했습니다.',
        });
        return;
      }

      setRecruitments(Array.isArray(data.recruitments) ? data.recruitments : []);
      setRecruitmentPage(1);
    } finally {
      setRecruitmentsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const userResponse = await fetch(`/api/auth/me`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const userData = (await userResponse.json().catch(() => ({}))) as SessionUserResponse;
        const nextUserRole =
          typeof userData.user?.role === 'string' && userData.user.role.trim() ? userData.user.role.trim() : 'student';
        if (!cancelled && typeof userData.user?.profileImageUrl === 'string' && userData.user.profileImageUrl.trim()) {
          setProfileImageUrl(userData.user.profileImageUrl.trim());
        }
        if (!cancelled) {
          setUserRole(nextUserRole);
        }

        const loadedAcademies = await loadStudyRoomContext();
        if (cancelled || !loadedAcademies) return;

        if (!(nextUserRole === 'academy' || nextUserRole === 'mentor')) {
          await loadStudyRecruitments('');
          if (cancelled) return;
        }

        if (!(nextUserRole === 'academy' || nextUserRole === 'mentor') && loadedAcademies.length === 0) {
          setShowAcademyAddPanel(true);
          await loadAcademies('');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (registeredPage > registeredTotalPages) {
      setRegisteredPage(registeredTotalPages);
    }
  }, [registeredPage, registeredTotalPages]);

  useEffect(() => {
    if (academySearchPage > academySearchTotalPages) {
      setAcademySearchPage(academySearchTotalPages);
    }
  }, [academySearchPage, academySearchTotalPages]);

  useEffect(() => {
    if (recruitmentPage > recruitmentTotalPages) {
      setRecruitmentPage(recruitmentTotalPages);
    }
  }, [recruitmentPage, recruitmentTotalPages]);

  const handleSearchAcademies = async () => {
    await loadAcademies(searchKeyword);
  };

  const handleSearchRecruitments = async () => {
    const trimmed = recruitmentSearchKeyword.trim();
    setRecruitmentSearchAppliedKeyword(trimmed);
    await loadStudyRecruitments(trimmed);
  };

  const handleToggleAcademyAddPanel = async () => {
    const next = !showAcademyAddPanel;
    setShowAcademyAddPanel(next);
    if (next && academies.length === 0) {
      await loadAcademies('');
    }
  };

  const handleRegisterAcademy = async (academyId: number, academyName: string) => {
    if (registeringAcademyId) return;
    const verificationPrompt = await fireSpoSwal({
      icon: 'question',
      title: '학원 인증번호 입력',
      text: `${academyName} 학원 인증번호를 입력해주세요.`,
      input: 'text',
      inputPlaceholder: '학원 인증번호',
      inputAttributes: {
        autocapitalize: 'off',
        autocorrect: 'off',
      },
      showCancelButton: true,
      cancelButtonText: '취소',
      confirmButtonText: '학원 추가',
      buttonsStyling: false,
      customClass: {
        confirmButton:
          '!inline-flex !min-w-[190px] !justify-center !rounded-full !bg-[#2563eb] !px-8 !py-4 !text-xl !font-extrabold !text-white shadow-[0_16px_32px_rgba(37,99,235,0.28)] transition hover:!bg-[#1d4ed8]',
        cancelButton:
          '!inline-flex !min-w-[120px] !justify-center !rounded-full !bg-[#7a8590] !px-7 !py-4 !text-xl !font-extrabold !text-white transition hover:!bg-[#66707b]',
      },
      inputValidator: (value) => {
        if (!value || !String(value).trim()) {
          return '인증번호를 입력해주세요.';
        }
        return undefined;
      },
    });

    if (!verificationPrompt.isConfirmed) {
      return;
    }
    const verificationCode = String(verificationPrompt.value || '').trim();

    setRegisteringAcademyId(academyId);
    try {
      const response = await fetch(`${API_BASE_URL}/app/users/me/academy`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          academyId,
          verificationCode: verificationCode.trim(),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '등록 실패',
          text: data.message || '학원 등록에 실패했습니다.',
        });
        return;
      }

      await fireSpoNotice({
        icon: 'success',
        title: '등록 완료',
        text: data.message || '학원 등록이 완료되었습니다.',
      });

      const loadedAcademies = await loadStudyRoomContext();
      if (!loadedAcademies) return;
      await loadStudyRecruitments(recruitmentSearchAppliedKeyword);
      setShowAcademyAddPanel(false);
    } finally {
      setRegisteringAcademyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">스터디룸 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb]">
      <AppSidebar activeItem="study-room" />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-end bg-[#f5f6f8]/70 px-8 backdrop-blur-xl">
          <div className="flex items-center gap-6">
            <NotificationBell />
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white bg-[#e0e3e5]">
              <img
                className="h-full w-full object-cover"
                src={profileImageUrl}
                alt="User profile avatar"
                onError={(event) => {
                  event.currentTarget.src = '/default-profile-avatar.svg';
                }}
              />
            </div>
          </div>
        </header>
        <div className="px-6 pb-8 pt-4">
          <div className="mx-auto w-full max-w-6xl">
            <header className="mb-6">
              <h1 className="pl-1 text-3xl font-black tracking-tight text-slate-900">스터디룸</h1>
            </header>

            <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">
                    {isAcademyManager ? 'MANAGED STUDIES' : '스터디 모집 공고'}
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-900">
                    {isAcademyManager ? '현재 운영 중인 스터디' : '스터디 모집 공고'}
                  </h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {isAcademyManager
                      ? '학원에서 생성하고 운영 중인 스터디를 한눈에 확인하세요.'
                      : '등록된 학원의 스터디 모집 공고를 확인하고 신청할 수 있습니다.'}
                  </p>
                </div>
              </div>

              {!isAcademyManager ? (
                <div className="mb-4 flex flex-col gap-2 md:flex-row">
                  <input
                    type="text"
                    value={recruitmentSearchKeyword}
                    onChange={(event) => setRecruitmentSearchKeyword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleSearchRecruitments();
                      }
                    }}
                    placeholder="공고명, 대상 수업, 학원명으로 검색"
                    className="h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0052FF]/45 focus:bg-white focus:ring-2 focus:ring-[#0052FF]/20"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleSearchRecruitments();
                      }}
                      className="h-11 rounded-xl bg-[#0052FF] px-4 text-sm font-bold text-white transition hover:bg-[#003ec0]"
                    >
                      공고 검색
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecruitmentSearchKeyword('');
                        setRecruitmentSearchAppliedKeyword('');
                        void loadStudyRecruitments('');
                      }}
                      className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                    >
                      초기화
                    </button>
                  </div>
                </div>
              ) : null}

              {!isAcademyManager && recruitmentSearchAppliedKeyword ? (
                <p className="mb-3 text-xs font-semibold text-slate-500">
                  검색어: <span className="font-extrabold text-slate-700">{recruitmentSearchAppliedKeyword}</span>
                </p>
              ) : null}

              {isAcademyManager ? (
                studies.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <p className="text-sm font-semibold text-slate-600">현재 운영 중인 스터디가 없습니다.</p>
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      학원 관리 탭에서 스터디를 생성하면 이곳에 바로 표시됩니다.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {studies.map((study) => (
                      <Link
                        key={study.id}
                        href={`/study-room/${study.id}`}
                        className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-[#0052FF]/45 hover:bg-white hover:shadow-[0_12px_24px_rgba(37,99,235,0.12)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-base font-extrabold text-slate-900">{study.name}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {study.subject} · {study.memberCount || 0}명 참여 중
                            </p>
                            <p className="mt-1 text-xs font-medium text-slate-500">
                              {study.description || '스터디 소개가 아직 등록되지 않았습니다.'}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-[#0052FF]">
                            {study.isActive ? '운영중' : '비활성'}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )
              ) : recruitmentsLoading ? (
                <p className="text-sm font-semibold text-slate-500">모집 목록을 불러오는 중입니다...</p>
              ) : !hasAcademyRegistered ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="text-sm font-semibold text-slate-600">
                    등록한 학원 공고만 표시됩니다. 먼저 학원을 등록해주세요.
                  </p>
                </div>
              ) : recruitments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="text-sm font-semibold text-slate-600">조건에 맞는 모집 공고가 없습니다.</p>
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {paginatedRecruitments.map((recruitment) => (
                      <Link
                        key={recruitment.id}
                        href={`/study-room/recruitments/${recruitment.id}`}
                        className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-[#0052FF]/45 hover:bg-white hover:shadow-[0_12px_24px_rgba(37,99,235,0.12)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-base font-extrabold text-slate-900">{recruitment.title}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              대상 수업: {recruitment.targetClass || '미정'}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              운영 학원: {recruitment.academyName || '미지정'}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-[#0052FF]">
                            {recruitment.status ? recruitmentStatusLabel[recruitment.status] : '모집중'}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-500">
                          <span>마감: {formatRecruitmentDate(recruitment.recruitmentEndAt)}</span>
                          <span>{recruitment.teamSize ? `팀당 ${recruitment.teamSize}명` : '팀 구성 미정'}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setRecruitmentPage((prev) => Math.max(1, prev - 1))}
                      disabled={recruitmentPage === 1}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      이전
                    </button>
                    <span className="min-w-[70px] text-center text-xs font-bold text-slate-600">
                      {recruitmentPage} / {recruitmentTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecruitmentPage((prev) => Math.min(recruitmentTotalPages, prev + 1))}
                      disabled={recruitmentPage === recruitmentTotalPages}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
            </section>

            {!isAcademyManager && hasAcademyRegistered ? (
              <>
                <section className="mb-6 rounded-3xl border border-blue-100 bg-blue-50/70 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-500">등록 학원 리스트</p>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-blue-700">
                        {registeredAcademies.length}개
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void handleToggleAcademyAddPanel();
                        }}
                        className="rounded-xl bg-[#0052FF] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#003ec0]"
                      >
                        {showAcademyAddPanel ? '학원추가 닫기' : '학원 추가'}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {paginatedRegisteredAcademies.map((academy) => (
                      <Link key={academy.id} href={`/study-room/academy/${academy.id}`} className="group block h-full">
                        <article className="h-full cursor-pointer rounded-2xl border border-blue-100 bg-white/80 p-4 transition hover:-translate-y-0.5 hover:border-[#0052FF]/45 hover:bg-white hover:shadow-[0_12px_24px_rgba(37,99,235,0.14)]">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-extrabold text-slate-900">{academy.name}</p>
                              <p className="text-sm text-slate-600">{academy.address || '주소 정보 없음'}</p>
                            </div>
                            <span className="text-lg font-black text-[#0052FF] transition group-hover:translate-x-0.5">
                              →
                            </span>
                          </div>
                        </article>
                      </Link>
                    ))}
                  </div>
                  {registeredAcademies.length >= REGISTERED_ACADEMIES_PER_PAGE ? (
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRegisteredPage((prev) => Math.max(1, prev - 1))}
                        disabled={registeredPage === 1}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        이전
                      </button>
                      <span className="min-w-[70px] text-center text-xs font-bold text-slate-600">
                        {registeredPage} / {registeredTotalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRegisteredPage((prev) => Math.min(registeredTotalPages, prev + 1))}
                        disabled={registeredPage === registeredTotalPages}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        다음
                      </button>
                    </div>
                  ) : null}
                </section>
              </>
            ) : !isAcademyManager ? (
              <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">등록된 학원이 없습니다</h2>
                <p className="mt-1 text-sm text-slate-500">
                  학원추가 탭에서 인증번호를 입력해 학원을 등록하면 스터디룸 기능을 사용할 수 있습니다.
                </p>
              </section>
            ) : null}

            {!isAcademyManager && (!hasAcademyRegistered || showAcademyAddPanel) && (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">학원추가</h2>
                <p className="mt-1 text-sm text-slate-500">
                  학원 검색 후 학원 추가 버튼을 누르면 인증번호 입력 모달이 열립니다.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleSearchAcademies();
                      }
                    }}
                    placeholder="학원명을 입력하세요"
                    className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium outline-none ring-[#0052FF]/25 transition focus:ring-2 md:col-span-2"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleSearchAcademies();
                    }}
                    disabled={searching}
                    className="rounded-xl bg-[#0052FF] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#003ec0] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {searching ? '검색중' : '검색'}
                  </button>
                </div>
                <div className="mt-5 space-y-3">
                  {academies.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-medium text-slate-500">
                      검색 결과가 없습니다.
                    </div>
                  ) : (
                    paginatedAcademies.map((academy) => {
                      const isRegistered = registeredAcademyIdSet.has(Number(academy.id));
                      return (
                        <div
                          key={academy.id}
                          className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="text-base font-extrabold text-slate-900">{academy.name}</p>
                            <p className="text-sm text-slate-600">{academy.address || '주소 정보 없음'}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void handleRegisterAcademy(academy.id, academy.name);
                            }}
                            disabled={isRegistered || registeringAcademyId === academy.id}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isRegistered
                              ? '등록됨'
                              : registeringAcademyId === academy.id
                                ? '등록중...'
                                : '학원 추가'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                {academies.length >= SEARCH_ACADEMIES_PER_PAGE ? (
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAcademySearchPage((prev) => Math.max(1, prev - 1))}
                      disabled={academySearchPage === 1}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      이전
                    </button>
                    <span className="min-w-[70px] text-center text-xs font-bold text-slate-600">
                      {academySearchPage} / {academySearchTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAcademySearchPage((prev) => Math.min(academySearchTotalPages, prev + 1))}
                      disabled={academySearchPage === academySearchTotalPages}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      다음
                    </button>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
