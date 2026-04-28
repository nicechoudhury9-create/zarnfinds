(function () {
  const unlockForm = document.getElementById("unlock-form");
  const passwordInput = document.getElementById("admin-password");
  const logoutButton = document.getElementById("logout-button");
  const adminPanel = document.getElementById("admin-panel");
  const adminStatus = document.getElementById("admin-status");
  const categoryForm = document.getElementById("category-form");
  const productForm = document.getElementById("product-form");
  const categorySelect = document.getElementById("category-select");
  const categoryList = document.getElementById("category-list");
  const productList = document.getElementById("product-list");

  let catalog = null;

  function setStatus(message, isError) {
    adminStatus.textContent = message || "";
    adminStatus.classList.toggle("error", Boolean(isError));
  }

  async function api(path, options) {
    const request = options || {};
    const headers = new Headers(request.headers || {});
    if (request.body && !(request.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(path, {
      ...request,
      credentials: "same-origin",
      headers,
      body: request.body && !(request.body instanceof FormData) ? JSON.stringify(request.body) : request.body
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      if (response.status === 401) {
        hideAdmin();
      }
      throw new Error(data?.error || "Request failed");
    }
    return data;
  }

  async function refreshCatalog() {
    catalog = await api("/api/catalog");
    renderCategories();
    renderProducts();
  }

  function renderCategories() {
    const options = (catalog.categories || []).map((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      return option;
    });
    categorySelect.replaceChildren(...options);

    const productCounts = new Map();
    (catalog.products || []).forEach((product) => {
      productCounts.set(product.categoryId, (productCounts.get(product.categoryId) || 0) + 1);
    });

    const rows = (catalog.categories || []).map((category) => {
      const row = document.createElement("div");
      row.className = "admin-row";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = category.name;
      const meta = document.createElement("span");
      const count = productCounts.get(category.id) || 0;
      meta.textContent = count === 1 ? "1 product" : `${count} products`;
      copy.append(title, meta);

      const button = document.createElement("button");
      button.className = "small-button secondary";
      button.type = "button";
      button.textContent = "Delete";
      button.dataset.deleteCategory = category.id;

      row.append(copy, button);
      return row;
    });
    categoryList.replaceChildren(...rows);
  }

  function renderProducts() {
    const categories = new Map((catalog.categories || []).map((category) => [category.id, category.name]));
    const rows = (catalog.products || []).map((product) => {
      const row = document.createElement("div");
      row.className = "admin-row";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = product.title;
      const meta = document.createElement("span");
      meta.textContent = `${categories.get(product.categoryId) || "Find"} - ${product.priceLabel || "See latest price"}`;
      copy.append(title, meta);

      const button = document.createElement("button");
      button.className = "small-button danger";
      button.type = "button";
      button.textContent = "Delete";
      button.dataset.deleteProduct = product.id;

      row.append(copy, button);
      return row;
    });
    productList.replaceChildren(...rows);
  }

  function showAdmin() {
    document.body.classList.remove("is-locked");
    unlockForm.classList.add("hidden");
    logoutButton.classList.remove("hidden");
    adminPanel.classList.remove("hidden");
  }

  function hideAdmin() {
    document.body.classList.add("is-locked");
    unlockForm.classList.remove("hidden");
    logoutButton.classList.add("hidden");
    adminPanel.classList.add("hidden");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(new Error("Could not read image file")));
      reader.readAsDataURL(file);
    });
  }

  unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = passwordInput.value.trim();
    if (!password) {
      setStatus("Enter the admin password.", true);
      return;
    }

    try {
      setStatus("Signing in...");
      await api("/api/admin/login", {
        method: "POST",
        body: { password }
      });
      passwordInput.value = "";
      showAdmin();
      await refreshCatalog();
      setStatus("Admin unlocked.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch (error) {
      // Even if the server session is already gone, the UI should lock.
    }
    hideAdmin();
    setStatus("Admin locked.");
  });

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(categoryForm);
    try {
      setStatus("Creating category...");
      await api("/api/categories", {
        method: "POST",
        body: {
          name: formData.get("name"),
          description: formData.get("description")
        }
      });
      categoryForm.reset();
      await refreshCatalog();
      setStatus("Category created.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(productForm);
    const file = formData.get("imageFile");
    try {
      setStatus("Publishing product...");
      let image = null;
      if (file && file.size > 0) {
        image = {
          name: file.name,
          type: file.type,
          dataUrl: await readFileAsDataUrl(file)
        };
      }

      await api("/api/products", {
        method: "POST",
        body: {
          title: formData.get("title"),
          categoryId: formData.get("categoryId"),
          priceLabel: formData.get("priceLabel"),
          affiliateUrl: formData.get("affiliateUrl"),
          imageUrl: formData.get("imageUrl"),
          isFeatured: formData.get("isFeatured") === "on",
          image
        }
      });
      productForm.reset();
      await refreshCatalog();
      setStatus("Product published.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  categoryList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-category]");
    if (!button) {
      return;
    }
    if (!window.confirm("Delete this category? Empty categories only can be deleted.")) {
      return;
    }
    try {
      setStatus("Deleting category...");
      await api(`/api/categories/${button.dataset.deleteCategory}`, { method: "DELETE" });
      await refreshCatalog();
      setStatus("Category deleted.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  productList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-product]");
    if (!button) {
      return;
    }
    if (!window.confirm("Delete this product from the storefront?")) {
      return;
    }
    try {
      setStatus("Deleting product...");
      await api(`/api/products/${button.dataset.deleteProduct}`, { method: "DELETE" });
      await refreshCatalog();
      setStatus("Product deleted.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  async function boot() {
    hideAdmin();
    try {
      await api("/api/admin/check");
      showAdmin();
      await refreshCatalog();
      setStatus("Admin unlocked.");
    } catch (error) {
      setStatus("Enter the admin password to continue.");
    }
  }

  boot();
})();
