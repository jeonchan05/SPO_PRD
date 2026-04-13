'use client';

import './page.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoNotice, fireSpoSwal } from '@/lib/ui/swal';

type Friend = {
  id: number;
  name: string;
  loginId?: string;
  email?: string;
  profileImageUrl?: string | null;
  role?: string;
  status?: string;
};

type FriendRequest = {
  id: number;
  requesterUserId: number;
  addresseeUserId: number;
  status: 'pending' | 'accepted' | 'rejected';
  requestedAt?: string;
  respondedAt?: string | null;
  requester?: Friend;
  addressee?: Friend;
};

type SessionMeResponse = {
  user?: {
    id?: number;
    role?: string;
    name?: string;
    profileImageUrl?: string | null;
  };
};

type AcademyStudent = {
  id: number;
  name: string;
  loginId?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
  status?: string | null;
  createdAt?: string | null;
  academyCount?: number;
  academies?: {
    id: number;
    name: string;
    registeredAt?: string | null;
  }[];
};

type AcademyStudentsResponse = {
  message?: string;
  students?: AcademyStudent[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
};

const resolveApiBaseUrl = () => {
  const raw = String(process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api').trim();
  if (!raw || raw === '/') return '/api';

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const parsed = new URL(raw);
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/api';
      }
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return '/api';
    }
  }

  if (raw.startsWith('/')) {
    const normalized = raw.replace(/\/+$/, '') || '/api';
    if (normalized === '/') return '/api';
    return normalized.startsWith('/api') ? normalized : '/api';
  }

  return raw.replace(/\/+$/, '');
};

const API_BASE_URL = resolveApiBaseUrl();
const STUDENT_PAGE_SIZE = 10;

const getFriendSubtitle = (friend: Friend) => {
  const roleLabel =
    friend.role === 'academy' || friend.role === 'mentor'
      ? '학원'
      : friend.role === 'admin'
        ? '관리자'
        : '학생';

  return friend.loginId ? `${roleLabel} · @${friend.loginId}` : roleLabel;
};

