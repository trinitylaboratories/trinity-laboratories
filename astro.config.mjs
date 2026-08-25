import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
        MarkdownContent: './src/components/records/RecordsMarkdownContent.astro',
        PageSidebar: './src/components/records/RecordsPageSidebar.astro',
        PageTitle: './src/components/records/RecordsPageTitle.astro',
        SiteTitle: './src/components/records/TirnSiteTitle.astro',
        ThemeSelect: './src/components/records/NoThemeSelect.astro',
      },
      sidebar: [
        {
          label: 'Institutional Systems',
          items: [
            { label: 'Records Gateway', link: '/records/' },
            { label: 'Staff Portal', link: '/portal/' },
            { label: 'Employee Access', link: '/employee-access/' },
            { label: 'Public Website', link: '/' },
          ],
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'robots',
            content: 'noindex, nofollow, noarchive',
          },
        },
      ],
    }),
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        return !pathname.startsWith('/portal/') && !pathname.startsWith('/records/');
      },
    }),
  ],
});
