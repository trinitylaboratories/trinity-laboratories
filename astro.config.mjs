import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const isIndexable = process.env.PUBLIC_INDEXABLE === 'true';

export default defineConfig({
  site: 'https://trinitylaboratories.org',
  output: 'static',
  trailingSlash: 'always',
  vite: {
    resolve: {
      preserveSymlinks: true,
    },
  },
  integrations: [
    starlight({
      title: 'Trinity Institutional Records Network',
      favicon: '/media/brand/trinity-icon.png',
      disable404Route: true,
      pagefind: true,
      customCss: ['./src/styles/records.css'],
      components: {
        SiteTitle: './src/components/records/TirnSiteTitle.astro',
        ThemeSelect: './src/components/records/NoThemeSelect.astro',
      },
      sidebar: [
        {
          label: 'Records Gateway',
          items: [
            { label: 'Dashboard', link: '/records/' },
            { label: 'Employee Access', link: '/employee-access/' },
            { label: 'Public Website', link: '/' },
          ],
        },
        {
          label: 'Security',
          items: [{ autogenerate: { directory: 'records/security' } }],
        },
        {
          label: 'Forms',
          items: [{ autogenerate: { directory: 'records/forms' } }],
        },
      ],
      head: isIndexable
        ? []
        : [
            {
              tag: 'meta',
              attrs: {
                name: 'robots',
                content: 'noindex, nofollow',
              },
            },
          ],
    }),
    sitemap(),
  ],
});
