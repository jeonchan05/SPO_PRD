'use client';

import './page.css';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { fireSpoNotice, fireSpoSwal } from '@/lib/ui/swal';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const RECRUITMENT_PAGE_SIZE = 5;

type Academy = {
  id: number;
  name: string;
  address?: string | null;
};

type Study = {
  id: number;
  name: string;
  subject: string;
  description?: string | null;
  academyId?: number | null;
  academyName?: string | null;
  memberCount?: number;
  isActive?: boolean;
};

type AcademyNotice = {
  id: number;
  academyId: number;
  studyGroupId?: number | null;
  studyGroupName?: string | null;
  title: string;
  content: string;
  imageUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
};

type RewardSetting = {
  academyId: number;
  absencePassProbability: number;
  gifticonProbability: number;
  missProbability: number;
  dailySpinLimit: number;
  attendanceRateThreshold?: number;
  monthlyAttendanceMinCount?: number;
  rewardDescription?: string;
};

type RecruitmentCustomCheck = {
  id: string;
  title: string;
  inputType: 'button' | 'radio';
  options: string[];
  enabled?: boolean;
};

type RecruitmentApplicationCheckConfig = {
  participationTitle: string;
  participationOptions: Array<{ key: 'join' | 'skip'; label: string }>;
  enableMbti?: boolean;
  mbtiTitle?: string;
  enablePreferredStyle?: boolean;
  styleTitle: string;
  styleOptions: string[];
  enablePersonality?: boolean;
  presentationTitle: string;
  presentationOptions: Array<{ key: 'passive' | 'normal' | 'presenter'; label: string }>;
  customChecks?: RecruitmentCustomCheck[];
};

type Recruitment = {
  id: number;
  academyId?: number | null;
  title: string;
  targetClass?: string | null;
  reviewScope?: string | null;
  recruitmentStartAt?: string | null;
  recruitmentEndAt?: string | null;
  minApplicants?: number | null;
  maxApplicants?: number | null;
  teamSize?: number | null;
  matchingGuide?: string | null;
  applicationCheckConfig?: RecruitmentApplicationCheckConfig | null;
  status?: 'open' | 'matching' | 'completed' | 'closed';
  createdAt?: string;
  updatedAt?: string;
};

type RecruitmentApplicant = {
  id: number;
  userId: number;
  userName: string;
  loginId?: string | null;
  participationIntent: 'join' | 'skip';
  preferredStyle?: string | null;
  mbtiType?: string | null;
  presentationLevel: 'passive' | 'normal' | 'presenter';
  customResponses?: Record<string, string> | null;
  updatedAt?: string;
};

type RecruitmentDetailResponse = {
  recruitment?: Recruitment;
  totalApplicants?: number;
  applicants?: RecruitmentApplicant[];
  permission?: {
    canRunMatching?: boolean;
  };
  message?: string;
};

type RecruitmentApplicantPanelData = {
  totalApplicants: number;
  applicants: RecruitmentApplicant[];
  canRunMatching: boolean;
};

type AcademyManagementResponse = {
  academies?: Academy[];
  studies?: Study[];
  notices?: AcademyNotice[];
  rewardSettings?: RewardSetting[];
  recruitments?: Recruitment[];
  message?: string;
};

type StudySetupFieldErrors = {
  recruitmentTitle: boolean;
  recruitmentStartAt: boolean;
  recruitmentEndAt: boolean;
  studyWeeklyDays: boolean;
  studyClassTime: boolean;
  monthlyAttendanceMinCount: boolean;
  rewardDescription: boolean;
};

type SessionMeResponse = {
  user?: {
    profileImageUrl?: string | null;
  };
};

const WEEKDAY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: '월' },
  { key: 'tue', label: '화' },
  { key: 'wed', label: '수' },
  { key: 'thu', label: '목' },
  { key: 'fri', label: '금' },
  { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
];

const RECRUITMENT_STATUS_LABEL: Record<NonNullable<Recruitment['status']>, string> = {
  open: '모집중',
  matching: '매칭중',
  completed: '매칭완료',
  closed: '종료',
};

const PRESENTATION_LEVEL_LABEL: Record<RecruitmentApplicant['presentationLevel'], string> = {
  passive: '소극적',
  normal: '보통',
  presenter: '활발',
};

const DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG: RecruitmentApplicationCheckConfig = {
  participationTitle: '스터디 참여 의사',
  participationOptions: [
    { key: 'join', label: '참여할래요' },
    { key: 'skip', label: '이번엔 어려워요' },
  ],
  enableMbti: false,
  mbtiTitle: 'MBTI',
  enablePreferredStyle: false,
  styleTitle: '같이 하고 싶은 스타일',
  styleOptions: ['조용히 집중해서 함께 공부', '개념을 차근차근 정리하며 공부', '질문을 많이 주고받는 토론형', '문제 풀이를 함께 점검하는 피드백형'],
  enablePersonality: false,
  presentationTitle: '성격',
  presentationOptions: [
    { key: 'passive', label: '소극적' },
    { key: 'normal', label: '보통' },
    { key: 'presenter', label: '활발' },
  ],
  customChecks: [],
};

const EMPTY_STUDY_SETUP_FIELD_ERRORS: StudySetupFieldErrors = {
  recruitmentTitle: false,
  recruitmentStartAt: false,
  recruitmentEndAt: false,
  studyWeeklyDays: false,
  studyClassTime: false,
  monthlyAttendanceMinCount: false,
  rewardDescription: false,
};

const formatDateTimeLabel = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('ko-KR');
};

const toDateTimeInputValue = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const toOptionalPositiveNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
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

