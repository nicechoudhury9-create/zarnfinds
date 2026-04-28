(function () {
  const state = {
    catalog: null,
    activeCategory: "all",
    search: ""
  };

  const categoryTabs = document.getElementById("category-tabs");
  const productGrid = document.getElementById("product-grid");
  const featuredGrid = document.getElementById("featured-grid");
  const categoryPreview = document.getElementById("category-preview");
  const miniStack = document.getElementById("home-featured-mini");
  const emptyState = document.getElementById("empty-state");
  const productSearch = document.getElementById("product-search");

  async function loadCatalog() {
    try {
      const response = await fetch("/api/catalog");
      if (!response.ok) {
        throw new Error("Could not load catalog");
      }
      state.catalog = await response.json();
      renderHome();
      renderFinds();
    } catch (error) {
      renderError(error.message);
    }
  }

  function categoryMap() {
    const map = new Map();
    (state.catalog?.categories || []).forEach((category) => {
      map.set(category.id, category);
    });
    return map;
  }

  function productsForView() {
    const searchTerm = state.search.trim().toLowerCase();
    return (state.catalog?.products || []).filter((product) => {
      const matchesCategory = state.activeCategory === "all" || product.categoryId === state.activeCategory;
      const matchesSearch = !searchTerm || product.title.toLowerCase().includes(searchTerm);
      return matchesCategory && matchesSearch;
    });
  }

  function renderHome() {
    if (!state.catalog) {
      return;
    }
    renderCategoryPreview();
    renderFeaturedProducts();
    renderMiniStack();
  }

  function renderCategoryPreview() {
    if (!categoryPreview) {
      return;
    }
    const products = state.catalog.products || [];
    const cards = (state.catalog.categories || []).map((category) => {
      const count = products.filter((product) => product.categoryId === category.id).length;
      const card = document.createElement("article");
      card.className = "collection-card";

      const title = document.createElement("h3");
      title.textContent = category.name;

      const description = document.createElement("p");
      description.textContent = category.description || "Fresh affiliate picks for your blog audience.";

      const meta = document.createElement("div");
      meta.className = "collection-meta";
      meta.textContent = count === 1 ? "1 find" : `${count} finds`;

      card.append(title, description, meta);
      return card;
    });
    categoryPreview.replaceChildren(...cards);
  }

  function featuredProducts() {
    const products = state.catalog?.products || [];
    const featured = products.filter((product) => product.isFeatured);
    return (featured.length ? featured : products).slice(0, 4);
  }

  function renderFeaturedProducts() {
    if (!featuredGrid) {
      return;
    }
    const categories = categoryMap();
    const cards = featuredProducts().map((product) => createProductCard(product, categories));
    featuredGrid.replaceChildren(...cards);
  }

  function renderMiniStack() {
    if (!miniStack) {
      return;
    }
    const items = featuredProducts().slice(0, 3).map((product) => {
      const item = document.createElement("div");
      item.className = "mini-item";

      const image = document.createElement("img");
      image.src = product.imageSrc;
      image.alt = product.title;
      image.loading = "lazy";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = product.title;
      const price = document.createElement("span");
      price.textContent = product.priceLabel || "See latest price";
      copy.append(title, price);

      item.append(image, copy);
      return item;
    });
    miniStack.replaceChildren(...items);
  }

  function renderFinds() {
    if (!productGrid || !state.catalog) {
      return;
    }
    renderCategoryTabs();
    const categories = categoryMap();
    const cards = productsForView().map((product) => createProductCard(product, categories));
    productGrid.replaceChildren(...cards);
    if (emptyState) {
      emptyState.hidden = cards.length > 0;
    }
  }

  function renderCategoryTabs() {
    if (!categoryTabs) {
      return;
    }
    const tabs = [
      { id: "all", name: "All" },
      ...(state.catalog.categories || [])
    ].map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = category.name;
      button.className = category.id === state.activeCategory ? "active" : "";
      button.addEventListener("click", () => {
        state.activeCategory = category.id;
        renderFinds();
      });
      return button;
    });
    categoryTabs.replaceChildren(...tabs);
  }

  function createProductCard(product, categories) {
    const category = categories.get(product.categoryId);
    const card = document.createElement("article");
    card.className = "product-card";

    const image = document.createElement("img");
    image.src = product.imageSrc;
    image.alt = product.title;
    image.loading = "lazy";

    const body = document.createElement("div");
    body.className = "product-body";

    const categoryLabel = document.createElement("div");
    categoryLabel.className = "product-category";
    categoryLabel.textContent = category?.name || "Find";

    const title = document.createElement("div");
    title.className = "product-title";
    title.textContent = product.title;

    const price = document.createElement("div");
    price.className = "product-price";
    price.textContent = product.priceLabel || "See latest price";

    const link = document.createElement("a");
    link.className = "buy-link";
    link.href = product.affiliateUrl;
    link.target = "_blank";
    link.rel = "sponsored noopener noreferrer";
    link.textContent = "View deal";

    body.append(categoryLabel, title, price, link);
    card.append(image, body);
    return card;
  }

  function renderError(message) {
    const target = productGrid || featuredGrid || categoryPreview || miniStack;
    if (!target) {
      return;
    }
    const error = document.createElement("p");
    error.className = "empty-state";
    error.textContent = `${message}. Start the backend with npm start and open this page from http://localhost:3000.`;
    target.replaceChildren(error);
  }

  if (productSearch) {
    productSearch.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderFinds();
    });
  }

  loadCatalog();
})();
