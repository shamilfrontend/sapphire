<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref } from 'vue';
import AgentsThreadTree from '../agents-window-tsx/AgentsThreadTree.vue';

defineProps<{
  onThreadOpen: () => void;
}>();

const editingFolderId = ref<string | null>(null);
</script>

<template>
  <AgentsThreadTree
    filterText=""
    :editingFolderId="editingFolderId"
    :onEditingFolderIdChange="(id: string | null) => { editingFolderId = id; }"
    :onThreadOpen="onThreadOpen"
  />
</template>
