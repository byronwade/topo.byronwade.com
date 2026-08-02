<template>
  <main class="shell">
    <header>
      <span class="eyebrow">Vue + Vue Router</span>
      <nav>
        <RouterLink to="/">Overview</RouterLink>
        <RouterLink to="/projects">Projects</RouterLink>
      </nav>
    </header>
    <RouterView />
  </main>
</template>
