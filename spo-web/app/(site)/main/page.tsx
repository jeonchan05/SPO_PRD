'use client';

import './page.css';

import Head from 'next/head';
import Link from 'next/link';
import { PointerEvent, useEffect, useRef, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoNotice } from '@/lib/ui/swal';

type AcademyNotice = {
  id?: number;
  category: string;
  title: string;
  description: string;
  badge: string;
  icon: string;
  imageUrl?: string | null;
};

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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const normalizeRole = (value?: string | null) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const SCHEDULE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

type CalendarCell = {
  label: string;
  date: Date;
  muted?: boolean;
  dot?: boolean;
  isToday?: boolean;
};

type TodoItem = {
  title: string;
  time: string;
};

type TodoGroup = {
  personal: TodoItem[];
  study: TodoItem[];
};

type PersonalScheduleApiItem = {
  id?: number;
  date?: string;
  time?: string;
  title?: string;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type PersonalSchedulesResponse = {
  schedules?: PersonalScheduleApiItem[];
  message?: string;
};

type StudySessionApiItem = {
  id?: number;
  topicTitle?: string;
  scheduledStartAt?: string | null;
  createdAt?: string;
  groupName?: string;
  status?: string;
};

type StudySessionsResponse = {
  sessions?: StudySessionApiItem[];
  message?: string;
};

type SessionMeResponse = {
  user?: {
    id?: number;
    loginId?: string;
    name?: string;
    profileImageUrl?: string | null;
    role?: string;
  };
};

type DashboardResponse = {
  metrics?: {
    totalStudyMinutes?: number;
    attendanceRate?: number;
    currentStreakDays?: number;
    studentCount?: number;
    studyCount?: number;
    todayParticipantCount?: number;
  };
  notices?: Array<{
    id?: number;
    academyId?: number;
    studyGroupId?: number | null;
    studyGroupName?: string | null;
    title?: string;
    content?: string;
    imageUrl?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
};

type DashboardNoticeItem = NonNullable<DashboardResponse['notices']>[number];

type FriendSuggestion = {
  title: string;
  description: string;
  icon: string;
  accentClassName: string;
  buttonClassName: string;
  ctaLabel: string;
};

const weekdayLabels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTodoPanelDate = (date: Date) =>
  `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;

const formatNoticeBadgeDate = (value?: string) => {
  if (!value) return '업데이트';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '업데이트';
  return parsed.toLocaleDateString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
  });
};

const toDateKeyFromDateString = (value?: string | null) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (SCHEDULE_DATE_PATTERN.test(normalized)) return normalized;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateKey(parsed);
};

const toDateKeyFromDateTime = (value?: string | null) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateKey(parsed);
};

const toTimeLabel = (rawTime?: string | null, dateTimeFallback?: string | null) => {
  const normalizedTime = typeof rawTime === 'string' ? rawTime.trim() : '';
  const matchedTime = normalizedTime.match(SCHEDULE_TIME_PATTERN);
  if (matchedTime) return `${matchedTime[1]}:${matchedTime[2]}`;

  const normalizedDateTime = typeof dateTimeFallback === 'string' ? dateTimeFallback.trim() : '';
  if (normalizedDateTime) {
    const parsed = new Date(normalizedDateTime);
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
    }
  }
  return '시간 미정';
};

const buildTodoMapFromApi = (
  personalSchedules: PersonalScheduleApiItem[] = [],
  studySessions: StudySessionApiItem[] = [],
) => {
  const map: Record<string, TodoGroup> = {};

  const ensureDateBucket = (dateKey: string) => {
    if (!map[dateKey]) {
      map[dateKey] = { personal: [], study: [] };
    }
    return map[dateKey];
  };

  personalSchedules.forEach((schedule) => {
    const dateKey = toDateKeyFromDateString(schedule.date);
    const title = typeof schedule.title === 'string' ? schedule.title.trim() : '';
    if (!dateKey || !title) return;
    const bucket = ensureDateBucket(dateKey);
    bucket.personal.push({
      title,
      time: toTimeLabel(schedule.time, schedule.createdAt),
    });
  });

  studySessions.forEach((session) => {
    const sourceDateTime =
      (typeof session.scheduledStartAt === 'string' && session.scheduledStartAt.trim()) ||
      (typeof session.createdAt === 'string' && session.createdAt.trim()) ||
      '';
    const dateKey = toDateKeyFromDateTime(sourceDateTime);
    const topicTitle = typeof session.topicTitle === 'string' ? session.topicTitle.trim() : '';
    if (!dateKey || !topicTitle) return;

    const groupName = typeof session.groupName === 'string' ? session.groupName.trim() : '';
    const bucket = ensureDateBucket(dateKey);
    bucket.study.push({
      title: groupName ? `${groupName} · ${topicTitle}` : topicTitle,
      time: toTimeLabel('', sourceDateTime),
    });
  });

  Object.keys(map).forEach((dateKey) => {
    map[dateKey].personal.sort((left, right) => left.time.localeCompare(right.time));
    map[dateKey].study.sort((left, right) => left.time.localeCompare(right.time));
  });

  return map;
};

function buildCalendarCells(currentDate: Date, todosByDate: Record<string, TodoGroup>): CalendarCell[] {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const cells: CalendarCell[] = [];

  for (let i = firstDay - 1; i >= 0; i -= 1) {
    const date = new Date(year, month - 1, daysInPrevMonth - i);
    const dateKey = formatDateKey(date);
    const hasTodo = Boolean(todosByDate[dateKey]?.personal?.length || todosByDate[dateKey]?.study?.length);
    cells.push({ label: String(daysInPrevMonth - i), muted: true, dot: hasTodo, date });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);
    const isToday =
      today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const hasTodo = Boolean(todosByDate[dateKey]?.personal?.length || todosByDate[dateKey]?.study?.length);
    cells.push({ label: String(day), dot: hasTodo, isToday, date });
  }

  while (cells.length % 7 !== 0) {
    const day = cells.length - (firstDay + daysInMonth) + 1;
    const date = new Date(year, month + 1, day);
    const dateKey = formatDateKey(date);
    const hasTodo = Boolean(todosByDate[dateKey]?.personal?.length || todosByDate[dateKey]?.study?.length);
    cells.push({ label: String(day), muted: true, dot: hasTodo, date });
  }

  return cells;
}

const getFriendSubtitle = (friend: Friend) => {
  const roleLabel =
    friend.role === 'mentor'
      ? '멘토'
      : friend.role === 'admin'
        ? '관리자'
        : '학생';

  return friend.loginId ? `${roleLabel} · @${friend.loginId}` : roleLabel;
};

const getAvatarUrl = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=334155&bold=true`;

const friendSuggestions: FriendSuggestion[] = [
  {
    title: '스터디 그룹',
    description: '전공과 관심사가 비슷한 학생들과 자동으로 연결되는 그룹을 둘러보세요.',
    icon: 'diversity_3',
    accentClassName: 'friend-suggestion-icon-primary',
    buttonClassName: 'friend-suggestion-button-primary',
    ctaLabel: '그룹 둘러보기',
  },
  {
    title: '스마트 매칭',
    description: '학습 시간대와 목표가 비슷한 친구를 SPO가 추천해 드립니다.',
    icon: 'auto_awesome',
    accentClassName: 'friend-suggestion-icon-secondary',
    buttonClassName: 'friend-suggestion-button-secondary',
    ctaLabel: '매칭 켜기',
  },
  {
    title: '캠퍼스 이벤트',
    description: '오프라인과 온라인 이벤트에서 자연스럽게 새로운 스터디 메이트를 만나보세요.',
    icon: 'event',
    accentClassName: 'friend-suggestion-icon-tertiary',
    buttonClassName: 'friend-suggestion-button-dark',
    ctaLabel: '이벤트 보기',
  },
];

type StudySummaryMetric = {
  label: string;
  value: string;
  hint: string;
  icon: string;
};

function StudySummaryPanel({
  userName,
  userLoginId,
  metrics,
  isAcademyManager,
}: {
  userName: string;
  userLoginId: string;
  metrics: StudySummaryMetric[];
  isAcademyManager: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [motion, setMotion] = useState({ x: 0, y: 0, rx: 0, ry: 0, scale: 1 });

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    const dx = (px - 0.5) * 2;
    const dy = (py - 0.5) * 2;
    setMotion({
      x: dx * 6,
      y: dy * 4,
      rx: -dy * 4,
      ry: dx * 5,
      scale: 1.01,
    });
  };

  const resetMotion = () => {
    setIsHovered(false);
    setMotion({ x: 0, y: 0, rx: 0, ry: 0, scale: 1 });
  };

  return (
    <div
      className={`summary-showcase ${isHovered ? 'summary-showcase-active' : ''}`}
      onPointerEnter={() => setIsHovered(true)}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetMotion}
      onPointerCancel={resetMotion}
    >
      <div
        className="summary-student-card"
        style={{
          transform: `translate3d(${motion.x}px, ${motion.y}px, 0) rotateX(${motion.rx}deg) rotateY(${motion.ry}deg) scale(${motion.scale})`,
        }}
      >
        <div className="summary-student-card__content">
          <div className="summary-student-card__topline">
            <div>
              <p className="summary-student-card__eyebrow">STUDY PROFILE</p>
              <h3 className="summary-student-card__name">{userName.replace(' 학생', '')}</h3>
            </div>
            <div className="summary-student-card__badge">
              <span className="material-symbols-outlined">verified</span>
              {isAcademyManager ? '운영 중' : '진행 중'}
            </div>
          </div>

          <div className="summary-student-card__hero">
            <div className="summary-student-card__identity">
              <div className="summary-student-card__avatar">
                <span className="material-symbols-outlined">{isAcademyManager ? 'business' : 'school'}</span>
              </div>
              <div className="summary-student-card__identity-meta">
                <p className="summary-student-card__caption">
                  {isAcademyManager ? '운영 현황을 한 번에 확인할 수 있어요' : '학습 루틴이 안정적으로 이어지고 있어요'}
                </p>
                <p className="summary-student-card__subtext">
                  {isAcademyManager
                    ? '학생 수, 스터디 수, 오늘 참여 인원을 실데이터로 보여드려요.'
                    : '오늘도 출석, 스터디, 장학금 루트를 한 장에서 확인하세요.'}
                </p>
              </div>
            </div>

            <div className="summary-student-card__idbox">
              <span className="summary-student-card__idlabel">{isAcademyManager ? '관리자 계정' : '학생 번호'}</span>
              <strong>{userLoginId || 'SPO-2026-042'}</strong>
            </div>
          </div>

          <div className="summary-student-card__metrics">
            {metrics.map((metric) => (
              <div key={metric.label} className="summary-student-card__metric">
                <div className="summary-student-card__metric-icon">
                  <span className="material-symbols-outlined">{metric.icon}</span>
                </div>
                <div>
                  <p className="summary-student-card__metric-label">{metric.label}</p>
                  <strong className="summary-student-card__metric-value">{metric.value}</strong>
                  <p className="summary-student-card__metric-hint">{metric.hint}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState('김지민 학생');
  const [userLoginId, setUserLoginId] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [userRole, setUserRole] = useState('student');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendRequestsLoading, setFriendRequestsLoading] = useState(true);
  const [friendRequestInput, setFriendRequestInput] = useState('');
  const [isSubmittingFriendRequest, setIsSubmittingFriendRequest] = useState(false);
  const [requestActionId, setRequestActionId] = useState<number | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardResponse['metrics']>({});
  const [academyNoticeItems, setAcademyNoticeItems] = useState<AcademyNotice[]>([]);
  const [todoByDate, setTodoByDate] = useState<Record<string, TodoGroup>>({});
  const [isTodoLoading, setIsTodoLoading] = useState(true);
  const [isFriendFabOpen, setIsFriendFabOpen] = useState(false);
  const friendFabRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFriends = async () => {
      try {
        setFriendsLoading(true);
        const response = await fetch(`${API_BASE_URL}/app/friends`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as { friends?: Friend[] };
        if (!cancelled) {
          setFriends(response.ok && Array.isArray(data.friends) ? data.friends : []);
        }
      } catch {
        if (!cancelled) {
          setFriends([]);
        }
      } finally {
        if (!cancelled) {
          setFriendsLoading(false);
        }
      }
    };

    const loadFriendRequests = async () => {
      try {
        setFriendRequestsLoading(true);
        const response = await fetch(`${API_BASE_URL}/app/friends/requests`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as { requests?: FriendRequest[] };
        if (!cancelled) {
          setFriendRequests(response.ok && Array.isArray(data.requests) ? data.requests : []);
        }
      } catch {
        if (!cancelled) {
          setFriendRequests([]);
        }
      } finally {
        if (!cancelled) {
          setFriendRequestsLoading(false);
        }
      }
    };

    const verifySession = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as SessionMeResponse;

        if (!response.ok || !data.user) {
          if (!cancelled) {
            window.location.replace('/sign-in');
          }
          return;
        }

        if (cancelled) return;

        if (typeof data.user.id === 'number') {
          setCurrentUserId(data.user.id);
        }
        const nextUserRole = normalizeRole(data.user.role) || 'student';
        setUserRole(nextUserRole);
        if (data.user.name) {
          setUserName(
            nextUserRole === 'academy' || nextUserRole === 'mentor'
              ? data.user.name
              : `${data.user.name}${data.user.name.endsWith('학생') ? '' : ' 학생'}`,
          );
        }
        if (data.user.loginId) {
          setUserLoginId(data.user.loginId);
        }
        if (typeof data.user.profileImageUrl === 'string' && data.user.profileImageUrl.trim()) {
          setProfileImageUrl(data.user.profileImageUrl.trim());
        }
        setIsAuthChecking(false);

        void loadFriends();
        void loadFriendRequests();

        setIsTodoLoading(true);
        const [dashboardResponse, personalScheduleResponse, studySessionResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/app/dashboard`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/personal-schedules`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/study-sessions`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
        ]);

        if (
          dashboardResponse.status === 401 ||
          personalScheduleResponse.status === 401 ||
          studySessionResponse.status === 401
        ) {
          if (!cancelled) {
            window.location.replace('/sign-in');
          }
          return;
        }

        const [dashboardData, personalScheduleData, studySessionData] = await Promise.all([
          dashboardResponse.json().catch(() => ({} as DashboardResponse)),
          personalScheduleResponse.json().catch(() => ({} as PersonalSchedulesResponse)),
          studySessionResponse.json().catch(() => ({} as StudySessionsResponse)),
        ]);

        if (!cancelled && dashboardResponse.ok) {
          setDashboardMetrics(dashboardData.metrics || {});
          if (Array.isArray(dashboardData.notices) && dashboardData.notices.length > 0) {
            setAcademyNoticeItems(
              dashboardData.notices.map((notice: DashboardNoticeItem) => ({
                id: notice.id,
                category: notice.studyGroupId ? '스터디 공지' : '전체 공지',
                title: String(notice.title || '제목 없음'),
                description: String(notice.content || '등록된 공지 내용이 없습니다.'),
                badge: notice.studyGroupId
                  ? String(notice.studyGroupName || '스터디')
                  : formatNoticeBadgeDate(notice.updatedAt || notice.createdAt),
                icon: notice.studyGroupId ? 'groups' : 'campaign',
                imageUrl: typeof notice.imageUrl === 'string' ? notice.imageUrl : null,
              })),
            );
          } else {
            setAcademyNoticeItems([]);
          }
        } else if (!cancelled) {
          setAcademyNoticeItems([]);
        }

        if (!cancelled) {
          const personalSchedules =
            personalScheduleResponse.ok && Array.isArray(personalScheduleData.schedules)
              ? personalScheduleData.schedules
              : [];
          const studySessions =
            studySessionResponse.ok && Array.isArray(studySessionData.sessions)
              ? studySessionData.sessions
              : [];
          setTodoByDate(buildTodoMapFromApi(personalSchedules, studySessions));
        }
      } catch {
        if (!cancelled) {
          setAcademyNoticeItems([]);
          setTodoByDate({});
          window.location.replace('/sign-in');
        }
      } finally {
        if (!cancelled) {
          setIsTodoLoading(false);
        }
      }
    };

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isFriendFabOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (friendFabRef.current?.contains(event.target as Node)) return;
      setIsFriendFabOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsFriendFabOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isFriendFabOpen]);

  const calendarCells = buildCalendarCells(calendarDate, todoByDate);
  const calendarTitle = `${calendarDate.getFullYear()}년 ${calendarDate.getMonth() + 1}월`;
  const todayKey = formatDateKey(new Date());
  const selectedDateKey = formatDateKey(selectedDate);
  const isSelectedDateToday = selectedDateKey === todayKey;
  const selectedDateTodos = todoByDate[selectedDateKey];
  const pendingIncomingRequests = friendRequests.filter(
    (request) => request.status === 'pending' && (currentUserId == null || request.addresseeUserId === currentUserId),
  );
  const friendCountLabel = friendsLoading ? '불러오는 중' : `${friends.length}명 연결됨`;
  const isAcademyManager = userRole === 'academy' || userRole === 'mentor';
  const summaryMetrics: StudySummaryMetric[] = [
    ...(isAcademyManager
      ? [
          {
            label: '학생 수',
            value: `${Number(dashboardMetrics?.studentCount || 0)}명`,
            hint: '현재 운영 스터디에 참여 중인 학생',
            icon: 'groups',
          },
          {
            label: '스터디 수',
            value: `${Number(dashboardMetrics?.studyCount || 0)}개`,
            hint: '학원에서 운영 중인 스터디',
            icon: 'library_books',
          },
          {
            label: '오늘 참여 인원',
            value: `${Number(dashboardMetrics?.todayParticipantCount || 0)}명`,
            hint: '오늘 출석 체크가 기록된 학생',
            icon: 'how_to_reg',
          },
        ]
      : [
          {
            label: '누적 공부 시간',
            value: `${Math.floor(Number(dashboardMetrics?.totalStudyMinutes || 0) / 60)}시간`,
            hint: `${Number(dashboardMetrics?.totalStudyMinutes || 0)}분 누적`,
            icon: 'timer',
          },
          {
            label: '출석률',
            value: `${Number(dashboardMetrics?.attendanceRate || 0)}%`,
            hint: '출석관리 탭과 동일한 기준',
            icon: 'fact_check',
          },
          {
            label: '연속 학습 일수',
            value: `${Number(dashboardMetrics?.currentStreakDays || 0)}일`,
            hint: '최근 학습 흐름을 반영했어요',
            icon: 'calendar_month',
          },
        ]),
  ];

  const reloadFriends = async () => {
    const response = await fetch(`${API_BASE_URL}/app/friends`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as { friends?: Friend[] };
    setFriends(response.ok && Array.isArray(data.friends) ? data.friends : []);
  };

  const reloadFriendRequests = async () => {
    const response = await fetch(`${API_BASE_URL}/app/friends/requests`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as { requests?: FriendRequest[] };
    setFriendRequests(response.ok && Array.isArray(data.requests) ? data.requests : []);
  };

  const handleFriendRequestSubmit = async () => {
    const targetLoginId = friendRequestInput.trim().toLowerCase();

    if (!targetLoginId) {
      await fireSpoNotice({
        icon: 'warning',
        title: '아이디를 확인해주세요',
        text: '친구 요청을 보낼 상대 아이디를 입력해주세요.',
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
      await Promise.all([reloadFriendRequests(), reloadFriends()]);
      await fireSpoNotice({
        icon: 'success',
        title: '친구 요청을 보냈어요',
        text: data.message || '상대방이 수락하면 친구 목록에 바로 반영됩니다.',
      });
    } catch {
      await fireSpoNotice({
        icon: 'error',
        title: '네트워크 오류',
        text: '친구 요청 전송 중 문제가 발생했습니다.',
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

      await Promise.all([reloadFriendRequests(), reloadFriends()]);
    } catch {
      await fireSpoNotice({
        icon: 'error',
        title: '네트워크 오류',
        text: '요청 처리 중 문제가 발생했습니다.',
      });
    } finally {
      setRequestActionId(null);
    }
  };

  if (isAuthChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-4">
        <p className="text-sm font-semibold text-slate-600">로그인 상태를 확인하는 중입니다...</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>SPO Study Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Noto+Sans+KR:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="page-root">
        <AppSidebar activeItem="main" />

        <main className="main-canvas no-topbar">
          <header className="main-topbar sticky top-0 z-40 flex h-16 w-full items-center justify-end bg-[#f5f6f8]/70 px-8 backdrop-blur-xl">
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
          <div className="main-content-grid">
          <div className="main-left">
            <section className="summary-section">
              <StudySummaryPanel
                userName={userName}
                userLoginId={userLoginId}
                metrics={summaryMetrics}
                isAcademyManager={isAcademyManager}
              />
            </section>

            <section className="notices-section">
              <div className="academy-notice-board">
                <div className="academy-notice-board__header">
                  <div>
                    <p className="academy-notice-board__eyebrow">ACADEMY NOTICE</p>
                    <p className="academy-notice-board__headline">학원 공지</p>
                  </div>
                  <div className="academy-notice-board__actions">
                    <Link href="/academy-notices" className="academy-notice-board__see-all">
                      전체보기
                    </Link>
                  </div>
                </div>

                <div className="academy-notice-list">
                  {academyNoticeItems.length === 0 ? (
                    <div className="academy-notice-card">
                      <div className="academy-notice-card__icon">
                        <span className="material-symbols-outlined">campaign</span>
                      </div>
                      <div className="academy-notice-card__body">
                        <div className="academy-notice-card__meta">
                          <span className="academy-notice-card__category">학원 공지</span>
                          <span className="academy-notice-card__badge">대기</span>
                        </div>
                        <h4 className="academy-notice-card__title">등록된 공지가 아직 없어요</h4>
                        <p className="academy-notice-card__description">
                          학원을 등록하고, 내가 참여한 스터디에 공개된 공지사항이 이곳에 표시됩니다.
                        </p>
                      </div>
                    </div>
                  ) : academyNoticeItems.map((notice, index) => (
                    <Link
                      key={`${notice.id ?? notice.title}-${index}`}
                      href={notice.id ? `/academy-notices/${notice.id}` : '/academy-notices'}
                      className="academy-notice-card academy-notice-card-link"
                    >
                      <div className="academy-notice-card__icon">
                        <span className="material-symbols-outlined">{notice.icon}</span>
                      </div>
                      <div className="academy-notice-card__body">
                        <div className="academy-notice-card__meta">
                          <span className="academy-notice-card__category">{notice.category}</span>
                          <span className="academy-notice-card__badge">{notice.badge}</span>
                        </div>
                        <div className="academy-notice-card__headline-row">
                          <h4 className="academy-notice-card__title">{notice.title}</h4>
                          <p className="academy-notice-card__description-inline">{notice.description}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="main-right">
            <div className="side-card">
              <div className="calendar-header">
                <div>
                  <h4 className="side-title">{calendarTitle}</h4>
                  <p className="calendar-current-date">오늘 · {formatTodoPanelDate(new Date())}</p>
                </div>
                <div className="calendar-arrows">
                  <button type="button" className="calendar-arrow-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}>
                    <span className="material-symbols-outlined arrow-icon">chevron_left</span>
                  </button>
                  <button type="button" className="calendar-arrow-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}>
                    <span className="material-symbols-outlined arrow-icon">chevron_right</span>
                  </button>
                </div>
              </div>

              <div className="calendar-grid calendar-weekdays">
                {weekdayLabels.map((day) => (
                  <span key={day} className="weekday">
                    {day}
                  </span>
                ))}
              </div>
              <div className="calendar-grid calendar-days">
                {calendarCells.map((cell, index) => (
                  <button
                    type="button"
                    key={`${cell.label}-${index}`}
                    onClick={() => {
                      setSelectedDate(cell.date);
                      setCalendarDate(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                    }}
                    className={`calendar-day ${cell.muted ? 'muted' : ''} ${
                      selectedDateKey === formatDateKey(cell.date) ? 'active' : ''
                    } ${cell.dot ? 'has-dot' : ''} ${cell.isToday ? 'today' : ''}`}
                  >
                    {cell.label}
                    {cell.dot ? <span className="dot" /> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="selected-todo-card">
              <div className="selected-todo-header">
                <div>
                  <p className="selected-todo-eyebrow">{isSelectedDateToday ? 'TODAY PLAN' : 'SELECTED DATE'}</p>
                  <h4 className="side-title">{formatTodoPanelDate(selectedDate)}</h4>
                </div>
                <span className="selected-todo-chip">{isSelectedDateToday ? '오늘의 할 일' : '선택한 날짜 일정'}</span>
              </div>

              <div className="selected-todo-columns">
                <div className="selected-todo-group">
                  <div className="selected-todo-group-title">
                    <span className="material-symbols-outlined">person</span>
                    <span>개인</span>
                  </div>
                  {isTodoLoading ? (
                    <div className="selected-todo-empty">개인 일정을 불러오는 중...</div>
                  ) : selectedDateTodos?.personal?.length ? (
                    selectedDateTodos.personal.map((todo) => (
                      <div key={`personal-${todo.time}-${todo.title}`} className="selected-todo-item">
                        <span className="selected-todo-time">{todo.time}</span>
                        <p className="selected-todo-text">{todo.title}</p>
                      </div>
                    ))
                  ) : (
                    <div className="selected-todo-empty">예정된 개인 일정이 없어요.</div>
                  )}
                </div>

                <div className="selected-todo-group">
                  <div className="selected-todo-group-title">
                    <span className="material-symbols-outlined">groups</span>
                    <span>스터디</span>
                  </div>
                  {isTodoLoading ? (
                    <div className="selected-todo-empty">스터디 일정을 불러오는 중...</div>
                  ) : selectedDateTodos?.study?.length ? (
                    selectedDateTodos.study.map((todo) => (
                      <div key={`study-${todo.time}-${todo.title}`} className="selected-todo-item">
                        <span className="selected-todo-time">{todo.time}</span>
                        <p className="selected-todo-text">{todo.title}</p>
                      </div>
                    ))
                  ) : (
                    <div className="selected-todo-empty">예정된 스터디 일정이 없어요.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
          </div>

          {!isAcademyManager ? (
            <div ref={friendFabRef} className={`friends-fab ${isFriendFabOpen ? 'friends-fab-open' : ''}`}>
              <div className={`friends-fab-panel ${isFriendFabOpen ? 'friends-fab-panel-open' : ''}`}>
                <div className="friends-fab-panel-head">
                  <h4 className="friends-fab-panel-title">친구</h4>
                  <span className="friends-fab-panel-count">{friendsLoading ? '...' : `${friends.length}명`}</span>
                </div>

                <div className="friends-fab-panel-list">
                  {friendsLoading ? (
                    <div className="friends-fab-panel-empty">친구 목록을 불러오는 중...</div>
                  ) : friends.length === 0 ? (
                    <div className="friends-fab-panel-empty">아직 등록된 친구가 없어요.</div>
                  ) : (
                    friends.slice(0, 5).map((friend) => (
                      <Link key={friend.id} href="/friends" className="friends-fab-item">
                        <img
                          alt={`${friend.name} 프로필`}
                          className="friends-fab-item-avatar"
                          src={friend.profileImageUrl || getAvatarUrl(friend.name)}
                          onError={(event) => {
                            event.currentTarget.src = getAvatarUrl(friend.name);
                          }}
                        />
                        <div className="friends-fab-item-body">
                          <p className="friends-fab-item-name">{friend.name}</p>
                          <p className="friends-fab-item-meta">{getFriendSubtitle(friend)}</p>
                        </div>
                        <span className="material-symbols-outlined friends-fab-item-icon">chat_bubble</span>
                      </Link>
                    ))
                  )}
                </div>

                <Link href="/friends" className="friends-fab-panel-link">
                  친구 탭으로 이동
                </Link>
              </div>

              <button
                type="button"
                className="dashboard-friends-floating-action"
                aria-label={isFriendFabOpen ? '친구 패널 닫기' : '친구 패널 열기'}
                aria-expanded={isFriendFabOpen}
                onClick={() => setIsFriendFabOpen((prev) => !prev)}
              >
                <span className="material-symbols-outlined">{isFriendFabOpen ? 'close' : 'chat'}</span>
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </>
  );
}
