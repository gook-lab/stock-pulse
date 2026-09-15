# PULSE — 시황 통합 대시보드

**한국어** | [English](README.en.md)

> **About (EN)** — A dark trading-terminal dashboard that fuses Korean and US
> market data into one screen: live KIS tick/orderbook over SSE, index cards,
> a treemap heatmap, sentiment-scored news, a paper-trading portfolio, AI
> opinions, and a Korean real-estate module with a 3D apartment-complex site
> map extruded from OpenStreetMap footprints in plain SVG.
> React 18 + Vite + TypeScript front end, Node backend proxy.

다크 트레이딩 터미널 스타일의 시황 통합 대시보드입니다.
지수·히트맵·뉴스(감성)·한국 실시간 체결/호가·순위·포트폴리오(KIS 모의계좌)·
AI 종합의견·기술적 목표가에 더해, 국내 부동산 모듈(실거래·단지투어 3D 배치도)까지 한 화면에 담았습니다.

---

## 스크린샷

<img src="docs/screenshots/01-dashboard.png" width="600">

> 백엔드 미연결 상태입니다. 실데이터가 없는 자리는 대체 데이터로 채우지 않고 `-`로 표시합니다.

## 실행

```bash
pnpm install
pnpm dev            # 프론트 개발 서버 (5180)
pnpm server         # 백엔드 프록시 (8080) — 실데이터를 보려면 필수
pnpm build
pnpm test
pnpm validate       # 커밋 전 통합 검증 (tsc + 테스트 + 색 하드코딩 + 미정의 CSS 토큰)

pnpm collect        # 부동산 실거래 배치 수집 (약 6분)
pnpm server:restart # 8080 LISTEN만 종료 후 재기동 + 헬스체크
```

> API 키는 `server/.env`에 둡니다. **절대 프론트로 내리거나 커밋하면 안 됩니다.**
> `pnpm validate`는 훅과 달리 경고가 아니라 **막습니다** — 커밋 전에 돌려야 합니다.

---

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| UI | React 18 + Vite + TypeScript, Tailwind v3, framer-motion, CSS Modules |
| 상태 | zustand (`src/store/`) |
| 데이터 | `src/data/httpApi.ts` (strangler 패턴) — 준비된 것만 HTTP, 나머지는 목 |
| 백엔드 | `server/index.mjs` (Node, 8080) — 외부 API 프록시 + 캐시 + 헤더 위장 |
| 실시간 | KIS WebSocket → 서버 게이트웨이 → SSE 팬아웃 (`/api/stream`) |
| 경로 별칭 | `@` → `src` |

---

## 프로젝트 구조

```
src/
├── components/
│   ├── common/       공통 UI — Button · Spinner · Loading · Skeleton · Badge
│   │                 Segmented · EmptyState · ErrorState · Modal · ConfirmDialog
│   │                 PriceChart · BarChart · MarketChip · ReasonList
│   ├── dashboard/    IndexCards · Heatmap(트리맵) · NewsFeed · RankingBoard
│   │                 Watchlist · AiOpinion · BuffettIndex · FearGreedGauge
│   │                 MacroList · SeoulRentMap
│   ├── detail/       StockDetail · CandleChart · OrderTicket · PriceAlertModal
│   ├── home/         Home · HeroCard · FeedCard · MoversCard · AllocationCard
│   ├── portfolio/    Portfolio · ManualAssets · ReturnChart
│   ├── realestate/   RealEstate · ComplexList/Map/Detail · ComplexTour
│   │                 ComplexSiteMap(3D 배치도) · DealScatter · LoanCalc · ScreenerFilters
│   ├── news/ research/
│   ├── AppBar · TickerTape · NotificationCenter
├── data/             httpApi.ts(strangler) · mockApi.ts · types.ts(MarketApi 계약) · aptSeed.ts
├── lib/              colors(등락색) · kisSocket(SSE 파서) · krxTick · chartSeries · treemap
│                     iso(3D 좌표) · buffett · alertEngine · paperOrders · loan · returns
│                     format · formatRelativeTime · sun · toast · kakaoSdk
├── store/            useModalStore
└── styles/           global.css (CSS 변수 = 토큰 단일 소스)

server/
├── index.mjs         라우트 + 캐시 + kisFetch 게이트
├── opinion.mjs · buffett.mjs · assets.mjs · portfolioHistory.mjs · lib.mjs
└── realestate/       collect · deals · signals · lawd · osm
```

