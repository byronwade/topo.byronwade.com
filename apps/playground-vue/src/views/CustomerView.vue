<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template>
  <section data-topo-screen="vue-project">
    <h1>Project detail</h1>
    <p>{{ route.params.projectId }}</p>
  </section>
</template>
