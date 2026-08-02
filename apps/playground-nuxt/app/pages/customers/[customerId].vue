<script setup lang="ts">
const route = useRoute();
</script>
<template>
  <section data-topo-screen="nuxt-customer">
    <h1>Customer detail</h1>
    <p>{{ route.params.customerId }}</p>
  </section>
</template>
