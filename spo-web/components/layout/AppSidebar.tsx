'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type SessionMeResponse = {
  user?: {
    loginId?: string;
    name?: string;
    profileImageUrl?: string | null;
    role?: string;
  };
};

type StudyGroup = {
  id: number;
  name: string;
  subject: string;
  academyId?: number | null;
  academyName?: string | null;
};

type StudyGroupsResponse = {
  groups?: StudyGroup[];
};

type Academy = {
  id: number;
  name: string;
};

type StudyRoomContextResponse = {
  academies?: Academy[];
  studies?: StudyGroup[];
};

type SidebarActiveItem =
  | 'main'
  | 'study-room'
  | 'attendance'
  | 'schedule'
  | 'friends'
  | 'academy-notices'
  | 'rewards'
  | 'academy-management'
  | 'settings';

type AppSidebarProps = {
  activeItem?: SidebarActiveItem;
};

const normalizeRole = (value?: string | null) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export function AppSidebar({ activeItem }: AppSidebarProps = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const profileSectionRef = useRef<HTMLDivElement | null>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [academyStudyMenuOpen, setAcademyStudyMenuOpen] = useState(() => {
    const academySection = searchParams.get('section');
    return (
      pathname.startsWith('/study-room') ||
      pathname.startsWith('/attendance-management') ||
      (pathname.startsWith('/academy-management') && academySection !== 'notice')
    );
  });
  const [academyNoticeMenuOpen, setAcademyNoticeMenuOpen] = useState(() => {
    const academySection = searchParams.get('section');
    return pathname.startsWith('/academy-notices') || (pathname.startsWith('/academy-management') && academySection === 'notice');
  });
  const [loggedIn, setLoggedIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [openCampusKeyMap, setOpenCampusKeyMap] = useState<Record<string, boolean>>({});

  const [userName, setUserName] = useState('김지민 학생');
  const [userLoginId, setUserLoginId] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('/default-profile-avatar.svg');
  const [userRole, setUserRole] = useState('');
  const [registeredAcademies, setRegisteredAcademies] = useState<Academy[]>([]);
  const [studyGroups, setStudyGroups] = useState<StudyGroup[]>([]);

  useEffect(() => {
    let cancelled = false;

    const verifySession = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as SessionMeResponse;

        if (!response.ok || !data.user || cancelled) return;

        setLoggedIn(true);
        const normalizedRole = normalizeRole(data.user.role);
        if (data.user.name) {
          const suffix = normalizedRole === 'academy' || normalizedRole === 'mentor' ? ' 학원관리자' : data.user.name.endsWith('학생') ? '' : ' 학생';
          setUserName(`${data.user.name}${suffix}`);
        }
        if (data.user.loginId) {
          setUserLoginId(data.user.loginId);
        }
        if (normalizedRole) {
          setUserRole(normalizedRole);
        }
        if (typeof data.user.profileImageUrl === 'string' && data.user.profileImageUrl.trim()) {
          setProfileImageUrl(data.user.profileImageUrl.trim());
        }

        const contextResponse = await fetch('/api/app/study-room/context', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });

        if (!cancelled && contextResponse.ok) {
          const contextData = (await contextResponse.json().catch(() => ({}))) as StudyRoomContextResponse;
          if (Array.isArray(contextData.academies)) {
            setRegisteredAcademies(contextData.academies);
          }
          if (Array.isArray(contextData.studies)) {
            setStudyGroups(contextData.studies);
            return;
          }
        }

        const groupsResponse = await fetch('/api/app/study-groups', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const groupsData = (await groupsResponse.json().catch(() => ({}))) as StudyGroupsResponse;
        if (!cancelled && groupsResponse.ok && Array.isArray(groupsData.groups)) {
          setStudyGroups(groupsData.groups);
        }
      } catch {
        // no-op
      }
    };

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (profileSectionRef.current?.contains(event.target as Node)) return;
      setIsProfileMenuOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    setIsProfileMenuOpen(false);
  }, [collapsed]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.replace('/sign-in');
    }
  };

  const handleProfileCardClick = () => {
    if (collapsed) {
      setCollapsed(false);
      setIsProfileMenuOpen(false);
      return;
    }
    setIsProfileMenuOpen((prev) => !prev);
  };

  const isMain = activeItem ? activeItem === 'main' : pathname === '/main';
  const isStudyRoom = activeItem ? activeItem === 'study-room' : pathname.startsWith('/study-room');
  const isAttendance = activeItem ? activeItem === 'attendance' : pathname.startsWith('/attendance-management');
  const isSchedule = activeItem ? activeItem === 'schedule' : pathname.startsWith('/schedule-management');
  const isFriends = activeItem ? activeItem === 'friends' : pathname.startsWith('/friends');
  const isAcademyNotices = activeItem ? activeItem === 'academy-notices' : pathname.startsWith('/academy-notices');
  const isRewards = activeItem ? activeItem === 'rewards' : pathname.startsWith('/rewards');
  const isAcademyManagement = activeItem
    ? activeItem === 'academy-management'
    : pathname.startsWith('/academy-management');
  const isSettings = activeItem ? activeItem === 'settings' : pathname.startsWith('/profile');
  const normalizedUserRole = normalizeRole(userRole);
  const isAcademyManager = normalizedUserRole === 'academy' || normalizedUserRole === 'mentor';
  const isStudentUser = normalizedUserRole === 'student';
  const canManageAcademy =
    isAcademyManager || normalizedUserRole === 'admin' || normalizedUserRole === 'operator';
  const showRewardsMenu = Boolean(normalizedUserRole) && !isAcademyManager;
  const showScheduleMenu = isStudentUser;
  const attendanceMenuLabel = isStudentUser ? '출석' : '출석 관리';
  const friendsMenuLabel = isAcademyManager ? '학생관리' : '친구';
  const friendsMenuIcon = isAcademyManager ? 'supervisor_account' : 'person';
  const academyManagementSection = searchParams.get('section');
  const isAcademyStudyManage = pathname.startsWith('/study-room') || pathname.startsWith('/attendance-management');
  const isAcademyRecruitmentManage =
    isAcademyManagement && academyManagementSection !== 'notice';
  const isAcademyStudyRootActive = isAcademyStudyManage || isAcademyRecruitmentManage;
  const isAcademyNoticeManage = isAcademyManagement && academyManagementSection === 'notice';
  const isAcademyNoticeRootActive = isAcademyNotices || isAcademyNoticeManage;
  const activeStudyGroupId = pathname.match(/^\/study-room\/(\d+)/)?.[1] ?? null;
  const showStudyGroupSubnav = isStudyRoom && !collapsed && studyGroups.length > 0;
  const showAcademyStudySubnav = !collapsed && academyStudyMenuOpen;
  const showAcademyNoticeSubnav = !collapsed && academyNoticeMenuOpen;

  useEffect(() => {
    if (isAcademyStudyRootActive) {
      setAcademyStudyMenuOpen(true);
    }
  }, [isAcademyStudyRootActive]);

  useEffect(() => {
    if (isAcademyNoticeRootActive) {
      setAcademyNoticeMenuOpen(true);
    }
  }, [isAcademyNoticeRootActive]);

  const groupedStudyGroups = useMemo(() => {
    const academyNameById = new Map<number, string>();
    const academyIdByName = new Map<string, number>();
    const primaryAcademyId = Number(registeredAcademies[0]?.id || 0);
    registeredAcademies.forEach((academy) => {
      const academyId = Number(academy.id);
      const academyName = String(academy.name || '').trim();
      if (!academyId || !academyName) return;
      academyNameById.set(academyId, academyName);
      academyIdByName.set(academyName.toLowerCase(), academyId);
    });

    const buckets = new Map<
      string,
      { label: string; groups: StudyGroup[]; isUnassigned: boolean; academyId: number | null }
    >();

    studyGroups.forEach((group) => {
      let resolvedAcademyId = Number(group.academyId);
      if (!Number.isInteger(resolvedAcademyId) || resolvedAcademyId <= 0) {
        resolvedAcademyId = 0;
      }

      const rawAcademyName = String(group.academyName || '').trim();
      if (!resolvedAcademyId && rawAcademyName) {
        resolvedAcademyId = academyIdByName.get(rawAcademyName.toLowerCase()) || 0;
      }

      if (!resolvedAcademyId && registeredAcademies.length === 1) {
        resolvedAcademyId = Number(registeredAcademies[0].id);
      }
      if (!resolvedAcademyId && isAcademyManager && primaryAcademyId > 0) {
        resolvedAcademyId = primaryAcademyId;
      }

      const label =
        (resolvedAcademyId > 0 ? academyNameById.get(resolvedAcademyId) : '') ||
        rawAcademyName ||
        '캠퍼스 미지정';
      const key = resolvedAcademyId > 0 ? `academy:${resolvedAcademyId}` : 'campus:unassigned';

      if (!buckets.has(key)) {
        buckets.set(key, {
          label,
          groups: [],
          isUnassigned: resolvedAcademyId <= 0,
          academyId: resolvedAcademyId > 0 ? resolvedAcademyId : null,
        });
      }
      buckets.get(key)?.groups.push(group);
    });

    const ordered = Array.from(buckets.entries())
      .map(([key, value]) => ({
        key,
        label: value.label,
        isUnassigned: value.isUnassigned,
        academyId: value.academyId,
        groups: [...value.groups].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
      }))
      .sort((a, b) => {
        if (!a.isUnassigned && !b.isUnassigned && a.academyId && b.academyId) {
          const aOrder = registeredAcademies.findIndex((academy) => Number(academy.id) === a.academyId);
          const bOrder = registeredAcademies.findIndex((academy) => Number(academy.id) === b.academyId);
          if (aOrder !== bOrder && aOrder !== -1 && bOrder !== -1) return aOrder - bOrder;
        }
        if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
        return a.label.localeCompare(b.label, 'ko');
      });

    return ordered;
  }, [studyGroups, registeredAcademies, isAcademyManager]);

  useEffect(() => {
    setOpenCampusKeyMap((prev) => {
      const next: Record<string, boolean> = { ...prev };
      let changed = false;

      groupedStudyGroups.forEach((campusGroup) => {
        if (typeof next[campusGroup.key] !== 'boolean') {
          next[campusGroup.key] = false;
          changed = true;
        }
      });

      Object.keys(next).forEach((key) => {
        if (!groupedStudyGroups.some((campusGroup) => campusGroup.key === key)) {
          delete next[key];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [groupedStudyGroups]);

  useEffect(() => {
    if (!activeStudyGroupId) return;
    const activeCampusGroup = groupedStudyGroups.find((campusGroup) =>
      campusGroup.groups.some((group) => String(group.id) === activeStudyGroupId),
    );
    if (!activeCampusGroup) return;

    setOpenCampusKeyMap((prev) => {
      if (prev[activeCampusGroup.key] === true) return prev;
      return {
        ...prev,
        [activeCampusGroup.key]: true,
      };
    });
  }, [activeStudyGroupId, groupedStudyGroups]);

  return (
    <>
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <button
          type="button"
          className="toggle-btn"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label="Toggle sidebar"
        >
          <span className="material-symbols-outlined text-sm">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>

        <Link href="/main" className="brand-section flex-row">
          <div className="brand-icon">
            <span className="material-symbols-outlined filled">school</span>
          </div>
          <div className="brand-text nowrap">
            <h1 className="brand-title">SPO</h1>
            <p className="brand-subtitle">Study &amp; Point</p>
          </div>
        </Link>

        <nav className="nav-list">
          <Link className={`nav-item ${isMain ? 'nav-item-active' : ''}`} href="/main">
            <span className="material-symbols-outlined filled">dashboard</span>
            <span className="nav-text nowrap">대시보드</span>
          </Link>
          {isAcademyManager ? (
            <>
              <button
                type="button"
                className={`nav-item nav-item-toggle ${isAcademyStudyRootActive ? 'nav-item-active' : ''}`}
                onClick={() => setAcademyStudyMenuOpen((prev) => !prev)}
                aria-expanded={academyStudyMenuOpen}
                aria-controls="academy-study-subnav"
              >
                <span className="material-symbols-outlined">groups</span>
                <span className="nav-text nowrap">스터디</span>
                <span className="material-symbols-outlined nav-toggle-icon">
                  {academyStudyMenuOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {showAcademyStudySubnav ? (
                <div id="academy-study-subnav" className="study-subnav" aria-label="학원 스터디 메뉴">
                  <Link
                    href="/study-room"
                    className={`study-subnav-item ${isAcademyStudyManage ? 'study-subnav-item-active' : ''}`}
                  >
                    <span className="study-subnav-dot" />
                    <span className="study-subnav-text">
                      <span className="study-subnav-name">스터디 관리</span>
                      <span className="study-subnav-subject">스터디별 출석/활동 확인</span>
                    </span>
                  </Link>
                  <Link
                    href="/academy-management?section=recruitment"
                    className={`study-subnav-item ${isAcademyRecruitmentManage ? 'study-subnav-item-active' : ''}`}
                  >
                    <span className="study-subnav-dot" />
                    <span className="study-subnav-text">
                      <span className="study-subnav-name">스터디 공고 관리</span>
                      <span className="study-subnav-subject">모집 조건/운영 설정 관리</span>
                    </span>
                  </Link>
                </div>
              ) : null}
              <button
                type="button"
                className={`nav-item nav-item-toggle ${isAcademyNoticeRootActive ? 'nav-item-active' : ''}`}
                onClick={() => setAcademyNoticeMenuOpen((prev) => !prev)}
                aria-expanded={academyNoticeMenuOpen}
                aria-controls="academy-notice-subnav"
              >
                <span className="material-symbols-outlined">campaign</span>
                <span className="nav-text nowrap">공지사항</span>
                <span className="material-symbols-outlined nav-toggle-icon">
                  {academyNoticeMenuOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {showAcademyNoticeSubnav ? (
                <div id="academy-notice-subnav" className="study-subnav" aria-label="학원 공지사항 메뉴">
                  <Link
                    href="/academy-notices"
                    className={`study-subnav-item ${isAcademyNotices ? 'study-subnav-item-active' : ''}`}
                  >
                    <span className="study-subnav-dot" />
                    <span className="study-subnav-text">
                      <span className="study-subnav-name">공지사항</span>
                      <span className="study-subnav-subject">등록된 학원 공지 목록</span>
                    </span>
                  </Link>
                  <Link
                    href="/academy-management?section=notice"
                    className={`study-subnav-item ${isAcademyNoticeManage ? 'study-subnav-item-active' : ''}`}
                  >
                    <span className="study-subnav-dot" />
                    <span className="study-subnav-text">
                      <span className="study-subnav-name">공지사항 관리</span>
                      <span className="study-subnav-subject">공지 작성/수정/삭제</span>
                    </span>
                  </Link>
                </div>
              ) : null}
              <Link className={`nav-item ${isFriends ? 'nav-item-active' : ''}`} href="/friends">
                <span className="material-symbols-outlined">{friendsMenuIcon}</span>
                <span className="nav-text nowrap">{friendsMenuLabel}</span>
              </Link>
            </>
          ) : (
            <>
              <Link className={`nav-item ${isStudyRoom ? 'nav-item-active' : ''}`} href="/study-room">
                <span className="material-symbols-outlined">groups</span>
                <span className="nav-text nowrap">스터디룸</span>
              </Link>
              {showStudyGroupSubnav ? (
                <div className="study-subnav" aria-label="참여 중인 스터디 목록">
                  {groupedStudyGroups.map((campusGroup) => {
                    const isCampusOpen = openCampusKeyMap[campusGroup.key] ?? true;
                    const campusSubnavId = `study-campus-${campusGroup.key.replace(/[^a-z0-9_-]/gi, '-')}`;
                    return (
                      <div key={campusGroup.key} className="study-subnav-campus-group">
                        <button
                          type="button"
                          className={`study-subnav-campus-heading study-subnav-campus-toggle ${
                            isCampusOpen ? 'study-subnav-campus-toggle-open' : ''
                          }`}
                          aria-expanded={isCampusOpen}
                          aria-controls={campusSubnavId}
                          onClick={() =>
                            setOpenCampusKeyMap((prev) => ({
                              ...prev,
                              [campusGroup.key]: !(prev[campusGroup.key] ?? true),
                            }))
                          }
                        >
                          <span className="study-subnav-campus-label">{campusGroup.label}</span>
                          <span className="material-symbols-outlined study-subnav-campus-toggle-icon">
                            {isCampusOpen ? 'expand_less' : 'expand_more'}
                          </span>
                        </button>
                        {isCampusOpen ? (
                          <div id={campusSubnavId} className="study-subnav-campus-items">
                            {campusGroup.groups.map((group) => {
                              const isActiveGroup = activeStudyGroupId === String(group.id);
                              return (
                                <Link
                                  key={group.id}
                                  href={`/study-room/${group.id}`}
                                  className={`study-subnav-item ${isActiveGroup ? 'study-subnav-item-active' : ''}`}
                                >
                                  <span className="study-subnav-dot" />
                                  <span className="study-subnav-text">
                                    <span className="study-subnav-name">{group.name}</span>
                                    <span className="study-subnav-subject">{group.subject}</span>
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <Link className={`nav-item ${isAttendance ? 'nav-item-active' : ''}`} href="/attendance-management">
                <span className="material-symbols-outlined">fact_check</span>
                <span className="nav-text nowrap">{attendanceMenuLabel}</span>
              </Link>
              {showScheduleMenu ? (
                <Link className={`nav-item ${isSchedule ? 'nav-item-active' : ''}`} href="/schedule-management">
                  <span className="material-symbols-outlined">calendar_month</span>
                  <span className="nav-text nowrap">일정 관리</span>
                </Link>
              ) : null}
              <Link className={`nav-item ${isFriends ? 'nav-item-active' : ''}`} href="/friends">
                <span className="material-symbols-outlined">{friendsMenuIcon}</span>
                <span className="nav-text nowrap">{friendsMenuLabel}</span>
              </Link>
              <Link className={`nav-item ${isAcademyNotices ? 'nav-item-active' : ''}`} href="/academy-notices">
                <span className="material-symbols-outlined">campaign</span>
                <span className="nav-text nowrap">학원 공지</span>
              </Link>
              {showRewardsMenu ? (
                <Link className={`nav-item ${isRewards ? 'nav-item-active' : ''}`} href="/rewards">
                  <span className="material-symbols-outlined">workspace_premium</span>
                  <span className="nav-text nowrap">리워드</span>
                </Link>
              ) : null}
              {canManageAcademy ? (
                <Link className={`nav-item ${isAcademyManagement ? 'nav-item-active' : ''}`} href="/academy-management">
                  <span className="material-symbols-outlined">apartment</span>
                  <span className="nav-text nowrap">학원 관리</span>
                </Link>
              ) : null}
            </>
          )}
          <Link className={`nav-item ${isSettings ? 'nav-item-active' : ''}`} href="/profile/settings">
            <span className="material-symbols-outlined">settings</span>
            <span className="nav-text nowrap">설정</span>
          </Link>
        </nav>

        <div className="profile-section" ref={profileSectionRef}>
          {loggedIn ? (
            <>
              <button
                type="button"
                className="profile-card profile-card-user profile-card-button"
                onClick={handleProfileCardClick}
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
              >
                <img
                  alt="User Profile"
                  className="profile-image"
                  src={profileImageUrl}
                  onError={(event) => {
                    event.currentTarget.src = '/default-profile-avatar.svg';
                  }}
                />
                <div className="profile-info-wrap">
                  <p className="profile-name">{userName}</p>
                  <p className="profile-tier">{userLoginId ? `ID: ${userLoginId}` : 'ID: -'}</p>
                </div>
                <span className="material-symbols-outlined profile-expand-icon">
                  {isProfileMenuOpen ? 'expand_more' : 'expand_less'}
                </span>
              </button>

              {isProfileMenuOpen ? (
                <div className="profile-menu" role="menu">
                  <Link
                    href="/profile/settings"
                    className="profile-menu-item"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    <span className="material-symbols-outlined profile-menu-icon">manage_accounts</span>
                    <span>프로필 설정</span>
                  </Link>
                  <button
                    type="button"
                    className="profile-menu-item profile-menu-item-danger"
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                  >
                    <span className="material-symbols-outlined profile-menu-icon">logout</span>
                    <span>{isSigningOut ? '로그아웃 중...' : '로그아웃'}</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="profile-card profile-card-login">
              <Link href="/sign-in" className="profile-login-only">
                <div className="login-icon-wrap">
                  <span className="material-symbols-outlined login-icon">login</span>
                </div>
                <div className="profile-info-wrap">
                  <p className="profile-name">로그인</p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </aside>
      <div className={`sidebar-spacer ${collapsed ? 'sidebar-spacer-collapsed' : ''}`} aria-hidden="true" />
    </>
  );
}
