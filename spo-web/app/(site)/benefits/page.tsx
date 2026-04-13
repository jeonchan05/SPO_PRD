import { InfoPageTemplate } from "@/components/pages/shared/InfoPageTemplate";
import styles from "@/app/css/pages/benefits.module.css";

export default function BenefitsPage() {
  return (
    <InfoPageTemplate
      badge="Core Features"
      title="SPO 핵심 기능"
      description="SPO는 학원에서 실제로 필요한 스터디 모집, 신청 관리, 팀 매칭, 공지 운영, 출석/리워드 관리를 한 흐름으로 제공하는 스터디 운영 플랫폼입니다."
      mainClassName={styles.page}
      points={[
        "스터디 공고 템플릿으로 대상 수업, 모집 기간, 인원 조건, 요일/시간 설정",
        "신청 체크 항목(MBTI, 성격, 같이 하고 싶은 스타일, 커스텀 질문) 구성",
        "AI 배정안 생성 후 관리자 직접 조정 및 팀 확정",
        "전체 공지/스터디 공지 작성, 이미지 첨부, 대상별 공지 노출",
        "출석 관리와 리워드 기준 설정 및 학생 화면 연동",
      ]}
    />
  );
}
