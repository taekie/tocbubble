/**
 * voronoi-render.js
 * VoronoiTreemap 렌더링 래퍼.
 * window.VoronoiTreemap 전역이 이미 로드되어 있어야 함.
 *
 * 사용:
 *   await loadVoronoiLibrary(chrome.runtime.getURL("lib/voronoi-treemap.standalone.js"));
 *   const chart = renderVoronoiTOC(containerEl, items, { onNavigate });
 */

/**
 * 라이브러리를 동적으로 로드.
 * content script에서는 외부 CDN 직접 로드 불가 → 확장 로컬 파일 사용.
 *
 * @param {string} url - chrome.runtime.getURL("lib/voronoi-treemap.standalone.js")
 * @returns {Promise<void>}
 */
function loadVoronoiLibrary(url) {
  return new Promise((resolve, reject) => {
    if (window.VoronoiTreemap) { resolve(); return; }
    const script = document.createElement("script");
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/** 기본 region 색상 팔레트 */
const DEFAULT_COLORS = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
  "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
  "#9c755f", "#bab0ac",
];

/**
 * TOC 아이템에서 Z 배열 방식으로 regionPositions 생성.
 *
 * Z 배열: n개 항목을 sqrt(n) 기반 cols×rows 격자에 순서대로 배치.
 *   col = i % cols
 *   row = floor(i / cols)
 *   x   = (col + 0.5) / cols * W
 *   y   = (row + 0.5) / rows * H
 *
 * 계층 구조:
 *   depth:1 — region (h2)        → 전체 캔버스 W×H를 격자 분할
 *   depth:2 — bigClusterLabel (h3) → 해당 region 픽셀 영역 안에서 재분할
 *
 * @param {Array} items  - parseTOC() 결과
 * @param {number} W     - 캔버스 너비
 * @param {number} H     - 캔버스 높이
 * @returns {Array}      regionPositions 배열
 */
function buildZPositions(items, W, H) {
  const regionPositions = [];

  // ── depth:1 : region(h2) 목록 ────────────────────────────
  const regionOrder = [];
  const regionSeen = new Set();
  for (const item of items) {
    if (!regionSeen.has(item.region)) {
      regionSeen.add(item.region);
      regionOrder.push(item.region);
    }
  }

  const n = regionOrder.length;
  const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const cellW = W / cols;
  const cellH = H / rows;

  regionOrder.forEach((region, ri) => {
    const col = ri % cols;
    const row = Math.floor(ri / cols);

    // region 크기 = 소속 아이템 bubbleSize 합계
    const regionSize = items
      .filter((d) => d.region === region)
      .reduce((s, d) => s + d.bubbleSize, 0);

    regionPositions.push({
      depth: 1,
      key: region,
      order: ri,
      x: (col + 0.5) * cellW,
      y: (row + 0.5) * cellH,
      size: regionSize,
    });

    // ── depth:2 : bigClusterLabel(h3) — region 픽셀 범위 안에서 Z 배열 ──
    const bigLabelsInRegion = [];
    const bigLabelSeen = new Set();
    for (const item of items) {
      if (item.region !== region) continue;
      const bl = item.bigClusterLabel;
      if (bl && bl !== "\u200b" && !bigLabelSeen.has(bl)) {
        bigLabelSeen.add(bl);
        bigLabelsInRegion.push(bl);
      }
    }

    const m = bigLabelsInRegion.length;
    if (m === 0) return;

    const bCols = Math.max(1, Math.ceil(Math.sqrt(m)));
    const bRows = Math.ceil(m / bCols);
    // region이 차지하는 픽셀 원점
    const rx0 = col * cellW;
    const ry0 = row * cellH;
    const bw = cellW / bCols;
    const bh = cellH / bRows;

    bigLabelsInRegion.forEach((bl, bi) => {
      const bc = bi % bCols;
      const br = Math.floor(bi / bCols);

      const blSize = items
        .filter((d) => d.region === region && d.bigClusterLabel === bl)
        .reduce((s, d) => s + d.bubbleSize, 0);

      regionPositions.push({
        depth: 2,
        key: bl,
        order: bi,
        x: rx0 + (bc + 0.5) * bw,
        y: ry0 + (br + 0.5) * bh,
        size: blSize,
      });
    });
  });

  return regionPositions;
}

/**
 * TOC 아이템 배열을 VoronoiTreemap으로 렌더링.
 *
 * @param {HTMLElement} container - 렌더링할 컨테이너
 * @param {Array} items - toc-parser.js의 parseTOC() 결과
 * @param {Object} options
 * @param {Function} options.onNavigate - 클릭 시 호출 (item.data.id 전달)
 * @param {number} [options.width=320]
 * @param {number} [options.height=480]
 * @param {string[]} [options.colors]
 * @returns {Object} chart 인스턴스
 */
function renderVoronoiTOC(container, items, options = {}) {
  const {
    onNavigate,
    width = 320,
    height = 480,
    colors = DEFAULT_COLORS,
  } = options;

  if (!window.VoronoiTreemap) {
    container.innerHTML = '<p style="color:red">VoronoiTreemap 라이브러리 로드 실패</p>';
    return null;
  }

  container.innerHTML = "";

  const regionPositions = buildZPositions(items, width, height);

  const chart = new window.VoronoiTreemap().render(items, {
    width,
    height,
    sizeLimit: 300,
    seedRandom: 1,
    regionPositions,
    colors,
    clickFunc: (what) => {
      if (!what?.data?.data?.id) return;
      if (typeof onNavigate === "function") {
        onNavigate(what.data.data.id, what.data.data);
      }
    },
  });

  return chart;
}

/**
 * 섹션 ID로 페이지 스크롤 이동.
 * @param {string} sectionId - 헤딩 요소의 id (예: "s-1.2")
 */
function navigateToSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // 잠깐 하이라이트 효과
  el.style.transition = "background 0.3s";
  el.style.background = "#fff3cd";
  setTimeout(() => { el.style.background = ""; }, 1500);
}

if (typeof module !== "undefined") {
  module.exports = { loadVoronoiLibrary, buildZPositions, renderVoronoiTOC, navigateToSection, DEFAULT_COLORS };
}
