<template>
  <div class="user-card">
    <h2>{{ name }}</h2>
    <p>{{ email }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ name: string; email: string }>()
</script>