---

## 아키텍처

FE 아키텍처의 **단일 소스는 [`docs/ARCHITECTURE-FE.md`](docs/ARCHITECTURE-FE.md)**입니다 (RADIO 형식:
Requirements → Architecture → Data model → Interface → Optimization/Observability).
품질 기준을 "빠르다" 같은 말이 아니라 **수치 SLI**로 적어 두고 그걸 지킵니다.

### 데이터 처리 규칙 5개

1. **브라우저는 KIS에 직결하지 않습니다.** 실시간은 서버 WebSocket 게이트웨이 1개 →
   SSE 팬아웃(`/api/stream`)만 씁니다. 키·재접속·키 한도는 서버 책임입니다.
2. **실데이터가 없으면 목이 아니라 `-`입니다.** `unavailable` / `targetReal` 플래그로 표현합니다.
   httpApi 실패 경로에서 `mockApi`를 반환하면 안 됩니다.
3. **등락색은 주입됩니다.** `signColor(pct, mode)`만 쓰고 hex를 하드코딩하면 안 됩니다.
   `colorMode`(글로벌 초록↑빨강↓ / 한국 빨강↑파랑↓)가 전역이라, 컴포넌트가 색을 정하면 안 됩니다.
4. **파서 결과는 골든 테스트와 비교합니다.** SSE 체결·호가 필드 인덱스가 바뀌면 픽스처와 파서를 함께 확인합니다.
5. **캐시는 빈 성공을 저장하면 안 됩니다.** 스로틀 순간의 `{}`가 TTL 동안 박제되면 곤란합니다.

### 신선도 목표 (SLI)

| 지표 | 목표 | 수단 |
|---|---|---|
| 첫 체결까지 (SSE 연결→) | < 3s | 게이트웨이 상시 연결 + onopen 일괄 재구독 |
| 한국 시세 | 틱 단위 | KIS ws → SSE 팬아웃 |
| 미국 시세 p75 | ≤ 15s | 관심종목 폴링 |
| 지수 | ≤ 30s | 30s 폴링 |
| 히트맵 | ≤ 60s | 60s 폴링 |
| 포트폴리오 | ≤ 30s | 30s 폴링 |
| 뉴스 | ≤ 1h | 3소스 배치 (1h TTL) + 수동 갱신 |

폴링은 전부 `document.hidden` 게이트를 겁니다.

---

## 외부 API 연동 노트

이 프로젝트에서는 여러 외부 API의 호출 제한과 실패 상태를 한 화면에서 다루는 데 가장 많은 검증이 필요했습니다.

- **CNN · data.go.kr는 User-Agent가 없으면 차단합니다.**
- **data.go.kr는 50콜 동시 호출 시 스로틀** — 동시성 5 + 재시도로 눌렀습니다.
- **KIS 토큰은 1분에 1회** — in-flight 중복 제거 + 캐시로 처리했습니다.
- **모든 KIS 호출은 `kisFetch` 게이트를 통과해야 합니다.** 모의계좌는 초당 상한이 낮아서
  라우트가 각자 던지면 서로를 밀어낸다는 것을 알았습니다(실측: 서로 다른 종목 연속 조회에서 6/10 실패).
  전역 직렬 큐 + **적응형 간격**(5xx/429면 ×1.6, 성공하면 −15ms, 200~1600ms)으로 0/12까지 내렸습니다.
  고정 간격은 TR마다 상한이 달라서 항상 틀렸습니다.
  > ⚠️ 게이트에서 자동 재시도하면 안 됩니다. 주문(`kisPost`)까지 재시도되면 **중복 주문**이 된다고 합니다.
  > 재시도는 호출자 책임입니다.
