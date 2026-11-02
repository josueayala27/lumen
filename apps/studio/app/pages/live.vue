<script setup lang="ts">
import { definePageMeta } from '#imports'

// The Show workspace replaced the Live page; keep old links and bookmarks working.
definePageMeta({
  redirect: (to) => {
    const { playlist, ...rest } = to.query
    return { path: '/show', query: playlist ? { ...rest, rundown: playlist } : rest }
  },
})
</script>

<template>
  <div />
</template>
