import { createRouter, createWebHistory } from "vue-router";

import CustomerView from "./views/CustomerView.vue";
import OverviewView from "./views/OverviewView.vue";
import ProjectsView from "./views/ProjectsView.vue";

const routes = [
  { path: "/", component: OverviewView },
  { path: "/projects", component: ProjectsView },
  { path: "/projects/:projectId", component: CustomerView },
];

export default createRouter({ history: createWebHistory(), routes });
