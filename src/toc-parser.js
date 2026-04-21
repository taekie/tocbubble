/**
 * toc-parser.js
 * 나무위키 페이지에서 목차(TOC) 구조를 파싱하고 섹션 크기를 계산.
 * content.js에서 import하거나 <script>로 직접 로드 가능.
 */

/**
 * 나무위키 헤딩 요소를 수집.
 * 나무위키는 h2~h4를 주로 사용하며, id="s-1", "s-1.1" 형식.
 *
 * @returns {Array<{el, id, level, title, numbering}>}
 */
function collectHeadings() {
  const headings = Array.from(
    document.querySelectorAll("h2[id], h3[id], h4[id], h5[id], h6[id]")
  ).filter((el) => /^s-[\d.]+$/.test(el.id));

  return headings.map((el) => {
    const level = parseInt(el.tagName[1]); // 2~6
    // 나무위키 헤딩 내부: <span class="title-text">제목</span> 또는 텍스트
    const titleEl = el.querySelector(".title-text") || el;
    const title = titleEl.textContent.trim();
    // 섹션 번호: id "s-1.2.3" → "1.2.3"
    const numbering = el.id.replace("s-", "");
    return { el, id: el.id, level, title, numbering };
  });
}

/**
 * 헤딩 사이의 텍스트 양으로 섹션 크기를 계산.
 * 크기 단위: 50자 ≈ 1줄
 *
 * @param {Array} headings - collectHeadings() 결과
 * @returns {Array} size 필드가 추가된 headings
 */
function computeSectionSizes(headings) {
  return headings.map((h, i) => {
    // 현재 헤딩 다음 노드부터 같은 레벨 이상의 다음 헤딩 전까지 텍스트 수집
    const nextSameOrHigher = headings
      .slice(i + 1)
      .find((nh) => nh.level <= h.level);

    let charCount = 0;
    let node = h.el.nextSibling;
    const stopEl = nextSameOrHigher?.el ?? null;

    while (node) {
      if (node === stopEl) break;
      if (node.nodeType === Node.TEXT_NODE) {
        charCount += node.textContent.length;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // 다음 헤딩 요소에 도달하면 중지
        if (node === stopEl) break;
        if (["H2", "H3", "H4", "H5", "H6"].includes(node.tagName)) break;
        charCount += node.textContent.length;
      }
      node = node.nextSibling;
    }

    return { ...h, size: Math.max(1, Math.round(charCount / 50)) };
  });
}

/**
 * 헤딩 배열을 Voronoi Treemap 입력 형식으로 변환.
 *
 * 계층 매핑:
 *   h2 → region (최상위 색상 영역)
 *   h3 → bigClusterLabel (중간 그룹 레이블)
 *   h4+ → clusterLabel (버블 텍스트)
 *
 * h2만 있는 경우: region = "전체", bigClusterLabel = h2 제목
 *
 * @param {Array} headings - computeSectionSizes() 결과
 * @returns {Array<VoronoiItem>}
 */
function headingsToVoronoiItems(headings) {
  // 부모 컨텍스트 추적
  let currentH2 = null;
  let currentH3 = null;

  // h2가 하나도 없으면 전체를 단일 region으로 처리
  const hasH2 = headings.some((h) => h.level === 2);

  return headings
    .map((h) => {
      if (h.level === 2) {
        currentH2 = h;
        currentH3 = null;
        if (!hasH2) return null;
        // h2 자체는 하위 항목을 가진 컨테이너 — 렌더링 아이템에서 제외하거나
        // 하위가 없으면 자체를 버블로 포함
        const hasChildren = headings.some(
          (nh) => nh.level > 2 && nh.numbering.startsWith(h.numbering + ".")
        );
        if (hasChildren) return null; // 하위 있으면 컨테이너만
        return {
          region: h.title,
          bigClusterLabel: "\u200b",
          clusterLabel: h.title,
          bubbleSize: h.size,
          data: { id: h.id, title: h.title, level: h.level, numbering: h.numbering },
        };
      }

      if (h.level === 3) {
        currentH3 = h;
        const region = currentH2?.title ?? "기타";
        const hasChildren = headings.some(
          (nh) => nh.level > 3 && nh.numbering.startsWith(h.numbering + ".")
        );
        if (hasChildren) return null;
        return {
          region,
          bigClusterLabel: "\u200b",
          clusterLabel: h.title,
          bubbleSize: h.size,
          data: { id: h.id, title: h.title, level: h.level, numbering: h.numbering },
        };
      }

      // h4+
      const region = currentH2?.title ?? "기타";
      const bigClusterLabel = currentH3?.title ?? "\u200b";
      return {
        region,
        bigClusterLabel,
        clusterLabel: h.title,
        bubbleSize: h.size,
        data: { id: h.id, title: h.title, level: h.level, numbering: h.numbering },
      };
    })
    .filter(Boolean);
}

/**
 * 전체 파싱 파이프라인.
 * @returns {Array<VoronoiItem>}
 */
function parseTOC() {
  const headings = collectHeadings();
  const sized = computeSectionSizes(headings);
  return headingsToVoronoiItems(sized);
}

// CommonJS / ESM 양쪽 호환
if (typeof module !== "undefined") {
  module.exports = { collectHeadings, computeSectionSizes, headingsToVoronoiItems, parseTOC };
}
