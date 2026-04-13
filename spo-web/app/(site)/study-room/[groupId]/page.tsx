'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice } from '@/lib/ui/swal';

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
  description?: string | null;
  memberCount?: number;
  academyId?: number | null;
  academyName?: string | null;
  matchingGuide?: string | null;
};

type StudySession = {
  id: number;
  studyGroupId: number;
  topicTitle: string;
  topicDescription?: string | null;
  scheduledStartAt?: string | null;
  studyDurationMinutes?: number;
  status: string;
};

type StudyRoomContextResponse = {
  studies?: StudyGroup[];
  message?: string;
};

type StudySessionsResponse = {
  sessions?: StudySession[];
  message?: string;
};

type CalendarCell = {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

type SessionMeResponse = {
  user?: {
    role?: string;
  };
};

type ParsedSessionContent = {
  topics: string[];
  sourceText: string;
  answerText: string;
  aiSummary: string | null;
  aiScore: number | null;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const TOPIC_BUNDLE_SEPARATOR = '||';
const WEEKDAY_KEY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const formatDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseDateKeyToLocalDate = (value: string) => {
  const [year, month, day] = String(value || '')
    .split('-')
    .map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const compareDateKeys = (leftDateKey: string, rightDateKey: string) => {
  const leftDate = parseDateKeyToLocalDate(leftDateKey);
  const rightDate = parseDateKeyToLocalDate(rightDateKey);
  if (!leftDate || !rightDate) return 0;
  if (leftDate.getTime() < rightDate.getTime()) return -1;
  if (leftDate.getTime() > rightDate.getTime()) return 1;
  return 0;
};

const normalizeDateKey = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDateKey(parsed);
};

const formatMonthDayBadge = (dateKey: string) => {
  const [_, month = '', day = ''] = String(dateKey || '').split('-');
  const mm = month.padStart(2, '0').slice(-2);
  const dd = day.padStart(2, '0').slice(-2);
  if (!mm || !dd) return '토론';
  return `${mm}${dd} 토론`;
};

const formatStudyDurationLabel = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const restMinutes = safeMinutes % 60;
  if (hours <= 0) return `${restMinutes}분`;
  return `${hours}시간 ${restMinutes}분`;
};

const parseWeeklyDaysFromGuide = (guide?: string | null) => {
  if (!guide) return [];
  const match = guide.match(/운영\s*요일\s*:\s*매주\s*([^\n]+)/);
  if (!match?.[1]) return [];
  const labelToKey: Record<string, string> = {
    월: 'mon',
    화: 'tue',
    수: 'wed',
    목: 'thu',
    금: 'fri',
    토: 'sat',
    일: 'sun',
  };
  return Array.from(
    new Set(
      match[1]
        .split(/[\s,/|]+/)
        .map((token) => labelToKey[token.trim()])
        .filter((value): value is string => Boolean(value)),
    ),
  );
};

const parseClassTimeFromGuide = (guide?: string | null) => {
  if (!guide) return '';
  const match = guide.match(/학원\s*연계\s*수업\s*시간\s*:\s*([^\n]+)/);
  return match?.[1]?.trim() || '';
};

const parseTopicBundle = (value: string | null | undefined) => {
  if (!value) return [];
  return String(value)
    .split(TOPIC_BUNDLE_SEPARATOR)
    .map((item) => decodeHtmlEntities(item).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const decodeHtmlEntities = (value: string) => {
  const source = String(value || '');
  if (!source) return '';

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = source;
    return textarea.value;
  }

  return source
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCharCode(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
};

const stripHtml = (value: string) =>
  decodeHtmlEntities(
    value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim(),
  );

const parseSessionContent = (raw: string | null | undefined): ParsedSessionContent => {
  if (!raw) {
    return { topics: [], sourceText: '', answerText: '', aiSummary: null, aiScore: null };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const schema = String(parsed.schema || '');
      const topics = parseTopicBundle(
        typeof parsed.confirmedTopic === 'string'
          ? parsed.confirmedTopic
          : typeof parsed.selectedTopic === 'string'
            ? parsed.selectedTopic
            : '',
      );
      const sourceText =
        typeof parsed.ocrExtractedText === 'string'
          ? parsed.ocrExtractedText
          : typeof parsed.ocrSourceText === 'string'
            ? parsed.ocrSourceText
            : '';
      const answerRaw = typeof parsed.answerDraft === 'string' ? parsed.answerDraft : '';
      const aiReview =
        parsed.aiReview && typeof parsed.aiReview === 'object'
          ? (parsed.aiReview as { summary?: unknown; score?: unknown })
          : null;

      return {
        topics,
        sourceText: stripHtml(sourceText),
        answerText: stripHtml(answerRaw),
        aiSummary: aiReview && typeof aiReview.summary === 'string' ? decodeHtmlEntities(aiReview.summary) : null,
        aiScore: aiReview && Number.isFinite(Number(aiReview.score)) ? Number(aiReview.score) : null,
      };
    }
  } catch {
    // fallback to raw text below
  }

  return {
    topics: [],
    sourceText: '',
    answerText: stripHtml(String(raw)),
    aiSummary: null,
    aiScore: null,
  };
};

const hasConfirmedTopicInSession = (session: StudySession) => {
  const raw = session.topicDescription;
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return false;

    if (parsed.schema === 'spo-ocr-discussion-v2') {
      const confirmedTopic = typeof parsed.confirmedTopic === 'string' ? parsed.confirmedTopic : '';
      return parseTopicBundle(confirmedTopic).length > 0;
    }

    if (parsed.schema === 'spo-ocr-discussion-v1') {
      const selectedTopic = typeof parsed.selectedTopic === 'string' ? parsed.selectedTopic.trim() : '';
      return Boolean(selectedTopic);
    }

    return false;
  } catch {
    return false;
  }
};

const hasMeaningfulDiscussionRecord = (session: StudySession) => {
  if (hasConfirmedTopicInSession(session)) return true;

  const parsed = parseSessionContent(session.topicDescription);
  if (parsed.topics.length > 0) return true;
  if (parsed.sourceText.trim()) return true;
  if (parsed.answerText.trim()) return true;
  if (parsed.aiSummary?.trim()) return true;
  if (parsed.aiScore != null) return true;
  return false;
};

const buildCalendarCells = (baseDate: Date): CalendarCell[] => {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = formatDateKey(new Date());

  const cells: CalendarCell[] = [];

  for (let i = firstDay - 1; i >= 0; i -= 1) {
    const date = new Date(year, month - 1, daysInPrevMonth - i);
    cells.push({
      key: formatDateKey(date),
      day: date.getDate(),
      inMonth: false,
      isToday: formatDateKey(date) === today,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({
      key: formatDateKey(date),
      day,
      inMonth: true,
      isToday: formatDateKey(date) === today,
    });
  }

  while (cells.length % 7 !== 0) {
    const offset = cells.length - (firstDay + daysInMonth) + 1;
    const date = new Date(year, month + 1, offset);
    cells.push({
      key: formatDateKey(date),
      day: date.getDate(),
      inMonth: false,
      isToday: formatDateKey(date) === today,
    });
  }

  return cells;
};

export default function StudyRoomCalendarPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const groupId = Number(params.groupId);

  const [loading, setLoading] = useState(true);
  const [studyGroup, setStudyGroup] = useState<StudyGroup | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKey(new Date()));
  const [todayDateKey, setTodayDateKey] = useState(() => formatDateKey(new Date()));
  const [userRole, setUserRole] = useState('student');

  const monthTitle = `${calendarDate.getFullYear()}년 ${calendarDate.getMonth() + 1}월`;
  const calendarCells = useMemo(() => buildCalendarCells(calendarDate), [calendarDate]);

  const sessionsByDate = useMemo(() => {
    const dateMap = new Map<string, StudySession[]>();
    sessions.forEach((session) => {
      if (!session.scheduledStartAt || !hasMeaningfulDiscussionRecord(session)) return;
      const parsed = parseDateKey(session.scheduledStartAt);
      if (!parsed) return;

      const dateKey = formatDateKey(parsed);
      const list = dateMap.get(dateKey) || [];
      list.push(session);
      dateMap.set(dateKey, list);
    });
    return dateMap;
  }, [sessions]);

  const studyMinutesByDate = useMemo(() => {
    const minutesMap = new Map<string, number>();
    sessions.forEach((session) => {
      if (!session.scheduledStartAt || !hasMeaningfulDiscussionRecord(session)) return;
      const parsed = parseDateKey(session.scheduledStartAt);
      if (!parsed) return;

      const dateKey = formatDateKey(parsed);
      const currentMinutes = minutesMap.get(dateKey) || 0;
      const nextMinutes = Math.max(0, Math.floor(Number(session.studyDurationMinutes || 0)));
      minutesMap.set(dateKey, currentMinutes + nextMinutes);
    });
    return minutesMap;
  }, [sessions]);

  const selectedDateSessions = useMemo(
    () => (sessionsByDate.get(selectedDateKey) || []).sort((a, b) => String(a.scheduledStartAt || '').localeCompare(String(b.scheduledStartAt || ''))),
    [sessionsByDate, selectedDateKey],
  );
  const studyWeeklyDays = useMemo(
    () => parseWeeklyDaysFromGuide(studyGroup?.matchingGuide),
    [studyGroup?.matchingGuide],
  );
  const studyClassTime = useMemo(
    () => parseClassTimeFromGuide(studyGroup?.matchingGuide),
    [studyGroup?.matchingGuide],
  );
  const plannedStudyDateSet = useMemo(() => {
    if (studyWeeklyDays.length === 0) return new Set<string>();

    const weekdayIndexSet = new Set(
      studyWeeklyDays
        .map((key) => WEEKDAY_KEY_TO_INDEX[key])
        .filter((value): value is number => Number.isInteger(value)),
    );
    if (weekdayIndexSet.size === 0) return new Set<string>();

    const nextSet = new Set<string>();
    calendarCells.forEach((cell) => {
      if (!cell.inMonth) return;
      if (sessionsByDate.has(cell.key)) return;
      if (compareDateKeys(cell.key, todayDateKey) < 0) return;

      const parsed = parseDateKeyToLocalDate(cell.key);
      if (!parsed) return;
      if (weekdayIndexSet.has(parsed.getDay())) {
        nextSet.add(cell.key);
      }
    });

    return nextSet;
  }, [calendarCells, sessionsByDate, studyWeeklyDays, todayDateKey]);
  const selectedDateHasPlannedStudy = plannedStudyDateSet.has(selectedDateKey);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const selectedSession = useMemo(
    () => selectedDateSessions.find((session) => Number(session.id) === Number(selectedSessionId)) || selectedDateSessions[0] || null,
    [selectedDateSessions, selectedSessionId],
  );
  const selectedSessionContent = useMemo(
    () => parseSessionContent(selectedSession?.topicDescription),
    [selectedSession?.topicDescription],
  );
  const isAcademyManager = userRole === 'academy' || userRole === 'mentor';
  const selectedDateCompareToday = compareDateKeys(selectedDateKey, todayDateKey);
  const isSelectedDateFuture = selectedDateCompareToday > 0;
  const hasSelectedDateDiscussionRecord = selectedDateSessions.length > 0;
  const canEnterSelectedDateEditor = selectedDateCompareToday === 0 || (selectedDateCompareToday < 0 && hasSelectedDateDiscussionRecord);
  const selectedDateEditorCtaLabel = selectedDateCompareToday < 0 ? '과거 기록 확인하러 가기' : '오늘 날짜 편집하러 가기';
  const selectedDateEditorDisabledLabel = isSelectedDateFuture
    ? '미래 날짜 토론 불가'
    : hasSelectedDateDiscussionRecord
      ? '과거 날짜는 기록만 확인'
      : '토론 기록이 있어야 이동 가능';

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (!groupId) {
        await fireSpoNotice({
          icon: 'error',
          title: '잘못된 접근',
          text: '유효한 스터디를 선택해주세요.',
        });
        router.replace('/study-room');
        return;
      }

      try {
        const [meResponse, contextResponse, sessionsResponse] = await Promise.all([
          fetch(`/api/auth/me`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/study-room/context`, {
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

        const meData = (await meResponse.json().catch(() => ({}))) as SessionMeResponse;
        const contextData = (await contextResponse.json().catch(() => ({}))) as StudyRoomContextResponse;
        const sessionsData = (await sessionsResponse.json().catch(() => ({}))) as StudySessionsResponse;

        if (contextResponse.status === 401 || sessionsResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!contextResponse.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '불러오기 실패',
            text: contextData.message || '스터디룸 정보를 불러오지 못했습니다.',
          });
          router.replace('/study-room');
          return;
        }

        const foundGroup = (contextData.studies || []).find((study) => study.id === groupId) || null;
        if (!foundGroup) {
          await fireSpoNotice({
            icon: 'warning',
            title: '스터디 없음',
            text: '선택한 스터디를 찾을 수 없습니다.',
          });
          router.replace('/study-room');
          return;
        }

        if (cancelled) return;

        if (typeof meData.user?.role === 'string' && meData.user.role.trim()) {
          setUserRole(meData.user.role.trim());
        }
        setStudyGroup(foundGroup);
        const filteredSessions = (sessionsData.sessions || []).filter(
          (session) => Number(session.studyGroupId) === groupId,
        );
        const recordedSessions = filteredSessions.filter((session) => hasMeaningfulDiscussionRecord(session));
        setSessions(filteredSessions);
        const todayKey =
          normalizeDateKey(contextResponse.headers.get('date')) ||
          normalizeDateKey(sessionsResponse.headers.get('date')) ||
          formatDateKey(new Date());
        setTodayDateKey(todayKey);
        const preferredDateKey = recordedSessions.some((session) => normalizeDateKey(session.scheduledStartAt) === todayKey)
          ? todayKey
          : normalizeDateKey(recordedSessions[0]?.scheduledStartAt) || todayKey;
        setSelectedDateKey(preferredDateKey);
        setSelectedSessionId(
          recordedSessions.find((session) => normalizeDateKey(session.scheduledStartAt) === preferredDateKey)?.id ||
            recordedSessions[0]?.id ||
            null,
        );
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
  }, [groupId, router]);

  useEffect(() => {
    setSelectedSessionId(selectedDateSessions[0]?.id || null);
  }, [selectedDateKey, selectedDateSessions]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">캘린더를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb]">
      <AppSidebar activeItem="study-room" />
      <main className="flex min-w-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/study-room" className="text-sm font-bold text-[#0052FF] hover:underline">
              ← 스터디 리스트로
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">{studyGroup?.name}</h1>
            <p className="text-sm font-medium text-slate-500">
              날짜를 선택하면 당일 수업 복습용 OCR 토론 워크스페이스로 이동합니다.
            </p>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-extrabold text-slate-900">{monthTitle}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                다음
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 text-center">
            {WEEKDAY_LABELS.map((day) => (
              <div key={day} className="py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                {day}
              </div>
            ))}

            {calendarCells.map((cell) => {
              const dailySessions = sessionsByDate.get(cell.key) || [];
              const dailyStudyMinutes = studyMinutesByDate.get(cell.key) || 0;
              const hasPlannedStudy = plannedStudyDateSet.has(cell.key);

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => {
                    setSelectedDateKey(cell.key);
                    setCalendarDate(new Date(cell.key));
                  }}
                  className={`min-h-[92px] rounded-2xl border p-2 text-left transition ${
                    cell.inMonth
                      ? 'border-slate-200 bg-white hover:border-[#0052FF]/40 hover:bg-blue-50/50'
                      : 'border-slate-100 bg-slate-50 text-slate-400'
                  } ${cell.isToday ? 'ring-2 ring-[#0052FF]/35' : ''} ${
                    selectedDateKey === cell.key ? 'border-[#0052FF] bg-blue-50/70 ring-2 ring-[#0052FF]/20' : ''
                  }`}
                >
                  <p className="text-sm font-bold">{cell.day}</p>
                  {dailySessions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded-md bg-[#0052FF] px-2 py-1 text-[10px] font-bold text-white">
                        {formatMonthDayBadge(cell.key)}
                      </span>
                      {dailyStudyMinutes > 0 ? (
                        <span className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">
                          학습 {formatStudyDurationLabel(dailyStudyMinutes)}
                        </span>
                      ) : (
                        <span className="rounded-md bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700">
                          학습 0분
                        </span>
                      )}
                    </div>
                  ) : hasPlannedStudy ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded-md bg-indigo-100 px-2 py-1 text-[10px] font-bold text-indigo-700">
                        예정 스터디
                      </span>
                      {studyClassTime ? (
                        <span className="rounded-md bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700">
                          {studyClassTime}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] font-medium text-slate-400">토론 기록 없음</p>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0052FF]">DAILY STUDY LOG</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">
                {selectedDateKey.replaceAll('-', '.')} 진행 스터디
              </h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                날짜를 선택하면 그날 진행된 세션과 학습 내용을 확인할 수 있어요.
              </p>
            </div>
            {!isAcademyManager ? (
              canEnterSelectedDateEditor ? (
                <Link
                  href={`/study-room/${groupId}/editor?date=${selectedDateKey}`}
                  className="inline-flex items-center justify-center rounded-xl bg-[#0052FF] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#003ec0]"
                >
                  {selectedDateEditorCtaLabel}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-bold text-slate-500"
                >
                  {selectedDateEditorDisabledLabel}
                </button>
              )
            ) : null}
          </div>

          {selectedDateSessions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-600">
                {selectedDateHasPlannedStudy
                  ? '선택한 날짜는 운영 요일에 맞춘 예정 스터디 일정입니다.'
                  : '선택한 날짜에 토론 기록이 없습니다.'}
              </p>
              {selectedDateHasPlannedStudy && studyClassTime ? (
                <p className="mt-2 text-xs font-semibold text-slate-500">예정 시간: {studyClassTime}</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
              <div className="space-y-3">
                {selectedDateSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedSession?.id === session.id
                        ? 'border-[#0052FF] bg-blue-50/70 shadow-[0_12px_24px_rgba(37,99,235,0.12)]'
                        : 'border-slate-200 bg-slate-50 hover:border-[#0052FF]/35 hover:bg-white'
                    }`}
                  >
                    <p className="text-sm font-black text-slate-900">{session.topicTitle}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {session.scheduledStartAt
                        ? new Date(session.scheduledStartAt).toLocaleString('ko-KR')
                        : '시간 미정'}
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      학습 시간 {formatStudyDurationLabel(session.studyDurationMinutes || 0)}
                    </p>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                {selectedSession ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-[#0052FF]">
                        {selectedSession.status}
                      </span>
                      {selectedSessionContent.aiScore != null ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-700">
                          AI 점수 {selectedSessionContent.aiScore}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-900">{selectedSession.topicTitle}</h3>

                    <div className="mt-5 space-y-5">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-slate-400">선정 주제</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedSessionContent.topics.length > 0 ? (
                            selectedSessionContent.topics.map((topic) => (
                              <span key={topic} className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-700">
                                {topic}
                              </span>
                            ))
                          ) : (
                            <p className="text-sm font-medium text-slate-500">저장된 주제가 없습니다.</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-slate-400">학습한 내용</p>
                        <div className="mt-2 rounded-2xl bg-white p-4 text-sm font-medium leading-7 text-slate-700">
                          {selectedSessionContent.answerText || selectedSessionContent.sourceText || '저장된 학습 내용이 없습니다.'}
                        </div>
                      </div>

                      {selectedSessionContent.aiSummary ? (
                        <div>
                          <p className="text-xs font-black uppercase tracking-wider text-slate-400">AI 피드백 요약</p>
                          <div className="mt-2 rounded-2xl bg-white p-4 text-sm font-medium leading-7 text-slate-700">
                            {selectedSessionContent.aiSummary}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </section>
        </div>
      </main>
      </div>
  );
}