const getAvatarUrl = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=334155&bold=true`;

export default function FriendsPage() {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendRequestsLoading, setFriendRequestsLoading] = useState(true);
  const [friendRequestInput, setFriendRequestInput] = useState('');
  const [isSubmittingFriendRequest, setIsSubmittingFriendRequest] = useState(false);
  const [requestActionId, setRequestActionId] = useState<number | null>(null);
  const [openMenuFriendId, setOpenMenuFriendId] = useState<number | null>(null);
  const [academyStudents, setAcademyStudents] = useState<AcademyStudent[]>([]);
  const [academyStudentsLoading, setAcademyStudentsLoading] = useState(false);
  const [studentSearchInput, setStudentSearchInput] = useState('');
  const [studentSearchKeyword, setStudentSearchKeyword] = useState('');
  const [studentsPage, setStudentsPage] = useState(1);
  const [studentsTotal, setStudentsTotal] = useState(0);
  const [studentsTotalPages, setStudentsTotalPages] = useState(1);

  const normalizedRole = useMemo(() => currentUserRole.trim().toLowerCase(), [currentUserRole]);
  const isAcademyManager = useMemo(
    () =>
      normalizedRole === 'academy' ||
      normalizedRole === 'mentor' ||
      normalizedRole === 'operator' ||
      normalizedRole === 'admin',
    [normalizedRole],
  );
  const pendingIncomingRequests = useMemo(
    () =>
      friendRequests.filter(
        (request) => request.status === 'pending' && (currentUserId == null || request.addresseeUserId === currentUserId),
      ),
    [friendRequests, currentUserId],
  );
  const visibleStudentPageNumbers = useMemo(() => {
    const totalPages = Math.max(1, Number(studentsTotalPages || 1));
    const current = Math.max(1, Math.min(Number(studentsPage || 1), totalPages));
    const start = Math.max(1, current - 2);
    const end = Math.min(totalPages, current + 2);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [studentsPage, studentsTotalPages]);

  const loadAcademyStudents = async (page = 1, keyword = '') => {
    setAcademyStudentsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(Math.max(1, page)));
      params.set('pageSize', String(STUDENT_PAGE_SIZE));
      if (keyword.trim()) {
        params.set('q', keyword.trim());
      }

      const response = await fetch(`${API_BASE_URL}/app/academy/students?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as AcademyStudentsResponse;
      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        const detailMessage =
          typeof data.message === 'string' && data.message.trim()
            ? data.message.trim()
            : `요청이 실패했습니다. (HTTP ${response.status})`;
        await fireSpoNotice({
          icon: 'error',
          title: '학생 목록을 불러오지 못했어요',
          text: detailMessage,
        });
        return;
      }

      setAcademyStudents(Array.isArray(data.students) ? data.students : []);
      setStudentsPage(Math.max(1, Number(data.page || page || 1)));
      setStudentsTotal(Math.max(0, Number(data.total || 0)));
      setStudentsTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch {
      await fireSpoNotice({
        icon: 'error',
        title: '학생 목록을 불러오지 못했어요',
        text: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setAcademyStudentsLoading(false);
    }
  };

  const loadFriends = async () => {
    setFriendsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/friends`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as { friends?: Friend[] };
      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      setFriends(response.ok && Array.isArray(data.friends) ? data.friends : []);
    } finally {
      setFriendsLoading(false);
    }
  };

  const loadFriendRequests = async () => {
    setFriendRequestsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/friends/requests`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as { requests?: FriendRequest[] };
      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      setFriendRequests(response.ok && Array.isArray(data.requests) ? data.requests : []);
    } finally {
      setFriendRequestsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as SessionMeResponse;

        if (response.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!cancelled) {
          if (typeof data.user?.id === 'number') {
            setCurrentUserId(data.user.id);
          }
          if (typeof data.user?.role === 'string' && data.user.role.trim()) {
            setCurrentUserRole(data.user.role.trim());
          }
          if (typeof data.user?.profileImageUrl === 'string' && data.user.profileImageUrl.trim()) {
            setProfileImageUrl(data.user.profileImageUrl.trim());
          }
        }

        const normalizedRole = typeof data.user?.role === 'string' ? data.user.role.trim().toLowerCase() : '';
        const shouldUseStudentManagement =
          normalizedRole === 'academy' ||
          normalizedRole === 'mentor' ||
          normalizedRole === 'operator' ||
          normalizedRole === 'admin';

        if (shouldUseStudentManagement) {
          await loadAcademyStudents(1, '');
        } else {
          await Promise.all([loadFriends(), loadFriendRequests()]);
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
    if (openMenuFriendId == null) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpenMenuFriendId(null);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [openMenuFriendId]);

  const handleStudentSearchSubmit = async () => {
    const keyword = studentSearchInput.trim();
    setStudentSearchKeyword(keyword);
    await loadAcademyStudents(1, keyword);
  };

  const handleStudentSearchReset = async () => {
    setStudentSearchInput('');
    setStudentSearchKeyword('');
    await loadAcademyStudents(1, '');
  };

  const handleStudentPageChange = async (nextPage: number) => {
    if (academyStudentsLoading) return;
    const totalPages = Math.max(1, Number(studentsTotalPages || 1));
    const safePage = Math.max(1, Math.min(nextPage, totalPages));
    if (safePage === studentsPage) return;
    await loadAcademyStudents(safePage, studentSearchKeyword);
  };

  const handleFriendRequestSubmit = async () => {
    const targetLoginId = friendRequestInput.trim().toLowerCase();

    if (!targetLoginId) {
      await fireSpoNotice({
        icon: 'warning',
        title: '아이디를 확인해주세요',
        text: '친구 요청을 보낼 로그인 아이디를 입력해주세요.',
      });
      return;
    }

    setIsSubmittingFriendRequest(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/friends/requests`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetLoginId }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '친구 요청을 보내지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      setFriendRequestInput('');
      await Promise.all([loadFriends(), loadFriendRequests()]);
      await fireSpoNotice({
        icon: 'success',
        title: '친구 요청을 보냈어요',
        text: data.message || '상대방이 수락하면 친구 목록에 반영됩니다.',
      });
    } finally {
      setIsSubmittingFriendRequest(false);
    }
  };

  const handleRespondToRequest = async (requestId: number, status: 'accepted' | 'rejected') => {
    setRequestActionId(requestId);
    try {
      const response = await fetch(`${API_BASE_URL}/app/friends/requests/${requestId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '요청을 처리하지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      await Promise.all([loadFriends(), loadFriendRequests()]);
    } finally {
      setRequestActionId(null);
    }
  };

  const handleDeleteFriend = async (friend: Friend) => {
    setOpenMenuFriendId(null);

    const result = await fireSpoSwal({
      icon: 'warning',
      title: '친구를 삭제할까요?',
      text: `${friend.name}님을 친구 목록에서 삭제합니다.`,
      showCancelButton: true,
      confirmButtonText: '삭제',
      confirmButtonColor: '#dc2626',
    });

    if (!result.isConfirmed) return;

    const response = await fetch(`${API_BASE_URL}/app/friends/${friend.id}`, {
      method: 'DELETE',
      credentials: 'include',
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string };

    if (!response.ok) {
      await fireSpoNotice({
        icon: 'error',
        title: '친구를 삭제하지 못했어요',
        text: data.message || '잠시 후 다시 시도해주세요.',
      });
      return;
    }

    await loadFriends();
    await fireSpoNotice({
      icon: 'success',
      title: '친구를 삭제했어요',
      text: data.message || '친구 목록에서 제거되었습니다.',
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">
          {isAcademyManager ? '학생관리 정보를 불러오는 중입니다...' : '친구 정보를 불러오는 중입니다...'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f8f9fa] text-[#191c1d]">
      <AppSidebar activeItem="friends" />
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

        {isAcademyManager ? (
          <div className="px-8 pb-12 pt-8 lg:px-12">
            <div className="mx-auto w-full max-w-[1600px]">
              <header className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
                <div>
                  <h1 className="pl-1 text-3xl font-black tracking-tight text-slate-900">학생관리</h1>
                  <p className="mt-2 font-medium text-slate-500">학원에 등록한 학생 목록을 검색하고 확인하세요.</p>
                </div>

                <div className="flex w-full max-w-2xl gap-2">
                  <div className="relative min-w-0 flex-1">
                    <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
                      <span className="material-symbols-outlined text-slate-400">person_search</span>
                    </div>
                    <input
                      value={studentSearchInput}
                      onChange={(event) => setStudentSearchInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleStudentSearchSubmit();
                        }
                      }}
                      className="h-14 w-full rounded-full border-none bg-[#f3f4f5] pl-12 pr-6 text-sm font-medium text-slate-900 outline-none transition-all focus:bg-white focus:ring-2 focus:ring-[#003dc7]"
                      placeholder="이름, 로그인 아이디, 이메일 검색"
                      type="text"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleStudentSearchSubmit();
                    }}
                    disabled={academyStudentsLoading}
                    className="h-14 rounded-full bg-[#003dc7] px-6 text-xs font-bold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    검색
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleStudentSearchReset();
                    }}
                    disabled={academyStudentsLoading}
                    className="h-14 rounded-full bg-slate-200 px-6 text-xs font-bold text-slate-700 transition-all hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    초기화
                  </button>
                </div>
              </header>

              <section className="rounded-[28px] bg-white p-8 shadow-sm">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-headline text-xl font-bold text-on-surface">학원 등록 학생</h3>
                  <div className="rounded-full bg-[#003dc7] px-4 py-2 text-xs font-bold text-white">
                    전체 {studentsTotal}명
                  </div>
                </div>

                {studentSearchKeyword ? (
                  <p className="mb-4 text-xs font-semibold text-slate-500">
                    검색어: <span className="font-bold text-slate-700">{studentSearchKeyword}</span>
                  </p>
                ) : null}

                {academyStudentsLoading ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
                    학생 목록을 불러오는 중입니다...
                  </div>
                ) : academyStudents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
                    표시할 학생이 없습니다.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {academyStudents.map((student) => (
                      <article
                        key={student.id}
                        className="flex items-start gap-4 rounded-2xl border border-transparent bg-[#f3f4f5] p-4 transition-all duration-300 hover:border-[#c3c5d9]/40 hover:bg-white hover:shadow-xl hover:shadow-[#003dc7]/5"
                      >
                        <img
                          alt={student.name}
                          className="h-12 w-12 rounded-full object-cover"
                          src={student.profileImageUrl || getAvatarUrl(student.name || 'Student')}
                          onError={(event) => {
                            event.currentTarget.src = getAvatarUrl(student.name || 'Student');
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate font-bold text-on-surface">{student.name || `학생 #${student.id}`}</h4>
                          <p className="truncate text-xs font-semibold text-slate-600">
                            {student.loginId ? `@${student.loginId}` : '아이디 없음'}
                          </p>
                          <p className="truncate text-xs font-medium text-slate-500">{student.email || '이메일 정보 없음'}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(Array.isArray(student.academies) ? student.academies : []).map((academy) => (
                              <span
                                key={`${student.id}-academy-${academy.id}`}
                                className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#003dc7]"
                              >
                                {academy.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
                  <p className="text-xs font-semibold text-slate-500">
                    {studentsPage} / {Math.max(1, studentsTotalPages)} 페이지
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={academyStudentsLoading || studentsPage <= 1}
                      onClick={() => {
                        void handleStudentPageChange(studentsPage - 1);
                      }}
                    >
                      이전
                    </button>
                    {visibleStudentPageNumbers.map((pageNumber) => (
                      <button
                        key={`students-page-${pageNumber}`}
                        type="button"
                        className={`rounded-full px-3 py-2 text-xs font-bold ${
                          pageNumber === studentsPage ? 'bg-[#003dc7] text-white' : 'bg-slate-100 text-slate-700'
                        }`}
                        disabled={academyStudentsLoading}
                        onClick={() => {
                          void handleStudentPageChange(pageNumber);
                        }}
                      >
                        {pageNumber}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={academyStudentsLoading || studentsPage >= Math.max(1, studentsTotalPages)}
                      onClick={() => {
                        void handleStudentPageChange(studentsPage + 1);
                      }}
                    >
                      다음
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <>
            <div className="px-8 pb-12 pt-8 lg:px-12">
              <div className="mx-auto w-full max-w-[1600px]">
                <header className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-center">
                  <div>
                    <h1 className="pl-1 text-3xl font-black tracking-tight text-slate-900">친구</h1>
                    <p className="mt-2 font-medium text-slate-500">함께 공부할 친구를 찾고, 요청을 주고받아보세요.</p>
                  </div>

                  <div className="relative w-full max-w-md">
                    <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
                      <span className="material-symbols-outlined text-slate-400">person_add</span>
                    </div>
                    <input
                      value={friendRequestInput}
                      onChange={(event) => setFriendRequestInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleFriendRequestSubmit();
                        }
                      }}
                      className="h-14 w-full rounded-full border-none bg-[#f3f4f5] pl-12 pr-28 text-sm font-medium text-slate-900 outline-none transition-all focus:bg-white focus:ring-2 focus:ring-[#003dc7]"
                      placeholder="로그인 아이디로 친구 추가"
                      type="text"
                      autoCapitalize="off"
                    />
                    <button
                      type="button"
                      onClick={() => void handleFriendRequestSubmit()}
                      disabled={isSubmittingFriendRequest}
                      className="absolute bottom-2 right-2 top-2 rounded-full bg-[#003dc7] px-6 text-xs font-bold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmittingFriendRequest ? '보내는 중...' : '검색'}
                    </button>
                  </div>
                </header>

                <div className="grid grid-cols-1 items-start gap-10 xl:grid-cols-12">
                  <section className="space-y-6 xl:col-span-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-headline text-xl font-bold text-on-surface">친구 요청</h3>
                      <span className="rounded-full bg-[#dde1ff] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#003dc7]">
                        {friendRequestsLoading ? '불러오는 중' : `${pendingIncomingRequests.length}건 대기 중`}
                      </span>
                    </div>

                    <div className="space-y-4">
                      {pendingIncomingRequests.map((request, index) => (
                        <div key={request.id} className="glass-panel flex items-center gap-4 rounded-2xl p-5 transition-transform hover:scale-[1.02]">
                          <img
                            alt={`${request.requester?.name || '사용자'} Profile`}
                            className={`h-14 w-14 rounded-2xl ${index % 3 === 0 ? 'bg-blue-100' : index % 3 === 1 ? 'bg-purple-100' : 'bg-green-100'}`}
                            src={request.requester?.profileImageUrl || getAvatarUrl(request.requester?.name || 'User')}
                            onError={(event) => {
                              event.currentTarget.src = getAvatarUrl(request.requester?.name || 'User');
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate font-bold text-on-surface">{request.requester?.name || '이름 없음'}</h4>
                            <p className="truncate text-xs font-medium text-slate-500">
                              {request.requester ? getFriendSubtitle(request.requester) : '학생'}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#003dc7]/10 text-[#003dc7] transition-all hover:bg-[#003dc7] hover:text-white disabled:cursor-wait disabled:opacity-60"
                              onClick={() => void handleRespondToRequest(request.id, 'accepted')}
                              disabled={requestActionId === request.id}
                            >
                              <span className="material-symbols-outlined text-sm">check</span>
                            </button>
                            <button
                              type="button"
                              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ffdad6]/50 text-[#ba1a1a] transition-all hover:bg-[#ba1a1a] hover:text-white disabled:cursor-wait disabled:opacity-60"
                              onClick={() => void handleRespondToRequest(request.id, 'rejected')}
                              disabled={requestActionId === request.id}
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          </div>
                        </div>
                      ))}

                      {!friendRequestsLoading && pendingIncomingRequests.length === 0 ? (
                        <div className="glass-panel rounded-2xl p-6 text-center text-sm font-semibold text-slate-500">
                          지금 처리할 친구 요청이 없어요.
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="xl:col-span-8">
                    <div className="rounded-[28px] bg-white p-8 shadow-sm">
                      <div className="mb-8 flex items-center justify-between">
                        <h3 className="font-headline text-xl font-bold text-on-surface">내 친구</h3>
                        <div className="rounded-full bg-[#003dc7] px-4 py-2 text-xs font-bold text-white">전체 ({friends.length})</div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {friends.map((friend) => {
                          return (
                            <div
                              key={friend.id}
                              className="group relative flex items-center gap-4 rounded-2xl border border-transparent bg-[#f3f4f5] p-4 transition-all duration-300 hover:border-[#c3c5d9]/40 hover:bg-white hover:shadow-xl hover:shadow-[#003dc7]/5"
                            >
                              <div className="relative">
                                <img
                                  alt={friend.name}
                                  className="h-12 w-12 rounded-full object-cover"
                                  src={friend.profileImageUrl || getAvatarUrl(friend.name)}
                                  onError={(event) => {
                                    event.currentTarget.src = getAvatarUrl(friend.name);
                                  }}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h5 className="font-bold text-on-surface transition-colors group-hover:text-[#003dc7]">{friend.name}</h5>
                                <p className="text-xs font-medium text-slate-500">{getFriendSubtitle(friend)}</p>
                              </div>
                              <button
                                type="button"
                                className="flex h-10 w-10 items-center justify-center rounded-full transition-all hover:bg-slate-100"
                                onClick={() => setOpenMenuFriendId((prev) => (prev === friend.id ? null : friend.id))}
                              >
                                <span className="material-symbols-outlined text-slate-400">more_vert</span>
                              </button>
                              {openMenuFriendId === friend.id ? (
                                <div
                                  ref={menuRef}
                                  className="absolute right-4 top-14 z-10 min-w-[132px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                                >
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold text-red-600 transition hover:bg-red-50"
                                    onClick={() => void handleDeleteFriend(friend)}
                                  >
                                    <span className="material-symbols-outlined text-base">delete</span>
                                    친구 삭제
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      {!friendsLoading && friends.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
                          아직 등록된 친구가 없어요.
                        </div>
                      ) : null}

                      <div className="mt-8 flex justify-center border-t border-slate-100 pt-8">
                        <button type="button" className="rounded-full bg-slate-100 px-8 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200">
                          친구 더 보기
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <button type="button" className="friends-floating-action" aria-label="친구 추가">
              <span className="material-symbols-outlined text-2xl">add</span>
            </button>
          </>
        )}
      </main>
    </div>
  );
}
