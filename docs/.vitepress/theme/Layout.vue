<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';

const downloads = [
  {
    os: 'macOS',
    href: '#',
    icon: 'M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z',
  },
  {
    os: 'Windows',
    href: '#',
    icon: 'M3 5.1 10.2 4.1v6.7H3V5.1zm8.1-1.1L21 2.6v8.2h-9.9V4zm-8.1 8.2h7.2V19L3 17.9v-5.7zm8.1.1H21V21l-9.9-1.5v-7.2z',
  },
  {
    os: 'Linux',
    href: '#',
    fillRule: 'evenodd',
    icon: 'M19 16c0 1.72-.63 3.3-1.66 4.5c.41.39.66.91.66 1.5H6c0-.59.25-1.11.66-1.5A6.9 6.9 0 0 1 5 16H3c0-1.25.57-2.36 1.46-3.09l.01-.02A6 6 0 0 0 7 8V7a5 5 0 0 1 5-5a5 5 0 0 1 5 5v1c0 2 1 3.81 2.53 4.89l.01.02c.89.73 1.46 1.84 1.46 3.09zm-3 0a4 4 0 0 0-4-4a4 4 0 0 0-4 4a4 4 0 0 0 4 4a4 4 0 0 0 4-4m-6-7l2 1.5L14 9l-2-1.5zm0-4a1 1 0 0 0-1 1a1 1 0 0 0 1 1a1 1 0 0 0 1-1a1 1 0 0 0-1-1m4 0a1 1 0 0 0-1 1a1 1 0 0 0 1 1a1 1 0 0 0 1-1a1 1 0 0 0-1-1',
  },
];
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-image>
      <div class="hero-aside">
        <img class="hero-logo" src="/logo.png" alt="Sapphire" />
      </div>
    </template>
    <template #home-hero-actions-after>
      <div class="hero-downloads">
        <span class="hero-downloads-label">Скачать для</span>
        <a
          v-for="item in downloads"
          :key="item.os"
          class="hero-download"
          :href="item.href"
          :aria-label="`Скачать для ${item.os}`"
          :title="item.os"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              :fill-rule="item.fillRule || 'nonzero'"
              :d="item.icon"
            />
          </svg>
        </a>
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
