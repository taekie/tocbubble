# 나무위키 보로노이 목차 크롬 확장 — 구현 계획

## 개요

나무위키 페이지의 목차(TOC)를 Voronoi Treemap으로 시각화하는 크롬 확장.
섹션 제목을 버블로 표시하고, 클릭 시 해당 위치로 스크롤 이동.

---

## 파일 구조

```
나무위키보로노이목차/
├── PLAN.md                 ← 이 파일
├── manifest.json           ← MV3 확장 매니페스트
├── src/
│   ├── content.js          ← 나무위키 TOC 추출 + 사이드바 주입
│   ├── toc-parser.js       ← TOC 파싱 + 섹션 크기 계산 (재사용 가능)
│   ├── voronoi-render.js   ← Voronoi 렌더링 래퍼 (재사용 가능)
│   └── sidebar.css         ← 사이드바 스타일
└── lib/
    └── voronoi-treemap.standalone.js  ← 라이브러리 로컬 복사본 (빌드 시 포함)
```

---

## 핵심 설계 결정

### 1. 사이드바 방식
- Side Panel API(MV3) 대신 **content script로 DOM에 직접 주입**하는 방식 사용
  - 이유: Side Panel은 확장 popup 느낌이고, 페이지와 함께 보이는 인라인 패널이 UX에 적합
- 나무위키 오른쪽에 고정 패널(`position: fixed; right: 0`) 형태
- 토글 버튼(플로팅)으로 열고 닫기

### 2. TOC → Voronoi 데이터 변환

나무위키 헤딩 레벨 → Voronoi 계층:
- **h2 (1단계)** → `region` (최상위 그룹, VoronoiTreemap의 region)
- **h3 (2단계)** → `bigClusterLabel` (중간 그룹)
- **h4 이하** → `clusterLabel` (버블 텍스트)

버블 크기:
- 각 섹션의 **텍스트 줄 수** 또는 **글자 수** 기준
- `document.getElementById(headingId)` ~ 다음 같은/상위 헤딩 사이의 텍스트 길이

### 3. Voronoi 라이브러리 API

```js
// 데이터 형식
const items = [{
  region: "1단계 제목",        // 최상위 구분 (색상 영역)
  bigClusterLabel: "2단계 제목", // 중간 그룹 레이블
  clusterLabel: "3단계 제목",   // 버블 표시 텍스트
  bubbleSize: 42,               // 섹션 줄 수
  data: { id: "s-1.2.3", title: "원문 제목" }  // 클릭 시 사용
}]

// 렌더링
const chart = new VoronoiTreemap().render(items, {
  width: 320,
  height: 500,
  sizeLimit: 200,          // 최대 아이템 수
  seedRandom: 1,
  regionPositions: [],     // 빈 배열이면 자동 배치
  colors: REGION_COLORS,
  clickFunc: (what) => {
    if (!what?.data?.id) return;
    document.getElementById(what.data.id)?.scrollIntoView({ behavior: "smooth" });
  }
})
```

CDN (content script에서는 로컬 복사 필요):
```
https://cdn.jsdelivr.net/gh/pxd-uxtech/voronoi-treemap-dist@c5fa08c/dist/voronoi-treemap.standalone.js
```

### 4. 섹션 크기 계산

```js
// h2~h6 헤딩을 순서대로 수집하고, 인접 헤딩 사이 텍스트 길이 측정
function getSectionSizes(headings) {
  return headings.map((h, i) => {
    const next = headings[i + 1];
    let node = h.nextSibling;
    let charCount = 0;
    while (node && node !== next) {
      charCount += (node.textContent || "").length;
      node = node.nextSibling;
    }
    return { ...h, size: Math.max(1, Math.round(charCount / 50)) };
  });
}
```

---

## 구현 단계

### Phase 1 — 기본 동작 (MVP)
- [ ] manifest.json 작성 (MV3, namuwiki.net 권한)
- [ ] content.js: TOC 추출 + 사이드바 컨테이너 주입
- [ ] toc-parser.js: 헤딩 파싱 + 섹션 크기 계산
- [ ] voronoi-render.js: 라이브러리 로드 + render() 호출
- [ ] 클릭 → scrollIntoView 연결
- [ ] sidebar.css: 기본 레이아웃

### Phase 2 — UX 개선
- [ ] 현재 읽고 있는 섹션 하이라이트 (IntersectionObserver)
- [ ] 헤딩 깊이 선택 (h2만 / h2+h3 / 전체)
- [ ] 색상 커스터마이징
- [ ] 나무위키 외 다른 위키 사이트 지원

---

## 미해결 이슈

1. **라이브러리 로드 방식**: content script에서 외부 CDN을 직접 로드할 수 없음 (CSP 제한). `web_accessible_resources`에 등록한 로컬 파일 사용 필요 → `lib/voronoi-treemap.standalone.js`를 다운받아 포함해야 함.

2. **나무위키 CSP**: 나무위키가 script-src를 제한할 경우 `world: "MAIN"` content script가 필요할 수 있음.

3. **동적 페이지**: 나무위키는 SPA 방식으로 페이지 전환될 수 있어 `MutationObserver`로 URL 변경 감지 필요.

4. **헤딩 구조**: 나무위키 실제 TOC HTML 구조 확인 필요.
   - 예상: `<div class="wiki-macro-toc">` 또는 `<section>` 태그
   - 실제 DOM 확인 후 `toc-parser.js` 셀렉터 조정 필요
