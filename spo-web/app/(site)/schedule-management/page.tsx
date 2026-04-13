'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';

type SessionUserResponse = {
  user?: {
    id?: number;
    loginId?: string;
    profileImageUrl?: string | null;
    role?: string;
  };
  message?: string;
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
  schedule?: PersonalScheduleApiItem | null;
  message?: string;
};

type PersonalScheduleItem = {
  id: number;
  title: string;
  time: string;
  note: string;
};

type PersonalScheduleMap = Record<string, PersonalScheduleItem[]>;

type CalendarCell = {
  date: Date;
  label: string;
  muted: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasSchedules: boolean;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
const SCHEDULE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isSameDate = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const sortSchedulesByTime = (items: PersonalScheduleItem[]) =>
  [...items].sort((a, b) => {
    if (a.time !== b.time) return a.time.localeCompare(b.time);
    return a.id - b.id;
  });

const normalizeApiScheduleItem = (value: PersonalScheduleApiItem) => {
  const id = Number(value.id);
  const date = typeof value.date === 'string' ? value.date.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const note = typeof value.note === 'string' ? value.note.trim() : '';
  const timeRaw = typeof value.time === 'string' ? value.time.trim() : '';
  const matchedTime = timeRaw.match(/^([01]\d|2[0-3]):([0-5]\d)/);
  const time = matchedTime ? `${matchedTime[1]}:${matchedTime[2]}` : '';

  if (!Number.isInteger(id) || id <= 0) return null;
  if (!SCHEDULE_DATE_PATTERN.test(date)) return null;
  if (!title) return null;
  if (!time) return null;

  return {
    date,
    item: {
      id,
      title,
      time,
      note,
    } satisfies PersonalScheduleItem,
  };
};

const buildScheduleMap = (schedules: PersonalScheduleApiItem[] = []): PersonalScheduleMap => {
  const grouped: PersonalScheduleMap = {};

  schedules.forEach((schedule) => {
    const normalized = normalizeApiScheduleItem(schedule);
    if (!normalized) return;
    if (!grouped[normalized.date]) {
      grouped[normalized.date] = [];
    }
    grouped[normalized.date].push(normalized.item);
  });

  return Object.entries(grouped).reduce<PersonalScheduleMap>((acc, [dateKey, items]) => {
    acc[dateKey] = sortSchedulesByTime(items);
    return acc;
  }, {});
};

const buildCalendarCells = (
  monthDate: Date,
  selectedDate: Date,
  schedulesByDate: PersonalScheduleMap,
): CalendarCell[] => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const cells: CalendarCell[] = [];

  for (let i = firstDay - 1; i >= 0; i -= 1) {
    const date = new Date(year, month - 1, daysInPrevMonth - i);
    const dateKey = formatDateKey(date);
    cells.push({
      date,
      label: String(daysInPrevMonth - i),
      muted: true,
      isToday: isSameDate(date, today),
      isSelected: isSameDate(date, selectedDate),
      hasSchedules: Boolean(schedulesByDate[dateKey]?.length),
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = formatDateKey(date);
    cells.push({
      date,
      label: String(day),
      muted: false,
      isToday: isSameDate(date, today),
      isSelected: isSameDate(date, selectedDate),
      hasSchedules: Boolean(schedulesByDate[dateKey]?.length),
    });
  }

  while (cells.length % 7 !== 0) {
    const day = cells.length - (firstDay + daysInMonth) + 1;
    const date = new Date(year, month + 1, day);
    const dateKey = formatDateKey(date);
    cells.push({
      date,
      label: String(day),
      muted: true,
      isToday: isSameDate(date, today),
      isSelected: isSameDate(date, selectedDate),
      hasSchedules: Boolean(schedulesByDate[dateKey]?.length),
    });
  }

  return cells;
};

export default function ScheduleManagementPage() {
  const [loading, setLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile.png');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [calendarDate, setCalendarDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [schedulesByDate, setSchedulesByDate] = useState<PersonalScheduleMap>({});
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleNote, setScheduleNote] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<number | null>(null);

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

        if (userResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        const scheduleResponse = await fetch(`${API_BASE_URL}/app/personal-schedules`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const scheduleData = (await scheduleResponse.json().catch(() => ({}))) as PersonalSchedulesResponse;

        if (scheduleResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!cancelled && typeof userData.user?.profileImageUrl === 'string' && userData.user.profileImageUrl.trim()) {
          setProfileImageUrl(userData.user.profileImageUrl.trim());
        }

        if (!cancelled) {
          if (scheduleResponse.ok && Array.isArray(scheduleData.schedules)) {
            setSchedulesByDate(buildScheduleMap(scheduleData.schedules));
          } else {
            setSchedulesByDate({});
          }
        }
      } catch {
        window.location.replace('/sign-in');
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

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarDate, selectedDate, schedulesByDate),
    [calendarDate, schedulesByDate, selectedDate],
  );
  const selectedDateKey = formatDateKey(selectedDate);
  const selectedDateSchedules = schedulesByDate[selectedDateKey] || [];
  const monthTitle = `${calendarDate.getFullYear()}년 ${calendarDate.getMonth() + 1}월`;
  const selectedDateLabel = `${selectedDate.getFullYear()}년 ${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${weekdayLabels[selectedDate.getDay()]})`;

  const handleDateSelect = (date: Date) => {
    setSelectedDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
    if (date.getMonth() !== calendarDate.getMonth() || date.getFullYear() !== calendarDate.getFullYear()) {
      setCalendarDate(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  const handleAddSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = scheduleTitle.trim();
    const normalizedTime = scheduleTime.trim() || '09:00';
    const normalizedNote = scheduleNote.trim();

    if (!normalizedTitle) {
      setFormError('일정 제목을 입력해주세요.');
      return;
    }
    if (!SCHEDULE_TIME_PATTERN.test(normalizedTime)) {
      setFormError('시간 형식은 HH:MM 이어야 합니다.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/personal-schedules`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDateKey,
          time: normalizedTime,
          title: normalizedTitle,
          note: normalizedNote,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as PersonalSchedulesResponse;
      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        setFormError(data.message || '개인 일정 저장에 실패했습니다.');
        return;
      }

      const normalized = data.schedule ? normalizeApiScheduleItem(data.schedule) : null;
      if (normalized) {
        setSchedulesByDate((previous) => {
          const nextItems = sortSchedulesByTime([...(previous[normalized.date] || []), normalized.item]);
          return {
            ...previous,
            [normalized.date]: nextItems,
          };
        });
      }

      setScheduleTitle('');
      setScheduleNote('');
      setFormError('');
    } catch {
      setFormError('개인 일정 저장 중 네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    if (deletingScheduleId != null) return;
    setDeletingScheduleId(scheduleId);
    try {
      const response = await fetch(`${API_BASE_URL}/app/personal-schedules/${scheduleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        setFormError(data.message || '개인 일정 삭제에 실패했습니다.');
        return;
      }

      setSchedulesByDate((previous) =>
        Object.entries(previous).reduce<PersonalScheduleMap>((acc, [dateKey, items]) => {
          const filtered = items.filter((item) => item.id !== scheduleId);
          if (filtered.length > 0) {
            acc[dateKey] = filtered;
          }
          return acc;
        }, {}),
      );
      setFormError('');
    } catch {
      setFormError('개인 일정 삭제 중 네트워크 오류가 발생했습니다.');
    } finally {
      setDeletingScheduleId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">일정 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb] text-[#191c1d]">
      <AppSidebar activeItem="schedule" />
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
                  event.currentTarget.src = '/default-profile.png';
                }}
              />
            </div>
          </div>
        </header>

        <div className="px-6 pb-10 pt-8 lg:px-10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <header>
              <h1 className="text-3xl font-black tracking-tight text-slate-900">일정 관리</h1>
              <p className="mt-2 text-sm font-medium text-slate-500">
                캘린더에서 날짜를 선택하고 개인 학습 일정을 작성해보세요.
              </p>
            </header>

            <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
              <article className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-black tracking-tight text-slate-900">{monthTitle}</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      onClick={() =>
                        setCalendarDate(
                          (previous) => new Date(previous.getFullYear(), previous.getMonth() - 1, 1),
                        )
                      }
                      aria-label="이전 달 보기"
                    >
                      <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      onClick={() =>
                        setCalendarDate(
                          (previous) => new Date(previous.getFullYear(), previous.getMonth() + 1, 1),
                        )
                      }
                      aria-label="다음 달 보기"
                    >
                      <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                    </button>
                  </div>
                </div>

                <div className="mb-3 grid grid-cols-7 text-center text-xs font-extrabold uppercase tracking-wide text-slate-400">
                  {weekdayLabels.map((label) => (
                    <span key={`weekday-${label}`} className="py-2">
                      {label}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {calendarCells.map((cell) => {
                    const cellDateKey = formatDateKey(cell.date);
                    const cellSchedules = schedulesByDate[cellDateKey] || [];
                    const visibleSchedules = cellSchedules.slice(0, 3);
                    const hiddenCount = Math.max(0, cellSchedules.length - visibleSchedules.length);

                    return (
                      <button
                        type="button"
                        key={`${cellDateKey}-${cell.label}`}
                        className={`relative flex min-h-[110px] flex-col items-start rounded-2xl border px-2.5 py-2 text-left transition ${
                          cell.isSelected
                            ? 'border-[#003dc7] bg-[#e9efff] shadow-[0_8px_24px_rgba(0,61,199,0.15)]'
                            : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50'
                        } ${cell.muted ? 'text-slate-400' : 'text-slate-700'}`}
                        onClick={() => handleDateSelect(cell.date)}
                      >
                        <span
                          className={`text-sm font-bold ${
                            cell.isToday ? 'rounded-full bg-[#003dc7] px-2 py-0.5 text-white' : ''
                          }`}
                        >
                          {cell.label}
                        </span>

                        {visibleSchedules.length > 0 ? (
                          <div className="mt-2 flex w-full flex-col gap-1">
                            {visibleSchedules.map((schedule) => (
                              <span
                                key={schedule.id}
                                className={`inline-flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold leading-none ${
                                  cell.isSelected
                                    ? 'bg-[#003dc7] text-white'
                                    : cell.muted
                                      ? 'bg-slate-100 text-slate-500'
                                      : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                <span
                                  className={`material-symbols-outlined text-[11px] ${
                                    cell.isSelected ? 'text-white/85' : 'text-slate-400'
                                  }`}
                                >
                                  event_note
                                </span>
                                <span className="min-w-0 truncate">{schedule.title}</span>
                              </span>
                            ))}
                            {hiddenCount > 0 ? (
                              <span
                                className={`inline-flex items-center justify-center rounded-md px-1.5 py-1 text-[10px] font-black ${
                                  cell.isSelected
                                    ? 'bg-white/80 text-[#003dc7]'
                                    : cell.muted
                                      ? 'bg-slate-200 text-slate-500'
                                      : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                +{hiddenCount}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </article>

              <article className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                <h2 className="text-xl font-black tracking-tight text-slate-900">일정 작성</h2>
                <p className="mt-2 text-sm font-medium text-slate-500">{selectedDateLabel}</p>

                <form className="mt-5 space-y-4" onSubmit={handleAddSchedule}>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="schedule-title">
                      일정 제목
                    </label>
                    <input
                      id="schedule-title"
                      value={scheduleTitle}
                      onChange={(event) => {
                        setScheduleTitle(event.target.value);
                        if (formError) {
                          setFormError('');
                        }
                      }}
                      placeholder="예: 수학 오답노트 정리"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-[#003dc7] focus:ring-2 focus:ring-[#003dc7]/15"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="schedule-time">
                      시간
                    </label>
                    <input
                      id="schedule-time"
                      type="time"
                      value={scheduleTime}
                      onChange={(event) => setScheduleTime(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-[#003dc7] focus:ring-2 focus:ring-[#003dc7]/15"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="schedule-note">
                      메모
                    </label>
                    <textarea
                      id="schedule-note"
                      value={scheduleNote}
                      onChange={(event) => setScheduleNote(event.target.value)}
                      placeholder="필요한 준비물이나 체크할 포인트를 적어보세요."
                      className="min-h-[96px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-[#003dc7] focus:ring-2 focus:ring-[#003dc7]/15"
                    />
                  </div>

                  {formError ? <p className="text-xs font-bold text-rose-500">{formError}</p> : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-[#003dc7] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#0033a6] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? '저장 중...' : '일정 추가'}
                  </button>
                </form>
              </article>
            </section>

            <section className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-black tracking-tight text-slate-900">작성된 일정</h2>
                <span className="rounded-full bg-[#e9efff] px-3 py-1 text-xs font-black text-[#003dc7]">
                  {selectedDateSchedules.length}개
                </span>
              </div>

              {selectedDateSchedules.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center text-sm font-medium text-slate-500">
                  선택한 날짜에 등록된 일정이 없습니다.
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedDateSchedules.map((schedule) => (
                    <article
                      key={schedule.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-4 md:flex-row md:items-start md:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="inline-flex rounded-full bg-[#e9efff] px-3 py-1 text-xs font-black text-[#003dc7]">
                          {schedule.time}
                        </div>
                        <h3 className="text-base font-black tracking-tight text-slate-900">{schedule.title}</h3>
                        {schedule.note ? (
                          <p className="text-sm font-medium leading-relaxed text-slate-600">{schedule.note}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={deletingScheduleId === schedule.id}
                        className="inline-flex items-center gap-1 self-start rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handleDeleteSchedule(schedule.id)}
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        {deletingScheduleId === schedule.id ? '삭제 중...' : '삭제'}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
