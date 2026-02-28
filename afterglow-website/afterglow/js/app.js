(function () {
  "use strict";

  const app = document.getElementById("app");
  const searchResultsEl = document.getElementById("search-results");
  const searchInput = document.getElementById("search-input");
  const lightboxEl = document.getElementById("lightbox");
  const lightboxImg = lightboxEl.querySelector(".lightbox-img");
  const lightboxClose = lightboxEl.querySelector(".lightbox-close");
  const lightboxPrev = lightboxEl.querySelector(".lightbox-prev");
  const lightboxNext = lightboxEl.querySelector(".lightbox-next");
  const lightboxDownload = document.getElementById("lightbox-download");

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
    if (tags.length && !tags.every((t) => (item.tags || []).includes(t))) return false;
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

      let html = "";

      if (matchedGalleries.length === 0 && matchedPhotos.length === 0) {
        html = `<div class="search-no-results">No results for &ldquo;${escapeHtml(q)}&rdquo;</div>`;
      } else {
        if (matchedGalleries.length > 0) {
          html += `<div class="search-section"><h2 class="search-section-title">Galleries (${matchedGalleries.length})</h2><div class="gallery-grid">`;
          for (const g of matchedGalleries) {
            html += `<a class="gallery-tile" href="#gallery=${encodeURIComponent(g.slug)}">
              <div class="gallery-tile-info">
                <div class="gallery-tile-name">${escapeHtml(g.name)}</div>
                <div class="gallery-tile-date">${escapeHtml(formatDate(g.date))}</div>
              </div>
            </a>`;
          }
          html += `</div></div>`;
        }
        if (matchedPhotos.length > 0) {
          html += `<div class="search-section"><h2 class="search-section-title">Photos (${matchedPhotos.length})</h2><div class="search-photo-grid">`;
          for (const p of matchedPhotos) {
            html += `<a class="search-photo-thumb" href="#gallery=${encodeURIComponent(p.gallerySlug)}">
              <img src="galleries/${escapeHtml(p.gallerySlug)}/${escapeHtml(p.thumbnail)}" alt="${escapeHtml(p.alt)}" loading="lazy">
              <div class="search-photo-caption">${escapeHtml(p.alt || p.gallerySlug)}</div>
            </a>`;
          }
          html += `</div></div>`;
        }
      }

      searchResultsEl.innerHTML = html;
      showSearchView();
    } catch (_e) {
      searchResultsEl.innerHTML = `<div class="search-no-results">Search unavailable.</div>`;
      showSearchView();
    }
  }

  function renderTags(tags) {
    if (!tags || tags.length === 0) return "";
    const pills = tags
      .map((t) => `<a class="tag-pill" href="#search=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`)
      .join("");
    return `<div class="tag-list">${pills}</div>`;
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
    if (gallery) return { view: "gallery", gallery };
    if (search !== null) return { view: "search", query: search };
    return { view: "home" };
  }

  async function route() {
    const { view, gallery, query } = getRoute();
    if (view === "search") {
      searchInput.value = query || "";
      await renderSearch(query || "");
    } else if (view === "gallery" && gallery) {
      showGalleryView();
      searchInput.value = "";
      await renderGallery(gallery);
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
      const grid = document.createElement("div");
      grid.className = "gallery-grid";

      for (const g of galleries) {
        const tile = document.createElement("a");
        tile.className = "gallery-tile";
        tile.href = `#gallery=${encodeURIComponent(g.slug)}`;
        tile.innerHTML = `
          <img class="gallery-tile-img" src="${g.cover}" alt="${escapeHtml(g.name)}" loading="lazy">
          <div class="gallery-tile-info">
            <div class="gallery-tile-name">${escapeHtml(g.name)}</div>
            <div class="gallery-tile-date">${escapeHtml(formatDate(g.date))}</div>
            ${renderTags(g.tags)}
          </div>
        `;
        grid.appendChild(tile);
      }

      app.innerHTML = "";
      app.appendChild(grid);
    } catch (e) {
      app.innerHTML = '<div class="loading">Failed to load galleries.</div>';
    }
  }

  // ===== Gallery Renderer =====
  let currentPhotos = [];
  let currentIndex = 0;

  async function renderGallery(slug) {
    app.innerHTML = '<div class="loading">Loading gallery&hellip;</div>';
    try {
      const detail = await fetchGalleryDetail(slug);
      currentPhotos = detail.photos;

      const header = document.createElement("div");
      header.className = "gallery-header";
      header.innerHTML = `
        <a href="#" class="gallery-back">&larr; Back to galleries</a>
        <h1 class="gallery-title">${escapeHtml(detail.name)}</h1>
        <div class="gallery-date">${escapeHtml(formatDate(detail.date))}</div>
        ${detail.description ? `<p class="gallery-description">${detail.description}</p>` : ""}
        ${renderTags(detail.tags)}
      `;

      const masonry = document.createElement("div");
      masonry.className = "masonry";

      detail.photos.forEach((photo, index) => {
        const item = document.createElement("div");
        item.className = "masonry-item";
        item.innerHTML = `<img src="${photo.thumbnail}" alt="${photo.alt || ""}" loading="lazy">`;
        item.addEventListener("click", () => openLightbox(index));
        masonry.appendChild(item);
      });

      app.innerHTML = "";
      app.appendChild(header);
      app.appendChild(masonry);
    } catch (e) {
      app.innerHTML = '<div class="loading">Failed to load gallery.</div>';
    }
  }

  // ===== Lightbox Download =====
  async function downloadPhoto(photo) {
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
    lightboxImg.classList.remove("loaded");
    lightboxImg.src = "";
  }

  function showLightboxImage(index) {
    currentIndex = index;
    const photo = currentPhotos[index];
    lightboxImg.classList.remove("loaded");
    lightboxImg.alt = photo.alt || "";

    const captionEl = document.getElementById("lightbox-caption");
    if (captionEl) captionEl.innerHTML = renderTags(photo.tags);
    if (lightboxDownload) lightboxDownload.onclick = () => downloadPhoto(photo);

    const img = new Image();
    img.src = photo.full;
    img.decode().then(() => {
      lightboxImg.src = photo.full;
      lightboxImg.classList.add("loaded");
    }).catch(() => {
      lightboxImg.src = photo.full;
      lightboxImg.classList.add("loaded");
    });

    // Preload adjacent
    if (index > 0) {
      const prev = new Image();
      prev.src = currentPhotos[index - 1].full;
    }
    if (index < currentPhotos.length - 1) {
      const next = new Image();
      next.src = currentPhotos[index + 1].full;
    }
  }

  function prevImage() {
    if (currentPhotos.length === 0) return;
    const index = (currentIndex - 1 + currentPhotos.length) % currentPhotos.length;
    showLightboxImage(index);
  }

  function nextImage() {
    if (currentPhotos.length === 0) return;
    const index = (currentIndex + 1) % currentPhotos.length;
    showLightboxImage(index);
  }

  // Lightbox event listeners
  lightboxClose.addEventListener("click", closeLightbox);
  lightboxPrev.addEventListener("click", prevImage);
  lightboxNext.addEventListener("click", nextImage);

  lightboxEl.addEventListener("click", (e) => {
    if (e.target === lightboxEl || e.target.classList.contains("lightbox-img-container")) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (lightboxEl.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") prevImage();
    if (e.key === "ArrowRight") nextImage();
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
