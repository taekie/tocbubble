/**
 * content.js
 * 나무위키 페이지에 보로노이 목차 사이드바를 주입.
 *
 * 흐름:
 *   1. 사이드바 DOM 생성 및 주입
 *   2. Voronoi 라이브러리 로드 (로컬 파일)
 *   3. toc-parser.js로 TOC 파싱
 *   4. voronoi-render.js로 렌더링
 *   5. URL 변경 감지 → 재렌더링 (SPA 대응)
 */

(function () {
  "use strict";

  // 중복 주입 방지
  if (document.getElementById("namu-voronoi-sidebar")) return;

  // ─── 1. 사이드바 DOM ──────────────────────────────────────
  const sidebar = document.createElement("div");
  sidebar.id = "namu-voronoi-sidebar";
  sidebar.innerHTML = `
    <div id="namu-voronoi-header">
      <span id="namu-voronoi-title">목차 맵</span>
      <button id="namu-voronoi-close" title="닫기">✕</button>
    </div>
    <div id="namu-voronoi-body">
      <div id="namu-voronoi-chart"></div>
    </div>
  `;
  document.body.appendChild(sidebar);

  // 토글 버튼 (플로팅)
  const toggleBtn = document.createElement("button");
  toggleBtn.id = "namu-voronoi-toggle";
  toggleBtn.title = "보로노이 목차 열기/닫기";
  toggleBtn.textContent = "목차";
  document.body.appendChild(toggleBtn);

  let isOpen = false;

  function setSidebarOpen(open) {
    isOpen = open;
    sidebar.classList.toggle("open", open);
    toggleBtn.classList.toggle("active", open);
  }

  toggleBtn.addEventListener("click", () => setSidebarOpen(!isOpen));
  document
    .getElementById("namu-voronoi-close")
    .addEventListener("click", () => setSidebarOpen(false));

  // 사이드바·토글버튼 외부 클릭 시 닫기
  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    if (sidebar.contains(e.target)) return;
    if (toggleBtn.contains(e.target)) return;
    setSidebarOpen(false);
  }, true);

  // ─── 2. 라이브러리 로드 ───────────────────────────────────
  // ES module이므로 dynamic import() 사용
  let _VoronoiTreemap = null;
  async function loadLib() {
    if (_VoronoiTreemap) return _VoronoiTreemap;
    const libUrl = chrome.runtime.getURL("lib/voronoi-bubble.standalone.js");
    const mod = await import(libUrl);
    _VoronoiTreemap = mod.VoronoiTreemap ?? mod.default;
    return _VoronoiTreemap;
  }

  // ─── 3. 렌더링 ────────────────────────────────────────────
  const isWikipedia = location.hostname.endsWith("wikipedia.org");

  function parseTOC() {
    return isWikipedia ? parseTOCWikipedia() : parseTOCNamu();
  }

  function parseTOCWikipedia() {
    // 위키백과 구조: h2/h3/h4 자체에 id 있음, 본문은 .mw-parser-output 내부
    // 여러 개일 경우 h2가 가장 많은 컨테이너 사용
    const containers = Array.from(document.querySelectorAll(".mw-parser-output"));
    const container = containers.reduce((best, c) =>
      c.querySelectorAll("h2[id]").length > (best?.querySelectorAll("h2[id]").length ?? 0) ? c : best
    , null);
    if (!container) return [];

    const headings = Array.from(
      container.querySelectorAll("h2[id], h3[id], h4[id]"),
    ).filter(
      (el) => el.id && !el.closest(".reflist, .navbox, .vertical-navbox"),
    );

    if (headings.length === 0) return [];

    // 첫 헤딩 이전 도입부 크기
    const introSize = getLeadSectionSize(container, headings[0]);

    // 순서 기반 numbering 생성
    const counters = [0, 0, 0]; // h2, h3, h4
    const sized = headings.map((el, i) => {
      const level = parseInt(el.tagName[1]);

      // 편집 링크 span 제외하고 텍스트 추출
      const clone = el.cloneNode(true);
      clone
        .querySelectorAll(".mw-editsection, .mw-editsection-bracket")
        .forEach((n) => n.remove());
      const title = clone.textContent.trim();

      // numbering 계산
      if (level === 2) {
        counters[0]++;
        counters[1] = 0;
        counters[2] = 0;
      } else if (level === 3) {
        counters[1]++;
        counters[2] = 0;
      } else if (level === 4) {
        counters[2]++;
      }
      const numbering =
        level === 2
          ? `${counters[0]}`
          : level === 3
            ? `${counters[0]}.${counters[1]}`
            : `${counters[0]}.${counters[1]}.${counters[2]}`;

      // 섹션 크기 (Range API)
      const nextSameOrHigher = headings
        .slice(i + 1)
        .find((nh) => parseInt(nh.tagName[1]) <= level);
      const charCount = getSectionTextLength(el, nextSameOrHigher || null);

      return {
        el,
        id: el.id,
        level,
        title,
        numbering,
        size: sizeFromChars(charCount),
        imageUrl: getSectionImageUrl(el, nextSameOrHigher || null),
      };
    });

    if (introSize > 1) {
      sized.unshift({
        el: container,
        id: "",
        level: 2,
        title: getPageTitle(),
        numbering: "",
        size: introSize,
        imageUrl: getLeadImageUrl(container, headings[0]),
      });
    }
    return buildVoronoiItems(sized);
  }

  function parseTOCNamu() {
    // 나무위키 실제 DOM 구조:
    //   <h2><a id="s-1" href="#toc">1.</a> <span id="제목">제목<span class="...">[편집]</span></span></h2>
    //   h2 자체에는 id 없음 → 내부 a[id^="s-"] 앵커 기준으로 파싱
    const anchors = Array.from(document.querySelectorAll('a[id^="s-"]')).filter(
      (a) => /^s-[\d.]+$/.test(a.id) && a.closest("h2, h3, h4, h5"),
    );

    if (anchors.length === 0) return [];

    const headings = anchors.map((anchor) => {
      const el = anchor.closest("h2, h3, h4, h5");
      const level = parseInt(el.tagName[1]);

      // 제목 텍스트: span[id] 내 텍스트/링크 텍스트 수집 (편집 아이콘 span 제외)
      const titleSpan = el.querySelector("span[id]");
      let title = "";
      if (titleSpan) {
        for (const child of titleSpan.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            title += child.textContent;
          } else if (
            child.nodeType === Node.ELEMENT_NODE &&
            child.tagName === "A"
          ) {
            title += child.textContent;
          }
        }
        title = title.trim();
      }
      if (!title) title = anchor.id.replace("s-", "");

      return {
        anchor,
        el,
        id: anchor.id,
        level,
        title,
        numbering: anchor.id.replace("s-", ""),
      };
    });

    // 섹션 크기: Range API로 헤딩 사이 텍스트 길이 측정
    const sized = headings.map((h, i) => {
      const nextSameOrHigher = headings
        .slice(i + 1)
        .find((nh) => nh.level <= h.level);
      const charCount = getSectionTextLength(h.el, nextSameOrHigher?.el || null);
      return { ...h, size: sizeFromChars(charCount) };
    });

    const firstEl = headings[0]?.el;
    // 나무위키 본문 컨테이너: 첫 헤딩의 조상 중 가장 가까운 section/article/div
    const namuContainer =
      firstEl?.closest('article, [class*="article"], [class*="content"]') ||
      document.body;
    const introSize2 = firstEl ? getLeadSectionSize(namuContainer, firstEl) : 1;
    if (introSize2 > 1) {
      sized.unshift({
        el: document.body,
        id: "",
        level: 2,
        title: getPageTitle(),
        numbering: "",
        size: introSize2,
        imageUrl: getLeadImageUrl(namuContainer, firstEl),
      });
    }
    return buildVoronoiItems(sized);
  }

  // 페이지 제목 (사이트명 제거)
  function getPageTitle() {
    const h1 = document.querySelector("h1");
    if (h1) return h1.textContent.trim();
    // document.title에서 " - 사이트명" 제거
    return document.title.replace(/\s*[-–|].*$/, "").trim();
  }

  // fragment 내 유효한 본문 이미지 URL 반환
  function pickImageUrl(fragment) {
    const imgs = Array.from(fragment.querySelectorAll('img[src]'));
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.src || '';
      if (!src || src.startsWith('data:')) continue;
      // UI/아이콘 이미지 제외
      if (src.includes('/skins/')) continue;
      const w = parseInt(img.getAttribute('width') || img.width || '0');
      const h = parseInt(img.getAttribute('height') || img.height || '0');
      if ((w > 0 && w <= 20) || (h > 0 && h <= 20)) continue;
      // 나무위키: data-doc 속성이 있는 본문 이미지만 허용
      if (!isWikipedia && !img.hasAttribute('data-doc')) continue;
      const absUrl = src.startsWith('//') ? 'https:' + src : src;
      return absUrl;
    }
    return null;
  }

  // 컨테이너 시작 ~ 첫 헤딩 사이 도입부 이미지 URL 반환
  function getLeadImageUrl(container, firstHeadingEl) {
    try {
      let searchRoot = container;
      if (!isWikipedia && firstHeadingEl) {
        // 나무위키: 첫 헤딩의 가장 가까운 공통 조상(h2의 조상 체인 최상위 중 body 바로 아래) 사용
        // body 직접 자식 div 중 firstHeadingEl을 포함하는 것
        const bodyChildren = Array.from(document.body.children);
        const ancestor = bodyChildren.find(c => c.contains(firstHeadingEl));
        if (ancestor) searchRoot = ancestor;
      }
      const range = document.createRange();
      range.setStart(searchRoot, 0);
      if (firstHeadingEl) range.setEndBefore(firstHeadingEl);
      else range.setEndAfter(searchRoot);
      const fragment = range.cloneContents();
      return pickImageUrl(fragment);
    } catch (e) {
      return null;
    }
  }

  // 섹션 범위(startEl~endEl) 내 첫 번째 이미지 URL 반환
  function getSectionImageUrl(startEl, endEl) {
    try {
      const range = document.createRange();
      range.setStartAfter(startEl);
      if (endEl) range.setEndBefore(endEl);
      else range.setEndAfter(startEl.closest('article, .mw-parser-output, body') || document.body);
      const fragment = range.cloneContents();
      const img = fragment.querySelector('img[src]');
      if (!img) return null;
      const src = img.src || img.getAttribute('src') || '';
      // data URI 제외, 소형 아이콘 제외 (width/height <= 20)
      if (src.startsWith('data:')) return null;
      const w = parseInt(img.width || img.getAttribute('width') || '100');
      const h = parseInt(img.height || img.getAttribute('height') || '100');
      if (w <= 20 || h <= 20) return null;
      return src.startsWith('//') ? 'https:' + src : src;
    } catch (e) {
      return null;
    }
  }

  // 컨테이너 시작 ~ 첫 헤딩 사이 도입부 텍스트 크기
  function getLeadSectionSize(container, firstHeadingEl) {
    try {
      const range = document.createRange();
      range.setStart(container, 0);
      range.setEndBefore(firstHeadingEl);
      const text = range.toString().replace(/\s+/g, " ").trim();
      return sizeFromChars(text.length);
    } catch (e) {
      return 1;
    }
  }

  // 글자 수 → bubbleSize 변환 (sqrt 스케일링, 최대 100)
  function sizeFromChars(n) {
    return Math.max(1, Math.min(100, Math.round(Math.sqrt(n / 2))));
  }

  // Range API로 두 헤딩 사이 텍스트 길이 반환
  function getSectionTextLength(startEl, endEl) {
    try {
      const range = document.createRange();
      range.setStartAfter(startEl);
      if (endEl) {
        range.setEndBefore(endEl);
      } else {
        // 마지막 섹션: 가장 가까운 공통 컨테이너 끝으로 제한
        const container =
          startEl.parentElement?.parentElement ||
          startEl.parentElement ||
          document.body;
        range.setEndAfter(container);
      }
      // 공백 압축 후 길이 반환 (들여쓰기/줄바꿈 제거)
      const text = range.toString().replace(/\s+/g, " ").trim();
      return text.length;
    } catch (e) {
      return 0;
    }
  }

  // 공통: sized 헤딩 배열 → Voronoi 아이템 배열
  function buildVoronoiItems(sized) {
    let currentH2 = null;
    let currentH3 = null;

    return sized.map((h) => {
      if (h.level === 2) {
        currentH2 = h;
        currentH3 = null;
      } else if (h.level === 3) {
        currentH3 = h;
      }

      // 번호 포함 표시 레이블
      const labelOf = (item) =>
        item.numbering ? `${item.numbering}. ${item.title}` : item.title;

      // h2 → region(depth:1), h3 → bigClusterLabel(depth:2), h4+ → clusterLabel(버블)
      return {
        region: currentH2 ? labelOf(currentH2) : "전체",
        bigClusterLabel: currentH3 ? labelOf(currentH3) : "\u200b",
        clusterLabel: labelOf(h),
        bubbleSize: h.size,
        data: {
          id: h.id,
          title: h.title,
          level: h.level,
          numbering: h.numbering,
          imageUrl: h.imageUrl || null,
        },
      };
    });
  }

  // regionPositions 생성: h2→region(depth:1), h3→bigClusterLabel(depth:2)
  function buildZPositions(items, W, H) {
    const regionPositions = [];

    // depth:1 — h2 region 격자 배치
    const regions = [];
    const regionSeen = new Set();
    for (const item of items) {
      if (!regionSeen.has(item.region)) {
        regionSeen.add(item.region);
        regions.push(item.region);
      }
    }
    const rn = regions.length;
    const rCols = Math.max(2, Math.ceil(Math.sqrt(rn)));
    const rRows = Math.ceil(rn / rCols);
    const rw = W / rCols,
      rh = H / rRows;
    regions.forEach((region, ri) => {
      const rc = ri % rCols,
        rr = Math.floor(ri / rCols);
      const rSize = items
        .filter((d) => d.region === region)
        .reduce((s, d) => s + d.bubbleSize, 0);
      regionPositions.push({
        depth: 1,
        key: region,
        order: ri,
        x: (rc + 0.5) * rw,
        y: (rr + 0.5) * rh,
        size: rSize,
      });

      // depth:2 — 해당 region 내 h3(bigClusterLabel) 배치
      const bigLabels = [];
      const seen = new Set();
      for (const item of items) {
        if (item.region !== region) continue;
        const bl = item.bigClusterLabel;
        if (bl && bl !== "\u200b" && !seen.has(bl)) {
          seen.add(bl);
          bigLabels.push(bl);
        }
      }
      const bn = bigLabels.length;
      if (!bn) return;
      const bCols = Math.max(1, Math.ceil(Math.sqrt(bn)));
      const bRows = Math.ceil(bn / bCols);
      const bw = rw / bCols,
        bh = rh / bRows;
      const rx0 = rc * rw,
        ry0 = rr * rh;
      bigLabels.forEach((bl, bi) => {
        const bc = bi % bCols,
          br = Math.floor(bi / bCols);
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

  function navigateTo(sectionId) {
    if (!sectionId) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const orig = el.style.background;
    el.style.transition = "background 0.4s";
    el.style.background = "#fff3cd";
    setTimeout(() => {
      el.style.background = orig;
    }, 1500);
  }

  async function render() {
    const chartEl = document.getElementById("namu-voronoi-chart");
    if (!chartEl) return;

    chartEl.innerHTML =
      '<p style="padding:12px;color:#666;font-size:13px">로딩 중...</p>';

    try {
      const VoronoiTreemap = await loadLib();

      const items = parseTOC();
      if (items.length === 0) {
        chartEl.innerHTML =
          '<p style="padding:12px;color:#999;font-size:13px">목차를 찾을 수 없습니다.</p>';
        return;
      }

      chartEl.innerHTML = "";
      const W = 1000;
      const H = 800;

      // Z 배열 방식으로 region 위치 계산
      const regionPositions = buildZPositions(items, W, H);

      const chart = new VoronoiTreemap().render(items, {
        width: W,
        height: H,
        sizeLimit: 300,
        seedRandom: 1,
        pebbleWidth: 5,
        showMetaLabel: true,
        regionPositions,
        cellImage: (d) => {
          if (d?.data?.id !== "") return null; // 도입 셀만 (id === "")
          const url = d?.data?.imageUrl;
          if (!url) return null;
          return { url, mode: 'fill', opacity: 0.7, colorMode: 'tint' };
        },
        clickFunc: (what) => {
          const id = what?.data?.data?.id;
          if (id !== undefined) navigateTo(id);
        },
      });

      if (typeof chart === "string") chartEl.innerHTML = chart;
      else if (chart) chartEl.appendChild(chart);

      // SVG background rect 투명화
      const svg = chartEl.querySelector("svg");
      if (svg) {
        svg.style.background = "transparent";
        const bgRect = svg.querySelector("rect");
        if (bgRect) bgRect.style.fill = "transparent";
      }
    } catch (err) {
      console.error("[나무위키 보로노이 목차]", err);
      chartEl.innerHTML = `<p style="padding:12px;color:red;font-size:12px">오류: ${err.message}</p>`;
    }
  }

  // ─── 4. 초기 렌더링 ───────────────────────────────────────
  // document_idle 이후 실행되므로 DOM 준비됨
  render();

  // ─── 5. SPA 페이지 전환 감지 ──────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // 새 페이지 렌더링 대기 후 재파싱
      setTimeout(render, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
