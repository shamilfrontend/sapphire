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

const onImageClick = (event: MouseEvent, img: ChatImageAttachment) => {
  const target = event.target instanceof Element ? event.target : null;
  // #region agent log
  fetch('http://127.0.0.1:7714/ingest/0d7d40a3-f671-45c9-9179-7225f077dfe2',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'22bbe4'},body:JSON.stringify({sessionId:'22bbe4',hypothesisId:'A',location:'SelectedImages.vue:onImageClick',message:'image thumbnail click',data:{type:props.type,tag:target?.tagName??null,className:target?.className??null,defaultPrevented:event.defaultPrevented},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  lightboxImage.value = img;
};
</script>

<template>
  <template v-if="images.length">
    <div class="flex flex-wrap gap-1.5 mb-1.5">
      <div
        v-for="img in images"
        :key="img.id"
        class="relative group rounded-md overflow-hidden border border-void-border-3 bg-void-bg-2 cursor-pointer"
        data-sapphire-image="1"
        @click="onImageClick($event, img)"
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
