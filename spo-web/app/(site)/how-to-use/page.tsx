import { InfoPageTemplate } from "@/components/pages/shared/InfoPageTemplate";
import styles from "@/app/css/pages/how-to-use.module.css";

export default function HowToUsePage() {
  return (
    <InfoPageTemplate
      badge="How to Use"
      title="SPO 사용 방법"
      description="1) 공고를 등록하고 신청 체크 항목을 설정합니다. 2) 학생 신청을 받은 뒤 AI 배정안 또는 직접 배정으로 팀을 확정합니다. 3) 생성된 스터디에서 공지, 출석, 기록을 운영합니다."
      mainClassName={styles.page}
      points={[
        "학원: 공고/공지/출석/학생 관리",
        "학생: 신청 저장, 공지 확인, 스터디 참여",
        "운영자: 검색/필터/페이지네이션으로 대량 데이터 관리",
      ]}
    />
  );
}
