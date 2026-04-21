# 인수인계 — 현재 상태 및 다음 작업

## 현재 상태

Phase 1 기본 구현 완료. 크롬에 로드해서 테스트 가능한 상태.

### 파일 구조

```
나무위키보로노이목차/
├── manifest.json          MV3, namu.wiki content script 등록
├── src/
│   ├── content.js         사이드바 주입 + TOC 파싱 + 렌더링 + SPA 감지 (메인)
│   ├── toc-parser.js      재사용 가능한 TOC 파싱 모듈 (별도 분리)
│   ├── voronoi-render.js  Voronoi 렌더링 래퍼 + buildZPositions 함수
│   └── sidebar.css        사이드바 스타일
├── lib/
│   └── voronoi-treemap.standalone.js  로컬 라이브러리 (복사 완료)
├── icons/
│   └── icon16,48,128.png  파란 원 아이콘
├── PLAN.md                전체 계획 + 미해결 이슈
└── HANDOFF.md             이 파일
```

### 구현 내용

- 나무위키 오른쪽에 고정 사이드바 (토글 버튼으로 열고 닫기)
- `h2~h4[id^="s-"]` 헤딩 파싱, 헤딩 사이 텍스트 길이(÷50) 기반 bubbleSize 계산
- **Z 배열 방식** `regionPositions` 생성 (`buildZPositions`):
  - h2 → depth:1, h3 → depth:2
  - 각 레벨을 `cols = ceil(√n)` cols×rows 격자로 순서대로 배치
  - depth:2는 해당 depth:1 픽셀 영역 안에서 재분할
- Voronoi 셀 클릭 → `scrollIntoView` + 노란 하이라이트 1.5초
- `MutationObserver`로 URL 변경 감지 → 800ms 후 재렌더링 (SPA 전환 대응)

### Voronoi 라이브러리 API (참고)

```js
new window.VoronoiTreemap().render(items, {
  width, height,
  sizeLimit: 300,
  seedRandom: 1,
  regionPositions,   // buildZPositions(items, W, H) 결과
  colors,
  clickFunc: (what) => {
    const id = what?.data?.data?.id;  // 헤딩 id (예: "s-1.2")
  }
})
```

아이템 형식:
```js
{
  region: "h2 제목",            // depth:1 영역
  bigClusterLabel: "h3 제목",   // depth:2 영역 ("\u200b"이면 없음)
  clusterLabel: "h4+ 제목",     // 버블 표시 텍스트
  bubbleSize: 10,               // 섹션 크기
  data: { id: "s-1.2", title: "원문 제목", level: 4, numbering: "1.2" }
}
```

### 크롬 로드 방법

1. `chrome://extensions` 열기
2. 우측 상단 **개발자 모드** 켜기
3. **압축 해제된 확장 프로그램 로드** 클릭
4. 이 폴더(`나무위키보로노이목차/`) 선택
5. `namu.wiki` 임의 페이지 열기 → 오른쪽 "목차" 버튼 확인

---

## 다음 작업 (우선순위 순)

### 1. 실제 나무위키 DOM 검증 (필수)

`content.js`의 `parseTOC()`에서 사용하는 셀렉터가 실제 나무위키 HTML과 맞는지 확인:

```js
// 현재 셀렉터 (content.js 내 parseTOC 함수)
document.querySelectorAll("h2[id], h3[id], h4[id], h5[id]")
// 필터: /^s-[\d.]+$/.test(el.id)
// 제목 추출: el.querySelector(".title-text") || el
```

나무위키 페이지에서 브라우저 콘솔로 확인:
```js
document.querySelectorAll("h2[id], h3[id]")
```
결과가 비거나 다른 구조면 셀렉터 수정 필요.

### 2. CSP 문제 대응 (필요 시)

로컬 스크립트 주입이 막히면 `manifest.json`의 content_scripts에 추가:
```json
"world": "MAIN"
```

### 3. 렌더링 결과 확인

- `window.VoronoiTreemap`이 로드되는지
- `chart` 반환값이 DOM Element인지 문자열인지 (현재 둘 다 처리함)
- 버블이 올바른 크기와 배치로 그려지는지

### 4. PLAN.md Phase 2 (선택)

- 현재 읽는 섹션 하이라이트 (`IntersectionObserver`)
- 헤딩 깊이 선택 UI (h2만 / h2+h3 / 전체)
