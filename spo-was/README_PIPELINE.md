# Vision-first PDF Discussion Pipeline

## 목표
PDF 발표자료를 입력받아 다음 산출물을 생성합니다.

1. 페이지별 구조 분석 JSON (`pages/*.json`, `page_analysis.jsonl`)
2. 문서 통합 요약 JSON (`document_summary.json`)
3. 토론 주제 10개 JSON + Markdown (`discussion_topics.json`, `discussion_topics.md`)

핵심 설계는 **Vision-first + OCR fallback** 입니다.

## 왜 OCR-only가 아닌 Vision-first인가
- OCR-only는 레이아웃, 표/도식 관계, 강조 구조(제목-본문-비교)를 잃기 쉽습니다.
- Vision-first는 슬라이드 역할(cover/comparison/conclusion 등)과 의미 구조를 먼저 복원합니다.
- OCR은 저신뢰 페이지에만 선택적으로 수행해 비용/지연을 줄이고, 작은 글씨/저화질 페이지를 보강합니다.

## 아키텍처
`src/pipeline` 하위 모듈:

- `pdf/`: PDF 페이지 렌더링 (`pdfinfo`, `pdftoppm`)
- `vision/`: 멀티모달 모델 adapter 인터페이스 (`mock`, `openai_compatible`, `gemini_cli`)
- `ocr/`: tesseract 기반 OCR 실행
- `pipeline/`: 단계 실행기/후처리/fallback 정책
- `prompts/`: 프롬프트 템플릿 자산
- `cli/`: 명령행 실행기
- `models/`: JSON 정규화 + 스키마 검증

## 주요 환경변수
- `MODEL_PROVIDER`: `mock` | `openai_compatible` | `gemma_api` | `gemini_cli`
- `MODEL_NAME`: 모델명 (예: `gemma4:e4b`)
- `MODEL_BASE_URL`: OpenAI-compatible base URL (기본: `http://127.0.0.1:11434`)
- `API_KEY`: API 키 (없으면 빈 값 허용)
- `MATERIAL_AI_PROVIDER`: `gemma_api` | `gemini_cli` (업로드 후 토론주제/피드백 생성 provider 선택)
- `GEMINI_API_KEY`: Gemini CLI 인증 키 (gemini_cli 사용 시 필요)
- `GEMINI_CLI_BIN`: Gemini CLI 실행 파일 경로 (기본 `gemini`)
- `GEMINI_CLI_NODE_BIN`: Gemini CLI를 실행할 Node 경로 (기본 현재 Node)
- `GEMINI_CLI_ENTRYPOINT`: Gemini CLI entrypoint JS 경로 (Alpine shebang 이슈 우회용)
- `GEMINI_CLI_MODEL`: Gemini CLI 모델명 (기본 `gemini-2.5-flash`)
- `GEMINI_CLI_REQUEST_TIMEOUT_MS`: Gemini CLI 요청 타임아웃(ms)
- `GEMINI_CLI_APPROVAL_MODE`: Gemini CLI approval mode (기본 `plan`)
- `GEMINI_CLI_OUTPUT_FORMAT`: Gemini CLI 출력 형식 (기본 `json`)
- `GEMINI_CLI_EXTRA_ARGS`: 추가 CLI 인자 (공백 구분)
- `GEMINI_CLI_ENABLE_VISION`: `true`일 때만 page vision 분석 시도 (기본 `false`, OCR fallback 유도)
- Gemini CLI는 실행 환경 Node 20+가 필요합니다. (Docker `spo-was`는 Node 20 기반)
- Alpine 환경에서는 `/usr/bin/env -S` shebang 미지원 문제가 있어 `node + entrypoint` 모드로 자동 우회합니다.
- `MODEL_SYSTEM_PROMPT`: 시스템 프롬프트 오버라이드
- `MODEL_REQUEST_TIMEOUT_MS`: 모델 요청 타임아웃(ms)
- `GEMMA_REQUEST_TIMEOUT_MS`: Gemma API 요청 타임아웃(ms, 기본 300000)
- `GEMMA_SUMMARY_TIMEOUT_MS`: 요약 단계 타임아웃(ms, 기본 180000)
- `GEMMA_TOPIC_TIMEOUT_MS`: 주제 생성 단계 타임아웃(ms, 기본 90000)
- `GEMMA_FEEDBACK_TIMEOUT_MS`: 피드백 단계 타임아웃(ms, 기본 90000)
- `MODEL_PAGE_TIMEOUT_MS`: 페이지 Vision 분석 타임아웃(ms, 기본 45000)
- `MATERIAL_PIPELINE_PAGE_CONCURRENCY`: PDF 페이지 분석 동시성(기본 4)
- `MATERIAL_LEGACY_OCR_CONCURRENCY`: PDF/PPT(PPTX 포함) 레거시 OCR 동시성(기본 4)
- `OCR_CONCURRENCY`: 레거시 OCR 동시성 fallback(기본 4)
- `MATERIAL_PIPELINE_VISION_ABORT_THRESHOLD`: Vision timeout 연속 횟수 초과 시 OCR-only 전환(기본 2)

