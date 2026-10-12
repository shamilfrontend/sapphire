<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// LaTeX без KaTeX — показываем как текст/ошибку
defineProps<{ latex: string }>();
</script>

<template>
  <span class="katex-error text-red-500">{{ latex }}</span>
</template>
