# 🏡 만복 — 독채 한옥 펜션 예약·결제 서비스

> **부모님이 운영하시는 독채 한옥 펜션의 공식 홈페이지 겸 예약·결제·운영 시스템**
>
> - **기간**: 2026.09.29 ~ 진행 중 (1인 개발)
> - **역할**: 기획 · 설계 · 프론트엔드 · 백엔드 · DB · 결제 연동 전부
> - **스택**: Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL · 토스페이먼츠
> - **배포**: <!-- TODO: 배포 URL --> (토스 **테스트 모드**로 운영 중 — 실제 결제되지 않습니다)

<br/>

## 📌 목차

1. [왜 만들었나](#-왜-만들었나)
2. [주요 기능](#-주요-기능)
3. [기술 스택](#-기술-스택)
4. [아키텍처](#-아키텍처)
5. [핵심 설계](#-핵심-설계)
6. [테스트](#-테스트)
7. [실행 방법](#-실행-방법)
8. [진행 상황 & 로드맵](#-진행-상황--로드맵)
9. [회고](#-회고)

<br/>

## 💡 왜 만들었나

<!-- TODO: 아래 3줄은 예시입니다. 부모님 펜션의 실제 상황으로 고쳐 주세요. -->
부모님은 펜션 예약을 **전화·문자와 외부 숙박 플랫폼**으로 받고 계셨습니다.

- 플랫폼 **수수료**가 매출에서 크게 빠져나감
- 전화로 받은 예약과 플랫폼 예약을 **손으로 맞추다 보니 중복 예약 위험**
- 입금 확인·환불 계산·안내 문자를 **사장님이 직접** 처리

그래서 **"사장님이 손대지 않아도 예약 → 결제 → 확정 → 취소·환불까지 돌아가는 홈페이지"** 를 목표로 직접 만들고 있습니다.
독채(한 팀만 머무는) 한옥이라 **같은 날짜는 단 한 팀만** 받아야 한다는 점이 설계의 출발점이었습니다.

<br/>

## ✨ 주요 기능

### 손님 화면

| 기능 | 설명 |
| :--- | :--- |
| 🏠 소개 페이지 | 홈 · 숙소 소개 · 독채 안내 · 이용 안내 · 후기 |
| 📅 실시간 예약 | 달력에서 날짜 범위 선택 → 서버가 요금 계산(평일/주말/성수기/특정일) → 인원·옵션(바비큐·찜질방) 선택 |
| 💳 결제 | 토스페이먼츠 **카드 결제 / 가상계좌**, 현금영수증 |
| 🔎 예약 조회·취소 | 예약번호 + 휴대폰 번호로 본인 확인, **환불 예정 금액 미리보기** 후 취소 → 자동 환불 |
| ⭐ 후기 | **이용 완료된 예약만** 1건 작성 가능, 신고 기능 |
| 📜 약관 | 이용약관 · 개인정보처리방침 · 환불 규정, 동의 기록 저장 |

### 사장님(관리자) 화면

| 기능 | 설명 |
| :--- | :--- |
| 📊 대시보드 | 오늘 체크인/아웃, 입금 대기, 환불 실패 등 처리할 일 카드 → 클릭 시 해당 목록으로 이동 |
| 📋 예약 관리 | 예약 목록·상세, 사장님 귀책 취소(전액 환불) |
| 🗓 날짜 차단 | 수리·개인 사용 날짜를 달력에서 막기 |
| 💰 요금·규정 | 평일/주말/성수기 요금, 환불 규정, 인원·옵션 정책 수정 |
| 💸 환불·매출 | 환불 현황(실패 건 재시도), 매출 내역 |
| ⭐ 후기 관리 | 답글, 신고 처리 |
| 🧾 작업 기록 | 관리자가 바꾼 모든 내용을 변경 전/후로 기록 (민감 값 자동 가림) |

<br/>

## 🛠 기술 스택

| 분류 | 기술 |
| :--- | :--- |
| **Frontend** | ![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white) ![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white) |
| **Backend** | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white) Next.js Route Handlers · Zod(입력 검증) |
| **Database** | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white) `pg` (ORM 없이 SQL 직접 작성) |
| **Payment** | 토스페이먼츠 (카드 · 가상계좌 · 부분 취소 · 웹훅) |
| **Notification** | 이메일(SMTP, nodemailer) · 알림 대기열 |
| **Dev** | Docker Compose(로컬 DB) · tsx(테스트 스크립트) · ESLint · AI 개발 도구(Claude Code) |

<br/>

## 🏗 아키텍처

```mermaid
flowchart LR
    Guest["👤 손님 (모바일 웹)"] --> Next
    Owner["👩‍🌾 사장님 (관리자)"] --> Next
    subgraph Next["Next.js (App Router)"]
        Pages["페이지 / 서버 컴포넌트"]
        API["Route Handlers<br/>/api/*"]
        Server["src/server<br/>booking · payments · refund<br/>admin · notify · privacy"]
        Pages --> Server
        API --> Server
    end
    Server --> DB[("PostgreSQL")]
    Server <--> Toss["토스페이먼츠 API"]
    Toss -- "웹훅 (결제 상태·입금)" --> API
    Cron["⏰ 스케줄러"] -- "1~5분마다 /api/cron/run" --> API
    Server --> Mail["📧 SMTP"]
```

- **화면(app) ↔ 도메인 로직(server) 분리**: 페이지와 API는 얇게 두고, 예약·결제·환불 규칙은 `src/server/*`에 모아 테스트 스크립트에서 그대로 호출할 수 있게 했습니다.
- **정기 작업은 하나의 엔드포인트로**: 만료된 점유 해제, 이용 완료 처리, 입금 대사, 환불 재시도, 알림 발송, 개인정보 파기를 `/api/cron/run`에서 실행합니다. 모든 작업은 **여러 번 실행해도 안전(멱등)** 하고, 하나가 실패해도 나머지는 계속 돕니다.

<br/>

## 🔑 핵심 설계

### 1. 중복 예약 방지 — "같은 날짜는 단 한 팀"

날짜마다 한 행씩 있는 **재고 테이블(`stay_dates`)** 을 두고, 예약은 해당 날짜 행들을 잠근 뒤에만 바꿉니다.

```mermaid
stateDiagram-v2
    [*] --> available
    available --> held: 결제창 진입 (임시 점유)
    held --> booked: 결제 승인
    held --> available: 점유 시간 만료 / 이탈
    booked --> available: 취소·환불
    available --> blocked: 사장님 날짜 차단
    blocked --> available: 차단 해제
```

- **`SELECT … FOR UPDATE`를 항상 날짜 오름차순으로** 잡습니다. 겹치는 날짜를 여러 요청이 동시에 잡아도 잠금 순서가 같아 **데드락이 생기지 않습니다.** 잠금 순서는 코드 전체에서 `payments → stay_dates → bookings`로 통일했습니다.
- 데드락·직렬화 실패(`40P01`, `40001`)가 나면 트랜잭션을 **최대 2회 재시도**합니다.
- 상태와 컬럼 조합이 어긋난 행(예: `booked`인데 예약 ID가 없음)은 **DB `CHECK` 제약으로 저장 자체가 불가능**하게 했습니다.
- 만료된 임시 점유는 크론이 늦어도 **조회 시점에 빈 날로 취급(lazy expiry)** 해서, 결제창만 열고 떠난 사람이 날짜를 오래 막지 못합니다.

### 2. 돈이 걸린 흐름은 "서버와 PG사가 기준"

```mermaid
sequenceDiagram
    participant C as 손님 브라우저
    participant S as 서버
    participant T as 토스페이먼츠
    C->>S: 결제 준비 (날짜·인원·옵션)
    S->>S: 요금 재계산 + 날짜 임시 점유
    C->>T: 결제창에서 결제
    T-->>C: 성공 리다이렉트 (paymentKey, amount)
    C->>S: 승인 요청
    S->>S: DB 금액과 대조
    S->>T: 결제 승인 API
    alt 승인 성공 & 날짜 확보
        S->>S: 예약 확정 (held → booked)
    else 승인됐지만 날짜를 잃음
        S->>T: 즉시 자동 환불
    end
    T-->>S: 웹훅 (본문은 믿지 않고 토스에 재조회)
```

- **금액은 DB가 기준**: 브라우저가 보낸 금액은 대조용일 뿐, 서버가 요금표로 다시 계산한 금액으로만 결제합니다.
- **돈이 승인됐다면 반드시 기록**: 토스에서 승인(DONE)됐는데 예약을 확정할 수 없으면(점유 만료 등) **즉시 자동 환불**합니다.
- **응답 유실 대비**: 승인 응답이 타임아웃·5xx로 사라져도 토스에 다시 조회해 실제 상태를 확인합니다.
- **웹훅은 믿지 않고 재조회**: 웹훅 본문으로 상태를 바꾸지 않고, 항상 토스 API로 재조회한 결과로만 반영합니다. 같은 이벤트가 여러 번 와도 `payment_events` 유니크 키로 **한 번만 처리**합니다. 가상계좌 입금 웹훅은 저장해 둔 `secret` 해시와 상수 시간 비교로 검증합니다.
- **가상계좌**: 계좌가 실제로 발급된 뒤에만 입금 기한만큼 날짜를 잡아 두고, 입금 전 취소 시에는 **토스에서 계좌를 먼저 닫은 뒤** 예약을 취소합니다(계좌가 열린 채 남아 나중에 입금되는 사고 방지).

### 3. 취소·환불 — 규정을 코드로, 실패해도 다시

- 환불 계산은 **DB·네트워크 없는 순수 함수(`calcRefund`)** 로 분리했습니다. 박마다 (비수기/성수기 × 평일/주말) 공제율을 적용하고, 옵션은 이용 마감 시각 기준, 사장님 귀책은 전액 환불합니다.
- 규정이 바뀌어도 기존 예약이 영향받지 않도록 **예약 당시 요금·규정을 스냅샷으로 저장**해 그 기준으로 계산합니다. 규정에 빈 구간이 있으면 추측하지 않고 오류를 내서 수동 확인하게 했습니다.
- 취소는 **① DB에서 예약 취소 + 재고 해제 + 환불 기록(한 트랜잭션) → ② 토스 환불 호출** 순서입니다. 토스 호출이 실패해도 환불 건이 `manual_needed`로 남아 재시도되고, **같은 멱등 키**를 써서 환불이 두 번 나가지 않습니다.

### 4. 개인정보 · 보안

| 항목 | 구현 |
| :--- | :--- |
| 전화번호 | **AES-256-GCM 암호화** 저장 + 조회용 **HMAC 해시**(복호화 없이 본인 확인) |
| 예약 조회 | 실패 사유를 구분해 알려 주지 않음, 예약번호당 5회 / IP당 20회 실패 시 15분 잠금 |
| 예약번호 | 추측 불가한 랜덤 번호 (Crockford Base32, 약 50bit) |
| 관리자 로그인 | **scrypt** 해시, 없는 계정도 같은 계산(응답 시간으로 계정 유무 노출 방지), 서명 쿠키 세션 8시간, 비밀번호 변경 시 기존 세션 전부 무효 |
| 작업 기록 | 관리자 변경 내역을 전/후로 기록, 비밀번호·계좌번호 등은 자동 `[redacted]` |
| 개인정보 파기 | 보유기간이 지난 예약의 이름·연락처·결제 원문 등을 정기 작업으로 **비식별화** (거래 통계는 유지) |
| 요청 제한 | 메모리 기반 rate limit (1차 방어) |

<br/>

## 🧪 테스트

실제 PostgreSQL(테스트 DB)에 대고 도는 **시나리오 테스트 스크립트 13종**을 작성했습니다. 토스 API는 목(mock) 클라이언트로 대체합니다.

| 스크립트 | 검증 내용 |
| :--- | :--- |
| `test:hold` | **동시 예약** — 같은 날짜 30건 동시 요청 시 정확히 1건만 성공 / 겹치는 범위 동시 요청 시 중복 없음 / 확정 vs 신규 점유 경쟁에서 승자 1명·데드락 없음 / 늦은 결제는 `HOLD_LOST` / 중복 호출 멱등 |
| `test:pay` · `test:va` | 카드 · 가상계좌 결제, 금액 불일치, 승인 응답 유실 |
| `test:cancel` · `test:refund` · `test:refund-db` | 환불 계산 규칙, 취소 트랜잭션, 환불 실패 후 재시도 |
| `test:admin` · `test:sync` · `test:dash` | 관리자 인증·권한, 입금 대사, 대시보드 링크 |
| `test:review` · `test:notify` · `test:privacy` · `test:api` | 후기 조건, 알림 중복 방지, 개인정보 파기, API 스모크 테스트 |

```bash
docker compose up -d        # 로컬 PostgreSQL
npm run test:hold           # 예: 동시 예약 테스트 (테스트 DB를 비우므로 ALLOW_TRUNCATE=1 필요 — 스크립트에 포함)
```

<br/>

## 🚀 실행 방법

```bash
# 1. 설치
git clone https://github.com/minheee0/manbok-pension.git
cd manbok-pension
npm install

# 2. DB 실행 및 스키마 적용
docker compose up -d
psql postgres://hanok:hanok_dev_pw@localhost:5432/hanok -f db/schema.sql
psql postgres://hanok:hanok_dev_pw@localhost:5432/hanok -f db/prices.sql

# 3. 환경 변수 (.env.example 참고해 .env.local 작성)
#    DATABASE_URL, PII_ENC_KEY, PII_HASH_KEY (base64 32바이트)
#    TOSS_CLIENT_KEY, TOSS_SECRET_KEY (토스 테스트 키), TOSS_WEBHOOK_TOKEN
#    ADMIN_SESSION_SECRET, CRON_SECRET, SITE_URL, SMTP_URL, OWNER_EMAIL, NOTIFY_MODE

# 4. 관리자 계정 생성 후 실행
npm run admin:create
npm run dev
```

<br/>

## 🗺 진행 상황 & 로드맵

- [x] 소개 페이지 (홈 · 소개 · 독채 · 이용 안내)
- [x] 예약 (요금 계산 · 달력 · 임시 점유 · 동시성 처리)
- [x] 결제 (카드 · 가상계좌 · 현금영수증 · 웹훅 · 대사)
- [x] 예약 조회 · 취소 · 자동 환불
- [x] 관리자 화면 (대시보드 · 예약 · 날짜 차단 · 요금/규정 · 환불 · 매출 · 후기 · 작업 기록)
- [x] 이메일 알림 · 관리자 화면 알림
- [x] 약관 · 개인정보처리방침 · 동의 기록 · 개인정보 파기
- [ ] **배포** (Vercel + 클라우드 PostgreSQL)
- [ ] 실제 사진 · 사업자 정보 반영 (부모님과 정리 중)
- [ ] **문자(SMS) 알림** — 솔라피 연동을 시도했으나 발신번호 등록 전이라 보류, 이메일 알림을 먼저 적용
- [ ] 요청 제한을 Redis(Upstash)로 교체 (서버리스 다중 인스턴스 대응)
- [ ] 실사용 후 사장님 피드백 반영 → 정식 오픈 및 실결제 전환

<br/>

## 💭 회고

- **"사장님이 손대지 않아도 되는가"를 기준으로 설계했습니다.** 결제 승인 응답이 사라지거나, 웹훅이 늦게 오거나, 환불 API가 실패하는 경우처럼 *사람이 개입해야 하는 상황*을 하나씩 없애는 것이 대부분의 작업이었습니다.
- **돈과 재고처럼 틀리면 안 되는 부분은 DB에서 막았습니다.** 애플리케이션 코드만 믿지 않고 `CHECK` 제약, 유니크 키, 행 잠금으로 잘못된 상태가 아예 저장되지 않게 했고, 동시성은 말로 확신하지 않고 **테스트로 증명**했습니다.
- **AI 개발 도구를 적극 활용했습니다.** 처음 써 보는 결제 연동과 Next.js 최신 버전을 빠르게 익히는 데 Claude Code를 사용했고, 대신 잠금 순서·멱등성·환불 규칙 같은 핵심 결정은 직접 정리해 코드 주석과 테스트로 남겼습니다.
- **실제 사용자가 가까이 있다는 것이 가장 큰 장점입니다.** 환불 규정, 옵션 마감 시간, 알림 대상(손님/사장님) 같은 정책은 부모님과 이야기하며 정했고, 앞으로 실사용 피드백으로 계속 개선할 계획입니다.
