<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref } from 'vue';
import { ChatImageAttachment } from '../../../../common/chatThreadServiceTypes.js';
import { chatImageToDataUrl } from '../../../../common/chatImageUtils.js';
import IconX from './IconX.vue';
import ImageLightbox from './ImageLightbox.vue';

const props = defineProps<
  | {
      type: 'past';
      images: ChatImageAttachment[];
      setImages?: undefined;
    }
  | {
      type: 'staging';
      images: ChatImageAttachment[];
      setImages: (imgs: ChatImageAttachment[]) => void;
    }
>();

const lightboxImage = ref<ChatImageAttachment | null>(null);
</script>

<template>
  <template v-if="images.length">
    <div class="flex flex-wrap gap-1.5 mb-1.5">
      <div
        v-for="img in images"
        :key="img.id"
        class="relative group rounded-md overflow-hidden border border-void-border-3 bg-void-bg-2 cursor-pointer"
        @click="lightboxImage = img"
      >
        <img
          :src="chatImageToDataUrl(img)"
          alt=""
          class="block h-14 w-auto max-w-[120px] object-cover"
        />
        <button
          v-if="type === 'staging' && setImages"
          type="button"
          class="absolute top-0.5 right-0.5 rounded-full bg-black/60 text-white p-0.5 opacity-80 hover:opacity-100 cursor-pointer"
          title="Убрать"
          @click.stop="setImages(props.images.filter((x) => x.id !== img.id))"
        >
          <IconX class="stroke-[2]" :size="10" />
        </button>
      </div>
    </div>
    <ImageLightbox
      v-if="lightboxImage"
      :image="lightboxImage"
      :onClose="() => { lightboxImage = null; }"
    />
  </template>
</template>
