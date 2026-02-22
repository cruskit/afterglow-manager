(function () {
  "use strict";

  const app = document.getElementById("app");
  const lightboxEl = document.getElementById("lightbox");
  const lightboxImg = lightboxEl.querySelector(".lightbox-img");
  const lightboxClose = lightboxEl.querySelector(".lightbox-close");
  const lightboxPrev = lightboxEl.querySelector(".lightbox-prev");
  const lightboxNext = lightboxEl.querySelector(".lightbox-next");

  // ===== Data Cache =====
  let galleriesCache = null;
  const galleryDetailCache = new Map();

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

  // ===== Router =====
  function getRoute() {
    const hash = location.hash.slice(1);
    if (!hash) return { view: "home" };
    const params = new URLSearchParams(hash);
    const gallery = params.get("gallery");
    if (gallery) return { view: "gallery", gallery };
    return { view: "home" };
  }

  async function route() {
    const { view, gallery } = getRoute();
    if (view === "gallery" && gallery) {
      await renderGallery(gallery);
    } else {
      await renderHome();
    }
  }

  window.addEventListener("hashchange", route);

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
          <img class="gallery-tile-img" src="${g.cover}" alt="${g.name}" loading="lazy">
          <div class="gallery-tile-info">
            <div class="gallery-tile-name">${g.name}</div>
            <div class="gallery-tile-date">${g.date}</div>
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
        <h1 class="gallery-title">${detail.name}</h1>
        <div class="gallery-date">${detail.date}</div>
        ${detail.description ? `<p class="gallery-description">${detail.description}</p>` : ""}
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

  // ===== Init =====
  route();
})();
