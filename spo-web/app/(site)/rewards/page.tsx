'use client';

import './page.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { fireSpoNotice } from '@/lib/ui/swal';

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
};

type SessionUserResponse = {
  user?: {
    profileImageUrl?: string | null;
  };
};

type RewardType = 'absence-pass' | 'gifticon' | 'miss';

type RewardSlot = {
  id: number;
  type: RewardType;
  label: string;
  shortLabel: string;
  startAngle: number;
  endAngle: number;
  color: string;
  textColor: string;
};

type RewardHistoryItem = {
  id: string;
  activityId: number;
  activityName: string;
  rewardType: Exclude<RewardType, 'miss'>;
  rewardLabel: string;
  acquiredAt: string;
};

type RewardInventoryItem = {
  activityId: number;
  activityName: string;
  subject: string;
  exemptionTicketCount: number;
};

type RewardContextResponse = {
  groups?: StudyGroup[];
  remainingSpinsByActivity?: Record<string, number>;
  inventory?: RewardInventoryItem[];
  rewardHistory?: RewardHistoryItem[];
  settings?: {
    dailySpinLimit?: number;
    probabilities?: {
      absencePass?: number;
      gifticon?: number;
      miss?: number;
    };
  };
  activitySettingsByActivity?: Record<
    string,
    {
      dailySpinLimit?: number;
      probabilities?: {
        absencePass?: number;
        gifticon?: number;
        miss?: number;
      };
    }
  >;
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE || '/api';
const DAILY_SPIN_LIMIT = 2;
const SPIN_DURATION_MS = 5200;
const SLOT_COUNT = 10;
const SLOT_ANGLE = 360 / SLOT_COUNT;

const rewardMeta: Record<RewardType, Omit<RewardSlot, 'id' | 'startAngle' | 'endAngle'>> = {
  'absence-pass': {
    type: 'absence-pass',
    label: '결석 면제권',
    shortLabel: '면제권',
    color: '#2563eb',
    textColor: '#ffffff',
  },
  gifticon: {
    type: 'gifticon',
    label: '기프티콘 1,000원',
    shortLabel: '1,000원',
    color: '#f97316',
    textColor: '#ffffff',
  },
  miss: {
    type: 'miss',
    label: '꽝',
    shortLabel: '꽝',
    color: '#dbe4ff',
    textColor: '#1e3a8a',
  },
};

const rewardSlotTypes: RewardType[] = [
  'absence-pass',
  'miss',
  'gifticon',
  'miss',
  'absence-pass',
  'miss',
  'gifticon',
  'miss',
  'absence-pass',
  'gifticon',
];

const rewardSlots: RewardSlot[] = rewardSlotTypes.map((type, index) => ({
  id: index,
  ...rewardMeta[type],
  startAngle: index * SLOT_ANGLE,
  endAngle: (index + 1) * SLOT_ANGLE,
}));

const rewardWheelGradient = `conic-gradient(from 0deg, ${rewardSlots
  .map((slot) => {
    const start = slot.startAngle + 0.55;
    const end = slot.endAngle - 0.55;
    return `#ffffff ${slot.startAngle}deg ${start}deg, ${slot.color} ${start}deg ${end}deg, #ffffff ${end}deg ${slot.endAngle}deg`;
  })
  .join(', ')})`;

const pickRewardSlot = (rewardType: RewardType) => {
  const matchingSlots = rewardSlots.filter((slot) => slot.type === rewardType);
  return matchingSlots[Math.floor(Math.random() * matchingSlots.length)] || rewardSlots[0];
};

const getTargetRotationForSlot = (currentRotation: number, slot: RewardSlot) => {
  const slotCenterAngle = slot.startAngle + SLOT_ANGLE / 2;
  const currentAngle = ((currentRotation % 360) + 360) % 360;
  const desiredAngle = (360 - slotCenterAngle) % 360;
  const deltaToTarget = (desiredAngle - currentAngle + 360) % 360;
  const fullTurns = 360 * (8 + Math.floor(Math.random() * 3));
  return currentRotation + fullTurns + deltaToTarget;
};

const formatHistoryDateTime = (isoString: string) => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

type RewardUnifiedSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type RewardUnifiedSelectProps = {
  value: string;
  options: RewardUnifiedSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function RewardUnifiedSelect({ value, options, onChange, placeholder, disabled = false }: RewardUnifiedSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsidePointer);
    return () => document.removeEventListener('mousedown', handleOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  return (
    <div
      ref={containerRef}
      className={`reward-unified-select ${disabled ? 'reward-unified-select-disabled' : ''}`}
    >
      <button
        type="button"
        className="reward-unified-select-trigger"
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="reward-unified-select-trigger-text">{selectedOption?.label || placeholder || '선택'}</span>
        <span className="reward-unified-select-trigger-icon">{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div className="reward-unified-select-menu" role="listbox">
          {options.length === 0 ? (
            <div className="reward-unified-select-empty">{placeholder || '선택 가능한 항목이 없습니다.'}</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`reward-unified-select-option ${option.value === value ? 'reward-unified-select-option-active' : ''}`}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function RewardsPage() {
  const [loading, setLoading] = useState(true);
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [remainingSpinsByActivity, setRemainingSpinsByActivity] = useState<Record<string, number>>({});
  const [rewardHistory, setRewardHistory] = useState<RewardHistoryItem[]>([]);
  const [exemptionInventory, setExemptionInventory] = useState<RewardInventoryItem[]>([]);
  const [dailySpinLimit, setDailySpinLimit] = useState(DAILY_SPIN_LIMIT);
  const [activitySettingsByActivity, setActivitySettingsByActivity] = useState<
    RewardContextResponse['activitySettingsByActivity']
  >({});
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [latestResult, setLatestResult] = useState<RewardSlot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [userResponse, rewardsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/app/users/me`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
          fetch(`${API_BASE_URL}/app/rewards`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          }),
        ]);

        const userData = (await userResponse.json().catch(() => ({}))) as SessionUserResponse;
        const rewardsData = (await rewardsResponse.json().catch(() => ({}))) as RewardContextResponse;

        if (userResponse.status === 401 || rewardsResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }

        if (!rewardsResponse.ok) {
          await fireSpoNotice({
            icon: 'error',
            title: '활동 목록을 불러오지 못했어요',
            text: rewardsData.message || '잠시 후 다시 시도해주세요.',
          });
          return;
        }

        if (!cancelled) {
          if (typeof userData.user?.profileImageUrl === 'string' && userData.user.profileImageUrl.trim()) {
            setProfileImageUrl(userData.user.profileImageUrl.trim());
          }

          const nextGroups = Array.isArray(rewardsData.groups) ? rewardsData.groups : [];
          setGroups(nextGroups);
          setSelectedActivityId((prev) => prev ?? nextGroups[0]?.id ?? null);
          setRemainingSpinsByActivity(rewardsData.remainingSpinsByActivity || {});
          setRewardHistory(Array.isArray(rewardsData.rewardHistory) ? rewardsData.rewardHistory : []);
          setExemptionInventory(Array.isArray(rewardsData.inventory) ? rewardsData.inventory : []);
          setActivitySettingsByActivity(rewardsData.activitySettingsByActivity || {});
          setDailySpinLimit(Number(rewardsData.settings?.dailySpinLimit || DAILY_SPIN_LIMIT));
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

  const activityOptions = useMemo(
    () =>
      groups.map((group) => ({
        value: String(group.id),
        label: `${group.name} · ${group.subject}`,
      })),
    [groups],
  );

  const selectedActivity = useMemo(
    () => groups.find((group) => group.id === selectedActivityId) ?? null,
    [groups, selectedActivityId],
  );

  const currentActivityInventory = useMemo(
    () => exemptionInventory.find((item) => Number(item.activityId) === Number(selectedActivityId)) ?? null,
    [exemptionInventory, selectedActivityId],
  );
  const currentActivitySettings = useMemo(
    () => (selectedActivityId ? activitySettingsByActivity?.[String(selectedActivityId)] : null) ?? null,
    [activitySettingsByActivity, selectedActivityId],
  );

  const remainingSpins = selectedActivityId ? Math.max(0, Number(remainingSpinsByActivity[String(selectedActivityId)] || 0)) : 0;

  const handleSpin = async () => {
    if (!selectedActivity) {
      await fireSpoNotice({
        icon: 'warning',
        title: '활동을 먼저 선택해주세요',
        text: '참여 중인 스터디를 선택하면 해당 활동 기준으로 룰렛을 돌릴 수 있어요.',
      });
      return;
    }

    if (isSpinning || remainingSpins <= 0) {
      return;
    }

    setIsSpinning(true);
    setLatestResult(null);

    const response = await fetch(`${API_BASE_URL}/app/rewards/spin`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ studyGroupId: selectedActivity.id }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
      result?: {
        rewardType?: RewardType;
        rewardLabel?: string;
        remainingSpins?: number;
        acquiredAt?: string;
        id?: string;
      };
    };

    if (!response.ok || !data.result?.rewardType) {
      setIsSpinning(false);
      await fireSpoNotice({
        icon: 'error',
        title: '룰렛을 돌리지 못했어요',
        text: data.message || '잠시 후 다시 시도해주세요.',
      });
      return;
    }

    const selectedReward = pickRewardSlot(data.result.rewardType);
    const nextRotation = getTargetRotationForSlot(rotation, selectedReward);
    setRotation(nextRotation);

    window.setTimeout(() => {
      setRemainingSpinsByActivity((prev) => ({
        ...prev,
        [String(selectedActivity.id)]: Math.max(0, Number(data.result?.remainingSpins || 0)),
      }));

      if (selectedReward.type === 'absence-pass') {
        setExemptionInventory((prev) => {
          const hasItem = prev.some((item) => Number(item.activityId) === Number(selectedActivity.id));
          if (!hasItem) {
            return [
              ...prev,
              {
                activityId: selectedActivity.id,
                activityName: selectedActivity.name,
                subject: selectedActivity.subject,
                exemptionTicketCount: 1,
              },
            ];
          }

          return prev.map((item) =>
            Number(item.activityId) === Number(selectedActivity.id)
              ? { ...item, exemptionTicketCount: item.exemptionTicketCount + 1 }
              : item,
          );
        });
      }

      if (selectedReward.type !== 'miss') {
        const rewardType = selectedReward.type as Exclude<RewardType, 'miss'>;
        setRewardHistory((prev) => [
          {
            id: data.result?.id || `${selectedActivity.id}-${Date.now()}`,
            activityId: selectedActivity.id,
            activityName: selectedActivity.name,
            rewardType,
            rewardLabel: data.result?.rewardLabel || selectedReward.label,
            acquiredAt: data.result?.acquiredAt || new Date().toISOString(),
          },
          ...prev,
        ]);
      }

      setLatestResult(selectedReward);
      setIsSpinning(false);
    }, SPIN_DURATION_MS);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] px-6 py-8">
        <p className="text-sm font-semibold text-slate-600">리워드 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6fb] text-[#191c1d]">
      <AppSidebar activeItem="rewards" />
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
          <div className="mx-auto max-w-7xl">
            <header className="mb-8">
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900">리워드 룰렛</h1>
                <p className="mt-2 text-sm font-medium text-slate-500">
                  활동별로 하루 2번 도전하고, 결석 면제권과 리워드를 받아보세요.
                </p>
              </div>
            </header>

            <div className="reward-main-grid">
              <section className="reward-surface space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-[#003dc7]">Current Activity</p>
                    <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                      {selectedActivity?.name || '참여 중인 활동이 없습니다'}
                    </h2>
                  </div>

                  <label className="reward-activity-select-wrap">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">활동 선택</span>
                    <RewardUnifiedSelect
                      value={selectedActivityId != null ? String(selectedActivityId) : ''}
                      options={activityOptions}
                      onChange={(nextValue) => setSelectedActivityId(Number(nextValue) || null)}
                      placeholder="참여 중인 활동 없음"
                      disabled={groups.length === 0 || isSpinning}
                    />
                  </label>
                </div>

                <div className="reward-wheel-and-result-grid">
                  <div className="reward-wheel-panel">
                    <div className="reward-wheel-shell">
                      <div className="reward-wheel-pointer" />
                      <div
                        className={`reward-wheel ${isSpinning ? 'reward-wheel-spinning' : ''}`}
                        style={{
                          transform: `rotate(${rotation}deg)`,
                          background: rewardWheelGradient,
                        }}
                      >
                        {rewardSlots.map((slot) => {
                          const midAngle = slot.startAngle + SLOT_ANGLE / 2;
                          return (
                            <div
                              key={slot.id}
                              className="reward-wheel-label"
                              style={{
                                transform: `translate(-50%, -50%) rotate(${midAngle}deg) translateY(-104px) rotate(-${midAngle + rotation}deg)`,
                                color: slot.textColor,
                              }}
                            >
                              {slot.shortLabel}
                            </div>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        className="reward-start-button"
                        onClick={() => void handleSpin()}
                        disabled={isSpinning || remainingSpins <= 0 || !selectedActivity}
                      >
                        <span className="reward-start-main">{isSpinning ? 'SPIN' : 'START'}</span>
                        <span className="reward-start-sub">
                          남은 {remainingSpins} / {currentActivitySettings?.dailySpinLimit ?? dailySpinLimit}
                        </span>
                      </button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="reward-mini-stat">
                        <span className="reward-mini-stat-label">오늘 남은 횟수</span>
                        <strong className="reward-mini-stat-value text-[#003dc7]">{remainingSpins}</strong>
                      </div>
                      <div className="reward-mini-stat">
                        <span className="reward-mini-stat-label">현재 활동 면제권</span>
                        <strong className="reward-mini-stat-value text-[#2563eb]">
                          {currentActivityInventory?.exemptionTicketCount || 0}
                        </strong>
                      </div>
                      <div className="reward-mini-stat">
                        <span className="reward-mini-stat-label">누적 당첨</span>
                        <strong className="reward-mini-stat-value text-[#f97316]">{rewardHistory.length}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="reward-result-panel">
                    <div className="reward-highlight-card">
                      <span className="reward-highlight-chip">Latest Result</span>
                      <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-900">
                        {latestResult ? latestResult.label : '룰렛을 돌려보세요'}
                      </h3>
                      <p className="mt-3 text-sm font-medium text-slate-500">
                        {latestResult?.type === 'absence-pass'
                          ? `${selectedActivity?.name || '현재 활동'}에서만 사용할 수 있는 결석 면제권이 적립됐어요.`
                          : latestResult?.type === 'gifticon'
                            ? '작은 보상이지만 기분 좋은 당첨이에요. 내역에서 확인해보세요.'
                            : latestResult?.type === 'miss'
                              ? '이번엔 아쉽지만 아직 기회가 남아 있을 수도 있어요.'
                              : '활동을 선택하고 가운데 START 버튼을 눌러 오늘의 운을 확인해보세요.'}
                      </p>
                    </div>

                    <div className="reward-legend-card">
                      <div className="reward-legend-item">
                        <span className="reward-legend-dot bg-[#2563eb]" />
                        <span>결석 면제권</span>
                      </div>
                      <div className="reward-legend-item">
                        <span className="reward-legend-dot bg-[#f97316]" />
                        <span>기프티콘 1,000원</span>
                      </div>
                      <div className="reward-legend-item">
                        <span className="reward-legend-dot bg-[#dbe4ff]" />
                        <span>꽝</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <aside className="reward-right-column">
                <section className="reward-surface">
                  <div className="reward-card-header">
                    <div>
                      <h2 className="text-xl font-black tracking-tight text-slate-900">면제권 보관함</h2>
                      <p className="mt-1 text-xs font-medium text-slate-500">활동별로 분리 보관되며 서로 공유되지 않습니다.</p>
                    </div>
                    <span className="reward-card-badge">
                      activity scoped
                    </span>
                  </div>

                  <div className="space-y-3">
                    {exemptionInventory.map((item) => (
                      <div
                        key={item.activityId}
                        className={`reward-inventory-item ${item.activityId === selectedActivityId ? 'reward-inventory-item-active' : ''}`}
                      >
                        <div className="reward-inventory-text">
                          <p className="reward-inventory-title">{item.activityName}</p>
                          <p className="reward-inventory-subject">{item.subject}</p>
                        </div>
                        <div className="reward-ticket-pill">{item.exemptionTicketCount}개</div>
                      </div>
                    ))}

                    {exemptionInventory.length === 0 ? (
                      <div className="reward-empty-state">참여 중인 활동이 없어서 아직 보관함이 비어 있어요.</div>
                    ) : null}
                  </div>
                </section>

                <section className="reward-surface">
                  <div className="mb-5">
                    <h2 className="text-xl font-black tracking-tight text-slate-900">받은 상품 내역</h2>
                    <p className="mt-1 text-xs font-medium text-slate-500">꽝은 기록되지 않고, 실제 당첨만 남겨집니다.</p>
                  </div>

                  <div className="space-y-3">
                    {rewardHistory.map((item) => (
                      <div key={item.id} className="reward-history-item">
                        <div className={`reward-history-icon ${item.rewardType === 'absence-pass' ? 'reward-history-icon-pass' : 'reward-history-icon-gift'}`}>
                          <span className="material-symbols-outlined">
                            {item.rewardType === 'absence-pass' ? 'verified' : 'redeem'}
                          </span>
                        </div>
                        <div className="reward-history-text">
                          <p className="reward-history-title">{item.rewardLabel}</p>
                          <p className="reward-history-activity">{item.activityName}</p>
                        </div>
                        <span className="reward-history-date">{formatHistoryDateTime(item.acquiredAt)}</span>
                      </div>
                    ))}

                    {rewardHistory.length === 0 ? (
                      <div className="reward-empty-state">아직 당첨된 상품이 없습니다. 오늘 첫 도전을 시작해보세요.</div>
                    ) : null}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
