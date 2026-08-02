<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

<main class="shell">
  <header>
    <span class="eyebrow">SvelteKit</span>
    <nav><a href="/">Overview</a><a href="/jobs">Jobs</a></nav>
  </header>
  {@render children()}
</main>