CLI 옵션으로도 동일 값 주입 가능:
- `--provider`
- `--model`
- `--base-url`
- `--api-key`

## 설치/실행
`spo-was`에서 실행:

```bash
npm install
```

Gemma4 원격 모델 기본값으로 실행:

```bash
MODEL_PROVIDER=gemma_api MODEL_BASE_URL=http://127.0.0.1:11434 MODEL_NAME=gemma4:e4b npm run pipeline -- run-pipeline ./sample.pdf --out ./out --verbose
```

Gemini CLI provider로 실행(로컬 gemini CLI 필요):

```bash
GEMINI_API_KEY=<your_key> MODEL_PROVIDER=gemini_cli MODEL_NAME=gemini-2.5-flash npm run pipeline -- run-pipeline ./sample.pdf --out ./out --verbose
```

OAuth 로그인으로 Gemini CLI 사용(API Key 없이):

```bash
docker exec -it spo-was /usr/local/bin/node /usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js
```

- 최초 1회 실행 시 `Sign in with Google`을 선택해 브라우저 인증을 완료합니다.
- 컨테이너는 `./.gemini -> /root/.gemini` 볼륨을 사용하므로, 이후 서버 호출에서 OAuth 세션이 재사용됩니다.
- 이 경우 `GEMINI_API_KEY`는 비워둬도 됩니다.

### 1) 전체 파이프라인
```bash
npm run pipeline -- run-pipeline ./sample.pdf --out ./out --provider mock --verbose
```

### 2) 페이지 분석만
```bash
npm run pipeline -- analyze-pdf ./sample.pdf --out ./out --dpi 180 --concurrency 2 --skip-existing
```

### 3) 이미지 디렉터리 분석만
```bash
npm run pipeline -- analyze-pages ./out/images --out ./out --skip-existing
```

### 4) 문서 통합만
```bash
npm run pipeline -- summarize-doc ./out/pages --out ./out/document_summary.json
```

### 5) 토론 주제 생성만
```bash
npm run pipeline -- generate-topics ./out/document_summary.json --out ./out/discussion_topics.json
```

## 출력 구조
예시 `out/`:

```text
out/
  images/
    page-0001.png
    page-0002.png
  pages/
    0001.json
    0002.json
  page_analysis.jsonl
  document_summary.json
  discussion_topics.json
  discussion_topics.md
```

## OCR fallback 규칙
`src/pipeline/pipeline/fallback.js`

트리거 예:
- `confidence` 낮음 (기본 0.62 미만)
- role 분류 불명확 + 제목 부재
- 추출 텍스트 길이 과소
- `signals.small_text_likelihood` 높음
- `signals.scan_quality` 나쁨

OCR 결과는 `enrichWithOcr`에서 **보강**만 수행합니다.
- `used_ocr: true`
- `ocr_reason` 기록
- title/main_points/keywords/facts를 추가 보강

## 가정
- 로컬에 `pdfinfo`, `pdftoppm`, `tesseract`가 설치되어 있다고 가정합니다.
- 모델 provider가 없어도 `mock` provider로 개발/테스트가 가능합니다.
- 모델 응답은 JSON-only를 강하게 유도하지만, 코드에서 fenced JSON 파싱을 보정합니다.

## 테스트
```bash
npm test
```

테스트 범위:
- page analysis schema 검증
- document summary schema 검증
- topics count=10 검증
- 중복 주제 제거 로직
- OCR fallback 트리거 로직
- excluded page 필터링

## 한계와 향후 개선
- 현재 Vision adapter는 OpenAI-compatible endpoint 형식만 기본 제공
- OCR 보강은 휴리스틱 중심이며, 재질문(re-ask) 방식의 multimodal 재해석은 미구현
- topic evidence_pages는 요약 품질에 의존하므로, page-level citation scoring 추가 여지 있음
- 대용량 문서에서는 페이지 병렬 분석과 rate limiting 정책을 provider별로 세분화하는 것이 바람직함