- **목 데이터는 실제와 3배 이상 벌어집니다** (삼성전자 시총 468조 vs 1,552조 · PER 12.8 vs 40.5).
  그래서 불변식 2번이 있습니다.

---

## 단지투어 3D 배치도

`ComplexSiteMap.tsx` + 뷰 정책 `siteMapView.ts` + 좌표 `src/lib/iso.ts`.
**three.js 없이** OSM 건물 외곽선을 SVG로 압출합니다. 회전은 좌표를 돌리는 것이라
렌더러가 필요 없습니다.

- 방위 yaw 0~360° 연속, 고도 pitch 8~85°(기본 30°). 지면 깊이는 `sinφ`, 높이는 `cosφ`로 눌립니다.
- **깊이 정렬 축은 yaw와 함께 돌아야 합니다** — 월드 `x+y`로 정렬하면 180°에서 순서가
  뒤집혀서 뒷건물이 앞을 덮었습니다.
- **OSM 링 방향은 보장되지 않습니다** (실측 CCW 451 / CW 209). 벽 법선을 링 방향으로만
  구하면 32%가 명암 반전되기 때문에 — `ringIsCCW`로 먼저 쌉니다.
- **LOD** — 축소하면 덜 그립니다. 최소 건물 면적 0/150/400m².
- **주변 스트리밍** — 200m 격자 칸 단위. 칸 캐시는 원점과 무관하게 구워서 **단지끼리 공유**됩니다.
  단지를 바꾸면 진행 중 요청을 끊고 응답의 `seq`를 대조합니다 (늦게 온 응답이 새 좌표계에
  섞이면 건물이 엉뚱한 곳에 서기 때문입니다).
- **지하철역은 대부분 터널**이기 때문에 지오메트리 규칙 `isHidden`을 표시에 그대로 적용하면
  역세권이 통째로 사라집니다. 도로명은 `residential`까지 포함해야 주택가에서 0개가 아닙니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [docs/ARCHITECTURE-FE.md](docs/ARCHITECTURE-FE.md) | FE 아키텍처 단일 소스 (RADIO) |
| [docs/DATA-STATES.md](docs/DATA-STATES.md) | 외부 데이터의 출처·신선도·실패 상태 처리 기준 |
| [기능명세.md](기능명세.md) | 상세 요구사항 |
| [CLAUDE.md](CLAUDE.md) | 작업 규칙 · 디자인 시스템 · 색상 컨벤션 · 데이터 연동 패턴 |
| [handoff/README.md](handoff/README.md) | 세션 인계 노트 |

---

## 주의

개인 학습용 토이 프로젝트입니다. **투자 조언이 아닙니다.**
KIS 연동은 검증 전까지 **모의(mock) 계좌만** 사용해야 합니다.
`server/data/`(개인 금융 데이터)와 `server/.env`(키)는 `.gitignore`에 있습니다 — 커밋하면 안 됩니다.

## 프로젝트 회고

여러 외부 API를 연결할 때 가장 어려운 부분은 데이터를 가져오는 기능보다 제한·지연·부분 실패를 일관된 화면 상태로 표현하는 일이었습니다. 값이 없는 자리를 임의의 데이터로 채우기보다 출처와 갱신 상태를 표시하는 편이 서비스의 신뢰를 지켰습니다.

성능도 번들 크기만으로 판단할 수 없었습니다. 초기 로딩 비용, 데이터 신선도, API 호출 안정성을 나누어 살펴봐야 변경의 효과를 설명할 수 있었습니다. 다음 대시보드에서는 정상 응답과 함께 호출 한도, 일부 누락, 재시도 시점을 먼저 화면 상태로 정의하려 합니다.

---

## 라이선스

**Source-available — 오픈소스가 아닙니다.** 코드를 읽을 수 있게 공개했을 뿐,
사용 권한을 드린 것은 아닙니다. 다른 프로젝트에 가져다 쓰거나 재배포·상업적 이용을
하려면 사전 서면 허락이 필요합니다. 전문은 [LICENSE](LICENSE), 한국어 안내는 [LICENSE.ko.md](LICENSE.ko.md) 참조.
