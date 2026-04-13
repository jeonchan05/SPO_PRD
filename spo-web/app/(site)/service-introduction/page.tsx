import { InfoPageTemplate } from "@/components/pages/shared/InfoPageTemplate";
import styles from "@/app/css/pages/service-introduction.module.css";

export default function ServiceIntroductionPage() {
  return (
    <InfoPageTemplate
      badge="Service Introduction"
      title="SPO 서비스 소개"
      description="SPO는 학원 운영자가 스터디 공고를 만들고 신청자를 매칭해 실제 스터디를 개설한 뒤, 공지와 출석/리워드까지 이어서 운영할 수 있는 서비스입니다."
      mainClassName={styles.page}
      points={[
        "공고 작성과 신청 접수",
        "AI 매칭 + 관리자 직접 매칭",
        "팀 확정 후 스터디 생성과 공지/출석 운영",
      ]}
    />
  );
}
