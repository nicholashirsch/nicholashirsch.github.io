import { defineConfig } from 'vite'
import { existsSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Vite only walks the module graph from the entries named here. index.html is
   the default when there is one page; the moment there are two, an unlisted
   one still works in dev and then silently vanishes from the build.

   The package is type: module, so __dirname does not exist -- hence the URL
   round-trip rather than the resolve(__dirname, ...) form the docs use. */
const root = dirname(fileURLToPath(import.meta.url))

/* GitHub Pages answers /projects with a 301 to /projects/ and then serves the
   index.html sitting there. Vite's dev and preview servers do not: they default
   to appType 'spa', which answers any path that matches nothing with a silent
   200 serving the ROOT index.html. So /projects locally returns the home page
   -- no redirect, no 404, nothing to suggest the response was invented -- and
   every banner link looks broken in a way that does not reproduce in
   production. This puts the redirect back so local matches the live site.

   Only ever redirects: it does not serve a byte, so it cannot disagree with
   what the static host would hand back. Paths that already end in a slash, or
   that carry a file extension, are left alone -- those are the asset requests,
   and Vite's own middlewares handle them. A path with no index.html behind
   it is left to 404, which is what the live site does with it. */
const directoryRedirect = (dir) => (req, res, next) => {
  const { pathname, search } = new URL(req.url, 'http://localhost')

  if (pathname === '/' || pathname.endsWith('/') || extname(pathname)) {
    return next()
  }

  /* The path is interpolated into a filesystem lookup below, so a traversal
     has to be refused rather than normalised -- resolve() would happily walk
     out of the directory and report on a file that is not part of the site. */
  if (pathname.includes('..')) return next()

  if (!existsSync(resolve(dir, `.${pathname}`, 'index.html'))) return next()

  /* 301 rather than 302: this is what Pages sends, and matching it means the
     browser caches the redirect exactly as it will in production. */
  res.statusCode = 301
  res.setHeader('Location', `${pathname}/${search}`)
  res.end()
}

/* Both servers, because both have the fallback and either one can be the thing
   you happen to be pointing a phone at. middlewares.use() inside these hooks
   runs BEFORE Vite's internal stack -- returning a function instead would queue
   it after, which is too late: the SPA fallback would already have answered. */
const directoryRedirectPlugin = {
  name: 'directory-index-redirect',
  configureServer(server) {
    server.middlewares.use(directoryRedirect(server.config.root))
  },
  configurePreviewServer(server) {
    server.middlewares.use(directoryRedirect(server.config.build.outDir))
  },
}

export default defineConfig({
  /* base stays at its default '/'. This deploys from the nicholashirsch.github.io
     repo, which GitHub serves at the domain root, so no prefix is needed.

     Do not set base to a subpath without also making every <a href> relative.
     Vite rewrites asset URLs -- link, script, img -- but never plain navigation
     links, and this site has eleven root-absolute ones across three pages. They
     would all point outside the site and 404 while the assets loaded fine,
     which makes it look like the pages are simply missing. */

  /* The redirect above only covers paths that DO have an index.html behind
     them. Everything else still meets the appType default of 'spa', which
     answers it with a 200 and the home page -- so a typo in a link, or an asset
     that failed to resolve, looks like a working page instead of the 404 the
     live site would return. There is no client-side router here to need that
     fallback; every route is a real file on disk. */
  appType: 'mpa',

  plugins: [directoryRedirectPlugin],

  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        /* Directory-per-page, not projects.html: a static host has no router,
           so /projects is only a real URL if there is a projects/index.html
           sitting at that path. Vite mirrors this layout into dist. */
        projects: resolve(root, 'projects/index.html'),
        contact: resolve(root, 'contact/index.html'),
      },
    },
  },
})