const stripScheduleGuideFromMatchingGuide = (guide?: string | null) => {
  if (!guide) return '';
  return guide
    .split('\n')
    .filter((line) => !/^\s*운영\s*요일\s*:/.test(line) && !/^\s*학원\s*연계\s*수업\s*시간\s*:/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const composeMatchingGuide = (memo: string, weeklyDays: string[], classTime: string) => {
  const weeklyDayLabel = WEEKDAY_OPTIONS.filter((option) => weeklyDays.includes(option.key))
    .map((option) => option.label)
    .join(', ');
  const scheduleLines: string[] = [];
  if (weeklyDayLabel) scheduleLines.push(`운영 요일: 매주 ${weeklyDayLabel}`);
  if (classTime.trim()) scheduleLines.push(`학원 연계 수업 시간: ${classTime.trim()}`);
  const scheduleGuide = scheduleLines.join('\n');
  return [memo.trim(), scheduleGuide].filter(Boolean).join('\n\n');
};

const toCustomChecksFromConfig = (config?: RecruitmentApplicationCheckConfig | null): RecruitmentCustomCheck[] => {
  const rows = Array.isArray(config?.customChecks) ? config?.customChecks : [];
  return rows
    .map((row, index) => {
      const title = typeof row?.title === 'string' ? row.title.trim() : '';
      const options = Array.isArray(row?.options)
        ? row.options.filter((option) => typeof option === 'string' && option.trim()).map((option) => option.trim())
        : [];
      if (!title) return null;
      const nextCheck: RecruitmentCustomCheck = {
        id:
          typeof row?.id === 'string' && row.id.trim()
            ? row.id.trim()
            : `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${index + 1}`.toLowerCase(),
        title,
        inputType: row?.inputType === 'radio' ? 'radio' : 'button',
        options,
        enabled: true,
      };
      return nextCheck;
    })
    .filter((check): check is RecruitmentCustomCheck => Boolean(check));
};

const createDefaultCustomCheck = (order: number): RecruitmentCustomCheck => ({
  id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.toLowerCase(),
  title: `커스텀 신청 항목 ${order}`,
  inputType: 'button',
  options: [],
  enabled: true,
});

type UnifiedSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type UnifiedSelectProps = {
  value: string;
  options: UnifiedSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  plain?: boolean;
};

function UnifiedSelect({ value, options, onChange, placeholder, disabled = false, plain = false }: UnifiedSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsidePointer);
    return () => document.removeEventListener('mousedown', handleOutsidePointer);
  }, [open]);

  return (
    <div ref={containerRef} className={`spo-select ${plain ? 'spo-select-plain' : ''} ${disabled ? 'spo-select-disabled' : ''}`}>
      <button
        type="button"
        className="spo-select-trigger"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
      >
        <span className="spo-select-trigger-text">{selectedOption?.label || placeholder || '선택'}</span>
        <span className="spo-select-trigger-icon">{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div className="spo-select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`spo-select-option ${option.value === value ? 'spo-select-option-active' : ''}`}
              disabled={option.disabled}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AcademyManagementContent() {
  const searchParams = useSearchParams();
  const [entrySection, setEntrySection] = useState<'recruitment' | 'notice'>('recruitment');
  const [loading, setLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [notices, setNotices] = useState<AcademyNotice[]>([]);
  const [recruitments, setRecruitments] = useState<Recruitment[]>([]);
  const [rewardSettings, setRewardSettings] = useState<RewardSetting[]>([]);
  const [selectedAcademyId, setSelectedAcademyId] = useState<number | null>(null);
  const [selectedNoticeStudyGroupId, setSelectedNoticeStudyGroupId] = useState<number | null>(null);
  const [noticeTargetType, setNoticeTargetType] = useState<'study' | 'all'>('study');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeContent, setNoticeContent] = useState('');
  const [noticeImageFile, setNoticeImageFile] = useState<File | null>(null);
  const [noticeImagePreviewUrl, setNoticeImagePreviewUrl] = useState<string | null>(null);
  const [noticeImageServerUrl, setNoticeImageServerUrl] = useState<string | null>(null);
  const [studyName, setStudyName] = useState('');
  const [studySubject, setStudySubject] = useState('');
  const [studyDescription, setStudyDescription] = useState('');
  const [studyMaxMembers, setStudyMaxMembers] = useState('');
  const [studyWeeklyDays, setStudyWeeklyDays] = useState<string[]>([]);
  const [studyClassTime, setStudyClassTime] = useState('');
  const [monthlyAttendanceMinCount, setMonthlyAttendanceMinCount] = useState('');
  const [rewardDescription, setRewardDescription] = useState('');
  const [recruitmentTitle, setRecruitmentTitle] = useState('');
  const [recruitmentTargetClass, setRecruitmentTargetClass] = useState('');
  const [recruitmentStartAt, setRecruitmentStartAt] = useState('');
  const [recruitmentEndAt, setRecruitmentEndAt] = useState('');
  const [recruitmentMinApplicants, setRecruitmentMinApplicants] = useState('');
  const [recruitmentTeamSize, setRecruitmentTeamSize] = useState('');
  const [recruitmentMaxApplicants, setRecruitmentMaxApplicants] = useState('');
  const [recruitmentGuide, setRecruitmentGuide] = useState('');
  const [studySetupFieldErrors, setStudySetupFieldErrors] = useState<StudySetupFieldErrors>(EMPTY_STUDY_SETUP_FIELD_ERRORS);
  const [checkEnableMbti, setCheckEnableMbti] = useState(Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enableMbti));
  const [checkEnableStyle, setCheckEnableStyle] = useState(Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePreferredStyle));
  const [checkEnablePersonality, setCheckEnablePersonality] = useState(Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePersonality));
  const [spoSettingsOpen, setSpoSettingsOpen] = useState(false);
  const [customChecks, setCustomChecks] = useState<RecruitmentCustomCheck[]>([]);
  const [customCheckOptionInputs, setCustomCheckOptionInputs] = useState<Record<string, string>>({});
  const [studySetupSubmitting, setStudySetupSubmitting] = useState(false);
  const [noticeSubmitting, setNoticeSubmitting] = useState(false);
  const [deletingNoticeId, setDeletingNoticeId] = useState<number | null>(null);
  const [editingNoticeId, setEditingNoticeId] = useState<number | null>(null);
  const [noticeViewMode, setNoticeViewMode] = useState<'manage' | 'add'>('manage');
  const [noticeSearchKeyword, setNoticeSearchKeyword] = useState('');
  const [noticePage, setNoticePage] = useState(1);
  const [recruitmentViewMode, setRecruitmentViewMode] = useState<'manage' | 'add'>('manage');
  const [editingRecruitmentId, setEditingRecruitmentId] = useState<number | null>(null);
  const [recruitmentSearchKeyword, setRecruitmentSearchKeyword] = useState('');
  const [recruitmentPage, setRecruitmentPage] = useState(1);
  const [deletingRecruitmentId, setDeletingRecruitmentId] = useState<number | null>(null);
  const [expandedRecruitmentId, setExpandedRecruitmentId] = useState<number | null>(null);
  const [loadingRecruitmentApplicantsId, setLoadingRecruitmentApplicantsId] = useState<number | null>(null);
  const [runningMatchingRecruitmentId, setRunningMatchingRecruitmentId] = useState<number | null>(null);
  const [recruitmentApplicantPanelMap, setRecruitmentApplicantPanelMap] = useState<Record<number, RecruitmentApplicantPanelData>>({});
  const noticeImageInputRef = useRef<HTMLInputElement | null>(null);
  const noticeImageObjectUrlRef = useRef<string | null>(null);

  const selectedRewardSetting = useMemo(
    () => rewardSettings.find((item) => Number(item.academyId) === Number(selectedAcademyId)) ?? null,
    [rewardSettings, selectedAcademyId],
  );

  const filteredStudies = useMemo(
    () => studies.filter((study) => !selectedAcademyId || Number(study.academyId) === Number(selectedAcademyId)),
    [studies, selectedAcademyId],
  );

  const filteredNotices = useMemo(
    () => notices.filter((notice) => !selectedAcademyId || Number(notice.academyId) === Number(selectedAcademyId)),
    [notices, selectedAcademyId],
  );
  const sortedNotices = useMemo(
    () =>
      [...filteredNotices].sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return Number(b.id) - Number(a.id);
      }),
    [filteredNotices],
  );
  const searchedNotices = useMemo(() => {
    const keyword = noticeSearchKeyword.trim().toLowerCase();
    if (!keyword) return sortedNotices;
    return sortedNotices.filter((notice) => {
      const values = [
        notice.title,
        notice.content,
        notice.studyGroupName,
        notice.studyGroupId ? '스터디 공지' : '전체 공지',
        new Date(notice.updatedAt || notice.createdAt).toLocaleString('ko-KR'),
      ];
      return values.some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [sortedNotices, noticeSearchKeyword]);
  const noticePageCount = useMemo(() => Math.max(1, Math.ceil(searchedNotices.length / RECRUITMENT_PAGE_SIZE)), [searchedNotices.length]);
  const pagedNotices = useMemo(() => {
    const safePage = Math.max(1, Math.min(noticePage, noticePageCount));
    const startIndex = (safePage - 1) * RECRUITMENT_PAGE_SIZE;
    return searchedNotices.slice(startIndex, startIndex + RECRUITMENT_PAGE_SIZE);
  }, [searchedNotices, noticePage, noticePageCount]);

  const filteredRecruitments = useMemo(
    () => recruitments.filter((item) => !selectedAcademyId || Number(item.academyId) === Number(selectedAcademyId)),
    [recruitments, selectedAcademyId],
  );
  const sortedRecruitments = useMemo(
    () =>
      [...filteredRecruitments].sort((a, b) => {
        const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
        const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return Number(b.id) - Number(a.id);
      }),
    [filteredRecruitments],
  );
  const searchedRecruitments = useMemo(() => {
    const keyword = recruitmentSearchKeyword.trim().toLowerCase();
    if (!keyword) return sortedRecruitments;
    return sortedRecruitments.filter((recruitment) => {
      const values = [
        recruitment.title,
        recruitment.targetClass,
        recruitment.matchingGuide,
        recruitment.status,
        formatDateTimeLabel(recruitment.recruitmentStartAt),
        formatDateTimeLabel(recruitment.recruitmentEndAt),
      ];
      return values.some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [sortedRecruitments, recruitmentSearchKeyword]);
  const recruitmentPageCount = useMemo(
    () => Math.max(1, Math.ceil(searchedRecruitments.length / RECRUITMENT_PAGE_SIZE)),
    [searchedRecruitments.length],
  );
  const pagedRecruitments = useMemo(() => {
    const safePage = Math.max(1, Math.min(recruitmentPage, recruitmentPageCount));
    const startIndex = (safePage - 1) * RECRUITMENT_PAGE_SIZE;
    return searchedRecruitments.slice(startIndex, startIndex + RECRUITMENT_PAGE_SIZE);
  }, [searchedRecruitments, recruitmentPage, recruitmentPageCount]);
  const selectedAcademy = useMemo(
    () => academies.find((academy) => Number(academy.id) === Number(selectedAcademyId)) ?? null,
    [academies, selectedAcademyId],
  );
  const academySelectOptions = useMemo<UnifiedSelectOption[]>(
    () =>
      academies.map((academy) => ({
        value: String(academy.id),
        label: academy.name,
      })),
    [academies],
  );
  const noticeStudySelectOptions = useMemo<UnifiedSelectOption[]>(
    () =>
      filteredStudies.length === 0
        ? [{ value: '', label: '운영 중인 스터디가 없습니다', disabled: true }]
        : filteredStudies.map((study) => ({ value: String(study.id), label: `${study.name} · ${study.subject}` })),
    [filteredStudies],
  );
  const isNoticeSection = entrySection === 'notice';
  const isRecruitmentSection = !isNoticeSection;

  const expectedMonthlySessions = useMemo(
    () => Math.max(4, Math.max(1, studyWeeklyDays.length) * 4),
    [studyWeeklyDays.length],
  );
  const selectedWeeklyDaysLabel = useMemo(
    () => WEEKDAY_OPTIONS.filter((option) => studyWeeklyDays.includes(option.key)).map((option) => option.label).join(', '),
    [studyWeeklyDays],
  );
  const completedCustomChecks = useMemo(
    () => customChecks.filter((check) => check.title.trim() && check.options.length >= 2),
    [customChecks],
  );
  const computedAttendanceRateThreshold = useMemo(() => {
    const monthlyCount = Math.floor(Number(monthlyAttendanceMinCount));
    if (!Number.isFinite(monthlyCount) || monthlyCount <= 0) return null;
    return Math.max(0, Math.min(100, Number(((monthlyCount / expectedMonthlySessions) * 100).toFixed(2))));
  }, [monthlyAttendanceMinCount, expectedMonthlySessions]);
  const applicationCheckConfigPayload = useMemo<RecruitmentApplicationCheckConfig>(
    () => ({
      participationTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationTitle,
      participationOptions: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationOptions,
      enableMbti: checkEnableMbti,
      mbtiTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.mbtiTitle,
      enablePreferredStyle: checkEnableStyle,
      styleTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleTitle,
      styleOptions: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleOptions,
      enablePersonality: checkEnablePersonality,
      presentationTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationTitle,
      presentationOptions: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationOptions,
      customChecks: completedCustomChecks
        .map((check) => ({
          id: check.id,
          title: check.title.trim(),
          inputType: check.inputType,
          options: check.options.map((option) => option.trim()).filter(Boolean),
          enabled: true,
        }))
        .filter((check) => check.title && check.options.length >= 2),
    }),
    [checkEnableMbti, checkEnableStyle, checkEnablePersonality, completedCustomChecks],
  );

  const loadContext = async () => {
    const [userResponse, managementResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/app/users/me`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      }),
      fetch(`${API_BASE_URL}/app/academy-management`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      }),
    ]);

    const userData = (await userResponse.json().catch(() => ({}))) as SessionMeResponse;
    const managementData = (await managementResponse.json().catch(() => ({}))) as AcademyManagementResponse;

    if (userResponse.status === 401 || managementResponse.status === 401) {
      window.location.replace('/sign-in');
      return false;
    }

    if (!managementResponse.ok) {
      await fireSpoNotice({
        icon: 'error',
        title: '학원 관리 데이터를 불러오지 못했어요',
        text: managementData.message || '잠시 후 다시 시도해주세요.',
      });
      return false;
    }

    if (typeof userData.user?.profileImageUrl === 'string' && userData.user.profileImageUrl.trim()) {
      setProfileImageUrl(userData.user.profileImageUrl.trim());
    }

    const nextAcademies = Array.isArray(managementData.academies) ? managementData.academies : [];
    setAcademies(nextAcademies);
    setSelectedAcademyId((prev) => prev ?? nextAcademies[0]?.id ?? null);
    setStudies(Array.isArray(managementData.studies) ? managementData.studies : []);
    setNotices(Array.isArray(managementData.notices) ? managementData.notices : []);
    setRecruitments(Array.isArray(managementData.recruitments) ? managementData.recruitments : []);
    const nextRewardSettings = Array.isArray(managementData.rewardSettings) ? managementData.rewardSettings : [];
    setRewardSettings(nextRewardSettings);
    const primarySetting = nextRewardSettings[0];
    if (primarySetting) {
      setMonthlyAttendanceMinCount(
        primarySetting.monthlyAttendanceMinCount != null && Number(primarySetting.monthlyAttendanceMinCount) > 0
          ? String(primarySetting.monthlyAttendanceMinCount)
          : '',
      );
      setRewardDescription(primarySetting.rewardDescription || '');
    } else {
      setMonthlyAttendanceMinCount('');
      setRewardDescription('');
    }

    return true;
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        await loadContext();
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
    setEntrySection(searchParams.get('section') === 'notice' ? 'notice' : 'recruitment');
  }, [searchParams]);

  useEffect(() => {
    if (!selectedRewardSetting) return;
    setMonthlyAttendanceMinCount(
      selectedRewardSetting.monthlyAttendanceMinCount != null && Number(selectedRewardSetting.monthlyAttendanceMinCount) > 0
        ? String(selectedRewardSetting.monthlyAttendanceMinCount)
        : '',
    );
    setRewardDescription(selectedRewardSetting.rewardDescription || '');
  }, [selectedRewardSetting]);

  useEffect(() => {
    setSelectedNoticeStudyGroupId((prev) => {
      if (filteredStudies.length === 0) return null;
      if (prev && filteredStudies.some((study) => study.id === prev)) return prev;
      return filteredStudies[0]?.id ?? null;
    });
  }, [filteredStudies]);

  useEffect(() => {
    setRecruitmentPage(1);
  }, [selectedAcademyId, recruitmentSearchKeyword]);

  useEffect(() => {
    setNoticePage(1);
  }, [selectedAcademyId, noticeSearchKeyword]);

  useEffect(() => {
    if (recruitmentPage <= recruitmentPageCount) return;
    setRecruitmentPage(recruitmentPageCount);
  }, [recruitmentPage, recruitmentPageCount]);

  useEffect(() => {
    if (noticePage <= noticePageCount) return;
    setNoticePage(noticePageCount);
  }, [noticePage, noticePageCount]);

  useEffect(() => {
    if (!editingRecruitmentId) return;
    if (filteredRecruitments.some((item) => Number(item.id) === Number(editingRecruitmentId))) return;
    setEditingRecruitmentId(null);
  }, [editingRecruitmentId, filteredRecruitments]);

  useEffect(() => {
    if (!editingNoticeId) return;
    if (filteredNotices.some((item) => Number(item.id) === Number(editingNoticeId))) return;
    setEditingNoticeId(null);
  }, [editingNoticeId, filteredNotices]);

  useEffect(() => {
    if (!expandedRecruitmentId) return;
    if (filteredRecruitments.some((item) => Number(item.id) === Number(expandedRecruitmentId))) return;
    setExpandedRecruitmentId(null);
  }, [expandedRecruitmentId, filteredRecruitments]);

  useEffect(
    () => () => {
      if (noticeImageObjectUrlRef.current) {
        URL.revokeObjectURL(noticeImageObjectUrlRef.current);
        noticeImageObjectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (loading) return;
    const targetId = isNoticeSection ? 'academy-notice-section' : 'academy-recruitment-section';
    const target = document.getElementById(targetId);
    if (!target) return;
    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [isNoticeSection, loading]);

  const toggleStudyWeeklyDay = (dayKey: string) => {
    setStudyWeeklyDays((prev) => {
      if (prev.includes(dayKey)) {
        return prev.filter((item) => item !== dayKey);
      }
      const next = [...prev, dayKey];
      const sorted = WEEKDAY_OPTIONS.map((option) => option.key).filter((key) => next.includes(key));
      if (sorted.length > 0) {
        setStudySetupFieldErrors((prevErrors) =>
          prevErrors.studyWeeklyDays ? { ...prevErrors, studyWeeklyDays: false } : prevErrors,
        );
      }
      return sorted;
    });
  };

  const clearStudySetupFieldError = (field: keyof StudySetupFieldErrors) => {
    setStudySetupFieldErrors((prev) => (prev[field] ? { ...prev, [field]: false } : prev));
  };

  const clearNoticePreviewObjectUrl = () => {
    if (!noticeImageObjectUrlRef.current) return;
    URL.revokeObjectURL(noticeImageObjectUrlRef.current);
    noticeImageObjectUrlRef.current = null;
  };

  const clearNoticeImageFile = () => {
    setNoticeImageFile(null);
    setNoticeImagePreviewUrl(null);
    clearNoticePreviewObjectUrl();
    if (noticeImageInputRef.current) {
      noticeImageInputRef.current.value = '';
    }
  };

  const handleNoticeImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setNoticeImageFile(nextFile);
    clearNoticePreviewObjectUrl();
    if (!nextFile) {
      setNoticeImagePreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(nextFile);
    noticeImageObjectUrlRef.current = objectUrl;
    setNoticeImagePreviewUrl(objectUrl);
  };

  const handleAddCustomCheck = () => {
    setCustomChecks((prev) => {
      if (prev.length >= 12) return prev;
      const nextNumber = prev.length + 1;
      return [...prev, createDefaultCustomCheck(nextNumber)];
    });
  };

  const handleRemoveCustomCheck = (checkId: string) => {
    setCustomChecks((prev) => {
      const next = prev.filter((check) => check.id !== checkId);
      return next;
    });
    setCustomCheckOptionInputs((prev) => {
      if (!(checkId in prev)) return prev;
      const next = { ...prev };
      delete next[checkId];
      return next;
    });
  };

  const handleChangeCustomCheckType = (checkId: string, inputType: RecruitmentCustomCheck['inputType']) => {
    setCustomChecks((prev) =>
      prev.map((check) =>
        check.id === checkId
          ? {
              ...check,
              inputType,
            }
          : check,
      ),
    );
  };

  const handleChangeCustomCheckTitle = (checkId: string, value: string) => {
    setCustomChecks((prev) =>
      prev.map((check) =>
        check.id === checkId
          ? {
              ...check,
              title: value.slice(0, 80),
            }
          : check,
      ),
    );
  };

  const handleChangeCustomCheckOptionInput = (checkId: string, value: string) => {
    setCustomCheckOptionInputs((prev) => ({
      ...prev,
      [checkId]: value,
    }));
  };

  const handleAddCustomCheckOption = (checkId: string) => {
    const option = (customCheckOptionInputs[checkId] || '').trim();
    if (!option) return;
    setCustomChecks((prev) =>
      prev.map((check) => {
        if (check.id !== checkId) return check;
        if (check.options.includes(option)) return check;
        if (check.options.length >= 8) return check;
        return {
          ...check,
          options: [...check.options, option],
        };
      }),
    );
    setCustomCheckOptionInputs((prev) => ({
      ...prev,
      [checkId]: '',
    }));
  };

  const handleRemoveCustomCheckOption = (checkId: string, option: string) => {
    setCustomChecks((prev) =>
      prev.map((check) =>
        check.id === checkId
          ? {
              ...check,
              options: check.options.filter((item) => item !== option),
            }
          : check,
      ),
    );
  };

  const resetStudySetupFields = () => {
    setEditingRecruitmentId(null);
    setStudyName('');
    setStudySubject('');
    setStudyDescription('');
    setStudyMaxMembers('');
    setStudyWeeklyDays([]);
    setStudyClassTime('');
    setRecruitmentTitle('');
    setRecruitmentTargetClass('');
    setRecruitmentStartAt('');
    setRecruitmentEndAt('');
    setRecruitmentMinApplicants('');
    setRecruitmentTeamSize('');
    setRecruitmentMaxApplicants('');
    setRecruitmentGuide('');
    setStudySetupFieldErrors(EMPTY_STUDY_SETUP_FIELD_ERRORS);
    setCheckEnableMbti(Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enableMbti));
    setCheckEnableStyle(Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePreferredStyle));
    setCheckEnablePersonality(Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePersonality));
    setSpoSettingsOpen(false);
    setCustomChecks([]);
    setCustomCheckOptionInputs({});
    setMonthlyAttendanceMinCount('');
    setRewardDescription('');
  };

  const resetNoticeForm = () => {
    setEditingNoticeId(null);
    setNoticeTargetType('study');
    setNoticeTitle('');
    setNoticeContent('');
    setNoticeImageServerUrl(null);
    clearNoticeImageFile();
    setSelectedNoticeStudyGroupId(filteredStudies[0]?.id ?? null);
  };

  const handleOpenNoticeCreateMode = () => {
    resetNoticeForm();
    setNoticeViewMode('add');
  };

  const handleEditRecruitment = (recruitment: Recruitment) => {
    const applicationCheckConfig = recruitment.applicationCheckConfig;
    const scheduleWeeklyDays = parseWeeklyDaysFromGuide(recruitment.matchingGuide);
    const scheduleClassTime = parseClassTimeFromGuide(recruitment.matchingGuide);
    setRecruitmentViewMode('add');
    setEditingRecruitmentId(recruitment.id);
    setRecruitmentTitle(recruitment.title || '');
    setRecruitmentTargetClass(recruitment.targetClass || '');
    setRecruitmentStartAt(toDateTimeInputValue(recruitment.recruitmentStartAt));
    setRecruitmentEndAt(toDateTimeInputValue(recruitment.recruitmentEndAt));
    setRecruitmentMinApplicants(
      recruitment.minApplicants != null && Number(recruitment.minApplicants) > 0 ? String(recruitment.minApplicants) : '',
    );
    setRecruitmentTeamSize(recruitment.teamSize != null && Number(recruitment.teamSize) > 0 ? String(recruitment.teamSize) : '');
    setRecruitmentMaxApplicants(
      recruitment.maxApplicants != null && Number(recruitment.maxApplicants) > 0 ? String(recruitment.maxApplicants) : '',
    );
    setRecruitmentGuide(stripScheduleGuideFromMatchingGuide(recruitment.matchingGuide));
    setStudyWeeklyDays(scheduleWeeklyDays);
    setStudyClassTime(scheduleClassTime);
    setCheckEnableMbti(Boolean(applicationCheckConfig?.enableMbti));
    setCheckEnableStyle(Boolean(applicationCheckConfig?.enablePreferredStyle));
    setCheckEnablePersonality(Boolean(applicationCheckConfig?.enablePersonality));
    setCustomChecks(toCustomChecksFromConfig(applicationCheckConfig));
    setCustomCheckOptionInputs({});
    setSpoSettingsOpen(false);
    setStudySetupFieldErrors(EMPTY_STUDY_SETUP_FIELD_ERRORS);
  };

  const handleDeleteRecruitment = async (recruitment: Recruitment) => {
    const confirmResult = await fireSpoSwal({
      icon: 'warning',
      title: '삭제하시겠습니까?',
      text: `"${recruitment.title}" 공고를 삭제합니다.`,
      showCancelButton: true,
      confirmButtonText: '확인',
      cancelButtonText: '취소',
      confirmButtonColor: '#dc2626',
    });
    if (!confirmResult.isConfirmed) return;

    setDeletingRecruitmentId(recruitment.id);
    try {
      const response = await fetch(`${API_BASE_URL}/app/academy-management/study-recruitments/${recruitment.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '스터디 공고를 삭제하지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      if (editingRecruitmentId === recruitment.id) setEditingRecruitmentId(null);
      await loadContext();
      await fireSpoNotice({
        icon: 'success',
        title: '스터디 공고를 삭제했어요',
        text: data.message || '선택한 스터디 공고가 삭제되었습니다.',
      });
    } finally {
      setDeletingRecruitmentId(null);
    }
  };

  const loadRecruitmentApplicantPanel = async (recruitmentId: number) => {
    setLoadingRecruitmentApplicantsId(recruitmentId);
    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitmentId}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as RecruitmentDetailResponse;

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return false;
      }

      if (!response.ok || !data.recruitment) {
        await fireSpoNotice({
          icon: 'error',
          title: '신청자 정보를 불러오지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return false;
      }

      setRecruitmentApplicantPanelMap((prev) => ({
        ...prev,
        [recruitmentId]: {
          totalApplicants: Number(data.totalApplicants || 0),
          applicants: Array.isArray(data.applicants) ? data.applicants : [],
          canRunMatching: Boolean(data.permission?.canRunMatching),
        },
      }));
      return true;
    } finally {
      setLoadingRecruitmentApplicantsId((prev) => (prev === recruitmentId ? null : prev));
    }
  };

  const handleToggleRecruitmentApplicants = async (recruitment: Recruitment) => {
    if (expandedRecruitmentId === recruitment.id) {
      setExpandedRecruitmentId(null);
      return;
    }
    setExpandedRecruitmentId(recruitment.id);
    await loadRecruitmentApplicantPanel(recruitment.id);
  };

  const handleRunRecruitmentMatching = async (recruitment: Recruitment) => {
    if (runningMatchingRecruitmentId === recruitment.id) return;

    const panelData = recruitmentApplicantPanelMap[recruitment.id];
    const applicantCount = Number(panelData?.totalApplicants || 0);
    if (applicantCount <= 0) {
      await fireSpoNotice({
        icon: 'warning',
        title: '신청자가 없습니다',
        text: '참여 신청자가 1명 이상일 때 매칭을 실행할 수 있습니다.',
      });
      return;
    }

    const confirmResult = await fireSpoSwal({
      icon: 'question',
      title: '랜덤 매칭을 실행할까요?',
      text: `"${recruitment.title}" 신청자 기준으로 팀 배정을 시작합니다.`,
      showCancelButton: true,
      confirmButtonText: '매칭 실행',
      cancelButtonText: '취소',
    });

    if (!confirmResult.isConfirmed) return;

    setRunningMatchingRecruitmentId(recruitment.id);
    try {
      const response = await fetch(`${API_BASE_URL}/app/study-recruitments/${recruitment.id}/run-matching`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (response.status === 401) {
        window.location.replace('/sign-in');
        return;
      }

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '매칭 실행에 실패했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      await Promise.all([loadContext(), loadRecruitmentApplicantPanel(recruitment.id)]);
      await fireSpoNotice({
        icon: 'success',
        title: '매칭을 완료했어요',
        text: data.message || '신청자 매칭이 완료되었습니다.',
      });
    } finally {
      setRunningMatchingRecruitmentId((prev) => (prev === recruitment.id ? null : prev));
    }
  };

  const handleCreateStudySetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAcademyId) return;

    const monthlyCount = Math.floor(Number(monthlyAttendanceMinCount));
    const resolvedStudyName =
      studyName.trim() ||
      recruitmentTitle.trim() ||
      (recruitmentTargetClass.trim() ? `${recruitmentTargetClass.trim()} 운영 스터디` : '운영 스터디');
    const resolvedStudySubject = studySubject.trim() || recruitmentTargetClass.trim() || '스터디';
    const resolvedStudyDescription = studyDescription.trim() || recruitmentGuide.trim() || `${resolvedStudyName} 안내`;
    const resolvedStudyMaxMembers =
      toOptionalPositiveNumber(studyMaxMembers) ??
      toOptionalPositiveNumber(recruitmentMaxApplicants) ??
      Math.max((toOptionalPositiveNumber(recruitmentTeamSize) ?? 4) * 2, 8);
    const parsedRecruitmentStartAt = recruitmentStartAt ? new Date(recruitmentStartAt).getTime() : Number.NaN;
    const parsedRecruitmentEndAt = recruitmentEndAt ? new Date(recruitmentEndAt).getTime() : Number.NaN;
    const hasStartAt = Number.isFinite(parsedRecruitmentStartAt);
    const hasEndAt = Number.isFinite(parsedRecruitmentEndAt);
    const isStartAtInPast = hasStartAt ? parsedRecruitmentStartAt < Date.now() - 60000 : false;
    const isEndAtBeforeStart = hasStartAt && hasEndAt ? parsedRecruitmentEndAt <= parsedRecruitmentStartAt : false;
    const mergedRecruitmentGuide = composeMatchingGuide(recruitmentGuide, studyWeeklyDays, studyClassTime);

    if (editingRecruitmentId) {
      const nextFieldErrors: StudySetupFieldErrors = {
        recruitmentTitle: !recruitmentTitle.trim(),
        recruitmentStartAt: !hasStartAt || isEndAtBeforeStart,
        recruitmentEndAt: !hasEndAt || isEndAtBeforeStart,
        studyWeeklyDays: false,
        studyClassTime: false,
        monthlyAttendanceMinCount: false,
        rewardDescription: false,
      };
      setStudySetupFieldErrors(nextFieldErrors);

      if (Object.values(nextFieldErrors).some(Boolean)) {
        await fireSpoNotice({
          icon: 'warning',
          title: '입력 내용을 확인해주세요',
          text: '공고 제목과 모집 기간을 다시 확인해주세요.',
        });
        return;
      }

      setStudySetupSubmitting(true);
      try {
        const response = await fetch(`${API_BASE_URL}/app/academy-management/study-recruitments/${editingRecruitmentId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            academyId: selectedAcademyId,
            title: recruitmentTitle.trim(),
            targetClass: recruitmentTargetClass,
            reviewScope: '',
            recruitmentStartAt,
            recruitmentEndAt,
            minApplicants: toOptionalPositiveNumber(recruitmentMinApplicants),
            teamSize: toOptionalPositiveNumber(recruitmentTeamSize),
            maxApplicants: toOptionalPositiveNumber(recruitmentMaxApplicants),
            matchingGuide: mergedRecruitmentGuide,
            applicationCheckConfig: applicationCheckConfigPayload,
          }),
        });
        const rawResponseText = await response.text().catch(() => '');
        let data: { message?: string } = {};
        if (rawResponseText) {
          try {
            data = JSON.parse(rawResponseText) as { message?: string };
          } catch {
            data = {};
          }
        }
        const fallbackResponseMessage =
          data.message ||
          (rawResponseText && !rawResponseText.trim().startsWith('<') ? rawResponseText.trim().slice(0, 220) : '') ||
          `요청이 실패했습니다. (HTTP ${response.status})`;

        if (!response.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '스터디 공고를 수정하지 못했어요',
            text: fallbackResponseMessage,
          });
          return;
        }

        resetStudySetupFields();
        await loadContext();
        setRecruitmentViewMode('manage');
        await fireSpoNotice({
          icon: 'success',
          title: '스터디 공고를 수정했어요',
          text: data.message || '선택한 스터디 공고가 수정되었습니다.',
        });
      } finally {
        setStudySetupSubmitting(false);
      }
      return;
    }

    const nextFieldErrors: StudySetupFieldErrors = {
      recruitmentTitle: !recruitmentTitle.trim(),
      recruitmentStartAt: !hasStartAt || isStartAtInPast || isEndAtBeforeStart,
      recruitmentEndAt: !hasEndAt || isEndAtBeforeStart,
      studyWeeklyDays: studyWeeklyDays.length === 0,
      studyClassTime: !studyClassTime.trim(),
      monthlyAttendanceMinCount: !Number.isFinite(monthlyCount) || monthlyCount <= 0,
      rewardDescription: !rewardDescription.trim(),
    };
    setStudySetupFieldErrors(nextFieldErrors);

    if (Object.values(nextFieldErrors).some(Boolean)) {
      await fireSpoNotice({
        icon: 'warning',
        title: '입력 내용을 확인해주세요',
        text: '빨간색으로 표시된 필수 입력 항목을 먼저 채워주세요.',
      });
      return;
    }

    setStudySetupSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/app/academy-management/study-setup`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          academyId: selectedAcademyId,
          name: resolvedStudyName,
          subject: resolvedStudySubject,
          description: resolvedStudyDescription,
          maxMembers: resolvedStudyMaxMembers,
          title: recruitmentTitle,
          targetClass: recruitmentTargetClass,
          reviewScope: '',
          recruitmentStartAt,
          recruitmentEndAt,
          minApplicants: toOptionalPositiveNumber(recruitmentMinApplicants),
          studyWeeklyDays,
          studyClassTime,
          teamSize: toOptionalPositiveNumber(recruitmentTeamSize),
          maxApplicants: toOptionalPositiveNumber(recruitmentMaxApplicants),
          matchingGuide: recruitmentGuide,
          applicationCheckConfig: applicationCheckConfigPayload,
          monthlyAttendanceMinCount: monthlyCount,
          attendanceRateThreshold: computedAttendanceRateThreshold ?? 80,
          rewardDescription: rewardDescription.trim(),
        }),
      });
      const rawResponseText = await response.text().catch(() => '');
      let data: { message?: string } = {};
      if (rawResponseText) {
        try {
          data = JSON.parse(rawResponseText) as { message?: string };
        } catch {
          data = {};
        }
      }
      const fallbackResponseMessage =
        data.message ||
        (rawResponseText && !rawResponseText.trim().startsWith('<') ? rawResponseText.trim().slice(0, 220) : '') ||
        `요청이 실패했습니다. (HTTP ${response.status})`;

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '스터디 공고를 추가하지 못했어요',
          text: fallbackResponseMessage,
        });
        return;
      }

      resetStudySetupFields();
      await loadContext();
      await fireSpoNotice({
        icon: 'success',
        title: '스터디 공고를 추가했어요',
        text: data.message || '스터디 공고와 보상 기준이 저장되었습니다. 매칭 완료 후 운영 스터디가 생성됩니다.',
      });
    } finally {
      setStudySetupSubmitting(false);
    }
  };

  const handleSubmitNotice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAcademyId) return;
    if (noticeTargetType === 'study' && !selectedNoticeStudyGroupId) {
      await fireSpoNotice({
        icon: 'warning',
        title: '공지 대상 스터디를 확인해주세요',
        text: '공지사항을 연결할 운영 스터디를 선택해주세요.',
      });
      return;
    }

    setNoticeSubmitting(true);
    try {
      const isEditing = Boolean(editingNoticeId);
      const payload = new FormData();
      payload.append('academyId', String(selectedAcademyId));
      payload.append('noticeType', noticeTargetType);
      if (noticeTargetType === 'study' && selectedNoticeStudyGroupId) {
        payload.append('studyGroupId', String(selectedNoticeStudyGroupId));
      }
      payload.append('title', noticeTitle);
      payload.append('content', noticeContent);
      if (noticeImageFile) {
        payload.append('noticeImage', noticeImageFile);
      }
      const response = await fetch(
        isEditing
          ? `${API_BASE_URL}/app/academy-management/notices/${editingNoticeId}`
          : `${API_BASE_URL}/app/academy-management/notices`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          credentials: 'include',
          body: payload,
        },
      );
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: isEditing ? '공지사항을 수정하지 못했어요' : '공지사항을 등록하지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      resetNoticeForm();
      await loadContext();
      setNoticeViewMode('manage');
      await fireSpoNotice({
        icon: 'success',
        title: isEditing ? '공지사항을 수정했어요' : '공지사항을 등록했어요',
        text: data.message || (isEditing ? '학생 공지사항이 수정되었습니다.' : '학생 공지사항이 등록되었습니다.'),
      });
    } finally {
      setNoticeSubmitting(false);
    }
  };

  const handleEditNotice = (notice: AcademyNotice) => {
    setNoticeViewMode('add');
    setEditingNoticeId(notice.id);
    const isStudyNotice = notice.studyGroupId != null && Number(notice.studyGroupId) > 0;
    setNoticeTargetType(isStudyNotice ? 'study' : 'all');
    setSelectedNoticeStudyGroupId(isStudyNotice ? notice.studyGroupId ?? filteredStudies[0]?.id ?? null : null);
    setNoticeTitle(notice.title);
    setNoticeContent(notice.content);
    setNoticeImageServerUrl(notice.imageUrl || null);
    clearNoticeImageFile();
  };

  const handleDeleteNotice = async (notice: AcademyNotice) => {
    const confirmResult = await fireSpoSwal({
      icon: 'warning',
      title: '공지사항을 삭제할까요?',
      text: `"${notice.title}" 공지사항이 삭제됩니다.`,
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#dc2626',
    });

    if (!confirmResult.isConfirmed) return;

    setDeletingNoticeId(notice.id);
    try {
      const response = await fetch(`${API_BASE_URL}/app/academy-management/notices/${notice.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        await fireSpoNotice({
          icon: 'error',
          title: '공지사항을 삭제하지 못했어요',
          text: data.message || '잠시 후 다시 시도해주세요.',
        });
        return;
      }

      if (editingNoticeId === notice.id) {
        resetNoticeForm();
      }
      await loadContext();
      await fireSpoNotice({
        icon: 'success',
        title: '공지사항을 삭제했어요',
        text: data.message || '선택한 공지사항이 삭제되었습니다.',
      });
    } finally {
      setDeletingNoticeId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">학원 관리 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb] text-[#191c1d]">
      <AppSidebar activeItem="academy-management" />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-end bg-[#f5f6f8]/70 px-8 backdrop-blur-xl">
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
        </header>

        <div className="px-6 pb-12 pt-8 lg:px-10">
          <div className="mx-auto max-w-7xl space-y-6">
            {isRecruitmentSection ? (
              <section id="academy-recruitment-section" className="surface-card space-y-8">
                <div className="section-heading">
                  <div>
                    <p className="section-eyebrow">Recruitment</p>
                    <h2 className="section-title">스터디 공고 관리</h2>
                  </div>
                  <label className="academy-select-wrap academy-select-wrap-inline academy-select-wrap-inline-plain">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">관리 학원</span>
                    <select
                      className="academy-select"
                      value={selectedAcademyId ?? ''}
                      onChange={(event) => setSelectedAcademyId(Number(event.target.value) || null)}
                      disabled
                    >
                      {academies.map((academy) => (
                        <option key={academy.id} value={academy.id}>
                          {academy.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="recruitment-mode-tabs" role="tablist" aria-label="스터디 공고 관리 모드">
                  <button
                    type="button"
                    className={`recruitment-mode-tab ${recruitmentViewMode === 'manage' ? 'recruitment-mode-tab-active' : ''}`}
                    onClick={() => setRecruitmentViewMode('manage')}
                  >
                    스터디 공고 관리
                  </button>
                  <button
                    type="button"
                    className={`recruitment-mode-tab ${recruitmentViewMode === 'add' ? 'recruitment-mode-tab-active' : ''}`}
                    onClick={() => setRecruitmentViewMode('add')}
                  >
                    스터디 공고 추가
                  </button>
                </div>

                {recruitmentViewMode === 'manage' ? (
                  <section className="setup-panel space-y-4">
                    <div className="setup-panel-head">
                      <p className="section-eyebrow">Manage</p>
                      <h3 className="setup-title">스터디 공고 관리</h3>
                      <p className="field-help">등록 공고를 검색하고 페이지 단위로 확인한 뒤 수정/삭제할 수 있습니다.</p>
                    </div>

                    <div className="recruitment-manage-toolbar">
                      <input
                        className="field-input"
                        value={recruitmentSearchKeyword}
                        onChange={(event) => setRecruitmentSearchKeyword(event.target.value)}
                        placeholder="공고 제목, 대상 수업, 상태 검색"
                      />
                      <p className="recruitment-manage-meta">
                        총 {searchedRecruitments.length}건 · {recruitmentPage}/{recruitmentPageCount} 페이지
                      </p>
                    </div>

                    <div className="space-y-3">
                      {pagedRecruitments.map((recruitment) => {
                        const isDeleting = deletingRecruitmentId === recruitment.id;
                        return (
                          <div key={recruitment.id} className="notice-card recruitment-manage-card">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-black text-slate-900">{recruitment.title}</p>
                              <span className="rounded-full bg-[#dde1ff] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#003dc7]">
                                {recruitment.status ? RECRUITMENT_STATUS_LABEL[recruitment.status] : '모집중'}
                              </span>
                            </div>
                            <p className="mt-2 text-xs font-medium text-slate-500">
                              {recruitment.targetClass || '대상 미지정'} · 팀 {recruitment.teamSize || 0}명
                            </p>
                            <p className="mt-1 text-xs font-medium text-slate-500">
                              모집기간: {formatDateTimeLabel(recruitment.recruitmentStartAt)} ~ {formatDateTimeLabel(recruitment.recruitmentEndAt)}
                            </p>
                            <p className="mt-1 text-xs font-medium text-slate-500">
                              모집 인원 조건: 최소 {recruitment.minApplicants || '-'}명 / 최대 {recruitment.maxApplicants || '-'}명
                            </p>
                            {recruitment.matchingGuide ? (
                              <p className="mt-2 whitespace-pre-line text-xs font-medium leading-6 text-slate-500">{recruitment.matchingGuide}</p>
                            ) : null}
                            <div className="notice-item-actions notice-item-actions-recruitment">
                              <button type="button" className="notice-action-btn" onClick={() => handleEditRecruitment(recruitment)}>
                                수정
                              </button>
                              <button
                                type="button"
                                className="notice-action-btn notice-action-btn-danger"
                                disabled={isDeleting}
                                onClick={() => handleDeleteRecruitment(recruitment)}
                              >
                                {isDeleting ? '삭제 중...' : '삭제'}
                              </button>
                              <Link
                                href={`/academy-management/recruitments/${recruitment.id}/applicants`}
                                className="notice-action-btn notice-action-btn-applicant-toggle"
                              >
                                신청자 관리
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                      {searchedRecruitments.length === 0 ? (
                        <div className="notice-card text-sm font-medium text-slate-500">검색 조건에 맞는 스터디 공고가 없습니다.</div>
                      ) : null}
                    </div>

                    {searchedRecruitments.length > 0 ? (
                      <div className="recruitment-pagination">
                        <button
                          type="button"
                          className="notice-action-btn"
                          disabled={recruitmentPage <= 1}
                          onClick={() => setRecruitmentPage((prev) => Math.max(1, prev - 1))}
                        >
                          이전
                        </button>
                        <span className="recruitment-pagination-label">
                          {recruitmentPage} / {recruitmentPageCount}
                        </span>
                        <button
                          type="button"
                          className="notice-action-btn"
                          disabled={recruitmentPage >= recruitmentPageCount}
                          onClick={() => setRecruitmentPage((prev) => Math.min(recruitmentPageCount, prev + 1))}
                        >
                          다음
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : (
              <form className="space-y-8" onSubmit={handleCreateStudySetup}>
                <div className="study-setup-layout">
                  <section className="setup-panel setup-panel-full">
                    <div className="setup-panel-head">
                      <p className="section-eyebrow">Recruitment Template</p>
                      <h3 className="setup-title">스터디 공고 추가</h3>
                      <p className="field-help">
                        {editingRecruitmentId
                          ? '수정 모드입니다. 저장하면 선택한 기존 공고가 업데이트됩니다.'
                          : '실제 공고/신청 화면 형태에서 항목을 바로 수정하세요.'}
                      </p>
                    </div>
                    {editingRecruitmentId ? (
                      <div className="template-edit-banner">
                        현재 기존 공고를 수정 중입니다. 완료 후 저장하면 기존 공고 내용이 변경됩니다.
                      </div>
                    ) : null}

                    <div className="template-card">
                      <label className="field-group field-group-full">
                        <span className="field-label">공고 제목</span>
                        <input
                          className={`field-input ${studySetupFieldErrors.recruitmentTitle ? 'field-input-error' : ''}`}
                          value={recruitmentTitle}
                          onChange={(event) => {
                            setRecruitmentTitle(event.target.value);
                            if (event.target.value.trim()) clearStudySetupFieldError('recruitmentTitle');
                          }}
                          placeholder="예: 5월 중간고사 대비 스터디 모집"
                        />
                        {studySetupFieldErrors.recruitmentTitle ? <p className="field-help field-help-error">공고 제목은 필수입니다.</p> : null}
                      </label>

                      <div className="template-summary">
                        <div className="template-summary-main">
                          <label className="field-group field-group-full">
                            <span className="field-label">운영 학원 (자동 입력)</span>
                            <input
                              className="field-input"
                              value={
                                selectedAcademy
                                  ? `${selectedAcademy.name}${selectedAcademy.address ? ` (${selectedAcademy.address})` : ''}`
                                  : '관리 학원 정보가 없습니다.'
                              }
                              readOnly
                            />
                          </label>
                          <label className="field-group field-group-full">
                            <span className="field-label">대상 수업</span>
                            <input
                              className="field-input"
                              value={recruitmentTargetClass}
                              onChange={(event) => setRecruitmentTargetClass(event.target.value)}
                              placeholder="예: 백엔드 부트캠프 5기"
                            />
                          </label>
                          <div className="setup-grid template-grid-spaced">
                            <label className="field-group">
                              <span className="field-label">모집 시작</span>
                              <input
                                className={`field-input ${studySetupFieldErrors.recruitmentStartAt ? 'field-input-error' : ''}`}
                                type="datetime-local"
                                value={recruitmentStartAt}
                                onChange={(event) => {
                                  setRecruitmentStartAt(event.target.value);
                                  if (event.target.value) clearStudySetupFieldError('recruitmentStartAt');
                                }}
                              />
                              {studySetupFieldErrors.recruitmentStartAt ? (
                                <p className="field-help field-help-error">
                                  {editingRecruitmentId
                                    ? '모집 시작/종료 시각 순서를 확인해주세요.'
                                    : '모집 시작은 현재 시각 이후로 입력해주세요.'}
                                </p>
                              ) : null}
                            </label>
                            <label className="field-group">
                              <span className="field-label">모집 종료</span>
                              <input
                                className={`field-input ${studySetupFieldErrors.recruitmentEndAt ? 'field-input-error' : ''}`}
                                type="datetime-local"
                                value={recruitmentEndAt}
                                onChange={(event) => {
                                  setRecruitmentEndAt(event.target.value);
                                  if (event.target.value) clearStudySetupFieldError('recruitmentEndAt');
                                }}
                              />
                              {studySetupFieldErrors.recruitmentEndAt ? (
                                <p className="field-help field-help-error">모집 종료는 시작 이후 시각으로 입력해주세요.</p>
                              ) : null}
                            </label>
                            <label className="field-group">
                              <span className="field-label">최소 모집 인원</span>
                              <input
                                className="field-input"
                                value={recruitmentMinApplicants}
                                onChange={(event) => setRecruitmentMinApplicants(event.target.value)}
                                placeholder="예: 8"
                                inputMode="numeric"
                              />
                            </label>
                            <label className="field-group">
                              <span className="field-label">최대 모집 인원</span>
                              <input
                                className="field-input"
                                value={recruitmentMaxApplicants}
                                onChange={(event) => setRecruitmentMaxApplicants(event.target.value)}
                                placeholder="예: 20"
                                inputMode="numeric"
                              />
                            </label>
                            <label className="field-group field-group-full">
                              <span className="field-label">팀당 인원</span>
                              <input
                                className="field-input"
                                value={recruitmentTeamSize}
                                onChange={(event) => setRecruitmentTeamSize(event.target.value)}
                                placeholder="예: 4"
                                inputMode="numeric"
                              />
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="setup-grid template-grid-spaced">
                        <div className="field-group field-group-full">
                          <span className="field-label">매주 스터디 요일</span>
                          <div className={`weekday-chip-list ${studySetupFieldErrors.studyWeeklyDays ? 'weekday-chip-list-error' : ''}`}>
                            {WEEKDAY_OPTIONS.map((option) => {
                              const active = studyWeeklyDays.includes(option.key);
                              return (
                                <button
                                  key={option.key}
                                  type="button"
                                  className={`weekday-chip ${active ? 'weekday-chip-active' : ''}`}
                                  onClick={() => toggleStudyWeeklyDay(option.key)}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                          {studySetupFieldErrors.studyWeeklyDays ? (
                            <p className="field-help field-help-error">최소 1개의 운영 요일을 선택해주세요.</p>
                          ) : null}
                        </div>
                        <label className="field-group field-group-full">
                          <span className="field-label">학원 수업 연계 시간</span>
                          <input
                            className={`field-input ${studySetupFieldErrors.studyClassTime ? 'field-input-error' : ''}`}
                            value={studyClassTime}
                            onChange={(event) => {
                              setStudyClassTime(event.target.value);
                              if (event.target.value.trim()) clearStudySetupFieldError('studyClassTime');
                            }}
                            placeholder="예: 화/목 19:00-20:30 (정규수업 직후)"
                          />
                          {studySetupFieldErrors.studyClassTime ? (
                            <p className="field-help field-help-error">학원 수업 연계 시간을 입력해주세요.</p>
                          ) : null}
                        </label>
                        <label className="field-group field-group-full">
                          <span className="field-label">추가 운영 메모</span>
                          <textarea
                            className="field-input min-h-[88px] resize-none py-4"
                            value={recruitmentGuide}
                            onChange={(event) => setRecruitmentGuide(event.target.value)}
                            placeholder="선발 우선순위, 참고 안내 등 선택 입력"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="template-card">
                      <div className="template-check-head">
                        <h4 className="template-check-title">신청 체크</h4>
                        <p className="template-check-meta">편집 중</p>
                      </div>
                      <div className="template-check-alert">공고 추가 단계에서는 신청 항목을 자유롭게 켜고 끌 수 있습니다.</div>

                      <div className="template-check-section">
                        <p className="template-check-label">{DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationTitle}</p>
                        <div className="template-pill-row">
                          <span className="template-pill template-pill-active">
                            {DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationOptions[0].label}
                          </span>
                          <span className="template-pill">
                            {DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationOptions[1].label}
                          </span>
                        </div>
                      </div>

                      <div className="custom-check-builder">
                        <p className="custom-check-builder-title">커스텀 신청 항목 추가</p>
                        <p className="custom-check-builder-help">선택 항목입니다. 비워두어도 공고 등록이 가능하며, 항목 추가 시 입력 방식과 선택지를 설정하세요.</p>
                        <button type="button" className="custom-check-add-btn" onClick={handleAddCustomCheck}>
                          항목 추가
                        </button>
                        {customChecks.length === 0 ? <p className="custom-check-empty">아직 추가된 커스텀 항목이 없습니다.</p> : null}
                        <div className="custom-check-list">
                          {customChecks.map((check, index) => (
                            <div key={check.id} className="custom-check-item">
                              <div className="custom-check-item-head">
                                <p className="custom-check-item-title">{check.title.trim() || `커스텀 신청 항목 ${index + 1}`}</p>
                                <div className="custom-check-item-actions">
                                  <span className="custom-check-item-type">
                                    {check.inputType === 'radio' ? '라디오 버튼식' : '클릭 버튼식'}
                                  </span>
                                  <button type="button" className="custom-check-item-action-delete" onClick={() => handleRemoveCustomCheck(check.id)}>
                                    삭제
                                  </button>
                                </div>
                              </div>
                              <label className="field-group">
                                <span className="field-label">항목 이름</span>
                                <input
                                  className={`field-input ${!check.title.trim() ? 'field-input-error' : ''}`}
                                  value={check.title}
                                  onChange={(event) => handleChangeCustomCheckTitle(check.id, event.target.value)}
                                  placeholder={`예: 커스텀 신청 항목 ${index + 1}`}
                                />
                              </label>
                              <div className="field-group">
                                <span className="field-label">입력 방식</span>
                                <div className="input-type-toggle" role="tablist" aria-label="입력 방식 선택">
                                  <button
                                    type="button"
                                    className={`input-type-toggle-btn ${check.inputType === 'button' ? 'input-type-toggle-btn-active' : ''}`}
                                    onClick={() => handleChangeCustomCheckType(check.id, 'button')}
                                    aria-pressed={check.inputType === 'button'}
                                  >
                                    클릭 버튼식
                                  </button>
                                  <button
                                    type="button"
                                    className={`input-type-toggle-btn ${check.inputType === 'radio' ? 'input-type-toggle-btn-active' : ''}`}
                                    onClick={() => handleChangeCustomCheckType(check.id, 'radio')}
                                    aria-pressed={check.inputType === 'radio'}
                                  >
                                    라디오 버튼식
                                  </button>
                                </div>
                              </div>
                              <label className="field-group">
                                <span className="field-label">선택지 입력</span>
                                <div className="custom-option-input-row">
                                  <input
                                    className="field-input"
                                    value={customCheckOptionInputs[check.id] || ''}
                                    onChange={(event) => handleChangeCustomCheckOptionInput(check.id, event.target.value)}
                                    placeholder="예: 저녁 시간대"
                                  />
                                  <button type="button" className="custom-option-add-btn" onClick={() => handleAddCustomCheckOption(check.id)}>
                                    +
                                  </button>
                                </div>
                              </label>
                              <div className="custom-check-item-options">
                                {check.options.map((option) => (
                                  <span key={option}>
                                    {option}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveCustomCheckOption(check.id, option)}
                                      aria-label="선택지 제거"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                              {!check.title.trim() || check.options.length < 2 ? (
                                <p className="field-help field-help-error mt-2">
                                  {!check.title.trim() ? '항목 이름을 입력해주세요. ' : ''}
                                  {check.options.length < 2 ? '선택지는 최소 2개 이상 추가해야 신청 체크에 반영됩니다.' : ''}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="spo-settings-wrap">
                        <button
                          type="button"
                          className={`spo-settings-trigger ${spoSettingsOpen ? 'spo-settings-trigger-open' : ''}`}
                          onClick={() => setSpoSettingsOpen((prev) => !prev)}
                          aria-expanded={spoSettingsOpen}
                        >
                          <span>SPO 기본 세팅 ON/OFF</span>
                          <span className="spo-settings-trigger-icon">{spoSettingsOpen ? '▲' : '▼'}</span>
                        </button>

                        {spoSettingsOpen ? (
                          <div className="spo-settings-panel">
                            <div className="check-toggle-list">
                              <div className="check-toggle-item">
                                <div className="check-toggle-copy">
                                  <p className="check-toggle-title">MBTI</p>
                                  <p className="check-toggle-desc">학생이 MBTI를 입력하는 항목을 노출합니다.</p>
                                </div>
                                <button
                                  type="button"
                                  className={`check-toggle-button ${checkEnableMbti ? 'check-toggle-button-on' : ''}`}
                                  onClick={() => setCheckEnableMbti((prev) => !prev)}
                                >
                                  {checkEnableMbti ? 'ON' : 'OFF'}
                                </button>
                              </div>
                              {checkEnableMbti ? <input className="field-input" value="예: INTJ" disabled readOnly /> : null}
                            </div>

                            <div className="check-toggle-list">
                              <div className="check-toggle-item">
                                <div className="check-toggle-copy">
                                  <p className="check-toggle-title">같이 하고 싶은 스타일</p>
                                  <p className="check-toggle-desc">
                                    집중형, 차근형, 토론형, 피드백형 등 일반 스터디 선택지를 제공합니다.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className={`check-toggle-button ${checkEnableStyle ? 'check-toggle-button-on' : ''}`}
                                  onClick={() => setCheckEnableStyle((prev) => !prev)}
                                >
                                  {checkEnableStyle ? 'ON' : 'OFF'}
                                </button>
                              </div>
                              {checkEnableStyle ? (
                                <div className="template-style-grid">
                                  {DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleOptions.map((option, index) => (
                                    <span
                                      key={option}
                                      className={`template-style-chip ${index === 2 ? 'template-style-chip-active' : ''}`}
                                    >
                                      {option}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <div className="check-toggle-list">
                              <div className="check-toggle-item">
                                <div className="check-toggle-copy">
                                  <p className="check-toggle-title">성격</p>
                                  <p className="check-toggle-desc">소극적, 보통, 활발 중 한 가지 성향을 받습니다.</p>
                                </div>
                                <button
                                  type="button"
                                  className={`check-toggle-button ${checkEnablePersonality ? 'check-toggle-button-on' : ''}`}
                                  onClick={() => setCheckEnablePersonality((prev) => !prev)}
                                >
                                  {checkEnablePersonality ? 'ON' : 'OFF'}
                                </button>
                              </div>
                              {checkEnablePersonality ? (
                                <div className="template-radio-list">
                                  {DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationOptions.map((option) => (
                                    <div key={option.key} className="template-radio-item">
                                      <span className={`template-radio-dot ${option.key === 'normal' ? 'template-radio-dot-active' : ''}`} />
                                      {option.label}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                          </div>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section className="setup-panel setup-panel-full">
                    <div className="setup-panel-head">
                      <p className="section-eyebrow">Reward Policy</p>
                      <h3 className="setup-title">출석 보상 기준</h3>
                    </div>
                    <div className="reward-layout">
                      <div className="setup-grid">
                        <label className="field-group">
                          <span className="field-label">월 최소 출석 횟수</span>
                          <input
                            className={`field-input ${studySetupFieldErrors.monthlyAttendanceMinCount ? 'field-input-error' : ''}`}
                            value={monthlyAttendanceMinCount}
                            onChange={(event) => {
                              setMonthlyAttendanceMinCount(event.target.value);
                              if (Number(event.target.value) > 0) clearStudySetupFieldError('monthlyAttendanceMinCount');
                            }}
                            placeholder="예: 6"
                            inputMode="numeric"
                          />
                          {studySetupFieldErrors.monthlyAttendanceMinCount ? (
                            <p className="field-help field-help-error">월 최소 출석 횟수(1 이상)를 입력해주세요.</p>
                          ) : null}
                        </label>
                        <label className="field-group">
                          <span className="field-label">보상 내용</span>
                          <input
                            className={`field-input ${studySetupFieldErrors.rewardDescription ? 'field-input-error' : ''}`}
                            value={rewardDescription}
                            onChange={(event) => {
                              setRewardDescription(event.target.value);
                              if (event.target.value.trim()) clearStudySetupFieldError('rewardDescription');
                            }}
                            placeholder="예: 월말 기프티콘 + 보너스 스핀 1회"
                          />
                          {studySetupFieldErrors.rewardDescription ? (
                            <p className="field-help field-help-error">보상 내용은 필수입니다.</p>
                          ) : null}
                        </label>
                      </div>

                      <div className="reward-summary-card">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">설정 미리보기</p>
                        <p className="mt-2 text-sm font-bold text-slate-900">
                          매주 {selectedWeeklyDaysLabel || '-'} 운영 · 월 {expectedMonthlySessions}회 기준
                        </p>
                        <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                          월 {monthlyAttendanceMinCount || '-'}회 이상 출석 시 출석률 약{' '}
                          {computedAttendanceRateThreshold != null ? `${computedAttendanceRateThreshold}%` : '-'} 기준이 적용됩니다.
                        </p>
                        <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                          보상: {rewardDescription || '아직 보상 내용이 입력되지 않았습니다.'}
                        </p>
                        <p className="mt-3 text-xs font-semibold text-slate-400">
                          현재 저장 기준: 월 {selectedRewardSetting?.monthlyAttendanceMinCount ?? '-'}회 /{' '}
                          {selectedRewardSetting?.attendanceRateThreshold != null
                            ? `${selectedRewardSetting?.attendanceRateThreshold}%`
                            : '-'}{' '}
                          · {selectedRewardSetting?.rewardDescription || '미등록'}
                        </p>
                      </div>
                    </div>
                  </section>

                </div>

                <div className="notice-form-actions notice-form-actions-end">
                  <button type="submit" disabled={studySetupSubmitting} className="action-btn">
                    {studySetupSubmitting
                      ? editingRecruitmentId
                        ? '스터디 공고를 수정하는 중...'
                        : '스터디 공고를 추가하는 중...'
                      : editingRecruitmentId
                        ? '스터디 공고 수정 저장'
                        : '스터디 공고 추가'}
                  </button>
                  {editingRecruitmentId ? (
                    <button type="button" className="action-btn action-btn-secondary" onClick={resetStudySetupFields}>
                      수정 취소
                    </button>
                  ) : null}
                </div>
              </form>
                )}
              </section>
            ) : null}

            {isNoticeSection ? (
              <section id="academy-notice-section" className="surface-card space-y-8">
                <div className="section-heading">
                  <div>
                    <p className="section-eyebrow">Notice</p>
                    <h2 className="section-title">공지사항 관리</h2>
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      공지사항을 작성, 수정, 삭제하고 운영 스터디별로 노출할 공지를 관리할 수 있습니다.
                    </p>
                  </div>
                  <div className="academy-select-wrap academy-select-wrap-inline academy-select-wrap-inline-plain-text">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">관리 학원</span>
                    <span className="academy-selected-static-text">{selectedAcademy?.name || '-'}</span>
                  </div>
                </div>

                <div className="recruitment-mode-tabs" role="tablist" aria-label="공지사항 관리 모드">
                  <button
                    type="button"
                    className={`recruitment-mode-tab ${noticeViewMode === 'manage' ? 'recruitment-mode-tab-active' : ''}`}
                    onClick={() => setNoticeViewMode('manage')}
                  >
                    공지사항 관리
                  </button>
                  <button
                    type="button"
                    className={`recruitment-mode-tab ${noticeViewMode === 'add' ? 'recruitment-mode-tab-active' : ''}`}
                    onClick={handleOpenNoticeCreateMode}
                  >
                    공지사항 추가
                  </button>
                </div>

                {noticeViewMode === 'manage' ? (
                  <section className="setup-panel space-y-4">
                    <div className="setup-panel-head">
                      <p className="section-eyebrow">Manage</p>
                      <h3 className="setup-title">공지사항 관리</h3>
                      <p className="field-help">등록 공지를 검색하고 페이지 단위로 확인한 뒤 수정/삭제할 수 있습니다.</p>
                    </div>

                    <div className="recruitment-manage-toolbar">
                      <input
                        className="field-input"
                        value={noticeSearchKeyword}
                        onChange={(event) => setNoticeSearchKeyword(event.target.value)}
                        placeholder="공지 제목, 내용, 스터디 검색"
                      />
                      <p className="recruitment-manage-meta">
                        총 {searchedNotices.length}건 · {noticePage}/{noticePageCount} 페이지
                      </p>
                    </div>

                    <div className="space-y-3">
                      {pagedNotices.map((notice) => {
                        const isDeleting = deletingNoticeId === notice.id;
                        const isStudyNotice = notice.studyGroupId != null && Number(notice.studyGroupId) > 0;
                        return (
                          <div key={notice.id} className="notice-card notice-card-with-preview">
                            <div className="notice-card-main">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-black text-slate-900">{notice.title}</p>
                              <span className="rounded-full bg-[#e8efff] px-3 py-1 text-[10px] font-black tracking-wider text-[#003dc7]">
                                {isStudyNotice ? '스터디 공지' : '전체 공지'}
                              </span>
                              {notice.studyGroupName ? (
                                <span className="rounded-full bg-[#dde1ff] px-3 py-1 text-[10px] font-black tracking-wider text-[#003dc7]">
                                  {notice.studyGroupName}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-sm font-medium leading-6 text-slate-600 whitespace-pre-line">{notice.content}</p>
                            <p className="mt-3 text-xs font-semibold text-slate-400">
                              {new Date(notice.updatedAt || notice.createdAt).toLocaleString('ko-KR')}
                            </p>
                            <div className="notice-item-actions">
                              <button type="button" className="notice-action-btn" onClick={() => handleEditNotice(notice)}>
                                수정
                              </button>
                              <button
                                type="button"
                                className="notice-action-btn notice-action-btn-danger"
                                disabled={isDeleting}
                                onClick={() => handleDeleteNotice(notice)}
                              >
                                {isDeleting ? '삭제 중...' : '삭제'}
                              </button>
                            </div>
                            </div>
                            {notice.imageUrl ? (
                              <div className="notice-card-preview-wrap">
                                <img
                                  src={notice.imageUrl}
                                  alt="공지 이미지"
                                  className="notice-card-preview-image"
                                  loading="lazy"
                                  onError={(event) => {
                                    event.currentTarget.style.display = 'none';
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {searchedNotices.length === 0 ? (
                        <div className="notice-card text-sm font-medium text-slate-500">검색 조건에 맞는 공지사항이 없습니다.</div>
                      ) : null}
                    </div>

                    {searchedNotices.length > 0 ? (
                      <div className="recruitment-pagination">
                        <button
                          type="button"
                          className="notice-action-btn"
                          disabled={noticePage <= 1}
                          onClick={() => setNoticePage((prev) => Math.max(1, prev - 1))}
                        >
                          이전
                        </button>
                        <span className="recruitment-pagination-label">
                          {noticePage} / {noticePageCount}
                        </span>
                        <button
                          type="button"
                          className="notice-action-btn"
                          disabled={noticePage >= noticePageCount}
                          onClick={() => setNoticePage((prev) => Math.min(noticePageCount, prev + 1))}
                        >
                          다음
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <section className="setup-panel space-y-4">
                    <div className="setup-panel-head">
                      <p className="section-eyebrow">Notice Form</p>
                      <h3 className="setup-title">공지사항 추가</h3>
                      <p className="field-help">운영 스터디를 선택하고 학생 대상 공지 내용을 등록하세요.</p>
                    </div>
                    {editingNoticeId ? (
                      <div className="template-edit-banner">현재 기존 공지사항을 수정 중입니다. 저장하면 기존 공지 내용이 변경됩니다.</div>
                    ) : null}

                    <form className="space-y-4" onSubmit={handleSubmitNotice}>
                      <div className="field-group">
                        <span className="field-label">공지 유형</span>
                        <div className="input-type-toggle" role="tablist" aria-label="공지 유형 선택">
                          <button
                            type="button"
                            className={`input-type-toggle-btn ${noticeTargetType === 'study' ? 'input-type-toggle-btn-active' : ''}`}
                            onClick={() => {
                              setNoticeTargetType('study');
                              setSelectedNoticeStudyGroupId((prev) => prev ?? filteredStudies[0]?.id ?? null);
                            }}
                            aria-pressed={noticeTargetType === 'study'}
                          >
                            스터디 공지
                          </button>
                          <button
                            type="button"
                            className={`input-type-toggle-btn ${noticeTargetType === 'all' ? 'input-type-toggle-btn-active' : ''}`}
                            onClick={() => setNoticeTargetType('all')}
                            aria-pressed={noticeTargetType === 'all'}
                          >
                            전체 공지
                          </button>
                        </div>
                      </div>
                      {noticeTargetType === 'study' ? (
                        <UnifiedSelect
                          value={selectedNoticeStudyGroupId != null ? String(selectedNoticeStudyGroupId) : ''}
                          options={noticeStudySelectOptions}
                          onChange={(nextValue) => setSelectedNoticeStudyGroupId(Number(nextValue) || null)}
                          placeholder="운영 스터디 선택"
                          disabled={filteredStudies.length === 0}
                        />
                      ) : (
                        <div className="field-help">전체 공지는 선택한 학원의 전체 학생에게 공지됩니다.</div>
                      )}
                      <input className="field-input" value={noticeTitle} onChange={(event) => setNoticeTitle(event.target.value)} placeholder="공지 제목" />
                      <textarea
                        className="field-input min-h-[124px] resize-none py-4"
                        value={noticeContent}
                        onChange={(event) => setNoticeContent(event.target.value)}
                        placeholder="학생들에게 전달할 안내 내용을 입력해주세요."
                      />
                      <div className="field-group">
                        <span className="field-label">공지 사진 (선택)</span>
                        <input
                          ref={noticeImageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="field-input notice-file-input"
                          onChange={handleNoticeImageChange}
                        />
                        <p className="field-help">jpg, png, webp, gif 형식 이미지를 첨부할 수 있습니다.</p>
                        {noticeImagePreviewUrl || noticeImageServerUrl ? (
                          <div className="notice-form-image-preview">
                            <img src={noticeImagePreviewUrl || noticeImageServerUrl || ''} alt="공지 이미지 미리보기" />
                          </div>
                        ) : null}
                        {noticeImagePreviewUrl ? (
                          <button type="button" className="notice-action-btn" onClick={clearNoticeImageFile}>
                            새 사진 선택 취소
                          </button>
                        ) : null}
                      </div>
                      <div className="notice-form-actions notice-form-actions-end">
                        <button
                          type="submit"
                          disabled={noticeSubmitting || (noticeTargetType === 'study' && filteredStudies.length === 0)}
                          className="action-btn"
                        >
                          {noticeSubmitting
                            ? editingNoticeId
                              ? '공지사항을 수정하는 중...'
                              : '공지사항을 등록하는 중...'
                            : editingNoticeId
                              ? '공지사항 수정 저장'
                              : '공지사항 등록'}
                        </button>
                        <button type="button" className="action-btn action-btn-secondary" onClick={resetNoticeForm}>
                          {editingNoticeId ? '수정 취소' : '입력 초기화'}
                        </button>
                      </div>
                    </form>
                  </section>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AcademyManagementPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
          <p className="text-sm font-semibold text-slate-600">학원 관리 정보를 불러오는 중입니다...</p>
        </div>
      }
    >
      <AcademyManagementContent />
    </Suspense>
  );
}
