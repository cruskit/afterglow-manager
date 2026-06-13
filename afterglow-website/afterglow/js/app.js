(function () {
  "use strict";

  const app = document.getElementById("app");
  const searchResultsEl = document.getElementById("search-results");
  const searchInput = document.getElementById("search-input");
  const lightboxEl = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lb-img");
  const lightboxClose = document.getElementById("lb-close");
  const lightboxPrev = document.getElementById("lb-prev");
  const lightboxNext = document.getElementById("lb-next");
  const lightboxDownload = document.getElementById("lb-dl");

  // ===== Data Cache =====
  let galleriesCache = null;
  const galleryDetailCache = new Map();
  let searchIndexCache = null;

  async function fetchGalleries() {
    if (galleriesCache) return galleriesCache;
    const res = await fetch("galleries/galleries.json");
    const data = await res.json();
    galleriesCache = data.galleries.map((g) => ({
      ...g,
      cover: `galleries/${g.cover}`,
    }));
    return galleriesCache;
  }

  async function fetchGalleryDetail(slug) {
    if (galleryDetailCache.has(slug)) return galleryDetailCache.get(slug);
    const res = await fetch(`galleries/${slug}/gallery-details.json`);
    const data = await res.json();
    data.photos = data.photos.map((p) => ({
      ...p,
      thumbnail: `galleries/${slug}/${p.thumbnail}`,
      full: `galleries/${slug}/${p.full}`,
    }));
    galleryDetailCache.set(slug, data);
    return data;
  }

  // ===== Search Index =====
  async function loadSearchIndex() {
    if (searchIndexCache) return searchIndexCache;
    const r = await fetch("galleries/search-index.json");
    searchIndexCache = await r.json();
    return searchIndexCache;
  }

  function parseQuery(q) {
    const tags = [], terms = [];
    for (const word of q.trim().split(/\s+/)) {
      if (!word) continue;
      if (word.startsWith("#")) tags.push(word.slice(1).toLowerCase());
      else terms.push(word.toLowerCase());
    }
    return { tags, terms };
  }

  function matchesItem(item, fields, { tags, terms }) {
    if (tags.length && !tags.every((t) => (item.tags || []).some(it => it.toLowerCase() === t))) return false;
    if (terms.length && !terms.every((t) => fields.some((f) => f.toLowerCase().includes(t)))) return false;
    return true;
  }

  async function renderSearch(q) {
    if (!q.trim()) {
      showGalleryView();
      return;
    }

    try {
      const index = await loadSearchIndex();
      const { tags, terms } = parseQuery(q);

      const matchedGalleries = index.galleries.filter((g) =>
        matchesItem(g, [g.name, g.date, g.description || "", ...(g.tags || [])], { tags, terms })
      );
      const matchedPhotos = index.photos.filter((p) =>
        matchesItem(p, [p.alt, p.gallerySlug, ...(p.tags || [])], { tags, terms })
      );

      posthog.capture('search_performed', {
        query: q,
        gallery_results: matchedGalleries.length,
        photo_results: matchedPhotos.length,
      });

      let html = '<div class="search-wrap">';

      if (matchedGalleries.length === 0 && matchedPhotos.length === 0) {
        html += `<div class="search-no-results">No results for &ldquo;${escapeHtml(q)}&rdquo;</div>`;
      } else {
        if (matchedGalleries.length > 0) {
          html += `<div class="search-section">
            <h2 class="search-section-title">Galleries <span style="color:var(--volt);font-size:.7em">/ ${matchedGalleries.length}</span></h2>
            <div class="search-gal-grid">`;
          for (const g of matchedGalleries) {
            html += `<a class="search-gal-tile" href="#gallery=${encodeURIComponent(g.slug)}">
              <div class="search-gal-date">${escapeHtml(formatDate(g.date))}</div>
              <div class="search-gal-name">${escapeHtml(g.name)}</div>
              ${g.tags && g.tags.length ? renderTags(g.tags) : ''}
            </a>`;
          }
          html += `</div></div>`;
        }
        if (matchedPhotos.length > 0) {
          html += `<div class="search-section">
            <h2 class="search-section-title">Photos <span style="color:var(--volt);font-size:.7em">/ ${matchedPhotos.length}</span></h2>
            <div class="search-photo-grid">`;
          for (const p of matchedPhotos) {
            html += `<a class="search-photo-thumb" href="#gallery=${encodeURIComponent(p.gallerySlug)}&photo=${encodeURIComponent(p.thumbnail)}">
              <img src="galleries/${escapeHtml(p.gallerySlug)}/${escapeHtml(p.thumbnail)}" alt="${escapeHtml(p.alt)}" loading="lazy">
              <div class="search-photo-caption">${escapeHtml(p.alt || p.gallerySlug)}</div>
            </a>`;
          }
          html += `</div></div>`;
        }
      }

      html += '</div>';
      searchResultsEl.innerHTML = html;
      showSearchView();
    } catch (_e) {
      searchResultsEl.innerHTML = '<div class="search-wrap"><div class="search-no-results">Search unavailable.</div></div>';
      showSearchView();
    }
  }

  function renderTags(tags) {
    if (!tags || tags.length === 0) return "";
    const chips = tags
      .map((t) => `<a class="chip" href="#search=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`)
      .join("");
    return `<div class="chips">${chips}</div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function formatDate(str) {
    const match = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return str;
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    if (month < 0 || month > 11) return str;
    return `${ordinal(day)} ${monthNames[month]} ${year}`;
  }

  // Short date format for gallery cards: "17 May 2026"
  function formatDateShort(str) {
    const match = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return str;
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if (month < 0 || month > 11) return str;
    return `${day} ${monthNames[month]} ${year}`;
  }

  function showSearchView() {
    app.hidden = true;
    searchResultsEl.hidden = false;
  }

  function showGalleryView() {
    app.hidden = false;
    searchResultsEl.hidden = true;
  }

  // ===== Router =====
  function getRoute() {
    const hash = location.hash.slice(1);
    if (!hash) return { view: "home" };
    const params = new URLSearchParams(hash);
    const gallery = params.get("gallery");
    const search = params.get("search");
    const photo = params.get("photo");
    if (gallery) return { view: "gallery", gallery, photo };
    if (search !== null) return { view: "search", query: search };
    return { view: "home" };
  }

  async function route() {
    const { view, gallery, query, photo } = getRoute();
    const pageviewProps = {};
    if (view === 'gallery' && gallery) pageviewProps.gallery_slug = gallery;
    if (view === 'search' && query) pageviewProps.search_query = query;
    posthog.capture('$pageview', pageviewProps);
    if (view === "search") {
      searchInput.value = query || "";
      await renderSearch(query || "");
    } else if (view === "gallery" && gallery) {
      showGalleryView();
      searchInput.value = "";
      await renderGallery(gallery, photo);
    } else {
      showGalleryView();
      searchInput.value = "";
      await renderHome();
    }
  }

  window.addEventListener("hashchange", () => {
    if (!lightboxEl.hidden) closeLightbox();
    route();
  });

  // ===== Homepage Renderer =====
  async function renderHome() {
    app.innerHTML = '<div class="loading">Loading galleries&hellip;</div>';
    try {
      const galleries = await fetchGalleries();
      const heroSrc = galleries[0]?.cover || "";

      const wrap = document.createElement("div");

      // Hero
      const hero = document.createElement("div");
      hero.className = "hero";
      hero.innerHTML = `
        ${heroSrc ? `<div class="hero-bg"><img src="${heroSrc}" alt=""></div>` : ""}
        <div class="wrap hero-inner">
          <div class="hero-idx">
            <span class="n">01</span>
            <span class="rule"></span>
            <span class="lbl">Latest match</span>
          </div>
          <span class="eyebrow">Grassroots football &middot; pitch-side</span>
          <h1>Full time is just<br>the <span class="o">start</span>.</h1>
          <p class="hero-lead">Cinematic match galleries from your local pitches &mdash; every goal, every gut-punch, free to browse and download.</p>
          <div class="hero-actions">
            <button class="btn solid" id="hero-browse">Browse galleries</button>
          </div>
        </div>
      `;
      wrap.appendChild(hero);

      // Grid section
      const inner = document.createElement("div");
      inner.className = "wrap";
      inner.innerHTML = `
        <div class="sec-head" id="galleries-grid-anchor">
          <div class="h-l">
            <h2>Galleries</h2>
            <span class="cnt">/ ${galleries.length}</span>
          </div>
        </div>
      `;

      const grid = document.createElement("div");
      grid.className = "gal-grid";

      // Reveal-on-scroll observer
      const io = window.IntersectionObserver
        ? new IntersectionObserver((entries) => {
            entries.forEach((e) => {
              if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
            });
          }, { rootMargin: "0px 0px -8% 0px" })
        : null;

      galleries.forEach((g, i) => {
        const el = document.createElement("article");
        el.className = "gal";
        const firstTag = g.tags && g.tags.length ? escapeHtml(g.tags[0]) : "";
        const dateFmt = escapeHtml(formatDateShort(g.date));
        el.innerHTML = `
          <span class="gal-no">${String(i + 1).padStart(2, "0")}</span>
          <img src="${g.cover}" alt="${escapeHtml(g.name)}" loading="lazy">
          <div class="gal-body">
            <div class="gal-meta">
              ${firstTag ? `<span>${firstTag}</span><span class="dot"></span>` : ""}
              <span class="gm-d">${dateFmt}</span>
            </div>
            <h3>${escapeHtml(g.name)}</h3>
            ${g.tags && g.tags.length > 1 ? `<div class="chips">${g.tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
          </div>
        `;
        el.addEventListener("click", () => {
          location.hash = "#gallery=" + encodeURIComponent(g.slug);
        });
        if (io) io.observe(el); else el.classList.add("in");
        grid.appendChild(el);
      });

      inner.appendChild(grid);
      wrap.appendChild(inner);

      app.innerHTML = "";
      app.appendChild(wrap);

      // Wire up hero browse button after mount
      document.getElementById("hero-browse")?.addEventListener("click", () => {
        document.getElementById("galleries-grid-anchor")?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (_e) {
      app.innerHTML = '<div class="loading">Failed to load galleries.</div>';
    }
  }

  // ===== Gallery Renderer =====
  let currentPhotos = [];
  let currentIndex = 0;
  let currentGallerySlug = null;
  let currentGalleryName = null;
  let lightboxLoadGen = 0;

  async function renderGallery(slug, photoId) {
    app.innerHTML = '<div class="loading">Loading gallery&hellip;</div>';
    try {
      // Fetch detail and gallery list in parallel (galleries may be cached)
      const [detail, galleries] = await Promise.all([
        fetchGalleryDetail(slug),
        fetchGalleries(),
      ]);
      currentPhotos = detail.photos;
      currentGallerySlug = slug;
      currentGalleryName = detail.name;
      posthog.capture('gallery_viewed', {
        gallery_slug: slug,
        gallery_name: detail.name,
        photo_count: detail.photos.length,
      });

      const galleryInfo = galleries.find((g) => g.slug === slug);
      const coverSrc = galleryInfo?.cover || "";

      const wrap = document.createElement("div");

      // Detail hero
      const heroEl = document.createElement("div");
      heroEl.className = "detail-hero";
      const tagsMeta = (detail.tags || []).map(t => `<span>${escapeHtml(t)}</span>`).join("");
      heroEl.innerHTML = `
        ${coverSrc ? `<div class="dh-bg"><img src="${coverSrc}" alt=""></div>` : ""}
        <div class="wrap detail-hero-inner">
          <button class="back" id="detail-back">&#8592; All galleries</button>
          <h1>${escapeHtml(detail.name)}</h1>
          <div class="detail-meta">
            <span class="v">${escapeHtml(formatDate(detail.date))}</span>
            <span>${detail.photos.length} photos</span>
            ${tagsMeta}
          </div>
          ${detail.description ? `<p class="detail-blurb">${escapeHtml(detail.description)}</p>` : ""}
        </div>
      `;
      wrap.appendChild(heroEl);

      // Masonry section
      const inner = document.createElement("div");
      inner.className = "wrap";

      // Build masonry grid
      const masonry = buildMasonry(detail.photos);

      // Build tag filter from photo tags
      const photoTags = [...new Set(detail.photos.flatMap((p) => p.tags || []))]
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      if (photoTags.length) {
        const filtersEl = document.createElement("div");
        filtersEl.className = "filters";
        filtersEl.innerHTML = `<span class="fl-label">Filter</span>`;
        inner.appendChild(filtersEl);

        const activeFilters = new Set();

        const allBtn = document.createElement("button");
        allBtn.className = "fbtn active";
        allBtn.textContent = "All";
        filtersEl.appendChild(allBtn);

        const tagBtns = [allBtn];
        photoTags.forEach((t) => {
          const btn = document.createElement("button");
          btn.className = "fbtn";
          btn.textContent = t;
          filtersEl.appendChild(btn);
          tagBtns.push(btn);
          btn.addEventListener("click", () => {
            if (activeFilters.has(t)) {
              activeFilters.delete(t);
              btn.classList.remove("active");
            } else {
              activeFilters.add(t);
              btn.classList.add("active");
            }
            allBtn.classList.toggle("active", activeFilters.size === 0);
            applyFilter();
          });
        });
        allBtn.addEventListener("click", () => {
          activeFilters.clear();
          tagBtns.forEach((b, i) => b.classList.toggle("active", i === 0));
          applyFilter();
        });

        function applyFilter() {
          masonry.querySelectorAll(".masonry-item").forEach((item) => {
            if (activeFilters.size === 0) {
              item.hidden = false;
            } else {
              const itemTags = item.dataset.tags ? item.dataset.tags.split(",") : [];
              item.hidden = !itemTags.some((tag) => activeFilters.has(tag));
            }
          });
        }
      }

      inner.appendChild(masonry);

      wrap.appendChild(inner);
      app.innerHTML = "";
      app.appendChild(wrap);

      // Wire back button
      document.getElementById("detail-back")?.addEventListener("click", () => {
        history.back();
      });

      if (photoId) {
        const prefixedId = `galleries/${slug}/${photoId}`;
        const index = currentPhotos.findIndex((p) => p.thumbnail === prefixedId);
        if (index !== -1) openLightbox(index);
      }
    } catch (_e) {
      app.innerHTML = '<div class="loading">Failed to load gallery.</div>';
    }
  }

  function buildMasonry(photos) {
    const masonry = document.createElement("div");
    masonry.className = "masonry";
    photos.forEach((photo, index) => {
      const item = document.createElement("div");
      item.className = "masonry-item";
      if (photo.tags && photo.tags.length) {
        item.dataset.tags = photo.tags.map((t) => t.toLowerCase()).join(",");
      }
      item.innerHTML = `<img src="${photo.thumbnail}" alt="${escapeHtml(photo.alt || "")}" loading="lazy">`;
      item.addEventListener("click", () => openLightbox(index));
      masonry.appendChild(item);
    });
    return masonry;
  }

  // ===== Lightbox Download =====
  async function downloadPhoto(photo) {
    posthog.capture('photo_downloaded', {
      gallery_slug: currentGallerySlug,
      gallery_name: currentGalleryName,
      photo_alt: photo.alt || '',
      photo_filename: photo.full.split('/').pop(),
    });
    const url = photo.full;
    const filename = url.split("/").pop() || "photo.jpg";
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (_e) {
      window.open(url, "_blank");
    }
  }

  // ===== Lightbox Controller =====
  function openLightbox(index) {
    currentIndex = index;
    showLightboxImage(index);
    lightboxEl.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    lightboxEl.hidden = true;
    document.body.classList.remove("lightbox-open");
    lightboxImg.classList.remove("on");
    lightboxImg.src = "";
  }

  function showLightboxImage(index) {
    currentIndex = index;
    const photo = currentPhotos[index];
    posthog.capture('photo_viewed', {
      gallery_slug: currentGallerySlug,
      gallery_name: currentGalleryName,
      photo_index: index,
      photo_alt: photo.alt || '',
    });

    lightboxImg.classList.remove("on");
    lightboxImg.src = "";
    lightboxImg.alt = photo.alt || "";

    // Top bar: caption with index + alt
    const capEl = document.getElementById("lb-cap");
    if (capEl) {
      capEl.innerHTML = `<b>${index + 1} / ${currentPhotos.length}</b> &nbsp;&middot;&nbsp; ${escapeHtml(photo.alt || "")}`;
    }

    // Bottom bar: count
    const countEl = document.getElementById("lb-count");
    if (countEl) countEl.textContent = `${index + 1} of ${currentPhotos.length}`;

    if (lightboxDownload) lightboxDownload.onclick = () => downloadPhoto(photo);

    const gen = ++lightboxLoadGen;
    const img = new Image();
    img.src = photo.full;
    const applyImage = () => {
      if (gen !== lightboxLoadGen) return;
      lightboxImg.src = photo.full;
      lightboxImg.classList.add("on");
    };
    img.decode().then(applyImage).catch(applyImage);

    // Preload adjacent
    if (index > 0) { const prev = new Image(); prev.src = currentPhotos[index - 1].full; }
    if (index < currentPhotos.length - 1) { const next = new Image(); next.src = currentPhotos[index + 1].full; }
  }

  function prevImage() {
    if (currentPhotos.length === 0) return;
    showLightboxImage((currentIndex - 1 + currentPhotos.length) % currentPhotos.length);
  }

  function nextImage() {
    if (currentPhotos.length === 0) return;
    showLightboxImage((currentIndex + 1) % currentPhotos.length);
  }

  // Lightbox event listeners
  lightboxClose.addEventListener("click", closeLightbox);
  lightboxPrev.addEventListener("click", prevImage);
  lightboxNext.addEventListener("click", nextImage);

  lightboxEl.addEventListener("click", (e) => {
    if (e.target === lightboxEl || e.target.classList.contains("lb-stage")) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (lightboxEl.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") prevImage();
    if (e.key === "ArrowRight") nextImage();
  });

  let touchStartX = 0;
  lightboxEl.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });
  lightboxEl.addEventListener("touchend", (e) => {
    if (lightboxEl.hidden) return;
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (delta > 50) prevImage();
    else if (delta < -50) nextImage();
  });

  // ===== Search Input =====
  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value;
    searchDebounce = setTimeout(() => {
      if (q.trim()) {
        history.replaceState(null, "", "#search=" + encodeURIComponent(q));
        renderSearch(q);
      } else {
        history.replaceState(null, "", "#");
        showGalleryView();
        route();
      }
    }, 150);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      searchInput.blur();
      history.replaceState(null, "", "#");
      showGalleryView();
      route();
    }
  });

  // Press / to focus search (when not in an input)
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  // ===== Init =====
  route();
})();
