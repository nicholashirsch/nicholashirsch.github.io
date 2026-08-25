import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Vite only walks the module graph from the entries named here. index.html is
   the default when there is one page; the moment there are two, an unlisted
   one still works in dev and then silently vanishes from the build.

   The package is type: module, so __dirname does not exist -- hence the URL
   round-trip rather than the resolve(__dirname, ...) form the docs use. */
const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  /* base stays at its default '/'. This deploys from the nicholashirsch.github.io
     repo, which GitHub serves at the domain root, so no prefix is needed.

     Do not set base to a subpath without also making every <a href> relative.
     Vite rewrites asset URLs -- link, script, img -- but never plain navigation
     links, and this site has eleven root-absolute ones across three pages. They
     would all point outside the site and 404 while the assets loaded fine,
     which makes it look like the pages are simply missing. */

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
