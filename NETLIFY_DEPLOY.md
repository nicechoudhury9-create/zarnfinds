# Zaar Finds Netlify Deploy

Use this setup when you want the public site on Netlify and still want to add products later from `/admin.html`.

## Netlify Settings

Connect this full project folder to Netlify through Git or Netlify CLI. Do not drag-and-drop only the HTML files.

- Build command: `npm run build:netlify`
- Publish directory: `public`
- Functions directory: `netlify/functions`

These settings are already in `netlify.toml`.

## Environment Variables

In Netlify, open Site configuration, then Environment variables, and add:

- `ADMIN_PASSWORD`: your private admin password
- `ADMIN_SESSION_SECRET`: a long random private string

If you do not set `ADMIN_PASSWORD`, the fallback password is `zarn123@@`.

## After Deploy

- Public site: `https://your-site.netlify.app/home.html`
- Product page: `https://your-site.netlify.app/finds.html`
- Admin login: `https://your-site.netlify.app/admin.html`

Log in to admin, add categories or products, upload images, and paste your affiliate links. Product data and uploaded images are saved in Netlify Blobs.

## Important

Netlify drag-and-drop deploys are fine for static pages, but they will not set up the Functions and Blobs admin system reliably. Use Git deploy or Netlify CLI for this version.
