'use client';

import './page.css';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoNotice } from '@/lib/ui/swal';

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
  description?: string | null;
};

type StudySession = {
  id: number;
  studyGroupId: number;
  topicTitle: string;
  scheduledStartAt?: string | null;
  status: string;
};

type AttendanceRecord = {
  id: number;
  studySessionId: number;
  attendanceStatus: 'present' | 'late' | 'absent';
  createdAt?: string;
};

type SessionUserResponse = {
  user?: {
    profileImageUrl?: string | null;
    role?: string;
  };
};

type AcademyAttendanceMember = {
  studyGroupId: number;
  studyGroupName: string;
  userId: number;
  userName: string;
  loginId: string;
  attendedCount: number;
  absentCount: number;
  totalCount: number;
  attendanceRate: number;
};

type AcademyManagementResponse = {
  attendanceMembers?: AcademyAttendanceMember[];
  message?: string;
};

type AttendanceCard = {
  id: number;
  name: string;
  subject: string;
  weeklySchedule: string;
  totalRequiredCount: number;
  attendedCount: number;
  absentCount: number;
  attendanceRate: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const ATTENDANCE_PAGE_SIZE = 5;

const weekdayKorean = ['일', '월', '화', '수', '목', '금', '토'];

const formatTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const getMonthBounds = () => {
  const now = new Date();
  return {
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    monthEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    now,
  };
};

const getWeeklyScheduleLabel = (sessions: StudySession[]) => {
  const scheduledDates = sessions
    .map((session) => (session.scheduledStartAt ? new Date(session.scheduledStartAt) : null))
    .filter((date): date is Date => {
      if (!(date instanceof Date)) {
        return false;
      }
      return !Number.isNaN(date.getTime());
    });

  if (scheduledDates.length === 0) {
    return '활동 일정 미정';
  }

  const patternCount = new Map<string, number>();
  scheduledDates.forEach((date) => {
    const key = `${date.getDay()}-${date.getHours()}-${date.getMinutes()}`;
    patternCount.set(key, (patternCount.get(key) || 0) + 1);
  });

  const topPattern = Array.from(patternCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topPattern) {
    return '활동 일정 미정';
  }

  const [day, hour, minute] = topPattern.split('-').map(Number);
  const sampleDate = new Date();
  sampleDate.setHours(hour, minute, 0, 0);

  return `매주 ${weekdayKorean[day]}요일 ${formatTime(sampleDate)}`;
};

const buildAttendanceCards = (
  groups: StudyGroup[],
  sessions: StudySession[],
  attendance: AttendanceRecord[],
): AttendanceCard[] => {
  const { monthStart, monthEnd, now } = getMonthBounds();
  const attendanceBySessionId = new Map<number, AttendanceRecord>();
  attendance.forEach((record) => {
    attendanceBySessionId.set(Number(record.studySessionId), record);
  });

  return groups.map((group) => {
    const groupSessions = sessions.filter((session) => Number(session.studyGroupId) === Number(group.id));
    const monthlySessions = groupSessions.filter((session) => {
      if (!session.scheduledStartAt || session.status === 'cancelled') return false;
      const scheduledDate = new Date(session.scheduledStartAt);
      if (Number.isNaN(scheduledDate.getTime())) return false;
      return scheduledDate >= monthStart && scheduledDate <= monthEnd && scheduledDate <= now;
    });

    const attendedCount = monthlySessions.filter((session) => {
      const record = attendanceBySessionId.get(Number(session.id));
      return record?.attendanceStatus === 'present' || record?.attendanceStatus === 'late';
    }).length;

    const explicitAbsentCount = monthlySessions.filter((session) => {
      const record = attendanceBySessionId.get(Number(session.id));
      return record?.attendanceStatus === 'absent';
    }).length;

    const totalRequiredCount = monthlySessions.length;
    const absentCount = explicitAbsentCount;
    const totalRecordedCount = attendedCount + absentCount;
    const attendanceRate = totalRecordedCount > 0 ? Math.round((attendedCount / totalRecordedCount) * 100) : 0;

    return {
      id: group.id,
      name: group.name,
      subject: group.subject,
      weeklySchedule: getWeeklyScheduleLabel(groupSessions),
      totalRequiredCount,
      attendedCount,
      absentCount,
      attendanceRate,
    };
  });
};

export default function AttendanceManagementPage() {
  const [loading, setLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [userRole, setUserRole] = useState('student');
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [academyAttendanceMembers, setAcademyAttendanceMembers] = useState<AcademyAttendanceMember[]>([]);
  const [studentPage, setStudentPage] = useState(1);
  const [academyPage, setAcademyPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const userResponse = await fetch(`${API_BASE_URL}/app/users/me`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });

        const userData = (await userResponse.json().catch(() => ({}))) as SessionUserResponse;
        const nextUserRole =
          typeof userData.user?.role === 'string' && userData.user.role.trim() ? userData.user.role.trim() : 'student';
        const isAcademyManager = nextUserRole === 'academy' || nextUserRole === 'mentor';

        if (userResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!userResponse.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '출석 정보를 불러오지 못했어요',
            text: '사용자 인증 정보를 불러오지 못했습니다.',
          });
          return;
        }

        if (!cancelled) {
          if (typeof userData.user?.profileImageUrl === 'string' && userData.user.profileImageUrl.trim()) {
            setProfileImageUrl(userData.user.profileImageUrl.trim());
          }
          setUserRole(nextUserRole);
        }

        if (isAcademyManager) {
          const academyResponse = await fetch(`${API_BASE_URL}/app/academy-management`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          });
          const academyData = (await academyResponse.json().catch(() => ({}))) as AcademyManagementResponse;
          if (academyResponse.status === 401) {
            window.location.replace('/sign-in');
            return;
          }
          if (!academyResponse.ok) {
            await fireSpoNotice({
              icon: 'error',
              title: '학원 출결 정보를 불러오지 못했어요',
              text: academyData.message || '잠시 후 다시 시도해주세요.',
            });
            return;
          }
          if (!cancelled && academyResponse.ok) {
            setAcademyAttendanceMembers(
              Array.isArray(academyData.attendanceMembers) ? academyData.attendanceMembers : [],
            );
            setGroups([]);
            setSessions([]);
            setAttendance([]);
          }
          return;
        }

        const [groupsResponse, sessionsResponse, attendanceResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/app/study-groups`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/study-sessions`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/attendance`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
        ]);

        const groupsData = (await groupsResponse.json().catch(() => ({}))) as { groups?: StudyGroup[]; message?: string };
        const sessionsData = (await sessionsResponse.json().catch(() => ({}))) as { sessions?: StudySession[]; message?: string };
        const attendanceData = (await attendanceResponse.json().catch(() => ({}))) as {
          attendance?: AttendanceRecord[];
          message?: string;
        };

        if (groupsResponse.status === 401 || sessionsResponse.status === 401 || attendanceResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!groupsResponse.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '출석 정보를 불러오지 못했어요',
            text: groupsData.message || '참여 중인 스터디 활동을 불러오지 못했습니다.',
          });
          return;
        }

        if (!cancelled) {
          setGroups(Array.isArray(groupsData.groups) ? groupsData.groups : []);
          setSessions(sessionsResponse.ok && Array.isArray(sessionsData.sessions) ? sessionsData.sessions : []);
          setAttendance(attendanceResponse.ok && Array.isArray(attendanceData.attendance) ? attendanceData.attendance : []);
          setAcademyAttendanceMembers([]);
        }

        if (!sessionsResponse.ok || !attendanceResponse.ok) {
          await fireSpoNotice({
            icon: 'warning',
            title: '일부 출석 기록을 불러오지 못했어요',
            text:
              sessionsData.message ||
              attendanceData.message ||
              '활동 목록은 표시하지만 세부 출석 통계는 일부 누락될 수 있습니다.',
          });
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

  const attendanceCards = useMemo(
    () => buildAttendanceCards(groups, sessions, attendance),
    [groups, sessions, attendance],
  );
  const isAcademyManager = userRole === 'academy' || userRole === 'mentor';
  const studentTotalPages = Math.max(1, Math.ceil(attendanceCards.length / ATTENDANCE_PAGE_SIZE));
  const academyTotalPages = Math.max(1, Math.ceil(academyAttendanceMembers.length / ATTENDANCE_PAGE_SIZE));
  const safeStudentPage = Math.min(studentPage, studentTotalPages);
  const safeAcademyPage = Math.min(academyPage, academyTotalPages);

  useEffect(() => {
    setStudentPage((prev) => Math.min(prev, studentTotalPages));
  }, [studentTotalPages]);

  useEffect(() => {
    setAcademyPage((prev) => Math.min(prev, academyTotalPages));
  }, [academyTotalPages]);

  const visibleStudentCards = useMemo(() => {
    const startIndex = (safeStudentPage - 1) * ATTENDANCE_PAGE_SIZE;
    return attendanceCards.slice(startIndex, startIndex + ATTENDANCE_PAGE_SIZE);
  }, [attendanceCards, safeStudentPage]);

  const visibleAcademyMembers = useMemo(() => {
    const startIndex = (safeAcademyPage - 1) * ATTENDANCE_PAGE_SIZE;
    return academyAttendanceMembers.slice(startIndex, startIndex + ATTENDANCE_PAGE_SIZE);
  }, [academyAttendanceMembers, safeAcademyPage]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">출석 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb] text-[#191c1d]">
      <AppSidebar activeItem="attendance" />
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

        <div className="px-6 pb-10 pt-8 lg:px-10">
          <div className="mx-auto max-w-6xl">
            <header className="mb-8">
              <h1 className="text-3xl font-black tracking-tight text-slate-900">출석 관리</h1>
              <p className="mt-2 text-sm font-medium text-slate-500">
                {isAcademyManager
                  ? '운영 중인 스터디에 참여하는 학생들의 출결 현황을 확인할 수 있어요.'
                  : '참여 중인 스터디별로 이번 달 출석 현황을 한눈에 확인할 수 있어요.'}
              </p>
            </header>

            <section className="grid gap-4">
              {isAcademyManager
                ? visibleAcademyMembers.map((member) => (
                    <article
                      key={`${member.studyGroupId}-${member.userId}`}
                      className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div>
                            <div className="mb-2 inline-flex rounded-full bg-[#dde1ff] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#003dc7]">
                              {member.loginId}
                            </div>
                            <h2 className="text-2xl font-black tracking-tight text-slate-900">{member.userName}</h2>
                          </div>
                          <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
                            <span className="material-symbols-outlined text-[18px] text-[#003dc7]">groups</span>
                            {member.studyGroupName}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                          <div className="attendance-metric-card">
                            <p className="attendance-metric-label">이번달 출석일</p>
                            <strong className="attendance-metric-value">{member.totalCount}</strong>
                          </div>
                          <div className="attendance-metric-card">
                            <p className="attendance-metric-label">출석</p>
                            <strong className="attendance-metric-value text-[#16a34a]">{member.attendedCount}</strong>
                          </div>
                          <div className="attendance-metric-card">
                            <p className="attendance-metric-label">결석</p>
                            <strong className="attendance-metric-value text-[#dc2626]">{member.absentCount}</strong>
                          </div>
                          <div className="attendance-metric-card">
                            <p className="attendance-metric-label">출석률</p>
                            <strong className="attendance-metric-value text-[#003dc7]">{member.attendanceRate}%</strong>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                : visibleStudentCards.map((card) => (
                <article
                  key={card.id}
                  className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl"
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div>
                        <div className="mb-2 inline-flex rounded-full bg-[#dde1ff] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#003dc7]">
                          {card.subject}
                        </div>
                        <h2 className="text-2xl font-black tracking-tight text-slate-900">{card.name}</h2>
                      </div>
                      <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
                        <span className="material-symbols-outlined text-[18px] text-[#003dc7]">schedule</span>
                        {card.weeklySchedule}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                      <div className="attendance-metric-card">
                        <p className="attendance-metric-label">이번달 출석일</p>
                        <strong className="attendance-metric-value">{card.totalRequiredCount}</strong>
                      </div>
                      <div className="attendance-metric-card">
                        <p className="attendance-metric-label">출석</p>
                        <strong className="attendance-metric-value text-[#16a34a]">{card.attendedCount}</strong>
                      </div>
                      <div className="attendance-metric-card">
                        <p className="attendance-metric-label">결석</p>
                        <strong className="attendance-metric-value text-[#dc2626]">{card.absentCount}</strong>
                      </div>
                      <div className="attendance-metric-card">
                        <p className="attendance-metric-label">출석률</p>
                        <strong className="attendance-metric-value text-[#003dc7]">{card.attendanceRate}%</strong>
                      </div>
                      <div className="attendance-metric-card attendance-metric-card-action">
                        <Link href={`/study-room/${card.id}`} className="attendance-detail-link">
                          상세 보기
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}

              {(isAcademyManager ? academyAttendanceMembers.length === 0 : attendanceCards.length === 0) ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center">
                  <h2 className="text-xl font-black text-slate-900">
                    {isAcademyManager ? '확인할 학생 출결 데이터가 없습니다' : '참여 중인 스터디가 없습니다'}
                  </h2>
                  <p className="mt-2 text-sm font-medium text-slate-500">
                    {isAcademyManager
                      ? '학원에서 운영 중인 스터디에 학생이 참여하면 이곳에 자동으로 표시됩니다.'
                      : '스터디룸에서 그룹에 참여하면 출석 관리 탭에 자동으로 표시됩니다.'}
                  </p>
                </div>
              ) : null}

              {(isAcademyManager ? academyAttendanceMembers.length > ATTENDANCE_PAGE_SIZE : attendanceCards.length > ATTENDANCE_PAGE_SIZE) ? (
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      if (isAcademyManager) {
                        setAcademyPage((prev) => Math.max(1, prev - 1));
                        return;
                      }
                      setStudentPage((prev) => Math.max(1, prev - 1));
                    }}
                    disabled={isAcademyManager ? safeAcademyPage <= 1 : safeStudentPage <= 1}
                  >
                    이전
                  </button>
                  <span className="min-w-[72px] text-center text-sm font-bold text-slate-700">
                    {isAcademyManager ? `${safeAcademyPage} / ${academyTotalPages}` : `${safeStudentPage} / ${studentTotalPages}`}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      if (isAcademyManager) {
                        setAcademyPage((prev) => Math.min(academyTotalPages, prev + 1));
                        return;
                      }
                      setStudentPage((prev) => Math.min(studentTotalPages, prev + 1));
                    }}
                    disabled={isAcademyManager ? safeAcademyPage >= academyTotalPages : safeStudentPage >= studentTotalPages}
                  >
                    다음
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
